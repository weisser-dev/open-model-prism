/**
 * Prompt Analyses — Prompt Quality Scoring
 *
 * Analyzes the N worst USER prompts from the request log using an LLM.
 * Only user messages (lastUserMessage) are evaluated — system prompts excluded.
 *
 * Scoring dimensions (0-100, 100 = perfect):
 *   specificity       — how specific and actionable the request is
 *   context           — does it include necessary context (code, stack, constraints)?
 *   outputDefinition  — does it specify expected format / scope / success criteria?
 *   modelFit          — is the complexity appropriate for the model used?
 *   tokenEfficiency   — is context size proportionate to task complexity?
 *
 * Routes:
 *   GET  /settings          — read config (adminOrMaint)
 *   PUT  /settings          — save config (adminOnly)
 *   POST /analyze           — trigger analysis run (adminOrMaint)
 *   GET  /results           — latest results (adminOrMaint)
 *   GET  /public            — public results endpoint (no auth, if publicEndpoint=true)
 */
import { Router } from 'express';
import SystemConfig from '../../models/SystemConfig.js';
import RequestLog from '../../models/RequestLog.js';
import Provider from '../../models/Provider.js';
import { adminOnly, adminOrMaint, canReadConfig } from '../../middleware/rbac.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { getProviderAdapter } from '../../providers/index.js';
import logger from '../../utils/logger.js';

const router = Router();

const CONFIG_KEY  = 'prompt_engineer_pros';
const RESULTS_KEY = 'prompt_engineer_pros_results';

const DEFAULTS = {
  enabled: false,
  publicEndpoint: false,
  providerId: '',        // preferred: reference to a configured Provider
  apiBase: 'https://api.openai.com/v1',  // fallback if no providerId
  apiKey: '',            // fallback if no providerId
  model: 'gpt-4o-mini',
  maxPrompts: 100,       // 0 = no limit (all), hard cap 2000
  maxPublicResults: 100, // max prompts shown on public page (max 200)
  minPromptLength: 20,   // skip prompts shorter than this (chars)
  ignoredCategories: [], // category slugs to skip during analysis
  autoAnalyze: false,    // nightly auto-analysis (opt-in, costs money)
  autoAnalyzeHour: 2,    // hour of day (0-23) to run auto-analysis
  inlineAnalysis: false, // analyze prompts in real-time after each routed request (fire-and-forget)
};

async function getSettings() {
  const doc = await SystemConfig.findOne({ key: CONFIG_KEY }).lean();
  return { ...DEFAULTS, ...(doc?.value || {}) };
}

// ── GET /settings ─────────────────────────────────────────────────────────────
router.get('/settings', canReadConfig, async (_req, res) => {
  try {
    const s = await getSettings();
    res.json({ ...s, apiKey: s.apiKey ? '••••••••' : '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /settings ─────────────────────────────────────────────────────────────
router.put('/settings', adminOnly, async (req, res) => {
  try {
    const current = await getSettings();
    const { apiKey, ...rest } = req.body;

    const update = { ...current, ...rest };
    if (apiKey && apiKey !== '••••••••') {
      update.apiKey = encrypt(apiKey);
    } else {
      update.apiKey = current.apiKey;
    }

    await SystemConfig.findOneAndUpdate(
      { key: CONFIG_KEY },
      { $set: { value: update } },
      { upsert: true, new: true },
    );
    res.json({ ...update, apiKey: update.apiKey ? '••••••••' : '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helper: resolve a Provider document for the analysis LLM ─────────────────
async function resolveProvider(settings) {
  if (settings.providerId) {
    const provider = await Provider.findById(settings.providerId);
    if (!provider) return { error: 'Configured provider not found — re-select it in the ⚙ settings.' };
    return { provider };
  }
  // Fallback: legacy apiBase + apiKey fields (raw OpenAI-compatible)
  const apiKey = decrypt(settings.apiKey || '');
  if (!apiKey) return { error: 'No provider selected. Select a provider in the ⚙ settings.' };
  // Synthesize a pseudo-provider doc so we can use OpenAIProvider adapter
  return {
    provider: {
      type: 'openai',
      config: {
        baseUrl: settings.apiBase || 'https://api.openai.com/v1',
        auth: { type: 'api_key', apiKey: settings.apiKey },
      },
    },
  };
}

// ── Helper: build candidate query + exclude already-analyzed ─────────────────
async function buildCandidateQuery(settings, { reset = false } = {}) {
  const ignoredCats = Array.isArray(settings.ignoredCategories) ? settings.ignoredCategories : [];
  // Source: human only — exclude FIM/autocomplete and tool-output continuations.
  // Category filter is independent (user-configurable ignored categories).
  const query = {
    'promptSnapshot.lastUserMessage': { $exists: true, $ne: '' },
    status: 'success',
    'routingSignals.isFimRequest': { $ne: true },
    'routingSignals.isToolOutputContinuation': { $ne: true },
    ...(ignoredCats.length ? { category: { $nin: ignoredCats } } : {}),
  };

  if (!reset) {
    // Exclude requestIds that were analyzed in the last run
    const prevDoc = await SystemConfig.findOne({ key: RESULTS_KEY }).lean();
    const prevIds = (prevDoc?.value?.results || []).map(r => r.requestId).filter(Boolean);
    if (prevIds.length) query._id = { $nin: prevIds };
  }

  return query;
}

// ── GET /preview ──────────────────────────────────────────────────────────────
router.get('/preview', canReadConfig, async (req, res) => {
  try {
    const settings  = await getSettings();
    if (!settings.enabled) return res.json({ count: 0, enabled: false });

    const reset     = req.query.reset === 'true';
    const maxPrompts = settings.maxPrompts === 0 ? 2000 : Math.min(Math.max(1, settings.maxPrompts || 100), 2000);
    const query     = await buildCandidateQuery(settings, { reset });
    const total     = await RequestLog.countDocuments(query);
    const count     = Math.min(total, maxPrompts);

    // Estimate tokens: eval prompt ≈ 400 input + 450 output per prompt
    const estimatedInputTokens  = count * 400;
    const estimatedOutputTokens = count * 450;

    const model = settings.model || 'gpt-4o-mini';
    let inputPer1M = 0.15, outputPer1M = 0.60;
    if (/gpt-4o(?!-mini)/i.test(model))   { inputPer1M = 2.50;  outputPer1M = 10.00; }
    else if (/gpt-4-/i.test(model))        { inputPer1M = 30.00; outputPer1M = 60.00; }
    else if (/claude.*opus/i.test(model))  { inputPer1M = 15.00; outputPer1M = 75.00; }
    else if (/claude.*sonnet/i.test(model)){ inputPer1M = 3.00;  outputPer1M = 15.00; }
    else if (/claude.*haiku/i.test(model)) { inputPer1M = 0.80;  outputPer1M = 4.00;  }

    const estimatedCost = (estimatedInputTokens / 1_000_000) * inputPer1M
                        + (estimatedOutputTokens / 1_000_000) * outputPer1M;

    // Count already-analyzed from previous run
    const prevDoc     = await SystemConfig.findOne({ key: RESULTS_KEY }).lean();
    const alreadyDone = (prevDoc?.value?.results || []).length;

    res.json({
      count,
      total,
      alreadyAnalyzed: alreadyDone,
      model,
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedCost: Math.round(estimatedCost * 10000) / 10000,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /analyze ─────────────────────────────────────────────────────────────
router.post('/analyze', adminOrMaint, async (_req, res) => {
  const settings = await getSettings();
  if (!settings.enabled) return res.status(400).json({ error: 'Prompt Analyses is disabled. Enable it in Settings first.' });

  const resolved = await resolveProvider(settings);
  if (resolved.error) return res.status(400).json({ error: resolved.error });
  const adapter = getProviderAdapter(resolved.provider);

  const reset = _req.body?.reset === true;
  const maxPrompts = settings.maxPrompts === 0 ? 2000 : Math.min(Math.max(1, settings.maxPrompts || 100), 2000);
  const query = await buildCandidateQuery(settings, { reset });

  // Fetch more than maxPrompts to allow for de-duplication and filtering.
  // No .populate() — resolve tenant slugs separately to avoid expensive joins.
  const fetchLimit = Math.min(maxPrompts * 3, 5000);
  const rawCandidates = await RequestLog.find(
    query,
    {
      'promptSnapshot.lastUserMessage': 1,
      routedModel: 1, requestedModel: 1,
      inputTokens: 1, outputTokens: 1, actualCostUsd: 1,
      category: 1, costTier: 1, timestamp: 1,
      tenantId: 1, sessionId: 1, systemPromptHash: 1,
    },
  )
    .sort({ actualCostUsd: -1 })
    .limit(fetchLimit)
    .lean();

  // Resolve tenant slugs in one query (instead of per-doc populate)
  const tenantIds = [...new Set(rawCandidates.map(r => String(r.tenantId)).filter(Boolean))];
  const tenantMap = {};
  if (tenantIds.length) {
    const tenants = await (await import('../../models/Tenant.js')).default
      .find({ _id: { $in: tenantIds } }, { slug: 1 }).lean();
    for (const t of tenants) tenantMap[String(t._id)] = t.slug;
  }

  // De-duplicate: keep only one request per (systemPromptHash + category + model).
  // Most coding tools don't send x-session-id, so each request gets a new UUID —
  // but systemPromptHash identifies the same coding session (same agent, same context).
  // We keep the highest-cost instance (sorted by cost desc) for each group.
  const seenGroups = new Set();
  const candidates = [];
  for (const r of rawCandidates) {
    const groupKey = [
      r.systemPromptHash || '',
      r.category || '',
      r.routedModel || '',
    ].join('|');
    // Allow through if no systemPromptHash (can't de-dup without it)
    if (r.systemPromptHash && seenGroups.has(groupKey)) continue;
    if (r.systemPromptHash) seenGroups.add(groupKey);
    candidates.push(r);
    if (candidates.length >= maxPrompts) break;
  }

  if (!candidates.length) {
    return res.status(400).json({ error: 'No user messages found. Enable prompt logging (capture depth: last user message) in Logging Configuration first.' });
  }

  // Start background analysis — save progress after every batch
  analysisRunning = true;
  analysisProgress = { total: candidates.length, done: 0, failed: 0, skipped: 0 };
  res.json({ status: 'started', total: candidates.length });
  runAnalysis(adapter, settings, candidates, reset, tenantMap)
    .catch(err => logger.warn('[prompt-engineer] Background analysis error:', err.message))
    .finally(() => { analysisRunning = false; });
});

// ── GET /progress — live progress of running analysis ────────────────────────
let analysisRunning = false;
let analysisProgress = { total: 0, done: 0, failed: 0, skipped: 0 };

router.get('/progress', canReadConfig, (_req, res) => {
  res.json({ running: analysisRunning, ...analysisProgress });
});

// ── Core analysis function (used by POST /analyze and auto-scheduler) ────────
async function runAnalysis(adapter, settings, candidates, reset, tenantMap = {}) {
  const results = [];
  let analyzed = 0;
  let failed = 0;
  let skipped = 0;

  // Pre-filter: decrypt + content checks
  const eligible = [];
  const minLen = Math.max(0, settings.minPromptLength ?? 20);
  for (const req of candidates) {
    const userMsg = decrypt(req.promptSnapshot?.lastUserMessage || '').slice(0, 1000);
    if (!userMsg || userMsg.length < minLen) { skipped++; continue; }
    const trimmed = userMsg.trim();
    if (
      // Tool output prefixes
      /^(Tool output|tool_result|tool_call_result|Result of|Output of|<tool_result|<function_results)/i.test(trimmed) ||
      // Code-fence file dump
      /^```[\w./\\]/.test(trimmed) ||
      // IDE launch command
      /^"?[A-Z]:\\.*\\(java|javaw|node|python)\.exe/i.test(trimmed) ||
      // IDE / tool context injection
      /^(This is the currently open file:|Use the above (code|context|file))/i.test(trimmed) ||
      // Shell prompt: (env) |git:branch|...
      /^\([\w.-]+\)\s*\|git:/.test(trimmed) ||
      // Path listing / shell output
      /^\/repos\//.test(trimmed) ||
      /^\/[\w/.-]+\.(py|js|ts|yaml|yml|json|sh|go|rs|java|c|cpp|log|cfg|conf|toml|xml|csv)/.test(trimmed) ||
      // "Output:" followed by shell content
      /^Output:\s*\(/i.test(trimmed) ||
      // <system-reminder> injected into user message
      /<system-reminder>/i.test(trimmed) ||
      // Single-line blob > 500 chars
      (trimmed.indexOf('\n') === -1 && trimmed.length > 500)
    ) { skipped++; continue; }
    eligible.push({ req, userMsg });
  }

  // ── Adaptive throttled analysis ─────────────────────────────────────────────
  // Starts with concurrency=5, backs off on rate limit errors, recovers on success.
  // Retries failed items up to 2 times with exponential backoff.

  async function analyzeOne({ req, userMsg }, retryCount = 0) {
    const contextKTokens = Math.round((req.inputTokens || 0) / 1000);
    const costStr = req.actualCostUsd ? `$${req.actualCostUsd.toFixed(4)}` : '$0';
    const model = req.routedModel || req.requestedModel || 'unknown';

    const evalPrompt = `You are an expert AI prompt quality evaluator. Evaluate the following user message sent to an AI assistant. Respond with ONLY a JSON object — no markdown, no prose.

USER MESSAGE:
"""
${userMsg}
"""

Runtime context: ${contextKTokens}k total input tokens, model="${model}", cost=${costStr}, task_category="${req.category || 'unknown'}"

Score each dimension 0–100 (100 = excellent, 0 = very poor):

- specificity: Is the request specific and actionable? Or vague like "fix this" / "write tests"?
- context: Does it provide necessary context (code snippet, language, framework, error message, file path)?
- outputDefinition: Does it specify what output is expected (format, scope, style, success criteria)?
- modelFit: Is the complexity appropriate for the model used? (over/under-powered)
- tokenEfficiency: Is the input size proportionate to the task? (not bloated with irrelevant context)

Return:
{
  "specificity": <0-100>,
  "context": <0-100>,
  "outputDefinition": <0-100>,
  "modelFit": <0-100>,
  "tokenEfficiency": <0-100>,
  "issues": ["<max 80 chars each, max 3>"],
  "suggestions": ["<concrete, actionable, max 80 chars each, max 3>"]
}`;

    const data = await adapter.chat({
      model: settings.model,
      messages: [{ role: 'user', content: evalPrompt }],
      max_tokens: 450,
      temperature: 0.1,
    });

    const raw = data.choices?.[0]?.message?.content?.trim() || '';
    if (!raw) throw new Error('Empty LLM response');

    let jsonStr = raw;
    const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (fenced) jsonStr = fenced[1];
    else { const brace = raw.match(/\{[\s\S]*\}/); if (brace) jsonStr = brace[0]; }
    const scores = JSON.parse(jsonStr.trim());

    const dims = ['specificity', 'context', 'outputDefinition', 'modelFit', 'tokenEfficiency'];
    const overall = Math.round(dims.reduce((sum, d) => sum + (scores[d] ?? 50), 0) / dims.length);

    return {
      requestId: req._id, timestamp: req.timestamp,
      tenant: tenantMap[String(req.tenantId)] || 'unknown', routedModel: model,
      category: req.category || null,
      inputTokens: req.inputTokens || 0, outputTokens: req.outputTokens || 0,
      costUsd: req.actualCostUsd || 0, promptExcerpt: userMsg.slice(0, 200),
      overall,
      specificity: scores.specificity ?? 50, context: scores.context ?? 50,
      outputDefinition: scores.outputDefinition ?? 50, modelFit: scores.modelFit ?? 50,
      tokenEfficiency: scores.tokenEfficiency ?? 50,
      issues: (scores.issues || []).slice(0, 3),
      suggestions: (scores.suggestions || []).slice(0, 3),
    };
  }

  function isRateLimitError(err) {
    const msg = err?.message || '';
    return /too many connections|rate limit|throttl|429|ServiceUnavailable/i.test(msg);
  }

  let concurrency = 5;       // start optimistic
  let delayMs = 200;         // pause between batches
  const MAX_RETRIES = 2;

  for (let i = 0; i < eligible.length; i += concurrency) {
    if (i > 0) await new Promise(r => setTimeout(r, delayMs));

    const batch = eligible.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(item => analyzeOne(item)));

    let rateLimited = 0;
    const retryQueue = [];

    for (let j = 0; j < batchResults.length; j++) {
      const br = batchResults[j];
      if (br.status === 'fulfilled') {
        results.push(br.value);
        analyzed++;
      } else if (isRateLimitError(br.reason)) {
        rateLimited++;
        retryQueue.push(batch[j]); // retry this item
      } else {
        failed++;
        logger.error(`[prompt-engineer] Analysis failed for request ${batch[j].req._id}: ${br.reason?.message || br.reason}`);
      }
    }

    // Adaptive backoff: rate limited → halve concurrency, double delay
    if (rateLimited > 0) {
      concurrency = Math.max(1, Math.floor(concurrency / 2));
      delayMs = Math.min(5000, delayMs * 2);
      logger.warn(`[prompt-engineer] Rate limited (${rateLimited}/${batch.length}) — concurrency=${concurrency}, delay=${delayMs}ms`);

      // Retry rate-limited items sequentially with backoff
      for (const item of retryQueue) {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          await new Promise(r => setTimeout(r, delayMs));
          try {
            results.push(await analyzeOne(item, attempt));
            analyzed++;
            break;
          } catch (retryErr) {
            if (attempt === MAX_RETRIES) {
              failed++;
              logger.error(`[prompt-engineer] Retry exhausted for ${item.req._id}: ${retryErr.message}`);
            }
          }
        }
      }
    } else if (concurrency < 5) {
      // Success — slowly recover concurrency
      concurrency = Math.min(5, concurrency + 1);
      delayMs = Math.max(200, Math.floor(delayMs * 0.75));
    }

    // Update progress
    analysisProgress = { total: eligible.length, done: analyzed + failed, failed, skipped };
  }

  // Save results once at the end (not after every batch — avoids hammering MongoDB)
  let finalResults = results;
  if (!reset) {
    const prevDoc = await SystemConfig.findOne({ key: RESULTS_KEY }).lean();
    const prevResults = prevDoc?.value?.results || [];
    const newIds = new Set(results.map(r => String(r.requestId)));
    const kept = prevResults.filter(r => !newIds.has(String(r.requestId)));
    finalResults = [...kept, ...results];
  }
  finalResults.sort((a, b) => a.overall - b.overall);

  await SystemConfig.findOneAndUpdate(
    { key: RESULTS_KEY },
    { $set: { value: { createdAt: new Date().toISOString(), model: settings.model, analyzed: finalResults.length, analyzedThisRun: analyzed, failed, skipped, results: finalResults } } },
    { upsert: true },
  );

  logger.info(`[prompt-engineer] Analysis complete: ${analyzed} new, ${failed} failed, ${skipped} skipped, ${finalResults.length} total`);
  return { analyzed, failed, skipped, total: finalResults.length };
}

// ── GET /results — paginated ──────────────────────────────────────────────────
router.get('/results', canReadConfig, async (req, res) => {
  try {
    const doc = await SystemConfig.findOne({ key: RESULTS_KEY }).lean();
    if (!doc?.value) return res.json(null);

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const allResults = doc.value.results || [];
    const start = (page - 1) * limit;

    res.json({
      ...doc.value,
      results: allResults.slice(start, start + limit),
      total: allResults.length,
      page,
      pages: Math.ceil(allResults.length / limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /public — no auth, gated by publicEndpoint flag ───────────────────────
router.get('/public', async (_req, res) => {
  try {
    const settings = await getSettings();
    if (!settings.enabled || !settings.publicEndpoint) return res.status(404).json({ error: 'Not found' });
    const doc = await SystemConfig.findOne({ key: RESULTS_KEY }).lean();
    if (!doc?.value) return res.json(null);
    const maxPublic = Math.min(settings.maxPublicResults ?? 100, 200);
    const pub = {
      ...doc.value,
      results: (doc.value.results || [])
        .filter(r => r.overall < 50)
        .slice(0, maxPublic)
        .map(({ promptExcerpt, requestId: _r, tenant: _t, ...r }) => ({
          ...r,
          promptHint: (promptExcerpt || '').slice(0, 50) || undefined,
        })),
    };
    res.json(pub);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Auto-analysis scheduler ──────────────────────────────────────────────────
// Runs every hour if autoAnalyze is enabled. Analyzes new prompts incrementally.
// Opt-in only (costs money) — must be enabled in Settings.
let autoAnalyzeTimer = null;

export function startAutoAnalyzeScheduler() {
  if (autoAnalyzeTimer) return;

  autoAnalyzeTimer = setInterval(async () => {
    try {
      const settings = await getSettings();
      if (!settings.enabled || !settings.autoAnalyze) return;

      const resolved = await resolveProvider(settings);
      if (resolved.error) return; // silently skip if no provider configured
      const adapter = getProviderAdapter(resolved.provider);

      const maxPrompts = settings.maxPrompts === 0 ? 2000 : Math.min(Math.max(1, settings.maxPrompts || 100), 2000);
      const fetchLimit = Math.min(maxPrompts * 3, 2000);
      const query = await buildCandidateQuery(settings, { reset: false });

      const rawCandidates = await RequestLog.find(query, {
        'promptSnapshot.lastUserMessage': 1, routedModel: 1, requestedModel: 1,
        inputTokens: 1, outputTokens: 1, actualCostUsd: 1,
        category: 1, costTier: 1, timestamp: 1,
        tenantId: 1, sessionId: 1, systemPromptHash: 1,
      }).sort({ actualCostUsd: -1 }).limit(fetchLimit).lean();

      const seenGroups = new Set();
      const candidates = [];
      for (const r of rawCandidates) {
        const groupKey = [r.systemPromptHash || '', r.category || '', r.routedModel || ''].join('|');
        if (r.systemPromptHash && seenGroups.has(groupKey)) continue;
        if (r.systemPromptHash) seenGroups.add(groupKey);
        candidates.push(r);
        if (candidates.length >= maxPrompts) break;
      }

      if (!candidates.length) return; // no new prompts

      // Resolve tenant slugs
      const tIds = [...new Set(candidates.map(r => String(r.tenantId)).filter(Boolean))];
      const tMap = {};
      if (tIds.length) {
        const Tenant = (await import('../../models/Tenant.js')).default;
        const ts = await Tenant.find({ _id: { $in: tIds } }, { slug: 1 }).lean();
        for (const t of ts) tMap[String(t._id)] = t.slug;
      }

      logger.info(`[prompt-engineer] Auto-analysis: ${candidates.length} new candidates`);
      const result = await runAnalysis(adapter, settings, candidates, false, tMap);
      logger.info(`[prompt-engineer] Auto-analysis done: ${result.analyzed} analyzed, ${result.failed} failed`);
    } catch (err) {
      logger.error(`[prompt-engineer] Auto-analysis error: ${err.message}`);
    }
  }, 3600_000).unref();
}

export default router;
