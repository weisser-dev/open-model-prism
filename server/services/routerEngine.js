import Provider from '../models/Provider.js';
import RoutingCategory from '../models/RoutingCategory.js';
import RoutingRuleSet from '../models/RoutingRuleSet.js';
import { getProviderAdapter } from '../providers/index.js';
import { extractSignals, applyRuleSet, buildClassifierContext } from './signalExtractor.js';
import { calcCost } from './pricingService.js';
import { findModel } from '../data/modelRegistry.js';
import logger from '../utils/logger.js';

// ── Benchmark weights per category type ──────────────────────────────────────
// Maps category prefix to relevance weights for { intelligence, coding, math, speed }
const CATEGORY_BENCH_WEIGHTS = {
  coding:             { intelligence: 0.2, coding: 0.6, math: 0.1, speed: 0.1 },
  math:               { intelligence: 0.2, coding: 0.1, math: 0.6, speed: 0.1 },
  reasoning:          { intelligence: 0.6, coding: 0.1, math: 0.2, speed: 0.1 },
  research:           { intelligence: 0.6, coding: 0.1, math: 0.1, speed: 0.2 },
  summarization:      { intelligence: 0.3, coding: 0.0, math: 0.0, speed: 0.7 },
  classification:     { intelligence: 0.3, coding: 0.0, math: 0.0, speed: 0.7 },
  translation:        { intelligence: 0.3, coding: 0.0, math: 0.0, speed: 0.7 },
  creative:           { intelligence: 0.6, coding: 0.0, math: 0.0, speed: 0.4 },
  analysis:           { intelligence: 0.5, coding: 0.1, math: 0.2, speed: 0.2 },
  tool_use:           { intelligence: 0.3, coding: 0.4, math: 0.1, speed: 0.2 },
  system_design:      { intelligence: 0.4, coding: 0.3, math: 0.1, speed: 0.2 },
  planning:           { intelligence: 0.5, coding: 0.2, math: 0.1, speed: 0.2 },
  sensitive:          { intelligence: 0.6, coding: 0.1, math: 0.1, speed: 0.2 },
  vision:             { intelligence: 0.5, coding: 0.1, math: 0.1, speed: 0.3 },
  document:           { intelligence: 0.4, coding: 0.1, math: 0.1, speed: 0.4 },
  smalltalk:          { intelligence: 0.2, coding: 0.0, math: 0.0, speed: 0.8 },
  email:              { intelligence: 0.3, coding: 0.0, math: 0.0, speed: 0.7 },
  sql:                { intelligence: 0.2, coding: 0.5, math: 0.2, speed: 0.1 },
  _default:           { intelligence: 0.4, coding: 0.2, math: 0.1, speed: 0.3 },
};

function getBenchWeights(category) {
  if (!category) return CATEGORY_BENCH_WEIGHTS._default;
  if (CATEGORY_BENCH_WEIGHTS[category]) return CATEGORY_BENCH_WEIGHTS[category];
  const parts = category.split('_');
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = parts.slice(0, i).join('_');
    if (CATEGORY_BENCH_WEIGHTS[prefix]) return CATEGORY_BENCH_WEIGHTS[prefix];
  }
  return CATEGORY_BENCH_WEIGHTS[parts[0]] || CATEGORY_BENCH_WEIGHTS._default;
}

/**
 * Calculate price-performance score for model selection.
 * costMode adjusts the balance between quality and cost:
 *   economy  → heavily favor cheap models (cost exponent 2.0)
 *   balanced → equal balance (cost exponent 1.0)
 *   quality  → heavily favor quality, cost barely matters (cost exponent 0.3)
 */
function calcPricePerformance(model, weights, benchmarks, costMode = 'balanced') {
  if (!benchmarks) return 0;
  const quality = (weights.intelligence * (benchmarks.intelligence || 0))
                + (weights.coding      * (benchmarks.coding || 0))
                + (weights.math        * (benchmarks.math || 0))
                + (weights.speed       * (benchmarks.speed || 0));
  const cost = (model.inputPer1M || 0) + (model.outputPer1M || 0);
  if (cost <= 0) return quality * 1000; // free/on-prem = best price-performance

  const costExponent = costMode === 'economy' ? 2.0 : costMode === 'quality' ? 0.3 : 1.0;
  return quality / Math.pow(cost, costExponent);
}

// ── Category cache ────────────────────────────────────────────────────────────
let categoriesCache    = null;
let categoriesCacheTime = 0;
const CATEGORIES_CACHE_TTL = 300_000;

export async function getCategories() {
  if (categoriesCache && Date.now() - categoriesCacheTime < CATEGORIES_CACHE_TTL) return categoriesCache;
  categoriesCache    = await RoutingCategory.find().sort('order').lean();
  categoriesCacheTime = Date.now();
  return categoriesCache;
}

// ── Rule set cache ────────────────────────────────────────────────────────────
let ruleSetCache    = null;
let ruleSetCacheTime = 0;
const RULESET_CACHE_TTL = 120_000;

export function invalidateRuleSetCache() {
  ruleSetCache = null;
}

async function getRuleSet(tenantId) {
  // Tenant-specific first, then global default
  const now = Date.now();
  if (ruleSetCache && now - ruleSetCacheTime < RULESET_CACHE_TTL) return ruleSetCache;

  const rs = await RoutingRuleSet.findOne({
    $or: [{ tenantId }, { isGlobalDefault: true }],
  }).sort({ tenantId: -1 }).lean(); // tenant-specific sorts first

  ruleSetCache    = rs;
  ruleSetCacheTime = now;
  return rs;
}

// ── Classifier prompt ─────────────────────────────────────────────────────────

// Tier order for sorting model list in classifier prompt
const TIER_SORT_ORDER = { micro: 0, minimal: 1, low: 2, medium: 3, advanced: 4, high: 5, ultra: 6, critical: 7 };

export function buildClassifierPrompt(categories, availableModels = []) {
  const categoryList = categories.map(c => {
    const examples = c.examples?.length ? ` — Examples: ${c.examples.join(', ')}` : '';
    return `- ${c.key} [${c.costTier}]${examples}`;
  }).join('\n');

  // Build a concise model list for the classifier to choose from directly
  let modelsSection = '';
  if (availableModels.length) {
    const seen = new Set();
    const modelLines = availableModels
      .filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; })
      .sort((a, b) => (TIER_SORT_ORDER[a.tier] ?? 9) - (TIER_SORT_ORDER[b.tier] ?? 9))
      .slice(0, 20) // cap at 20 to keep prompt size reasonable
      .map(m => {
        const cost = (m.inputPer1M != null && m.outputPer1M != null)
          ? ` — in:$${m.inputPer1M}/out:$${m.outputPer1M}/1M`
          : '';
        return `- ${m.id} [${m.tier}]${cost}`;
      })
      .join('\n');
    modelsSection = `\n\n## Available Models\nPick the best one for this request as "recommended_model":\n${modelLines}`;
  }

  return `You are a precise model router. Analyze the user's prompt and classify it into one of these categories.

## Categories
${categoryList}${modelsSection}

## Response Format
Reply with ONLY valid JSON, no markdown:
{"category":"<key>","confidence":<0-1>,"complexity":"<simple|medium|complex>","has_image":<bool>,"language":"<en|de|other>","estimated_output_length":"<short|medium|long>","domain":"<general|legal|medical|finance|tech|science>","conversation_turn":<int>,"user_frustration_signal":<bool>,"cost_tier":"<micro|minimal|low|medium|advanced|high|ultra|critical>","recommended_model":"<model_id or null>","reasoning":"<1 sentence>"}`;
}

// ── Existing override rules (from tenant.routing.overrides) ───────────────────

export function applyOverrides(result, overrides, categories) {
  if (!overrides) return result;
  const TIERS = ['micro', 'minimal', 'low', 'medium', 'advanced', 'high', 'ultra', 'critical'];
  const MEDIUM_IDX = TIERS.indexOf('medium'); // 3
  const category = categories.find(c => c.key === result.category);

  if (overrides.visionUpgrade && result.hasImage && !category?.requiresVision) {
    // Vision tasks need at least low tier; step up micro/minimal to low, anything below medium to medium
    result.overrideApplied = 'vision_upgrade';
    const idx = TIERS.indexOf(result.costTier);
    if (idx < TIERS.indexOf('low')) result.costTier = 'low';
    else if (idx < MEDIUM_IDX) result.costTier = 'medium';
  }
  if (overrides.toolCallUpgrade && result.signals?.hasToolCalls) {
    // Tool calls require a model that supports function calling — force at least configured min tier
    const minTier = overrides.toolCallMinTier || 'medium';
    const minIdx = TIERS.indexOf(minTier);
    const idx = TIERS.indexOf(result.costTier);
    if (idx < minIdx) {
      result.overrideApplied = 'tool_call_upgrade';
      result.costTier = minTier;
    }
  }
  if (overrides.confidenceFallback && result.confidence < (overrides.confidenceThreshold || 0.4)) {
    result.overrideApplied = 'confidence_fallback';
    result.costTier = 'medium';
  }
  if (overrides.domainGate && ['legal', 'medical', 'finance'].includes(result.domain)) {
    const idx = TIERS.indexOf(result.costTier);
    if (idx < MEDIUM_IDX) {
      result.overrideApplied = 'domain_gate';
      result.costTier = 'medium';
    }
  }
  if (overrides.conversationTurnUpgrade && result.conversationTurn >= 4) {
    if (!['classification_extraction', 'summarization_short', 'summarization_long', 'translation'].includes(result.category)) {
      result.overrideApplied = 'conversation_turn_upgrade';
      const idx = TIERS.indexOf(result.costTier);
      if (idx >= 0 && idx < TIERS.length - 1) result.costTier = TIERS[idx + 1];
    }
  }
  if (overrides.frustrationUpgrade && result.userFrustrationSignal) {
    // Guard against false positives:
    // 1. Tool outputs (e.g. "Tool output for run_terminal_command tool call: …") are not human frustration
    // 2. Very short greetings / single-word messages (e.g. "Hello?") are not frustration
    const lastMsg = (result.signals?.lastUserMessage || '').trimStart();
    const isToolOutput = /^tool output for\s/i.test(lastMsg) || /^tool_call_result/i.test(lastMsg);
    const isTrivialGreeting = result.signals?.totalTokens != null
      ? result.signals.totalTokens < 30
      : lastMsg.length < 30;
    if (!isToolOutput && !isTrivialGreeting) {
      result.overrideApplied = 'frustration_upgrade';
      const idx = TIERS.indexOf(result.costTier);
      if (idx >= 0 && idx < TIERS.length - 1) result.costTier = TIERS[idx + 1];
    }
  }
  if (overrides.outputLengthUpgrade && result.estimatedOutputLength === 'long') {
    // Upgrade micro/minimal to low for long outputs — these models are not suited for verbose responses
    const idx = TIERS.indexOf(result.costTier);
    if (idx < TIERS.indexOf('low')) {
      result.overrideApplied = 'output_length_upgrade';
      result.costTier = 'low';
    }
  }

  return result;
}

// ── Categories that still warrant a big coder/reasoning model ────────────────
// When the user explicitly picked a high-tier model and the classifier lands
// on one of these keys, "smart" mode keeps the user's choice — even if a
// smaller model would technically satisfy the tier, a senior developer
// deliberately asking for Sonnet/Opus on "system design" is a legitimate use.
const CAPABLE_MODEL_CATEGORY_PREFIXES = [
  'coding',        // coding_autocomplete, coding_simple, coding_medium, coding_complex
  'swe',           // swe_agentic
  'code',          // code_explanation
  'error',         // error_debugging
  'qa',            // qa_testing
  'tool_use',      // tool_use_agentic
  'system_design',
  'reasoning',
  'research',
  'analysis',
  'math',
  'sensitive',
  'legal',
  'medical',
  'devops',
  'sql',
  'planning',
  'creative',
  'vision',
];

function isSubstantialCategory(categoryKey) {
  if (!categoryKey) return false;
  return CAPABLE_MODEL_CATEGORY_PREFIXES.some(prefix => categoryKey.startsWith(prefix));
}

// ── Main router ───────────────────────────────────────────────────────────────

/**
 * Route a chat request to the best model for its classified task.
 *
 * @param {Object} tenant         Tenant document (must include routing config)
 * @param {Object} chatRequest    OpenAI-style chat-completions payload
 * @param {Object} [opts]
 * @param {String} [opts.budgetCostMode]   'economy' | 'quality' — forced by budget guard
 * @param {Number} [opts.prevSessionFillPct]  0-1 — previous request's context fill
 * @param {String} [opts.userSelectedModel]   model the caller originally asked for
 * @param {String} [opts.strictnessMode]      'fim_only' | 'smart' — force-route policy
 *        fim_only → only replace the user's model for genuine FIM / autocomplete.
 *        smart    → keep the user's model whenever the classified category is
 *                   substantial (coding / reasoning / analysis / …). Only re-routes
 *                   when the category is clearly trivial (smalltalk, chat_title, …).
 */
export async function routeRequest(tenant, chatRequest, opts = {}) {
  const startTime  = Date.now();
  const categories = await getCategories();

  // ── 1. Signal extraction (always — stored with request log) ──────────────
  const signals  = extractSignals(chatRequest);
  let preRouted  = null;
  let ruleSet    = null;

  // ── 1a. Strictness short-circuit: fim_only keeps user model for non-FIM ──
  // In `fim_only` mode we only force-route syntactic autocomplete. Anything
  // else goes straight back to the user's chosen model without running the
  // classifier — the user's seniority is trusted.
  if (opts.strictnessMode === 'fim_only' && opts.userSelectedModel && !signals.isFimRequest) {
    const userModel = await resolveUserSelectedModel(tenant, opts.userSelectedModel);
    if (userModel) {
      const analysisTimeMs = Date.now() - startTime;
      logger.info(`[router] strictness=fim_only, not FIM → keeping user model '${opts.userSelectedModel}' [${analysisTimeMs}ms]`);
      return {
        category:              null,
        confidence:            1,
        complexity:            signals.totalTokens > 8000 ? 'complex' : signals.totalTokens > 2000 ? 'medium' : 'simple',
        costTier:              userModel.tier || 'medium',
        hasImage:              signals.hasImages,
        language:              'en',
        estimatedOutputLength: 'medium',
        domain:                inferDomainFromSignals(signals) || 'general',
        conversationTurn:      signals.conversationTurns,
        userFrustrationSignal: false,
        reason:                'strictness_fim_only_keep_user_model',
        taskType:              'general',
        overrideApplied:       'strictness_fim_only',
        preRouted:              true,
        modelId:                userModel.id,
        providerId:             userModel.providerId,
        selectionMethod:        'strictness_keep_user',
        signals,
        analysisTimeMs,
        routingCostUsd:         0,
      };
    }
    // Could not resolve user model → fall through to normal routing.
  }

  // ── 1b. FIM / Autocomplete fast-path (no classifier needed) ──────────────
  // These requests are syntactic completions: latency-sensitive, short output,
  // zero reasoning required → route to low tier (coder-optimised cheap model).
  if (signals.isFimRequest) {
    const analysisTimeMs = Date.now() - startTime;
    logger.info(`[router] fim_autocomplete (pre-routed, conf=0.99) [${analysisTimeMs}ms]`);
    preRouted = {
      tier: 'micro',
      category: 'coding_autocomplete',
      domain: 'tech',
      confidence: 0.99,
      source: 'fim_detection',
      preRouted: true,
    };
  }

  // ── 1c. Tool-agent detection ──────────────────────────────────────────────
  // Tool-agent is now purely a classifier signal (via metadataSummary).
  // It no longer pre-routes — the LLM classifier decides the category based
  // on the actual user message content and conversation context.

  // ── 2. Rule-set pre-routing (if a rule set is configured) ─────────────────
  // Skip if already pre-routed via FIM detection
  if (!preRouted) {
    try {
      ruleSet = await getRuleSet(tenant._id);
    } catch { /* non-fatal */ }

    if (ruleSet) {
      preRouted = applyRuleSet(signals, ruleSet);
    }
  }

  // ── 3. Decide: pre-routed or LLM classifier ───────────────────────────────
  let result;
  const classifierConfigured = !!(tenant.routing.classifierProvider && tenant.routing.classifierModel);
  const usePreRouted = preRouted?.preRouted || !classifierConfigured;

  // ── 3b. Load providers for classifier model list (and reuse in step 6) ───
  // Load early when classifier will be used so we can inject available models
  // into the classifier prompt for direct model recommendation.
  let providers = null;
  let allAvailableModels = [];
  if (!usePreRouted) {
    try {
      providers = await Provider.find({ _id: { $in: tenant.providerIds } });
      allAvailableModels = providers.flatMap(p =>
        (p.discoveredModels || [])
          .filter(m => m.visible !== false && m.tier)
          .map(m => ({
            id: m.id,
            tier: m.tier,
            inputPer1M:  m.inputPer1M  ?? null,
            outputPer1M: m.outputPer1M ?? null,
            providerId:  p._id.toString(),
            priority:    m.priority ?? 50,
            contextWindow: m.contextWindow ?? null,
          }))
      );
    } catch { /* non-fatal — classifier runs without model list */ }
  }

  if (usePreRouted && preRouted) {
    // Build a result from the pre-routing decision
    result = {
      category:              preRouted.category || inferCategoryFromTier(preRouted.tier, preRouted.domain, categories),
      confidence:            preRouted.confidence,
      complexity:            signals.totalTokens > 15000 ? 'complex' : signals.totalTokens > 2000 ? 'medium' : 'simple',
      costTier:              preRouted.tier || 'medium',
      hasImage:              signals.hasImages,
      language:              'en',
      estimatedOutputLength: 'medium',
      domain:                preRouted.domain || inferDomainFromSignals(signals),
      conversationTurn:      signals.conversationTurns,
      userFrustrationSignal: false,
      reason:                `Pre-routed via ${preRouted.source}`,
      taskType:              (preRouted.category || '').split('_')[0] || 'general',
      overrideApplied:       '',
      preRouted:             true,
      signals,
    };
  } else {
    // ── 4. LLM classifier with fallback chain ─────────────────────────────
    if (!classifierConfigured) {
      throw new Error('Classifier provider not configured and no rule set pre-routed the request');
    }

    // Build classifier chain: primary + up to 2 fallbacks
    const classifierChain = [
      { model: tenant.routing.classifierModel, provider: tenant.routing.classifierProvider },
      ...(tenant.routing.classifierFallbacks || []).filter(f => f.model && f.provider),
    ];

    const strategy     = ruleSet?.classifier?.contextStrategy || 'truncate';
    const systemPrompt = buildClassifierPrompt(categories, allAvailableModels);
    let classifierResponse = null;
    let usedClassifierModel = null;
    let lastError = null;

    for (const clf of classifierChain) {
      try {
        const clfProvider = await Provider.findById(clf.provider);
        if (!clfProvider) continue;

        // Use model's actual context window (from provider), with optional manual override
        const clfModelEntry = clfProvider.discoveredModels?.find(m => m.id === clf.model);
        const contextWindow = clfModelEntry?.contextWindow || ruleSet?.classifier?.contextLimitTokens || 128000;
        // Reserve space for system prompt + response (~2000 tokens)
        const limitTokens = Math.max(1000, contextWindow - 2000);
        let context       = buildClassifierContext(chatRequest, signals, strategy, limitTokens);

        // Inject system-prompt-role hint so the classifier is aware of the IDE context
        // but still makes its own decision based on the actual user message
        if (preRouted?.source?.startsWith('system_prompt_role:')) {
          const roleName = preRouted.source.replace('system_prompt_role:', '');
          context += `\n[HINT: Request originates from a "${roleName}" IDE context. Classify based on the ACTUAL user message complexity, not the system prompt.]`;
        }

        const adapter = getProviderAdapter(clfProvider);
        classifierResponse = await adapter.chat({
          model:       clf.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: context },
          ],
          temperature: 0,
          max_tokens:  512,
        });
        usedClassifierModel = clf.model;
        break; // success — stop trying fallbacks
      } catch (err) {
        lastError = err;
        logger.warn(`[router] Classifier ${clf.model} failed: ${err.message}${classifierChain.indexOf(clf) < classifierChain.length - 1 ? ' — trying fallback…' : ''}`);
      }
    }

    if (!classifierResponse) {
      // All classifiers failed — use token count as a tier fallback instead of
      // throwing and always defaulting to the tenant's defaultModel (usually the
      // most expensive model). This prevents cost spikes when the classifier is
      // temporarily unavailable or rate-limited.
      const fallbackTier = signals.totalTokens >= 50000 ? 'high'
        : signals.totalTokens >= 15000 ? 'advanced'
        : signals.totalTokens >= 8000  ? 'medium'
        : signals.totalTokens >= 2000  ? 'low'
        : signals.totalTokens >= 500   ? 'minimal'
        : 'micro';

      const fallbackReason = `token_fallback (${lastError?.message || 'classifier_unavailable'})`;
      logger.warn(`[router] ${fallbackReason} → tier=${fallbackTier}`);

      result = {
        category:              null,
        confidence:            0.1,
        complexity:            signals.totalTokens > 8000 ? 'complex' : signals.totalTokens > 2000 ? 'medium' : 'simple',
        costTier:              fallbackTier,
        hasImage:              signals.hasImages,
        language:              'en',
        estimatedOutputLength: 'medium',
        domain:                inferDomainFromSignals(signals) || 'general',
        conversationTurn:      signals.conversationTurns,
        userFrustrationSignal: false,
        reason:                fallbackReason,
        taskType:              'general',
        overrideApplied:       'classifier_fallback',
        preRouted:             false,
        signals,
        routingCostUsd:        0,
      };
    } else {
    const classifierUsage = classifierResponse.usage || {};
    const classifierInTokens  = classifierUsage.prompt_tokens     || 0;
    const classifierOutTokens = classifierUsage.completion_tokens || 0;
    const content = classifierResponse.choices?.[0]?.message?.content || '';

    let parsed;
    try {
      // Extract JSON from response — classifier may wrap in ```json...``` or add prose after
      let jsonStr = content;
      const fenced = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
      if (fenced) {
        jsonStr = fenced[1];
      } else {
        // Try to find a raw JSON object
        const braceMatch = content.match(/\{[\s\S]*\}/);
        if (braceMatch) jsonStr = braceMatch[0];
      }
      parsed = JSON.parse(jsonStr.trim());
    } catch {
      logger.error('[router] Failed to parse classifier response:', typeof content === 'string' ? content.slice(0, 300) : JSON.stringify(content).slice(0, 300));
      // Fall back to token-based tier rather than crashing
      const fallbackTier = signals.totalTokens >= 50000 ? 'high'
        : signals.totalTokens >= 15000 ? 'advanced'
        : signals.totalTokens >= 8000  ? 'medium'
        : signals.totalTokens >= 2000  ? 'low'
        : signals.totalTokens >= 500   ? 'minimal'
        : 'micro';
      result = {
        category: null, confidence: 0.1,
        complexity: 'medium', costTier: fallbackTier,
        hasImage: signals.hasImages, language: 'en',
        estimatedOutputLength: 'medium',
        domain: inferDomainFromSignals(signals) || 'general',
        conversationTurn: signals.conversationTurns,
        userFrustrationSignal: false,
        reason: 'token_fallback (invalid_json)',
        taskType: 'general', overrideApplied: 'classifier_fallback',
        preRouted: false, signals, routingCostUsd: 0,
      };
    }

    if (parsed) {
      // Validate recommended_model against available models
      const recModelId = parsed.recommended_model && parsed.recommended_model !== 'null'
        ? allAvailableModels.find(m => m.id === parsed.recommended_model)?.id || null
        : null;

      result = {
        category:              parsed.category || 'smalltalk_simple',
        confidence:            parsed.confidence || 0.5,
        complexity:            parsed.complexity || 'medium',
        costTier:              parsed.cost_tier || 'medium',
        hasImage:              parsed.has_image || signals.hasImages,
        language:              parsed.language || 'en',
        estimatedOutputLength: parsed.estimated_output_length || 'medium',
        domain:                parsed.domain || inferDomainFromSignals(signals) || 'general',
        conversationTurn:      parsed.conversation_turn || signals.conversationTurns,
        userFrustrationSignal: parsed.user_frustration_signal || false,
        reason:                parsed.reasoning || '',
        taskType:              (parsed.category || '').split('_')[0] || 'general',
        overrideApplied:        '',
        preRouted:              false,
        recommendedModel:       recModelId,
        signals,
        classifierInputTokens:  classifierInTokens,
        classifierOutputTokens: classifierOutTokens,
        classifierModel:        usedClassifierModel,
        routingCostUsd:         calcCost(usedClassifierModel, classifierInTokens, classifierOutTokens, null),
      };
    }
    } // end else (classifierResponse existed)
  }

  // ── 4b. Enforce pre-routing tier / category / domain hints when classifier was used
  // Keyword rules have confidence < classifier threshold (hint-only mode), so the
  // classifier always runs for those cases. Here we enforce the pre-routing tierMin as
  // a hard floor so e.g. a security keyword rule still guarantees at least 'high' even
  // if the classifier independently chose a lower tier.
  if (!usePreRouted && preRouted?.tier) {
    const TIERS_HINT = ['micro', 'minimal', 'low', 'medium', 'advanced', 'high', 'ultra', 'critical'];
    const hintIdx = TIERS_HINT.indexOf(preRouted.tier);
    const curIdx  = TIERS_HINT.indexOf(result.costTier);
    if (hintIdx > curIdx) {
      result.costTier = preRouted.tier;
      result.overrideApplied = (result.overrideApplied ? result.overrideApplied + '+' : '')
        + `rule_tiermin:${preRouted.source}`;
    }
    // Use pre-routing category/domain as fallback if classifier left them empty
    if (preRouted.category && !result.category) result.category = preRouted.category;
    if (preRouted.domain   && !result.domain)   result.domain   = preRouted.domain;
  }

  // ── 5. Apply tenant override rules ───────────────────────────────────────
  result = applyOverrides(result, tenant.routing?.overrides, categories);

  // ── 5b. Session context-fill upgrade ─────────────────────────────────────
  // If the previous request in this session used >= 75 % of the context window,
  // proactively step up one tier so the current request lands on a model with
  // sufficient headroom — preventing mid-session context overflows.
  const fillThreshold = tenant.routing?.sessionFillUpgradeThreshold ?? 0.75;
  if (opts.prevSessionFillPct != null && opts.prevSessionFillPct >= fillThreshold) {
    const TIERS_FILL = ['micro', 'minimal', 'low', 'medium', 'advanced', 'high', 'ultra', 'critical'];
    const fillIdx = TIERS_FILL.indexOf(result.costTier);
    if (fillIdx >= 0 && fillIdx < TIERS_FILL.length - 1) {
      result.costTier = TIERS_FILL[fillIdx + 1];
      result.overrideApplied = (result.overrideApplied ? result.overrideApplied + '+' : '')
        + `session_context_upgrade(${Math.round(opts.prevSessionFillPct * 100)}%)`;
    }
  }

  // ── 5c. Apply cost mode (rule-set or budget guard override) ───────────────
  // Budget guard cost mode takes precedence when active
  const effectiveCostMode = opts.budgetCostMode || ruleSet?.costMode || 'balanced';
  if (effectiveCostMode !== 'balanced') {
    const tiers = ['micro', 'minimal', 'low', 'medium', 'advanced', 'high', 'ultra', 'critical'];
    const idx = tiers.indexOf(result.costTier);
    if (effectiveCostMode === 'economy' && idx > 0) {
      result.costTier = tiers[idx - 1]; // step down one tier
      const source = opts.budgetCostMode ? 'budget_guard_economy' : 'cost_economy';
      result.overrideApplied = (result.overrideApplied ? result.overrideApplied + '+' : '') + source;
    } else if (effectiveCostMode === 'quality' && idx < tiers.length - 1) {
      result.costTier = tiers[idx + 1]; // step up one tier
      result.overrideApplied = (result.overrideApplied ? result.overrideApplied + '+' : '') + 'cost_quality';
    }
  }

  // ── 5d. Apply explicit tier boost from rule set ─────────────────────────────
  const tierBoost = ruleSet?.tierBoost || 0;
  if (tierBoost !== 0) {
    const tiers = ['micro', 'minimal', 'low', 'medium', 'advanced', 'high', 'ultra', 'critical'];
    const curIdx = tiers.indexOf(result.costTier);
    const newIdx = Math.max(0, Math.min(tiers.length - 1, curIdx + tierBoost));
    if (newIdx !== curIdx) {
      result.costTier = tiers[newIdx];
      result.overrideApplied = (result.overrideApplied ? result.overrideApplied + '+' : '')
        + `tier_boost:${tierBoost > 0 ? '+' : ''}${tierBoost}`;
    }
  }

  // ── 5e. Smart-strictness: keep user's model for substantial categories ───
  // When the caller asked for a specific model and strictnessMode='smart',
  // honour that model whenever the classifier lands on a substantial category
  // (coding/reasoning/analysis/…) — even if the model's tier is "too high"
  // for the task. This is the developer-seniority escape hatch: a senior
  // picking Opus for a coding_medium task is a legitimate choice, not a
  // misallocation we should second-guess. FIM autocomplete is the one
  // exception (always cheap) and trivial categories still get re-routed to
  // save cost.
  if (opts.strictnessMode === 'smart' && opts.userSelectedModel && !signals.isFimRequest) {
    if (isSubstantialCategory(result.category)) {
      if (!providers) {
        providers = await Provider.find({ _id: { $in: tenant.providerIds } });
      }
      const userModelEntry = providers.flatMap(p =>
        (p.discoveredModels || [])
          .filter(m => m.id === opts.userSelectedModel && m.visible !== false)
          .map(m => ({ id: m.id, providerId: p._id.toString(), tier: m.tier, contextWindow: m.contextWindow }))
      )[0];

      if (userModelEntry) {
        // Context pre-flight: if the user's model can't fit the prompt, fall
        // through to tier-based selection (which will pick a larger model).
        const userModelTokens = signals.totalTokens || 0;
        const ctxOk = !userModelTokens || !userModelEntry.contextWindow
          || userModelEntry.contextWindow >= userModelTokens;
        if (ctxOk) {
          result.modelId         = userModelEntry.id;
          result.providerId      = userModelEntry.providerId;
          result.selectionMethod = 'strictness_smart_keep_user';
          result.overrideApplied = (result.overrideApplied ? result.overrideApplied + '+' : '') + 'strictness_smart';
          if (userModelEntry.tier) result.costTier = userModelEntry.tier;
          result.analysisTimeMs = Date.now() - startTime;
          if (opts.prevSessionFillPct != null) result.prevSessionFillPct = opts.prevSessionFillPct;
          logger.info(`[router] strictness=smart, substantial category '${result.category}' → keeping user model '${userModelEntry.id}' [${result.analysisTimeMs}ms]`);
          return result;
        }
      }
      // User model unavailable or context too small → fall through to normal routing.
    }
    // Trivial category (smalltalk, chat_title, translation, …) → re-route normally.
  }

  // ── 6. Find target model — best price-performance in the resolved tier ─────
  // Providers were loaded early if classifier ran; load now if pre-routed (fast-path)
  if (!providers) {
    providers = await Provider.find({ _id: { $in: tenant.providerIds } });
  }
  const estimatedTokens = signals.totalTokens || 0;

  // ── 6a. Use classifier's direct model recommendation if valid ─────────────
  // The classifier picks the best model having seen all available options.
  // We validate: (a) context window fits, (b) model tier >= resolved tier.
  // Overrides and costMode may have pushed the tier above the classifier's
  // original assessment — the recommendation must still match.
  if (result.recommendedModel) {
    const TIERS_CHECK = ['micro', 'minimal', 'low', 'medium', 'advanced', 'high', 'ultra', 'critical'];
    const recEntry = providers.flatMap(p =>
      (p.discoveredModels || [])
        .filter(m => m.id === result.recommendedModel && m.visible !== false)
        .map(m => ({ id: m.id, providerId: p._id.toString(), contextWindow: m.contextWindow, tier: m.tier }))
    ).find(Boolean);

    if (recEntry) {
      const ctxOk = !estimatedTokens || !recEntry.contextWindow || recEntry.contextWindow >= estimatedTokens;
      const tierOk = !recEntry.tier || TIERS_CHECK.indexOf(recEntry.tier) >= TIERS_CHECK.indexOf(result.costTier);
      if (ctxOk && tierOk) {
        result.modelId  = recEntry.id;
        result.providerId = recEntry.providerId;
        result.selectionMethod = 'classifier_recommendation';
        result.analysisTimeMs = Date.now() - startTime;
        if (opts.prevSessionFillPct != null) result.prevSessionFillPct = opts.prevSessionFillPct;
        logger.info(`[router] ${result.category} (${result.costTier}, conf=${result.confidence.toFixed(2)}, src=classifier_rec) → ${result.modelId} [${result.analysisTimeMs}ms]`);
        return result;
      }
    }
    // Recommendation was invalid or context too small — fall through to tier-based selection
    result.recommendedModel = null;
  }

  function buildCandidates(tier) {
    return providers.flatMap(p =>
      (p.discoveredModels || [])
        .filter(m => {
          if (m.visible === false || m.tier !== tier) return false;
          // Exclude models whose context window is smaller than the estimated input
          if (estimatedTokens > 0) {
            const ctx = m.contextWindow || findModel(m.id)?.contextWindow || Infinity;
            if (ctx < estimatedTokens) return false;
          }
          return true;
        })
        .map(m => ({ id: m.id, providerId: p._id.toString(), inputPer1M: m.inputPer1M, outputPer1M: m.outputPer1M, priority: m.priority }))
    );
  }

  const TIERS = ['micro', 'minimal', 'low', 'medium', 'advanced', 'high', 'ultra', 'critical'];
  let tierModels = buildCandidates(result.costTier);

  // If no model in the selected tier can handle the context, step up through tiers
  if (!tierModels.length && estimatedTokens > 0) {
    const startIdx = TIERS.indexOf(result.costTier);
    for (let i = startIdx + 1; i < TIERS.length; i++) {
      tierModels = buildCandidates(TIERS[i]);
      if (tierModels.length) {
        result.overrideApplied = (result.overrideApplied ? result.overrideApplied + '+' : '') + `context_tier_upgrade_${TIERS[i]}`;
        break;
      }
    }
  }

  if (tierModels.length) {
    const weights = getBenchWeights(result.category);
    tierModels.sort((a, b) => {
      const benchA = findModel(a.id)?.benchmarks;
      const benchB = findModel(b.id)?.benchmarks;
      const scoreA = calcPricePerformance(a, weights, benchA, effectiveCostMode);
      const scoreB = calcPricePerformance(b, weights, benchB, effectiveCostMode);
      if (scoreA !== scoreB) return scoreB - scoreA; // highest score first
      return (b.priority || 50) - (a.priority || 50);
    });
    result.modelId = tierModels[0].id;
    result.providerId = tierModels[0].providerId;
    result.selectionMethod = `benchmark_${effectiveCostMode}`;
  } else {
    // Fallback: category default → tenant default
    const matchedCategory = categories.find(c => c.key === result.category);
    result.modelId = matchedCategory?.defaultModel || tenant.routing.defaultModel;
  }

  result.analysisTimeMs = Date.now() - startTime;
  if (opts.prevSessionFillPct != null) result.prevSessionFillPct = opts.prevSessionFillPct;

  logger.info(`[router] ${result.category} (${result.costTier}, conf=${result.confidence.toFixed(2)}, src=${result.preRouted ? result.reason : 'classifier'}) → ${result.modelId} [${result.analysisTimeMs}ms]`);

  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Locate a user-selected model across the tenant's providers and return a
// normalised { id, providerId, tier, contextWindow } record, or null when the
// model is not available on any assigned provider.
async function resolveUserSelectedModel(tenant, modelId) {
  if (!modelId) return null;
  try {
    const providers = await Provider.find({ _id: { $in: tenant.providerIds } });
    for (const p of providers) {
      const m = (p.discoveredModels || []).find(m => m.id === modelId && m.visible !== false);
      if (m) {
        return {
          id:            m.id,
          providerId:    p._id.toString(),
          tier:          m.tier || null,
          contextWindow: m.contextWindow || null,
          inputPer1M:    m.inputPer1M ?? null,
          outputPer1M:   m.outputPer1M ?? null,
        };
      }
    }
  } catch { /* non-fatal — fall through */ }
  return null;
}

function inferCategoryFromTier(tier, domain, categories) {
  // Pick a sensible default category for a tier when no specific category was matched
  const defaults = {
    micro:    'chat_title_generation',
    minimal:  'smalltalk_simple',
    low:      'summarization_short',
    medium:   domain === 'legal' ? 'legal_analysis' : 'document_qa',
    advanced: domain === 'legal' ? 'legal_analysis' : 'analysis_complex',
    high:     'swe_agentic',
    ultra:    'reasoning_formal',
    critical: domain === 'medical' ? 'medical_analysis' : 'sensitive_critical',
  };
  const key = defaults[tier] || 'question_answering_complex';
  // Verify the category exists
  return categories.find(c => c.key === key) ? key : (categories[0]?.key || 'smalltalk_simple');
}

function inferDomainFromSignals(signals) {
  if (signals.detectedDomains?.length) return signals.detectedDomains[0];
  if (signals.detectedLanguages?.length) return 'tech';
  return 'general';
}
