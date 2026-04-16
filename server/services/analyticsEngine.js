import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import RequestLog from '../models/RequestLog.js';
import DailyStat, { DailyCategoryStat } from '../models/DailyStat.js';
import LogConfig from '../models/LogConfig.js';
import { calcCost } from './pricingService.js';
import { scoreResponse } from './qualityService.js';
import { encrypt } from '../utils/encryption.js';
import { incrementUsage } from './quotaService.js';
import { emit as emitWebhook } from './webhookService.js';
import { recordResult as recordExperimentResult } from './experimentService.js';
import logger from '../utils/logger.js';

// ── Dynamic baseline cache (weighted avg cost of direct/non-auto calls) ──────
let baselineCache = new Map(); // tenantId → { weightedCostPer1M, fetchedAt }
const BASELINE_CACHE_TTL = 300_000; // 5 min

// Sensible fallback baseline when no history is available.
// Represents a typical "flagship" model cost users would pay without a gateway.
const BASELINE_FALLBACK_MODEL = 'claude-sonnet-4-5';

async function getDynamicBaseline(tenantId, tenant) {
  const key = String(tenantId);
  const cached = baselineCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < BASELINE_CACHE_TTL) return cached;

  // 1. Explicitly configured baseline model — most reliable, admin-set
  if (tenant?.routing?.baselineModel) {
    const result = { model: tenant.routing.baselineModel, fetchedAt: Date.now() };
    baselineCache.set(key, result);
    return result;
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // 2. Most-requested model from non-auto-routed traffic in last 7 days.
    //    These are requests where the client chose the model directly (no gateway override),
    //    which represents what users would pay without Model Prism.
    const nonAutoStats = await RequestLog.aggregate([
      {
        $match: {
          tenantId,
          isAutoRouted: false,
          timestamp: { $gte: sevenDaysAgo },
          requestedModel: { $nin: ['auto-prism', 'none', null] },
        },
      },
      { $group: { _id: '$requestedModel', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 },
    ]);

    if (nonAutoStats.length) {
      const result = { model: nonAutoStats[0]._id, fetchedAt: Date.now() };
      baselineCache.set(key, result);
      return result;
    }

    // 3. Most-requested model from ALL auto-routed requests (the model clients asked for,
    //    before forceAutoRoute kicked in). This is the "intended" model, not the routed one.
    const requestedStats = await RequestLog.aggregate([
      {
        $match: {
          tenantId,
          isAutoRouted: true,
          requestedModel: { $nin: ['auto-prism', 'none', null] },
          timestamp: { $gte: sevenDaysAgo },
        },
      },
      { $group: { _id: '$requestedModel', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 },
    ]);

    if (requestedStats.length) {
      const result = { model: requestedStats[0]._id, fetchedAt: Date.now() };
      baselineCache.set(key, result);
      return result;
    }

    // 4. Hard fallback — use a representative flagship model
    const result = { model: BASELINE_FALLBACK_MODEL, fetchedAt: Date.now() };
    baselineCache.set(key, result);
    return result;
  } catch {
    return { model: tenant?.routing?.baselineModel || BASELINE_FALLBACK_MODEL, fetchedAt: Date.now() };
  }
}

// ── LogConfig cache ───────────────────────────────────────────────────────────
let logConfigCache = null;
let logConfigCacheTime = 0;
const LOG_CONFIG_TTL = 60_000;

async function getLogConfig() {
  if (logConfigCache && Date.now() - logConfigCacheTime < LOG_CONFIG_TTL) return logConfigCache;
  try {
    const cfg = await LogConfig.findOne({ singleton: 'default' }).lean();
    logConfigCache = cfg || {};
    logConfigCacheTime = Date.now();
  } catch {
    logConfigCache = {};
  }
  return logConfigCache;
}

export function invalidateLogConfigCache() {
  logConfigCache = null;
}

// ── JSONL file writer ─────────────────────────────────────────────────────────
// Tracks current file size per directory key
const fileSizeCache = new Map();

function writeRequestJsonl(dir, entry) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const filePath = path.join(dir, `requests-${dateStr}.jsonl`);

    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(filePath, line, 'utf8');

    // Track size and rotate if needed
    const key = filePath;
    const prevSize = fileSizeCache.get(key) || 0;
    const newSize = prevSize + Buffer.byteLength(line);
    fileSizeCache.set(key, newSize);
  } catch {
    // Non-fatal — file logging failures must not affect request handling
  }
}

// ── Path extractor ────────────────────────────────────────────────────────────
// Matches Unix/Windows-style paths that contain at least one directory separator
// and end with a file extension (1-15 chars). Avoids URLs.
const PATH_RE = /(?:^|[\s"'`(,=\[])(\/?(?:[\w.~%-]+[/\\])+[\w.~%-]+\.[\w]{1,15})(?=[\s"'`),\];\n]|$)/gm;

function extractPaths(messages) {
  if (!messages?.length) return [];
  const found = new Set();
  for (const m of messages) {
    const text = typeof m.content === 'string' ? m.content
      : Array.isArray(m.content) ? m.content.filter(p => p.type === 'text').map(p => p.text || '').join(' ')
      : '';
    let match;
    PATH_RE.lastIndex = 0;
    while ((match = PATH_RE.exec(text)) !== null) {
      const p = match[1].trim();
      // Skip very short paths and common false positives (URLs already excluded by //)
      if (p.length > 4 && !p.startsWith('http')) found.add(p);
    }
  }
  return [...found].slice(0, 50); // cap per request
}

// ── Prompt snapshot builder ───────────────────────────────────────────────────
function buildPromptSnapshot(messages, level) {
  if (!messages?.length) return null;

  const systemMsg = messages.find(m => m.role === 'system');
  const userMsgs  = messages.filter(m => m.role === 'user');

  const extractText = c => {
    if (!c) return '';
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.filter(p => p.type === 'text').map(p => p.text || '').join(' ');
    return String(c);
  };

  // Find the first real human message — skip tool results, file content dumps, and agent outputs.
  function isNonHumanMessage(m) {
    const c = m.content;
    // Content-block array with tool_result / tool_use entries
    if (Array.isArray(c) && c.some(b => b.type === 'tool_result' || b.type === 'tool_use' || b.type === 'tool_use_result')) return true;
    // OpenAI tool result format
    if (m.tool_call_id) return true;
    if (typeof c !== 'string') return false;
    const t = c.trim();
    // Tool output prefixes
    if (/^(Tool output|tool_result|tool_call_result|Result of|Output of|<tool_result|<function_results)/i.test(t)) return true;
    // Code fences at start = file content dump from agent
    if (/^```[\w./\\]/.test(t)) return true;
    // IDE launch commands
    if (/^"?[A-Z]:\\.*\\(java|javaw|node|python)\.exe/i.test(t)) return true;
    // IDE / tool context injection
    if (/^(This is the currently open file:|Use the above (code|context|file))/i.test(t)) return true;
    // Shell prompt: (env) |git:branch|date|path:$
    if (/^\([\w.-]+\)\s*\|git:/.test(t)) return true;
    // Path listing / shell output
    if (/^\/repos\//.test(t)) return true;
    if (/^\/[\w/.-]+\.(py|js|ts|yaml|yml|json|sh|go|rs|java|c|cpp|log|cfg|conf|toml|xml|csv)/.test(t)) return true;
    // "Output:" followed by shell content
    if (/^Output:\s*\(/i.test(t)) return true;
    // Very long single line (>500 chars no newline)
    if (t.indexOf('\n') === -1 && t.length > 500) return true;
    return false;
  }

  const realUserMsgs = userMsgs.filter(m => !isNonHumanMessage(m));
  // Prefer the first real user message; fall back to last user msg of any type
  const bestUser = realUserMsgs[0] || userMsgs[userMsgs.length - 1];

  const snapshot = {
    messageCount:    messages.length,
    systemPrompt:    systemMsg ? encrypt(extractText(systemMsg.content).slice(0, 2000)) : undefined,
    lastUserMessage: bestUser  ? encrypt(extractText(bestUser.content).slice(0, 4000))  : undefined,
  };

  if (level === 'full') {
    snapshot.messages = messages.map(m => ({
      role:    m.role,
      content: encrypt(extractText(m.content).slice(0, 8000)),
    }));
  }

  return snapshot;
}

// ── Main export ───────────────────────────────────────────────────────────────
/**
 * Log a request asynchronously (fire-and-forget).
 * @param {object} params
 * @param {Array}  params.messages — raw messages array from chatRequest (optional)
 */
export function logRequest({
  tenantId, sessionId, userName, requestedModel, routedModel, providerId,
  isAutoRouted, routingResult, inputTokens, outputTokens, streaming, tenant,
  contextFallback = false, originalModel = null,
  handledFallback = false, fallbackType = null, fallbackDetail = null,
  messages = null, responseContent = null, finishReason = null,
  experimentId = null, experimentVariant = null, durationMs = null,
  contextWindowUsed = null, clientIp = null, viaProxy = null,
}) {
  setImmediate(async () => {
    try {
      const cfg = await getLogConfig();

      // ── Load provider pricing so calcCost uses actual contract prices ──
      // Without this, calcCost falls back to MODEL_REGISTRY list prices
      // which can be very different from the provider's configured pricing.
      let providerModels = null;
      if (providerId) {
        try {
          const Provider = (await import('../models/Provider.js')).default;
          const provider = await Provider.findById(providerId, { discoveredModels: 1 }).lean();
          providerModels = provider?.discoveredModels;
        } catch { /* non-fatal */ }
      }

      function findProviderModel(modelId) {
        return providerModels?.find(m => m.id === modelId) || null;
      }

      const modelCost   = calcCost(routedModel, inputTokens, outputTokens, tenant, findProviderModel(routedModel));
      const routingCost = routingResult?.routingCostUsd || 0;
      // Actual cost = model cost + classifier cost (total cost of auto-routing)
      const actualCost  = modelCost + (isAutoRouted ? routingCost : 0);

      // Savings calculation:
      //   Fall A: User requested specific model → Baseline = cost of that model
      //   Fall B: No routing → Baseline = Actual, Saved = 0
      //   Fall C: User requested "auto-prism" → Baseline = cost of the model the
      //           user would have used without the gateway (dynamic baseline from
      //           most-used non-auto model in last 7 days)
      let baselineModel;
      let baselineCost;
      if (isAutoRouted && requestedModel && requestedModel !== 'auto-prism') {
        // Fall A: compare against the model the client originally requested
        baselineModel = requestedModel;
        baselineCost = calcCost(baselineModel, inputTokens, outputTokens, tenant, findProviderModel(baselineModel));
      } else if (isAutoRouted) {
        // Fall C: compare against the most-used manually chosen model
        const dynamic = await getDynamicBaseline(tenantId, tenant);
        baselineModel = dynamic.model || tenant?.routing?.baselineModel || routedModel;
        baselineCost = calcCost(baselineModel, inputTokens, outputTokens, tenant, findProviderModel(baselineModel));
      } else {
        // Fall B: no routing → no savings
        baselineModel = routedModel;
        baselineCost = actualCost;
      }
      const saved = baselineCost - actualCost;
      const today = new Date().toISOString().slice(0, 10);

      // ── System prompt hash (always computed, never stores raw content) ──
      let systemPromptHash;
      if (messages?.length) {
        const sysMsg = messages.find(m => m.role === 'system');
        if (sysMsg) {
          const text = typeof sysMsg.content === 'string' ? sysMsg.content : JSON.stringify(sysMsg.content);
          systemPromptHash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 8);
        }
      }

      // ── Prompt snapshot ─────────────────────────────────────────────────
      let promptSnapshot;
      if (cfg.promptLogging && messages?.length) {
        promptSnapshot = buildPromptSnapshot(messages, cfg.promptLogLevel || 'last_user');
      }

      // ── Path capture ─────────────────────────────────────────────────────
      const rawPaths = (cfg.pathCapture?.enabled && messages?.length)
        ? extractPaths(messages)
        : undefined;
      const capturedPaths = rawPaths?.map(p => encrypt(p));

      // ── Response snapshot ──────────────────────────────────────────────
      let responseSnapshot;
      if (cfg.promptLogging && responseContent) {
        responseSnapshot = {
          content: typeof responseContent === 'string' ? encrypt(responseContent.slice(0, 4000)) : undefined,
          finishReason: finishReason || undefined,
        };
      }

      // ── Quality scoring ──────────────────────────────────────────────────
      let qualityScore = null;
      let qualityBreakdown = null;
      if (responseContent) {
        try {
          const qs = scoreResponse({
            responseContent,
            finishReason,
            chatRequest: messages ? { messages } : null,
            routingResult,
          });
          qualityScore = qs.score;
          // Use numeric signals (not string breakdown details) to match schema field types.
          // Map signal keys to the schema field names stored in RequestLog.qualityBreakdown.
          qualityBreakdown = {
            completeness:    qs.signals.completeness,
            lengthAdequacy:  qs.signals.lengthAdequacy,
            noRefusal:       qs.signals.noRefusal,
            noErrors:        qs.signals.noErrorIndicators,
            languageMatch:   qs.signals.languageConsistency,
            formatCompliance: qs.signals.formatCompliance,
          };
        } catch { /* non-fatal */ }
      }

      // ── Quota usage increment ─────────────────────────────────────────
      try {
        await incrementUsage(tenantId, {
          tokens: inputTokens + outputTokens,
          requests: 1,
          costUsd: actualCost,
        });
      } catch { /* non-fatal */ }

      // ── Experiment result tracking ────────────────────────────────────
      if (experimentId && experimentVariant) {
        try {
          await recordExperimentResult(experimentId, experimentVariant, {
            inputTokens,
            outputTokens,
            costUsd: actualCost,
            error: false,
            qualityScore,
            latencyMs: durationMs,
          });
        } catch { /* non-fatal */ }
      }

      // ── Client IP hash (anonymized, for unique user counting) ──────────
      let clientIpHash;
      if (clientIp && cfg.trackUsersByIp) {
        clientIpHash = crypto.createHash('sha256').update(clientIp).digest('hex').slice(0, 16);
      }

      // ── DB insert ────────────────────────────────────────────────────────
      await RequestLog.create({
        tenantId,
        sessionId,
        userName,
        requestedModel,
        routedModel,
        providerId,
        category:        routingResult?.category,
        taskType:        routingResult?.taskType,
        complexity:      routingResult?.complexity,
        costTier:        routingResult?.costTier,
        confidence:      routingResult?.confidence,
        inputTokens,
        outputTokens,
        actualCostUsd:   actualCost,
        baselineCostUsd: baselineCost,
        savedUsd:        saved,
        isAutoRouted,
        routingCostUsd:  routingResult?.routingCostUsd || 0,
        routingMs:       routingResult?.analysisTimeMs,
        overrideApplied: routingResult?.overrideApplied,
        domain:          routingResult?.domain,
        language:        routingResult?.language,
        streaming,
        contextFallback,
        originalModel:      contextFallback ? originalModel : undefined,
        handledFallback:    handledFallback || undefined,
        fallbackType:       fallbackType || undefined,
        fallbackDetail:     fallbackDetail || undefined,
        contextWindowUsed:  contextWindowUsed || undefined,
        systemPromptHash:   systemPromptHash || undefined,
        promptSnapshot,
        responseSnapshot,
        qualityScore,
        qualityBreakdown,
        experimentId:       experimentId || undefined,
        experimentVariant:  experimentVariant || undefined,
        durationMs:         durationMs || undefined,
        clientIpHash:    clientIpHash || undefined,
        viaProxy:        viaProxy || undefined,
        capturedPaths:   capturedPaths?.length ? capturedPaths : undefined,
        routingSignals:  routingResult?.signals ? {
          totalTokens:       routingResult.signals.totalTokens,
          hasImages:         routingResult.signals.hasImages,
          hasToolCalls:      routingResult.signals.hasToolCalls,
          conversationTurns: routingResult.signals.conversationTurns,
          detectedDomains:   routingResult.signals.detectedDomains,
          detectedLanguages: routingResult.signals.detectedLanguages,
          preRouted:         routingResult.preRouted,
          isFimRequest:      routingResult.signals.isFimRequest || undefined,
        isToolAgentRequest:  routingResult.signals.isToolAgentRequest || undefined,
        isToolOutputContinuation: routingResult.signals.isToolOutputContinuation || undefined,
        prevSessionFillPct:  routingResult.prevSessionFillPct != null
          ? Math.round(routingResult.prevSessionFillPct * 100) / 100
          : undefined,
          signalSource:      routingResult.reason,
        } : undefined,
      });

      // ── Daily stat upsert ────────────────────────────────────────────────
      // logRequest is only called for successful requests; logError handles errors
      const hasDuration = durationMs != null && durationMs > 0;
      await DailyStat.findOneAndUpdate(
        { date: today, tenantId, routedModel },
        {
          $inc: {
            requests:        1,
            inputTokens,
            outputTokens,
            actualCostUsd:   actualCost,
            baselineCostUsd: baselineCost,
            savedUsd:        saved,
            autoRoutedCount: isAutoRouted ? 1 : 0,
            routingCostUsd:  routingResult?.routingCostUsd || 0,
            errorCount:      0, // logRequest = success only; errors tracked via logError
            durationMsTotal: hasDuration ? durationMs : 0,
            durationMsCount: hasDuration ? 1 : 0,
          },
        },
        { upsert: true },
      );

      // ── Daily category stat upsert (for /categories endpoint) ─────────
      const category = routingResult?.category;
      if (category && isAutoRouted) {
        await DailyCategoryStat.findOneAndUpdate(
          { date: today, tenantId, category, costTier: routingResult?.costTier || null },
          {
            $inc: {
              requests:      1,
              actualCostUsd: actualCost,
            },
          },
          { upsert: true },
        );
      }

      // ── JSONL file logging ───────────────────────────────────────────────
      if (cfg.fileLogging?.enabled && cfg.fileLogging?.directory) {
        const entry = {
          timestamp:      new Date().toISOString(),
          tenant:         tenant?.slug || String(tenantId),
          sessionId:      sessionId || null,
          user:           userName || null,
          requestedModel,
          routedModel,
          inputTokens,
          outputTokens,
          costUsd:        Math.round(actualCost * 1e6) / 1e6,
          isAutoRouted,
          routing:        routingResult ? {
            category:   routingResult.category,
            tier:       routingResult.costTier,
            confidence: routingResult.confidence,
            domain:     routingResult.domain,
            preRouted:  routingResult.preRouted,
          } : null,
          signals: routingResult?.signals ? {
            tokens:    routingResult.signals.totalTokens,
            hasImages: routingResult.signals.hasImages,
            hasTools:  routingResult.signals.hasToolCalls,
            turns:     routingResult.signals.conversationTurns,
            domains:   routingResult.signals.detectedDomains,
            langs:     routingResult.signals.detectedLanguages,
          } : null,
        };

        // Include prompts in file log if both file logging and prompt options enable it
        if (cfg.fileLogging.includePrompts && messages?.length) {
          entry.messages = buildPromptSnapshot(messages, cfg.promptLogLevel || 'full')?.messages;
        }

        writeRequestJsonl(cfg.fileLogging.directory, entry);
      }
    } catch (err) {
      logger.error('[analytics] Failed to log request:', { error: err.message });
    }
  });
}

/**
 * Log a gateway error (auth failures, rate limits, validation, upstream errors).
 * Fire-and-forget — never blocks the response.
 */
export function logError({
  tenantId = null,
  sessionId = null,
  userName = null,
  requestedModel = 'unknown',
  routedModel = null,     // the model that was actually attempted (if known)
  routingResult = null,   // routing context: category, confidence, signals
  errorMessage,
  errorType,
  statusCode,
  tenant = null,
  messages = null,
  errorCategory = null,
  errorFixedIn = null,
  errorDescription = null,
  clientIp = null,
  viaProxy = null,
}) {
  setImmediate(async () => {
    try {
      // Skip if no tenant context (e.g. invalid slug) — can't create a valid RequestLog
      if (!tenantId) return;

      const cfg = await getLogConfig();

      let promptSnapshot;
      if (cfg.promptLogging && messages?.length) {
        promptSnapshot = buildPromptSnapshot(messages, cfg.promptLogLevel || 'last_user');
      }

      let clientIpHash;
      if (clientIp && cfg.trackUsersByIp) {
        clientIpHash = crypto.createHash('sha256').update(clientIp).digest('hex').slice(0, 16);
      }

      await RequestLog.create({
        tenantId,
        sessionId,
        userName,
        requestedModel,
        routedModel: routedModel || 'none',
        status: 'error',
        errorType,
        errorMessage: `[${statusCode}] ${errorType}: ${errorMessage}`,
        clientIpHash: clientIpHash || undefined,
        viaProxy: viaProxy || undefined,
        errorCategory,
        errorFixedIn,
        errorDescription,
        promptSnapshot,
        // Routing context — populated when the error happened after routing resolved
        isAutoRouted:   routingResult ? true : undefined,
        category:       routingResult?.category       || undefined,
        confidence:     routingResult?.confidence     || undefined,
        routingSignals: routingResult?.signals        || undefined,
      });

      // Increment error count in DailyStat
      const today = new Date().toISOString().slice(0, 10);
      const rm = routedModel || 'none';
      await DailyStat.findOneAndUpdate(
        { date: today, tenantId, routedModel: rm },
        { $inc: { requests: 1, errorCount: 1 } },
        { upsert: true },
      );
    } catch (err) {
      logger.error('[analytics] Failed to log error:', err.message);
    }
  });
}
