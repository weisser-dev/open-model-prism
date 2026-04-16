import { Router } from 'express';
import crypto from 'crypto';
import Tenant from '../../models/Tenant.js';
import Provider from '../../models/Provider.js';
import { getProviderAdapter } from '../../providers/index.js';
import { logRequest, logError } from '../../services/analyticsEngine.js';
import { routeRequest } from '../../services/routerEngine.js';
import { calcCost } from '../../services/pricingService.js';
import { gatewayRequestsTotal, gatewayTokensTotal, gatewayCostUsd } from '../metrics.js';
import { isContextOverflowError, isMaxTokensError, extractMaxTokensLimit, checkContextFits, estimateChatTokens, truncateMessages } from '../../services/tokenService.js';
import logger from '../../utils/logger.js';
import { incReq, incBlocked, incError } from '../../utils/requestCounters.js';
import { checkBudget } from '../../services/budgetService.js';
import { suggestForModel } from '../../data/modelRegistry.js';
import { parseModelId } from '../../utils/parseModelId.js';
import { isAvailable as cbIsAvailable, recordSuccess as cbSuccess, recordFailure as cbFailure } from '../../services/circuitBreakerService.js';
import { checkQuotas } from '../../services/quotaService.js';
import { getActiveExperiment, selectVariant } from '../../services/experimentService.js';
import { emit as emitWebhook } from '../../services/webhookService.js';
import RequestLog from '../../models/RequestLog.js';
const router = Router();

// ── User-friendly error messages for common provider errors ─────────────────
function friendlyErrorMessage(errMsg) {
  if (!errMsg) return errMsg;
  // AWS Bedrock rate limit / throttling
  if (/Too many connections|ThrottlingException|ServiceUnavailable/i.test(errMsg)) {
    return 'AWS Bedrock rate limit reached — please wait a moment and try again.';
  }
  // AWS Bedrock blank text
  if (/text field.*is blank/i.test(errMsg)) {
    return 'Request contained empty message content. This is usually caused by tool responses with blank output — please retry.';
  }
  // AWS Bedrock tool_use without tool_result
  if (/tool_use.*without.*tool_result/i.test(errMsg)) {
    return 'Conversation history contains orphaned tool calls without results. Try starting a new conversation.';
  }
  // Proxy URL blocked
  if (/URLBlocked|Tunnel connection failed.*403/i.test(errMsg)) {
    return 'The proxy is blocking the target URL. Check your corporate proxy allowlist.';
  }
  // Proxy connection failure
  if (/ProxyError|Unable to connect to proxy/i.test(errMsg)) {
    return 'Cannot reach the configured proxy server. Verify proxy URL and connectivity.';
  }
  // Azure Responses API content type
  if (/Invalid value.*input_text.*Supported values.*output_text/i.test(errMsg)) {
    return 'Azure Responses API content format error — this has been fixed in a newer version. Please update Model Prism.';
  }
  // Context length
  if (/context.*length|maximum.*context|too many tokens/i.test(errMsg)) {
    return 'The conversation is too long for this model\'s context window. Try starting a new conversation or use a model with a larger context.';
  }
  // Generic connection errors
  if (/ECONNREFUSED/i.test(errMsg)) return 'Cannot connect to the AI provider — connection refused.';
  if (/ETIMEDOUT/i.test(errMsg)) return 'Connection to the AI provider timed out. Please try again.';
  if (/ENOTFOUND/i.test(errMsg)) return 'Cannot resolve the AI provider\'s address (DNS error). Check the provider configuration.';
  return errMsg;
}

// ── Error classification for request log badges ─────────────────────────────
function classifyError(errMsg) {
  if (!errMsg) return { category: 'unknown', description: 'Unknown error' };
  // Fixed errors — these were bugs in Model Prism, now resolved
  if (/tool_use.*without.*tool_result|tool_call_ids did not have response/i.test(errMsg))
    return { category: 'fixed', fixedIn: 'v1.10.12', description: 'Orphaned tool calls (stripped in gateway)' };
  if (/Invalid value.*input_text.*Supported.*output_text/i.test(errMsg))
    return { category: 'fixed', fixedIn: 'v1.10.12', description: 'Azure content type mapping' };
  if (/text field.*is blank/i.test(errMsg))
    return { category: 'fixed', fixedIn: 'v1.10.8', description: 'Bedrock blank text blocks' };
  if (/Missing.*tools\[0\]\.name/i.test(errMsg))
    return { category: 'fixed', fixedIn: 'v1.10.12', description: 'Azure Responses API tool format' };
  if (/expected a string.*got null|Invalid value for.*content/i.test(errMsg))
    return { category: 'fixed', fixedIn: 'v1.10.12', description: 'Azure null content handling' };
  if (/cache_control/i.test(errMsg))
    return { category: 'fixed', fixedIn: 'v1.10.27', description: 'Azure Responses API cache_control stripped' };
  if (/Provider.*not found or not assigned/i.test(errMsg))
    return { category: 'fixed', fixedIn: 'v1.10.15', description: 'Cross-provider model fallback' };
  if (/reasoning_effort/i.test(errMsg))
    return { category: 'fixed', fixedIn: 'v1.10.27', description: 'Azure Responses API reasoning_effort → reasoning.effort' };
  if (/Invalid value.*'tool'.*Supported.*assistant.*user/i.test(errMsg))
    return { category: 'fixed', fixedIn: 'v1.10.16', description: 'Azure tool role conversion on fallback' };
  // Provider errors — external, not fixable by Model Prism
  if (/Too many connections|ThrottlingException|ServiceUnavailable/i.test(errMsg))
    return { category: 'provider', description: 'Rate limit — wait and retry' };
  if (/context.*length|maximum.*context|too many tokens|prompt is too long/i.test(errMsg))
    return { category: 'provider', description: 'Context window exceeded' };
  if (/ECONNREFUSED/i.test(errMsg))
    return { category: 'provider', description: 'Provider connection refused' };
  if (/ETIMEDOUT/i.test(errMsg))
    return { category: 'provider', description: 'Provider connection timed out' };
  if (/ENOTFOUND/i.test(errMsg))
    return { category: 'provider', description: 'Provider DNS not found' };
  if (/rate_limit.*tenant|Rate limit exceeded for tenant/i.test(errMsg))
    return { category: 'provider', description: 'Tenant rate limit exceeded' };
  if (/max_tokens.*exceeds.*model limit|maximum tokens.*exceeds/i.test(errMsg))
    return { category: 'provider', description: 'Max tokens exceeds model limit' };
  if (/terminated|stream.*terminated/i.test(errMsg))
    return { category: 'provider', description: 'Stream connection terminated' };
  if (/Bad Gateway|502.*Bad/i.test(errMsg))
    return { category: 'provider', description: 'Provider returned 502 Bad Gateway' };
  if (/Multimodal.*not supported/i.test(errMsg))
    return { category: 'provider', description: 'Model does not support multimodal input' };
  if (/modelStreamErrorException|invalid sequence.*ToolUse/i.test(errMsg))
    return { category: 'provider', description: 'Model produced invalid tool use sequence' };
  if (/Server disconnected/i.test(errMsg))
    return { category: 'provider', description: 'Server disconnected mid-response' };
  if (/array too long|too many tools/i.test(errMsg))
    return { category: 'provider', description: 'Too many tools (provider limit)' };
  if (/image.*url|Unable to access.*image/i.test(errMsg))
    return { category: 'provider', description: 'Image URL not accessible' };
  if (/promptCaching.*Extra inp/i.test(errMsg))
    return { category: 'provider', description: 'Prompt caching error' };
  // Provider: tool/config validation
  if (/tool.*is a duplicate|duplicate tool/i.test(errMsg))
    return { category: 'provider', description: 'Duplicate tool name in request' };
  if (/toolConfig field must be/i.test(errMsg))
    return { category: 'provider', description: 'Bedrock tool config validation error' };
  if (/Unknown parameter.*'input\[\d+\]\.tool_calls'/i.test(errMsg))
    return { category: 'fixed', fixedIn: 'v1.10.19', description: 'Azure Responses API tool_calls — cross-provider retry triggered' };
  if (/Unknown parameter.*tool_call/i.test(errMsg))
    return { category: 'provider', description: 'Azure unsupported parameter in input' };
  if (/Unknown parameter.*'thinking'|'thinking'.*not.*supported|extra inputs.*thinking|thinking.*unknown|betas.*not.*supported|Unknown parameter.*'betas'/i.test(errMsg))
    return { category: 'provider', description: 'Anthropic-specific params (thinking/betas) sent to non-Anthropic provider — check routing config or add a Bedrock/Anthropic provider fallback' };
  if (/final assistant content/i.test(errMsg))
    return { category: 'provider', description: 'Bedrock validation error' };
  // Proxy errors
  if (/URLBlocked|Tunnel connection failed.*403/i.test(errMsg))
    return { category: 'proxy', description: 'Proxy blocking target URL' };
  if (/ProxyError|Unable to connect to proxy/i.test(errMsg))
    return { category: 'proxy', description: 'Proxy unreachable' };
  if (/McAfee|Web Gateway|<!DOCTYPE.*html/i.test(errMsg))
    return { category: 'proxy', description: 'Proxy/firewall returned HTML error page' };
  // Default
  return { category: 'unknown', description: 'Unclassified error' };
}

// ── Block direct /api/api/* access (only allowed via shorthand rewrite) ───────
// Prevents the double-prefix path from being an advertised or usable route.
router.all('/api/{*path}', (req, res, next) => {
  if (req._shorthand) return next();
  return res.status(404).json({ error: { message: 'Not found', type: 'not_found' } });
});

// ── Block /api/prism/* from being treated as a tenant request ─────────────────
// Admin routes are at /api/prism/… and are mounted before the gateway in index.js.
// This guard is a safety net in case a /api/prism/* path slips through unmatched.
router.all('/prism/{*path}', (_req, res) => {
  res.status(404).json({ error: { message: 'Not found', type: 'not_found' } });
});

// ── Provider slug cache (for model ID prefix parsing) ────────────────────────
let providerSlugSet = new Set();
let slugCacheTime = 0;
const SLUG_CACHE_TTL = 60_000;

async function getProviderSlugs() {
  if (Date.now() - slugCacheTime < SLUG_CACHE_TTL && providerSlugSet.size > 0) return providerSlugSet;
  const providers = await Provider.find().select('slug').lean();
  providerSlugSet = new Set(providers.map(p => p.slug).filter(Boolean));
  slugCacheTime = Date.now();
  return providerSlugSet;
}

// ── Tenant lookup cache ───────────────────────────────────────────────────────
const tenantCache = new Map();
const TENANT_CACHE_TTL = 60_000;

// ── Session context-fill cache ────────────────────────────────────────────────
// Tracks the fill % of the last successful request per session so the router
// can proactively upgrade to a larger-context model before an overflow occurs.
// Key: sessionId  Value: { fillPct: 0-1, timestamp }
const sessionFillCache = new Map();
const SESSION_FILL_TTL = 30 * 60_000; // 30 min of inactivity → evict

setInterval(() => {
  const cutoff = Date.now() - SESSION_FILL_TTL;
  for (const [id, v] of sessionFillCache) {
    if (v.timestamp < cutoff) sessionFillCache.delete(id);
  }
}, 5 * 60_000).unref();

// ── Per-tenant rate limiter (sliding window, in-memory) ───────────────────────
// Stores { count, windowStart } per tenantId
const tenantRateWindows = new Map();

function checkTenantRateLimit(tenantId, limitPerMin) {
  if (!limitPerMin || limitPerMin <= 0) return true; // unlimited

  const now = Date.now();
  const window = tenantRateWindows.get(tenantId);

  if (!window || now - window.windowStart >= 60_000) {
    tenantRateWindows.set(tenantId, { count: 1, windowStart: now });
    return true;
  }

  if (window.count >= limitPerMin) return false;

  window.count++;
  return true;
}

// Cleanup stale windows every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [id, w] of tenantRateWindows) {
    if (w.windowStart < cutoff) tenantRateWindows.delete(id);
  }
}, 300_000).unref();

async function resolveTenant(slug, apiKey) {
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const cacheKey = `${slug}:${keyHash}`;
  const cached = tenantCache.get(cacheKey);
  if (cached && Date.now() - cached.time < TENANT_CACHE_TTL) return cached.tenant;

  // Try legacy single-key first, then multi-key array
  let tenant = await Tenant.findOne({ slug, apiKeyHash: keyHash, active: true });
  if (!tenant) {
    tenant = await Tenant.findOne({ slug, active: true, 'apiKeys.hash': keyHash });
  }

  // ── Token-based tenant resolution ──────────────────────────────────────
  // When using the default endpoint (/api/v1/..., slug='api') and the key
  // doesn't match the default tenant, try finding the key across ALL tenants.
  // This lets admins distribute only API keys — users don't need tenant URLs.
  if (!tenant && slug === 'api') {
    tenant = await Tenant.findOne({ apiKeyHash: keyHash, active: true });
    if (!tenant) {
      tenant = await Tenant.findOne({ active: true, 'apiKeys.hash': keyHash });
    }
  }

  if (tenant) {
    // Check multi-key specific constraints (enabled, expiry)
    const matchedKey = tenant.apiKeys?.find(k => k.hash === keyHash);
    if (matchedKey) {
      if (!matchedKey.enabled) return null;
      if (matchedKey.expiresAt && new Date() > matchedKey.expiresAt) return null;
      // Update lastUsedAt (fire-and-forget)
      Tenant.updateOne(
        { _id: tenant._id, 'apiKeys._id': matchedKey._id },
        { $set: { 'apiKeys.$.lastUsedAt': new Date() } }
      ).catch(() => {});
    }
    tenantCache.set(cacheKey, { tenant, time: Date.now() });
  }
  return tenant;
}

// Auth middleware for gateway
async function gatewayAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: { message: 'API key required', type: 'authentication_error' } });
  }

  const apiKey = authHeader.slice(7);
  const tenant = await resolveTenant(req.params.tenant, apiKey);
  if (!tenant) {
    return res.status(401).json({ error: { message: 'Invalid API key or tenant', type: 'authentication_error' } });
  }

  if (!tenant.keyEnabled) {
    logError({ tenantId: tenant._id, requestedModel: req.body?.model, errorMessage: 'API key is disabled', errorType: 'authentication_error', statusCode: 401, tenant });
    return res.status(401).json({ error: { message: 'API key is disabled', type: 'authentication_error', code: 'api_key_disabled' } });
  }

  if (tenant.keyExpiresAt && new Date() > tenant.keyExpiresAt) {
    logError({ tenantId: tenant._id, requestedModel: req.body?.model, errorMessage: 'API key has expired', errorType: 'authentication_error', statusCode: 401, tenant });
    return res.status(401).json({ error: { message: 'API key has expired', type: 'authentication_error', code: 'api_key_expired' } });
  }

  req.tenant = tenant;
  next();
}

// Public tenant lookup (no key required — just checks slug exists and is active)
async function resolveTenantPublic(slug) {
  return Tenant.findOne({ slug, active: true });
}

/**
 * Detect provider-type field mismatch errors (Anthropic-specific params sent to Azure/OpenAI).
 * When these occur, a cross-provider fallback to a Bedrock/Anthropic provider is appropriate.
 */
function isProviderFieldMismatchError(err) {
  const msg = err?.message || '';
  if (/Unknown parameter.*'thinking'|'thinking'.*not.*supported|extra inputs.*thinking|thinking.*unknown.param|betas.*not.*supported|Unknown parameter.*'betas'/i.test(msg)) return true;
  if (/Unknown parameter.*'input\[\d+\]\.tool_calls'/i.test(msg)) return true;
  if (/Unknown parameter.*'cache_control'|Unknown parameter.*'input\[\d+\]\.cache_control'/i.test(msg)) return true;
  if (/Unsupported parameter.*'reasoning_effort'|Unknown parameter.*'reasoning_effort'/i.test(msg)) return true;
  return false;
}

/** True when the mismatch is specifically Azure Responses API rejecting tool_calls in input. */
function isAzureToolCallsMismatch(err) {
  return /Unknown parameter.*'input\[\d+\]\.tool_calls'/i.test(err?.message || '');
}

// ── Auto-learn context window from provider errors ────────────────────────────
// In-memory cache so the same session doesn't hit the same wrong limit twice.
const learnedContextWindows = new Map(); // "providerId:modelId" → contextWindow

/**
 * Parse the actual context window from an error message like
 * "prompt is too long: 204366 tokens > 200000 maximum" and persist it.
 * Fire-and-forget — never blocks the request.
 */
function learnContextWindowFromError(err, modelId, provider) {
  const msg = err?.message || err?.toString() || '';
  const m = msg.match(/(\d+)\s*(?:tokens?\s*)?>[\s]*(\d+)\s*(?:maximum|token)/i);
  if (!m) return;
  const actualLimit = parseInt(m[2], 10);
  if (!actualLimit || actualLimit < 1000) return;

  const cacheKey = `${provider._id}:${modelId}`;
  const prev = learnedContextWindows.get(cacheKey);
  if (prev === actualLimit) return; // already known

  learnedContextWindows.set(cacheKey, actualLimit);
  logger.info(`[gateway] Learned context window for ${modelId} on ${provider.name}: ${actualLimit.toLocaleString()} tokens`);

  // Persist to Provider.discoveredModels — async, fire-and-forget
  Provider.updateOne(
    { _id: provider._id, 'discoveredModels.id': modelId },
    { $set: { 'discoveredModels.$.contextWindow': actualLimit } },
  ).catch(e => logger.debug('[gateway] Failed to persist learned context window:', e.message));
}

/** Get effective context window, respecting learned overrides. */
function getEffectiveContextWindow(modelId, provider) {
  const cacheKey = `${provider._id}:${modelId}`;
  const learned = learnedContextWindows.get(cacheKey);
  if (learned) return learned;
  const discovered = provider.discoveredModels?.find(m => m.id === modelId);
  return discovered?.contextWindow || suggestForModel(modelId)?.contextWindow || null;
}

/**
 * Count how many models across all providers have a context window larger
 * than the given token count. Used to decide whether to add a warning hint.
 */
function countLargerContextModels(currentTokens, providers) {
  let count = 0;
  for (const p of providers) {
    for (const m of (p.discoveredModels || [])) {
      const ctx = getEffectiveContextWindow(m.id, p);
      if (ctx && ctx > currentTokens) count++;
    }
  }
  return count;
}

/**
 * Tier order (ascending cost/capability). Used for ±1 tier fallback.
 * When looking for an alternative provider, prefer same tier, then one below, then one above.
 */
const TIER_ORDER = ['minimal', 'micro', 'low', 'medium', 'advanced', 'high', 'ultra', 'critical'];
const AZURE_PROVIDER_TYPES = new Set(['azure', 'azure-proxy']);

/**
 * Find an alternative provider (non-Azure) with a model of the same tier as modelId,
 * falling back to ±1 tier if nothing found. Respects the circuit breaker state.
 *
 * @param {object} failingProvider - The provider that errored.
 * @param {string} modelId        - The model that was requested.
 * @param {object[]} providers    - All providers available to the tenant.
 * @param {Function} cbCheck      - cbIsAvailable(providerId) → boolean.
 * @returns {{ provider, model: string } | null}
 */
function findTierMatchAltProvider(failingProvider, modelId, providers, cbCheck) {
  // Resolve tier from failing provider's discovered models, then fall back to registry
  const discovered = failingProvider.discoveredModels?.find(m => m.id === modelId);
  const currentTier = discovered?.tier || suggestForModel(modelId)?.tier;
  const tierIdx = currentTier ? TIER_ORDER.indexOf(currentTier) : -1;

  // Tier search order: same → one below → one above
  const tiersToTry = tierIdx >= 0
    ? [
        currentTier,
        tierIdx > 0                        ? TIER_ORDER[tierIdx - 1] : null,
        tierIdx < TIER_ORDER.length - 1    ? TIER_ORDER[tierIdx + 1] : null,
      ].filter(Boolean)
    : [];

  for (const tier of tiersToTry) {
    for (const p of providers) {
      if (AZURE_PROVIDER_TYPES.has(p.type)) continue;            // exclude all Azure providers
      if (p._id.equals(failingProvider._id)) continue;
      if (!cbCheck(String(p._id))) continue;                     // respect circuit breaker / resilience
      const candidate = (p.discoveredModels || [])
        .filter(m => m.visible !== false && m.tier === tier)
        .sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50))[0];
      if (candidate) return { provider: p, model: candidate.id };
    }
  }
  return null;
}

/**
 * Find the next model with a larger context window to use as a fallback.
 * Searches all providers available to the tenant, sorted ascending by contextWindow.
 * Returns { modelId, provider } or null.
 */
function findLargerContextModel(currentModelId, providers) {
  // Resolve current model's context window and tier
  let currentContextWindow = 0;
  let currentTier = null;
  for (const provider of providers) {
    const found = provider.discoveredModels?.find(m => m.id === currentModelId);
    if (found) {
      if (found.contextWindow) currentContextWindow = found.contextWindow;
      if (found.tier) currentTier = found.tier;
      break;
    }
  }
  if (!currentContextWindow || !currentTier) {
    const reg = suggestForModel(currentModelId);
    if (!currentContextWindow) currentContextWindow = reg?.contextWindow || 0;
    if (!currentTier) currentTier = reg?.tier || null;
  }

  // Build flat list of all candidates with a strictly larger context window
  const candidates = [];
  for (const provider of providers) {
    for (const m of provider.discoveredModels || []) {
      if (m.visible === false) continue;
      if (m.id === currentModelId) continue;
      const ctx = m.contextWindow || suggestForModel(m.id)?.contextWindow;
      if (!ctx || ctx <= currentContextWindow) continue;
      const tier = m.tier || suggestForModel(m.id)?.tier || null;
      candidates.push({ modelId: m.id, contextWindow: ctx, tier, provider });
    }
  }
  if (!candidates.length) return null;

  // Tier search order: same → one below → one above → any (last resort)
  const tierIdx = currentTier ? TIER_ORDER.indexOf(currentTier) : -1;
  const tiersToTry = tierIdx >= 0
    ? [
        currentTier,
        tierIdx > 0                     ? TIER_ORDER[tierIdx - 1] : null,
        tierIdx < TIER_ORDER.length - 1 ? TIER_ORDER[tierIdx + 1] : null,
      ].filter(Boolean)
    : [];

  for (const tier of tiersToTry) {
    // Within each tier, pick the model with the smallest (least-overshoot) context window
    const bucket = candidates
      .filter(c => c.tier === tier)
      .sort((a, b) => a.contextWindow - b.contextWindow);
    if (bucket.length) return bucket[0];
  }

  // Final fallback: any larger-context model, cheapest first
  return candidates.sort((a, b) => a.contextWindow - b.contextWindow)[0];
}

// PUBLIC: GET /api/:tenant/v1/health  (no auth)
router.get('/:tenant/v1/health', async (req, res) => {
  const tenant = await resolveTenantPublic(req.params.tenant);
  if (!tenant) return res.status(404).json({ status: 'not_found', tenant: req.params.tenant });

  const providers = await Provider.find({ _id: { $in: tenant.providerIds } });
  const providerStatuses = providers.map(p => ({ name: p.name, status: p.status }));
  const allOk = providerStatuses.every(p => p.status === 'connected');

  const keyExpired = tenant.keyExpiresAt && new Date() > tenant.keyExpiresAt;

  res.status(allOk ? 200 : 207).json({
    status: allOk ? 'ok' : 'degraded',
    tenant: tenant.slug,
    keyEnabled: tenant.keyEnabled,
    keyExpired: keyExpired || false,
    providers: providerStatuses,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Build an ordered list of providers to try for a given model.
 * Uses tenant fallback chains if configured, otherwise returns [targetProvider].
 */
function buildFallbackChain(tenant, modelId, targetProvider, allProviders) {
  const chains = tenant.fallbackChains || [];
  // Find matching chain: exact model ID first, then wildcard '*'
  const chain = chains.find(c => c.modelPattern === modelId)
    || chains.find(c => c.modelPattern === '*');

  if (chain?.providers?.length) {
    const ordered = chain.providers
      .map(pid => allProviders.find(p => p._id.toString() === pid.toString()))
      .filter(Boolean);
    // Ensure targetProvider is first if not already in chain
    if (targetProvider && !ordered.some(p => p._id.toString() === targetProvider._id.toString())) {
      ordered.unshift(targetProvider);
    }
    return ordered;
  }

  // No chain configured — just the target provider + any others that have the model
  const result = [targetProvider];
  for (const p of allProviders) {
    if (p._id.toString() !== targetProvider._id.toString() && p.discoveredModels?.some(m => m.id === modelId)) {
      result.push(p);
    }
  }
  return result;
}

/**
 * Build a model fallback sequence from tenant.modelFallbacks.
 * Returns an array of { model, provider } pairs to try after the primary model fails.
 */
function buildModelFallbackSequence(tenant, failedModel, allProviders) {
  const rules = tenant.modelFallbacks || [];
  const rule = rules.find(r => r.sourcePattern === failedModel || r.sourcePattern === '*');
  if (!rule) return [];

  if (rule.type === 'next-tier') {
    // Auto-step-down: find models on the same providers, ordered by tier (lower)
    const TIERS = ['micro', 'minimal', 'low', 'medium', 'advanced', 'high', 'ultra', 'critical'];
    const primaryProvider = allProviders.find(p =>
      p.discoveredModels?.some(m => m.id === failedModel)
    );
    if (!primaryProvider) return [];
    const failedTierIdx = TIERS.indexOf(
      primaryProvider.discoveredModels?.find(m => m.id === failedModel)?.tier || ''
    );
    if (failedTierIdx < 0) return [];
    const candidates = (primaryProvider.discoveredModels || [])
      .filter(m => m.id !== failedModel && m.visible !== false && TIERS.indexOf(m.tier) < failedTierIdx)
      .sort((a, b) => TIERS.indexOf(b.tier) - TIERS.indexOf(a.tier)); // closest tier first
    return candidates.slice(0, 4).map(m => ({ model: m.id, provider: primaryProvider }));
  }

  // 'specific': explicit list of fallback models
  return (rule.fallbacks || []).slice(0, 4).map(fb => {
    const provider = fb.providerId
      ? allProviders.find(p => p._id.toString() === String(fb.providerId))
      : allProviders.find(p => p.discoveredModels?.some(m => m.id === fb.model));
    return { model: fb.model, provider };
  }).filter(x => x.provider);
}

// Internal meta-models that always bypass whitelist/blacklist filtering
const INTERNAL_MODELS = new Set(['auto-prism']);

// Helper: check if a model (bare or prefixed) matches a whitelist/blacklist entry
function modelMatchesList(modelId, list) {
  if (list.includes(modelId)) return true;
  // Also match bare ID extracted from prefixed form
  const slashIdx = modelId.indexOf('/');
  if (slashIdx !== -1) return list.includes(modelId.slice(slashIdx + 1));
  return false;
}

// Helper: check if a model is allowed by the tenant's whitelist/blacklist config.
// Internal models (auto-prism) always pass.
function isModelAllowed(modelId, modelConfig) {
  if (INTERNAL_MODELS.has(modelId)) return true;
  const { mode, list } = modelConfig || {};
  if (mode === 'whitelist' && list?.length) return modelMatchesList(modelId, list);
  if (mode === 'blacklist' && list?.length) return !modelMatchesList(modelId, list);
  return true;
}

// PUBLIC: GET /api/:tenant/v1/models  (no auth — lists available models)
router.get('/:tenant/v1/models/public', async (req, res) => {
  const tenant = await resolveTenantPublic(req.params.tenant);
  if (!tenant) return res.status(404).json({ error: { message: 'Tenant not found', type: 'not_found' } });

  const providers = await Provider.find({ _id: { $in: tenant.providerIds } });
  let models = [];
  for (const provider of providers) {
    for (const model of provider.discoveredModels || []) {
      if (model.visible === false) continue;
      models.push({ id: `${provider.slug}/${model.id}`, object: 'model', owned_by: provider.name });
    }
  }
  const { mode, list } = tenant.modelConfig || {};
  if (mode === 'whitelist' && list?.length) models = models.filter(m => modelMatchesList(m.id, list));
  else if (mode === 'blacklist' && list?.length) models = models.filter(m => !modelMatchesList(m.id, list));
  if (tenant.routing?.enabled) models.unshift({ id: 'auto-prism', object: 'model', owned_by: 'open-model-prism' });

  res.json({ object: 'list', data: models });
});

// GET /api/:tenant/v1/models  (authenticated)
router.get('/:tenant/v1/models', gatewayAuth, async (req, res) => {
  const { tenant } = req;

  // Aggregate models from all assigned providers
  const providers = await Provider.find({ _id: { $in: tenant.providerIds } });
  let models = [];

  for (const provider of providers) {
    for (const model of provider.discoveredModels || []) {
      if (model.visible === false) continue; // hidden in registry
      models.push({
        id: `${provider.slug}/${model.id}`,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: provider.name,
      });
    }
  }

  // Apply whitelist/blacklist
  const { mode, list } = tenant.modelConfig || {};
  if (mode === 'whitelist' && list?.length) {
    models = models.filter(m => modelMatchesList(m.id, list));
  } else if (mode === 'blacklist' && list?.length) {
    models = models.filter(m => !modelMatchesList(m.id, list));
  }

  // Add "auto" model if routing is enabled
  if (tenant.routing?.enabled) {
    models.unshift({
      id: 'auto-prism',
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'open-model-prism',
    });
  }

  res.json({ object: 'list', data: models });
});

// ── IDE config generators ─────────────────────────────────────────────────────
// Self-service endpoints that generate ready-to-use config files for IDEs.
// Public access (no auth) for the DEFAULT tenant only — other tenants need
// ?apiKey= or a Bearer header. The API key is embedded in the output so
// developers can drop the file straight into their IDE without editing.
//
// Query params:
//   ?models=model1,model2   — include only these models (plus model-prism)
//   ?apiKey=omp-xxx         — embedded in the generated config
//   ?baseUrl=https://...    — override the auto-detected base URL

// ── Tier-based recommendations & warnings ─────────────────────────────────
const TIER_ADVICE = {
  micro:    { label: 'Micro',    cost: 'negligible', recommendation: 'autocomplete' },
  minimal:  { label: 'Minimal',  cost: 'very low',   recommendation: 'autocomplete' },
  low:      { label: 'Low',      cost: 'low',        recommendation: 'autocomplete, small tasks' },
  medium:   { label: 'Medium',   cost: 'moderate',   recommendation: 'general coding, code review, debugging' },
  advanced: { label: 'Advanced', cost: 'moderate',   recommendation: 'complex coding, architecture questions' },
  high:     { label: 'High',     cost: 'high',       recommendation: 'agentic SWE, complex refactoring, security reviews' },
  ultra:    { label: 'Ultra',    cost: 'very high',   recommendation: null },
  critical: { label: 'Critical', cost: 'very high',   recommendation: null },
};

function enrichModelWithAdvice(m) {
  const advice = TIER_ADVICE[m.tier] || {};
  const entry = { id: m.id, name: m.id, provider: m.provider, tier: m.tier, cost: advice.cost || 'unknown' };

  if (m.tier === 'ultra' || m.tier === 'critical') {
    entry.warning = 'This is an ultra/critical-tier model with very high per-request costs. '
      + 'Use sparingly — recommended only for formal proofs, critical security reviews, '
      + 'sensitive legal/medical analysis, or complex multi-step reasoning where cheaper models fall short.';
    entry.suggestion = 'For everyday coding, medium–high tier models (e.g. Sonnet 4.6, GPT-5.2, Qwen3 Coder) '
      + 'deliver excellent results at a fraction of the cost.';
  }

  if (advice.recommendation) {
    entry.recommendedFor = advice.recommendation;
  }

  return entry;
}

function buildModelList(tenant, providers, selectedModels) {
  let models = [];
  for (const provider of providers) {
    for (const m of provider.discoveredModels || []) {
      if (m.visible === false) continue;
      models.push({ id: m.id, name: m.id, provider: provider.name, slug: provider.slug, tier: m.tier,
        inputPer1M: m.inputPer1M, outputPer1M: m.outputPer1M });
    }
  }
  const { mode, list } = tenant.modelConfig || {};
  if (mode === 'whitelist' && list?.length) {
    models = models.filter(m => list.some(l => m.id.includes(l) || l.includes(m.id)));
  } else if (mode === 'blacklist' && list?.length) {
    models = models.filter(m => !list.some(l => m.id.includes(l) || l.includes(m.id)));
  }
  if (selectedModels?.length) {
    models = models.filter(m => selectedModels.includes(m.id));
  }
  return models;
}

// Resolve tenant for config endpoints. Three modes:
// 1. /api/:tenant/v1/config/* with tenant slug → use that tenant (default tenant needs no key)
// 2. /api/:tenant/v1/config/*?apiKey=omp-xxx → if tenant is "api" (shorthand), look up tenant by key
// 3. Default tenant without any key → public access
async function resolveConfigTenant(req) {
  const apiKey = req.query.apiKey || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const slugParam = req.params.tenant;

  // If slug is "api" (the shorthand default) and an API key is provided,
  // try to find the tenant that owns this key — so ?apiKey alone is enough.
  if (slugParam === 'api' && apiKey) {
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    let tenant = await Tenant.findOne({ apiKeyHash: keyHash, active: true });
    if (!tenant) tenant = await Tenant.findOne({ active: true, 'apiKeys.hash': keyHash });
    if (tenant) return tenant;
  }

  const tenant = await resolveTenantPublic(slugParam);
  if (!tenant) return null;
  // Non-default tenants require an API key
  if (!tenant.isDefault && !apiKey) return null;
  return tenant;
}

// GET /api/:tenant/v1/config/models — model catalogue with tier advice
// Public for default tenant, needs ?apiKey for others.
router.get('/:tenant/v1/config/models', async (req, res) => {
  const tenant = await resolveConfigTenant(req);
  if (!tenant) return res.status(404).json({ error: { message: 'Tenant not found or API key required', type: 'not_found' } });
  const providers = await Provider.find({ _id: { $in: tenant.providerIds } });
  const models = buildModelList(tenant, providers, null);

  // Group by tier for easy browsing
  const byTier = {};
  for (const m of models) {
    if (!byTier[m.tier]) byTier[m.tier] = [];
    byTier[m.tier].push(enrichModelWithAdvice(m));
  }

  // Pick smart defaults for recommendations
  const autocompleteSuggestions = models
    .filter(m => ['micro', 'minimal', 'low'].includes(m.tier))
    .slice(0, 3)
    .map(m => m.id);
  const smallModelSuggestions = models
    .filter(m => ['low', 'medium'].includes(m.tier))
    .slice(0, 3)
    .map(m => m.id);
  const recommendedModels = models
    .filter(m => ['medium', 'high'].includes(m.tier))
    .slice(0, 3)
    .map(m => m.id);

  res.json({
    tenant: { slug: tenant.slug, name: tenant.name },
    models: [
      { id: 'model-prism', name: 'Model Prism (Auto Router)', locked: true, selected: true, tier: 'auto',
        recommendedFor: 'all tasks — automatically selects the optimal model for each request',
        suggestion: 'Best default choice. The auto-router classifies your prompt and picks the right model and tier, saving costs without sacrificing quality.' },
      ...models.map(m => ({ ...enrichModelWithAdvice(m), selected: false })),
    ],
    recommendations: {
      autocomplete: {
        description: 'For tab-autocomplete / FIM code completion, use cheap fast models:',
        models: autocompleteSuggestions,
        tiers: ['micro', 'minimal', 'low'],
      },
      smallTasks: {
        description: 'For quick questions, simple code, translations — affordable and fast:',
        models: smallModelSuggestions,
        tiers: ['low', 'medium'],
      },
      recommended: {
        description: 'Best balance of quality and cost for everyday coding and architecture work:',
        models: recommendedModels,
        tiers: ['medium', 'high'],
      },
      premium: {
        description: 'Ultra/critical-tier models are very expensive. Use only for: formal proofs, critical security audits, sensitive legal/medical analysis, or when cheaper models demonstrably fail.',
        models: models.filter(m => m.tier === 'ultra' || m.tier === 'critical').map(m => m.id),
        tiers: ['ultra', 'critical'],
      },
    },
    formats: ['continue', 'opencode'],
  });
});

// GET /api/:tenant/v1/config/continue — Continue.dev YAML config
router.get('/:tenant/v1/config/continue', async (req, res) => {
  const tenant = await resolveConfigTenant(req);
  if (!tenant) return res.status(404).json({ error: { message: 'Tenant not found or API key required', type: 'not_found' } });
  const providers = await Provider.find({ _id: { $in: tenant.providerIds } });
  const selectedModels = req.query.models ? req.query.models.split(',').map(s => s.trim()) : null;
  const models = buildModelList(tenant, providers, selectedModels);

  const baseUrl = req.query.baseUrl || `${req.protocol}://${req.get('host')}/api/${tenant.slug}/v1`;
  const apiKey = req.query.apiKey || req.headers.authorization?.replace(/^Bearer\s+/i, '') || 'YOUR_API_KEY';

  // Suggest autocomplete model: cheapest available
  const autocompModel = models.find(m => ['micro', 'minimal', 'low'].includes(m.tier));

  // Build YAML with comments as guidance
  const modelEntries = [
    `  # ── Auto Router (always included, cannot be removed) ──`,
    `  - title: "Model Prism (Auto Router)"`,
    `    provider: openai`,
    `    model: auto-prism`,
    `    apiBase: "${baseUrl}"`,
    `    apiKey: "${apiKey}"`,
    ``,
  ];

  // Group selected models by tier for organized output
  const tiers = ['micro', 'minimal', 'low', 'medium', 'advanced', 'high', 'ultra', 'critical'];
  for (const tier of tiers) {
    const tierModels = models.filter(m => m.tier === tier);
    if (!tierModels.length) continue;

    const advice = TIER_ADVICE[tier] || {};
    let tierComment = `  # ── ${advice.label || tier} tier (cost: ${advice.cost || '?'})`;
    if (tier === 'ultra' || tier === 'critical') {
      tierComment += ` — WARNING: very high costs, use sparingly!`;
    } else if (advice.recommendation) {
      tierComment += ` — good for: ${advice.recommendation}`;
    }
    modelEntries.push(tierComment);

    for (const m of tierModels) {
      modelEntries.push(`  - title: "${m.id}"`);
      modelEntries.push(`    provider: openai`);
      modelEntries.push(`    model: "${m.id}"`);
      modelEntries.push(`    apiBase: "${baseUrl}"`);
      modelEntries.push(`    apiKey: "${apiKey}"`);
    }
    modelEntries.push('');
  }

  const yaml = `# Continue.dev config — generated by Model Prism
# Tenant: "${tenant.name}" (${tenant.slug})
# Generated: ${new Date().toISOString()}
#
# RECOMMENDATION: Use "Model Prism (Auto Router)" as your primary model.
# It classifies each prompt and routes to the optimal model automatically.
# Add specific models below only if you need to bypass the auto-router.
#
# For autocomplete/FIM: ${autocompModel ? autocompModel.id : 'auto-prism'} (low cost)
# For general coding:   medium–high tier models offer the best quality/cost ratio.
# Avoid ultra/critical tier for everyday work — reserve for edge cases.

models:
${modelEntries.join('\n')}

tabAutocompleteModel:
  title: "${autocompModel ? autocompModel.id + ' (autocomplete)' : 'Model Prism (FIM)'}"
  provider: openai
  model: "${autocompModel ? autocompModel.id : 'auto-prism'}"
  apiBase: "${baseUrl}"
  apiKey: "${apiKey}"
`;

  res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="continue-config-${tenant.slug}.yaml"`);
  res.send(yaml);
});

// GET /api/:tenant/v1/config/opencode — OpenCode JSON config
router.get('/:tenant/v1/config/opencode', async (req, res) => {
  const tenant = await resolveConfigTenant(req);
  if (!tenant) return res.status(404).json({ error: { message: 'Tenant not found or API key required', type: 'not_found' } });
  const providers = await Provider.find({ _id: { $in: tenant.providerIds } });
  const selectedModels = req.query.models ? req.query.models.split(',').map(s => s.trim()) : null;
  const models = buildModelList(tenant, providers, selectedModels);

  const baseUrl = req.query.baseUrl || `${req.protocol}://${req.get('host')}/api/${tenant.slug}/v1`;
  const apiKey = req.query.apiKey || req.headers.authorization?.replace(/^Bearer\s+/i, '') || 'YOUR_API_KEY';

  const modelMap = { 'model-prism': { name: 'Model Prism (Auto Router)' } };
  const _comments = [];
  for (const m of models) {
    modelMap[m.id] = { name: m.id };
    if (m.tier === 'ultra' || m.tier === 'critical') {
      _comments.push(`WARNING: ${m.id} is ${m.tier}-tier — very high costs. Use sparingly.`);
    }
  }

  const config = {
    $schema: 'https://opencode.ai/config.json',
    _generated: {
      by: 'Model Prism',
      tenant: tenant.name,
      at: new Date().toISOString(),
      recommendation: 'Use model-prism/model-prism as default — the auto-router picks the optimal model for each task.',
      ..._comments.length ? { warnings: _comments } : {},
    },
    provider: {
      'model-prism': {
        options: { baseURL: baseUrl, apiKey },
        models: modelMap,
      },
    },
    model: 'model-prism/model-prism',
    compaction: { auto: true, prune: true },
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="opencode-${tenant.slug}.json"`);
  res.json(config);
});

// POST /api/:tenant/v1/chat/completions
router.post('/:tenant/v1/chat/completions', gatewayAuth, async (req, res) => {
  const { tenant } = req;

  // Per-tenant rate limit check
  const rpmLimit = tenant.rateLimit?.requestsPerMinute ?? 0;
  if (!checkTenantRateLimit(String(tenant._id), rpmLimit)) {
    incBlocked();
    const msg = `Rate limit exceeded for tenant '${tenant.slug}'. Limit: ${rpmLimit} req/min.`;
    logError({ tenantId: tenant._id, sessionId: req.headers['x-session-id'], requestedModel: req.body?.model, errorMessage: msg, errorType: 'rate_limit_error', statusCode: 429, tenant });
    return res.status(429).json({ error: { message: msg, type: 'rate_limit_error', code: 'tenant_rate_limit_exceeded' } });
  }
  incReq();

  // Budget check
  const budget = await checkBudget(tenant);
  if (budget.blocked) {
    incBlocked();
    const msg = `Budget limit reached for tenant '${tenant.slug}'.`;
    logError({ tenantId: tenant._id, sessionId: req.headers['x-session-id'], requestedModel: req.body?.model, errorMessage: msg, errorType: 'budget_limit_error', statusCode: 429, tenant });
    return res.status(429).json({ error: { message: msg, type: 'budget_limit_error', code: 'tenant_budget_exceeded' } });
  }

  // Quota check
  let quotaResult;
  try {
    quotaResult = await checkQuotas(tenant._id);
    if (!quotaResult.allowed) {
      incBlocked();
      const msg = `Quota exceeded for tenant '${tenant.slug}'.`;
      logError({ tenantId: tenant._id, sessionId: req.headers['x-session-id'], requestedModel: req.body?.model, errorMessage: msg, errorType: 'quota_exceeded', statusCode: 429, tenant });
      emitWebhook('quota_exhausted', { tenant: tenant.slug, quotas: quotaResult.quotas.filter(q => q.pct >= 100) }, tenant._id);
      return res.status(429).json({ error: { message: msg, type: 'quota_exceeded', code: 'tenant_quota_exceeded' } });
    }
    if (quotaResult.activeEnforcement === 'soft_warning') {
      emitWebhook('quota_warning', { tenant: tenant.slug, quotas: quotaResult.quotas.filter(q => q.pct >= 100) }, tenant._id);
    }
  } catch { /* non-fatal — don't block if quota service fails */ }

  const chatRequest = req.body;
  const userName = req.headers['x-user'] || req.headers['x-openwebui-user-name'] || chatRequest.user || null;

  // Session tracking: prefer client-provided session ID.
  // If absent, derive a stable session ID from the system prompt hash so that
  // multi-turn requests from the same agent/context are correlated automatically.
  // Single-message requests (FIM/autocomplete, one-shot questions) get random UUIDs
  // to avoid lumping thousands of unrelated autocomplete calls into one "session".
  let sessionId = req.headers['x-session-id'];
  if (!sessionId) {
    const msgs = chatRequest.messages || [];
    const userMsgCount = msgs.filter(m => m.role === 'user').length;
    const sysMsg = msgs.find(m => m.role === 'system');
    // Only correlate multi-turn conversations (>1 user message = ongoing session)
    if (sysMsg && userMsgCount > 1) {
      const sysText = typeof sysMsg.content === 'string' ? sysMsg.content : JSON.stringify(sysMsg.content);
      const sysHash = crypto.createHash('sha256').update(sysText).digest('hex').slice(0, 16);
      sessionId = `sp-${sysHash}-${tenant.slug}`;
    } else {
      sessionId = crypto.randomUUID();
    }
  }

  let requestedModel = chatRequest.model;
  let isAutoRouted = false;
  let routingResult = null;
  let explicitProviderSlug = null;

  // Parse provider prefix (e.g. "my-anthropic/claude-haiku-4-5")
  const knownSlugs = await getProviderSlugs();
  const parsed = parseModelId(chatRequest.model, knownSlugs);
  if (parsed.providerSlug) {
    explicitProviderSlug = parsed.providerSlug;
    chatRequest.model = parsed.modelId;
  }

  // Apply model aliases
  if (tenant.modelConfig?.aliases?.has?.(chatRequest.model)) {
    chatRequest.model = tenant.modelConfig.aliases.get(chatRequest.model);
  }

  // Whitelist / blacklist gate (internal models like auto-prism always pass)
  if (!isModelAllowed(chatRequest.model, tenant.modelConfig)) {
    const msg = `Model '${chatRequest.model}' is not allowed by tenant model policy`;
    logError({ tenantId: tenant._id, sessionId, userName, requestedModel, errorMessage: msg, errorType: 'access_denied', statusCode: 403, tenant, messages: chatRequest.messages });
    return res.status(403).json({ error: { message: msg, type: 'access_denied' } });
  }

  // ── Force auto-route policy (v2.1.0) ─────────────────────────────────────
  // Resolves to one of: 'off' | 'fim_only' | 'smart' | 'all'.
  // Falls back to the legacy `forceAutoRoute` boolean for pre-2.1 tenants.
  const forceAutoRouteMode = tenant.routing?.forceAutoRouteMode
    || (tenant.routing?.forceAutoRoute ? 'all' : 'off');

  // Decide whether to force-route. Explicit provider prefix always wins;
  // `auto-prism` passes through unchanged.
  let wasForceAutoRouted = false;
  let forceRouteSmartKeep = false; // when true, router will try to preserve user's model
  if (!explicitProviderSlug
      && chatRequest.model !== 'auto-prism'
      && chatRequest.model !== 'auto'
      && forceAutoRouteMode !== 'off') {
    if (forceAutoRouteMode === 'all') {
      wasForceAutoRouted = true;
      chatRequest.model = 'auto-prism';
    } else if (forceAutoRouteMode === 'fim_only' || forceAutoRouteMode === 'smart') {
      // Both modes always hand the request to the router, but pass the user's
      // original model so the router can decide whether to keep it. The router
      // applies the actual policy: fim_only → only reroute FIM syntactic
      // completions; smart → only reroute when the classified category is
      // genuinely unsuited to the user's model (e.g. chat_title / smalltalk).
      wasForceAutoRouted = true;
      forceRouteSmartKeep = true;
      chatRequest.model = 'auto-prism';
    }
  }

  // Auto-routing
  if (chatRequest.model === 'auto-prism' && tenant.routing?.enabled) {
    isAutoRouted = true;
    const routeOpts = {};
    if (budget.guardActive && budget.guardCostMode) {
      routeOpts.budgetCostMode = budget.guardCostMode;
    }
    // v2.1.0: pass user's original model + strictness mode so the router can
    // decide whether to honour the user's choice (smart / fim_only modes).
    if (forceRouteSmartKeep && requestedModel && requestedModel !== 'auto-prism' && requestedModel !== 'auto') {
      routeOpts.userSelectedModel = requestedModel;
      routeOpts.strictnessMode    = forceAutoRouteMode; // 'fim_only' | 'smart'
    }
    // Pass previous session fill % so the router can proactively upgrade tier.
    // In-memory cache is checked first (hot path); on cache miss (e.g. after a
    // pod restart) we fall back to the last successful RequestLog entry so that
    // long-running sessions don't lose their fill state across deployments.
    let prevFill = sessionFillCache.get(sessionId);
    if (!prevFill && sessionId) {
      try {
        const lastEntry = await RequestLog.findOne(
          { sessionId, status: 'success', inputTokens: { $gt: 0 }, contextWindowUsed: { $gt: 0 } },
          { inputTokens: 1, contextWindowUsed: 1 },
          { sort: { timestamp: -1 } }
        ).lean();
        if (lastEntry) {
          prevFill = { fillPct: lastEntry.inputTokens / lastEntry.contextWindowUsed, timestamp: Date.now() };
          sessionFillCache.set(sessionId, prevFill); // warm the cache
        }
      } catch {
        // DB lookup is best-effort — don't block routing on failure
      }
    }
    if (prevFill) routeOpts.prevSessionFillPct = prevFill.fillPct;

    try {
      routingResult = await routeRequest(tenant, chatRequest, routeOpts);
      chatRequest.model = routingResult.modelId;

      // ── Tier cap: never route to a MORE expensive model than requested ──
      // When the client requested a specific model (not "auto"), the routed
      // tier must not exceed the requested model's tier. Skip if routing
      // already selected the exact requested model (no-op, reduces log noise).
      if (requestedModel && requestedModel !== 'auto-prism' && requestedModel !== 'auto'
          && chatRequest.model !== requestedModel) {
        const TIERS_CAP = ['micro', 'minimal', 'low', 'medium', 'advanced', 'high', 'ultra', 'critical'];
        try {
          const capProviders = await Provider.find({ _id: { $in: tenant.providerIds } });
          const reqModelEntry = capProviders.flatMap(p =>
            (p.discoveredModels || []).filter(m => m.id === requestedModel)
          )[0];
          if (reqModelEntry?.tier) {
            const reqTierIdx = TIERS_CAP.indexOf(reqModelEntry.tier);
            const routedTierIdx = TIERS_CAP.indexOf(routingResult.costTier);
            if (reqTierIdx >= 0 && routedTierIdx > reqTierIdx) {
              chatRequest.model = requestedModel;
              routingResult.costTier = reqModelEntry.tier;
              routingResult.overrideApplied = (routingResult.overrideApplied ? routingResult.overrideApplied + '+' : '') + `tier_cap:${requestedModel}`;
              logger.info(`[gateway] Tier cap: ${routingResult.modelId} (${TIERS_CAP[routedTierIdx]}) > ${requestedModel} (${reqModelEntry.tier}) → using requested model`);
            }
          }
        } catch { /* non-fatal */ }
      }
    } catch (err) {
      logger.error('[gateway] Routing failed, using default:', { error: err.message });
      chatRequest.model = tenant.routing.defaultModel || 'gpt-4o';
    }
  }

  // A/B Experiment: check for active experiment and select variant
  let experimentId = null;
  let experimentVariant = null;
  if (isAutoRouted && routingResult) {
    try {
      const experiment = await getActiveExperiment(tenant._id, routingResult.category);
      if (experiment) {
        const variant = selectVariant(experiment, sessionId);
        experimentId = experiment._id;
        experimentVariant = variant.variantName;
        chatRequest.model = variant.model;
        if (variant.providerId) {
          explicitProviderSlug = null; // override — experiment controls the provider
        }
        routingResult.experimentOverride = { experimentId, variant: variant.variantName, model: variant.model };
      }
    } catch { /* non-fatal */ }
  }

  // Quota enforcement: auto-economy mode from quotas
  if (quotaResult?.activeEnforcement === 'auto_economy' && isAutoRouted && routingResult) {
    routingResult.costTier = 'minimal';
    routingResult.overrideApplied = (routingResult.overrideApplied ? routingResult.overrideApplied + '+' : '') + 'quota_economy';
  }

  // Find which provider has this model — always fresh from DB (no provider cache)
  let providers = await Provider.find({ _id: { $in: tenant.providerIds } });
  let targetProvider = null;

  // If explicit provider slug was given, use that specific provider
  if (explicitProviderSlug) {
    targetProvider = providers.find(p => p.slug === explicitProviderSlug);
    if (!targetProvider) {
      // Provider slug not assigned to this tenant — fallback: find the model on any assigned provider
      logger.warn(`[gateway] Provider '${explicitProviderSlug}' not assigned to tenant '${tenant.slug}', searching other providers for model '${chatRequest.model}'`);
      for (const p of providers) {
        if (p.discoveredModels?.some(m => m.id === chatRequest.model && m.visible !== false)) {
          targetProvider = p;
          logger.info(`[gateway] Found model '${chatRequest.model}' on provider '${p.slug}' (fallback from '${explicitProviderSlug}')`);
          break;
        }
      }
      // If model not found anywhere, try without the slug prefix (bare model name)
      if (!targetProvider) {
        for (const p of providers) {
          if (p.discoveredModels?.some(m => m.id === requestedModel && m.visible !== false)) {
            chatRequest.model = requestedModel; // use the bare model name
            targetProvider = p;
            logger.info(`[gateway] Found bare model '${requestedModel}' on provider '${p.slug}' (fallback from '${explicitProviderSlug}')`);
            break;
          }
        }
      }
    }
  }

  // If routing result specifies a provider, use it
  if (!targetProvider && routingResult?.providerId) {
    targetProvider = providers.find(p => p._id.toString() === routingResult.providerId);
  }

  // Otherwise find first provider that has this model (must be visible)
  if (!targetProvider) {
    for (const provider of providers) {
      if (provider.discoveredModels?.some(m => m.id === chatRequest.model && m.visible !== false)) {
        targetProvider = provider;
        break;
      }
    }
  }

  // ── Hidden model fallback: model exists but is hidden (visible=false) ──────
  // Find a visible alternative in same tier, then -1 tier, then +1 tier.
  if (!targetProvider) {
    let hiddenModel = null;
    let hiddenProvider = null;
    for (const p of providers) {
      const m = p.discoveredModels?.find(m => m.id === chatRequest.model && m.visible === false);
      if (m) { hiddenModel = m; hiddenProvider = p; break; }
    }

    if (hiddenModel) {
      const hiddenTier = hiddenModel.tier;
      const tierIdx = TIER_ORDER.indexOf(hiddenTier);
      // Search order: same tier → one tier down → one tier up
      const searchTiers = [hiddenTier];
      if (tierIdx > 0) searchTiers.push(TIER_ORDER[tierIdx - 1]);
      if (tierIdx < TIER_ORDER.length - 1) searchTiers.push(TIER_ORDER[tierIdx + 1]);

      let fallbackModel = null;
      let fallbackProvider = null;
      for (const tier of searchTiers) {
        for (const p of providers) {
          const candidate = (p.discoveredModels || [])
            .filter(m => m.visible !== false && m.tier === tier)
            .sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
          if (candidate) {
            fallbackModel = candidate;
            fallbackProvider = p;
            break;
          }
        }
        if (fallbackModel) break;
      }

      if (fallbackModel) {
        logger.info(`[gateway] Model '${chatRequest.model}' is hidden (visible=false) — falling back to '${fallbackModel.id}' (tier: ${hiddenTier} → ${fallbackModel.tier})`);
        chatRequest.model = fallbackModel.id;
        targetProvider = fallbackProvider;
      }
    }
  }

  // Last resort fallback — only if auto-routing chose this model
  if (!targetProvider && providers.length > 0 && routingResult?.model) {
    targetProvider = providers[0];
  }

  // Cache-miss recovery: if requested model not found in any known provider, the tenant
  // cache may be stale (new provider added since last resolve). Evict and re-fetch.
  if (!targetProvider || !providers.some(p => p.discoveredModels?.some(m => m.id === chatRequest.model && m.visible !== false))) {
    const cacheKey = `${req.params.tenant}:${crypto.createHash('sha256').update(req.headers.authorization?.slice(7) || '').digest('hex')}`;
    tenantCache.delete(cacheKey);
    const freshTenant = await resolveTenant(req.params.tenant, req.headers.authorization?.slice(7) || '');
    if (freshTenant) {
      providers = await Provider.find({ _id: { $in: freshTenant.providerIds } });
      for (const provider of providers) {
        if (provider.discoveredModels?.some(m => m.id === chatRequest.model && m.visible !== false)) {
          targetProvider = provider;
          break;
        }
      }
      // Only fallback if auto-routing chose this model
      if (!targetProvider && providers.length > 0 && routingResult?.model) targetProvider = providers[0];
    }
  }

  if (!targetProvider) {
    const msg = `No provider found for model '${chatRequest.model}'. The model may not exist, is hidden, or is not assigned to this tenant. Use model=auto for Model Prism's intelligent routing.`;
    logError({ tenantId: tenant._id, sessionId, userName, requestedModel, routedModel: chatRequest.model, routingResult, errorMessage: msg, errorType: 'invalid_request_error', statusCode: 400, tenant, messages: chatRequest.messages });
    return res.status(400).json({ error: { message: msg, type: 'invalid_request_error', code: 'model_not_found' } });
  }

  // Pre-flight: check context window before sending (avoids wasted round-trip)
  const effectiveContextWindow = getEffectiveContextWindow(chatRequest.model, targetProvider);
  if (effectiveContextWindow) {
    const { fits, inputTokens: estimatedInput, headroom } = checkContextFits(
      chatRequest.messages,
      chatRequest.max_tokens || 4096,
      effectiveContextWindow
    );
    // Trigger pre-flight fallback when over limit OR within the last 10% of
    // context window — the token estimator can undercount by ~5 % on complex
    // payloads (tool results, XML, code), so we need a safety margin.
    const fillPct = estimatedInput / effectiveContextWindow;
    const nearLimit = fillPct >= 0.90;
    if (!fits || nearLimit) {
      const reason = !fits ? 'overflow' : `near_limit(${Math.round(fillPct * 100)}%)`;
      logger.warn(`[gateway] Pre-flight ${reason}: model=${chatRequest.model} estimated=${estimatedInput} window=${effectiveContextWindow} headroom=${headroom}`);
      const fallback = findLargerContextModel(chatRequest.model, providers);
      if (fallback) {
        logger.info(`[gateway] Pre-flight fallback: ${chatRequest.model} → ${fallback.modelId} (context=${fallback.contextWindow})`);
        chatRequest.model = fallback.modelId;
        targetProvider = fallback.provider;
      } else {
        // No larger model available — truncate old messages as last resort
        // rather than hard-failing. The model keeps the system prompt + recent
        // turns; a synthetic note tells it that history was cut.
        const { messages: truncated, dropped } = truncateMessages(
          chatRequest.messages, effectiveContextWindow, chatRequest.max_tokens || 4096
        );
        if (dropped > 0) {
          logger.warn(`[gateway] Pre-flight truncation: dropped ${dropped} messages to fit ${chatRequest.model} (${effectiveContextWindow} tokens)`);
          chatRequest.messages = truncated;
        } else if (!fits) {
          // Couldn't truncate enough (e.g. single message larger than window) — log and proceed
          logger.error(`[gateway] Pre-flight: unable to truncate to fit ${chatRequest.model} — sending anyway`);
        }
      }
    }
  }

  // Re-resolve model metadata after potential pre-flight fallback
  const resolvedModel = targetProvider.discoveredModels?.find(m => m.id === chatRequest.model);
  const resolvedSuggestion = suggestForModel(chatRequest.model);

  // Clamp max_tokens to model limit (prevents upstream rejection)
  if (chatRequest.max_tokens) {
    const maxOut = resolvedModel?.maxOutputTokens
      || resolvedSuggestion?.maxOutputTokens
      || null;
    if (maxOut && chatRequest.max_tokens > maxOut) {
      logger.info(`[gateway] Clamping max_tokens ${chatRequest.max_tokens} → ${maxOut} for model ${chatRequest.model}`);
      chatRequest.max_tokens = maxOut;
    }
    // Clamp max_tokens to fit within remaining context headroom
    const ctxWin = resolvedModel?.contextWindow || resolvedSuggestion?.contextWindow || effectiveContextWindow;
    if (ctxWin) {
      const { inputTokens: estimatedInput } = checkContextFits(chatRequest.messages, 1, ctxWin);
      const headroom = ctxWin - estimatedInput;
      if (headroom > 0 && chatRequest.max_tokens > headroom) {
        logger.info(`[gateway] Clamping max_tokens ${chatRequest.max_tokens} → ${headroom} (headroom for ${chatRequest.model}, ctx=${ctxWin}, est_input=${estimatedInput})`);
        chatRequest.max_tokens = headroom;
      }
    }
  }
  // Final safety: max_tokens must never be < 1
  if (chatRequest.max_tokens != null && chatRequest.max_tokens < 1) {
    chatRequest.max_tokens = 1;
  }

  // Budget guard: block high-cost tiers if guard is active
  if (budget.guardActive && budget.blockedTiers.length > 0) {
    const modelInfo = suggestForModel(chatRequest.model);
    if (modelInfo && budget.blockedTiers.includes(modelInfo.tier)) {
      incBlocked();
      const msg = `Model '${chatRequest.model}' (tier: ${modelInfo.tier}) is temporarily blocked — budget threshold reached for tenant '${tenant.slug}'.`;
      logError({ tenantId: tenant._id, sessionId, userName, requestedModel, routedModel: chatRequest.model, routingResult, errorMessage: msg, errorType: 'budget_guard_error', statusCode: 429, tenant, messages: chatRequest.messages });
      return res.status(429).json({ error: { message: msg, type: 'budget_guard_error', code: 'tenant_budget_guard' } });
    }
  }

  // Extract signals from routing result (only available when auto-routed)
  const signals = routingResult?.signals || null;

  // ── Sanitize reasoning_effort — providers only accept low/medium/high ─────
  // Strip any value that isn't a valid reasoning_effort (e.g. 'none', empty, custom)
  if (chatRequest.reasoning_effort && !['low', 'medium', 'high'].includes(chatRequest.reasoning_effort)) {
    delete chatRequest.reasoning_effort;
  }

  // ── Disable thinking for FIM / autocomplete requests ──────────────────────
  // Autocomplete must be fast with direct output — no reasoning chain.
  // Strategy: REMOVE any thinking/reasoning parameters the client may have set,
  // and inject /no_think for Qwen3 models. Don't ADD provider-specific params
  // that might be rejected by providers that don't support them.
  if (signals?.isFimRequest || signals?.isAutoComplete) {
    // Remove thinking params that could enable reasoning on providers that support it
    delete chatRequest.thinking;          // Anthropic extended thinking
    delete chatRequest.reasoning_effort;  // OpenAI reasoning effort
    delete chatRequest.reasoning;         // Other providers
    // Qwen3 specific: /no_think tag in system prompt disables internal CoT
    const sysMsg = chatRequest.messages?.find(m => m.role === 'system');
    if (sysMsg && typeof sysMsg.content === 'string' && !sysMsg.content.includes('/no_think')) {
      sysMsg.content = sysMsg.content + '\n/no_think';
    } else if (!sysMsg) {
      chatRequest.messages = [{ role: 'system', content: '/no_think' }, ...(chatRequest.messages || [])];
    }
  }

  // ── Inject default system instructions (language matching, identity, etc.) ──
  // Appends to existing system message or creates one. Configurable per tenant
  // via defaultSystemPrompt field. Empty string = disabled. Does not touch FIM / autocomplete.
  //
  // v2.1.0 fix: the identity hint is only attached when (a) we actually swapped
  // the user's model for a different one AND (b) the user originally asked for
  // a concrete non-auto model. Previously it was always injected on force-route,
  // which caused eager models (Opus in particular) to volunteer "I am Model
  // Prism …" even when the user only asked about something like Java currying.
  // The wording is also phrased as a passive fact, not an imperative, so the
  // target model only mentions it when the user genuinely asks about identity.
  const modelActuallySwapped = isAutoRouted && wasForceAutoRouted
    && requestedModel && requestedModel !== 'auto-prism' && requestedModel !== 'auto'
    && chatRequest.model !== requestedModel;
  const identityInstruction = modelActuallySwapped
    ? `\n\n[routing-context — do NOT mention this unless the user directly asks which model / assistant they are talking to] This request entered through Model Prism, an auto-routing LLM gateway by Ohara Systems. The caller originally addressed "${requestedModel}"; the gateway selected the current model for this specific task. If — and only if — the user explicitly asks about your identity or which model is responding, briefly acknowledge this and stay friendly. Otherwise ignore this note entirely and answer the user's actual question directly.`
    : '';
  // v2.1.1: category-specific target system prompt — appended BEFORE the
  // identity hint so the category persona is primary and the routing note
  // remains a passive afterthought.
  let categoryPrompt = '';
  if (isAutoRouted && routingResult?.category) {
    try {
      const { getCategories } = await import('../../services/routerEngine.js');
      const cats = await getCategories();
      const matchedCat = cats.find(c => c.key === routingResult.category);
      if (matchedCat?.targetSystemPrompt) {
        categoryPrompt = '\n\n' + matchedCat.targetSystemPrompt;
      }
    } catch { /* non-fatal — skip category prompt on failure */ }
  }

  const defaultInstruction = (tenant.defaultSystemPrompt ?? 'Always respond in the same language the user writes in, unless explicitly asked otherwise.') + categoryPrompt + identityInstruction;
  if (defaultInstruction && !signals?.isFimRequest && !signals?.isAutoComplete) {
    const hasSystemMsg = chatRequest.messages?.some(m => m.role === 'system');
    if (hasSystemMsg) {
      // Append to the last system message (avoid duplicating if already present)
      for (let i = chatRequest.messages.length - 1; i >= 0; i--) {
        if (chatRequest.messages[i].role === 'system') {
          const existing = chatRequest.messages[i].content || '';
          if (!existing.includes(defaultInstruction)) {
            chatRequest.messages[i].content = existing + '\n\n' + defaultInstruction;
          }
          break;
        }
      }
    } else {
      // Prepend a system message
      chatRequest.messages = [{ role: 'system', content: defaultInstruction }, ...(chatRequest.messages || [])];
    }
  }


  // Helper: execute a single non-streaming chat call and inject annotations
  async function executeChat(provider, request) {
    const adapter = getProviderAdapter(provider);
    const response = await adapter.chat(request);

    // Strip thinking/reasoning from non-streaming responses
    if (tenant.stripThinking !== false && response.choices) {
      for (const choice of response.choices) {
        const msg = choice.message;
        if (!msg) continue;
        // Remove reasoning_content field
        if (msg.reasoning_content != null) delete msg.reasoning_content;
        // Strip <thinking>...</thinking> and <think>...</think> blocks from content
        if (typeof msg.content === 'string' && (msg.content.includes('<thinking>') || msg.content.includes('<think>'))) {
          msg.content = msg.content.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>\s*/g, '').trim();
        }
        // Content blocks: filter out thinking type
        if (Array.isArray(msg.content)) {
          msg.content = msg.content.filter(b => b.type !== 'thinking');
        }
      }
    }

    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    const actualCost = calcCost(request.model, inputTokens, outputTokens, tenant);

    response.cost_info = {
      model: request.model,
      tokens_used: inputTokens + outputTokens,
      cost_usd: Math.round(actualCost * 1e6) / 1e6,
    };

    if (isAutoRouted && routingResult) {
      // Real savings: compare against what the user originally requested.
      // For auto-prism calls, use tenant baseline config (dynamic baseline is in analytics).
      const savingsBaseline = (requestedModel && requestedModel !== 'auto-prism')
        ? requestedModel
        : (tenant.routing.baselineModel || request.model);
      const baselineCost = calcCost(savingsBaseline, inputTokens, outputTokens, tenant);
      response.auto_routing = {
        selected_model: request.model,
        category: routingResult.category,
        complexity: routingResult.complexity,
        confidence: routingResult.confidence,
        cost_tier: routingResult.costTier,
        reason: routingResult.reason,
        selection_method: routingResult.selectionMethod || 'cheapest',
        routing_time_ms: routingResult.analysisTimeMs,
        cost_usd: Math.round(actualCost * 1e6) / 1e6,
        baseline_model: savingsBaseline,
        baseline_cost_usd: Math.round(baselineCost * 1e6) / 1e6,
        saved_usd: Math.round((baselineCost - actualCost) * 1e6) / 1e6,
      };
    }

    return { response, inputTokens, outputTokens, actualCost };
  }

  // ── Sanitize request for provider compatibility ─────────────────────────
  // Normalize content block types, deduplicate tools, fix message order.
  try {
    // ── Normalize messages for provider compatibility ──────────────────
    if (chatRequest.messages?.length) {
      for (let i = 0; i < chatRequest.messages.length; i++) {
        const msg = chatRequest.messages[i];

        // 1. Normalize content arrays with input_text/output_text → plain string
        //    Azure expects content as string, not [{type:"input_text",text:"..."}]
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'input_text' || block.type === 'output_text') {
              block.type = 'text';
            }
          }
          // Remove empty/blank text blocks (Bedrock rejects them)
          msg.content = msg.content.filter(block =>
            block.type !== 'text' || (block.text && block.text.trim())
          );
          // Simplify single-text-block arrays to plain string
          if (msg.content.length === 1 && msg.content[0].type === 'text') {
            msg.content = msg.content[0].text;
          }
        }

        // Ensure no message has null/empty content without tool_calls
        // (assistant messages with only tool_calls can have null content — that's fine)
        if (msg.role === 'assistant' && !msg.content && !msg.tool_calls?.length) {
          msg.content = '.';
        }

        // Note: role:"tool" is left as-is here — Bedrock needs it.
        // Azure-specific role conversion happens in the provider adapter.
      }
    }

    // ── Deduplicate and cap tools array ──────────────────────────────
    if (chatRequest.tools?.length > 1) {
      const seen = new Set();
      chatRequest.tools = chatRequest.tools.filter(t => {
        const name = t.function?.name || t.name;
        if (!name) return true;
        if (seen.has(name)) return false;
        seen.add(name);
        return true;
      });
    }
    // Tools cap is provider-specific — applied after provider is known (below)

    if (chatRequest.messages?.length) {
      const hasTools = chatRequest.tools?.length > 0;
      if (!hasTools) {
        // Strip tool role messages when no tools[] provided
        chatRequest.messages = chatRequest.messages.filter(m => m.role !== 'tool');
      }

      // ── Strip orphaned tool_calls without matching tool results ──────
      // Providers (Bedrock + Azure) reject conversations where an assistant
      // message has tool_calls but no tool-role response follows.
      // Walk through messages and strip tool_calls from assistant messages
      // that have no corresponding tool responses after them.
      for (let i = 0; i < chatRequest.messages.length; i++) {
        const msg = chatRequest.messages[i];
        if (msg.role !== 'assistant' || !msg.tool_calls?.length) continue;

        // Collect all tool_call IDs from this assistant message
        const callIds = new Set(msg.tool_calls.map(tc => tc.id).filter(Boolean));

        // Check if the following messages contain tool responses for ALL these IDs
        let j = i + 1;
        while (j < chatRequest.messages.length && chatRequest.messages[j].role === 'tool') {
          callIds.delete(chatRequest.messages[j].tool_call_id);
          j++;
        }

        // If some tool_call IDs have no response, strip them
        if (callIds.size > 0) {
          msg.tool_calls = msg.tool_calls.filter(tc => !callIds.has(tc.id));
          if (!msg.tool_calls.length) delete msg.tool_calls;
        }
      }

      // Ensure first non-system message is a user message (only if conversation
      // literally starts with an assistant message, which Bedrock rejects)
      const firstNonSystem = chatRequest.messages.findIndex(m => m.role !== 'system');
      if (firstNonSystem >= 0 && chatRequest.messages[firstNonSystem].role === 'assistant') {
        chatRequest.messages.splice(firstNonSystem, 0, { role: 'user', content: '.' });
      }
    }
  } catch {
    // Sanitization must never break a request — skip silently on error
  }

  // ── Azure-specific sanitization (only after target provider is known) ──
  const isAzureProvider = targetProvider.type === 'azure' || targetProvider.type === 'azure-proxy' || /azure/i.test(targetProvider.name || '') || /azure/i.test(targetProvider.baseUrl || '');
  if (isAzureProvider) {
    // Azure rejects content:null — convert to empty string
    if (chatRequest.messages?.length) {
      for (const msg of chatRequest.messages) {
        if (msg.content === null || msg.content === undefined) {
          msg.content = '';
        }
      }
    }
    // Strip Anthropic-specific cache_control from messages AND content blocks (Azure rejects it)
    if (chatRequest.messages?.length) {
      for (const msg of chatRequest.messages) {
        delete msg.cache_control; // message-level cache_control
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            delete block.cache_control; // content-block-level cache_control
          }
        }
      }
    }
    // Strip reasoning_effort for Azure Responses API (uses reasoning.effort instead)
    delete chatRequest.reasoning_effort;
    // Convert role:"tool" → role:"user" (Azure doesn't support tool role)
    if (chatRequest.messages?.length) {
      chatRequest.messages = chatRequest.messages.map(m => {
        if (m.role !== 'tool') return m;
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return { role: 'user', content: `[Tool result for ${m.tool_call_id || 'unknown'}]: ${content}` };
      });
    }
    // Azure max 128 tools
    if (chatRequest.tools?.length > 128) {
      chatRequest.tools = chatRequest.tools.slice(0, 128);
    }
    // Azure Responses API expects input_image, not image_url
    if (chatRequest.messages?.length) {
      for (const msg of chatRequest.messages) {
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'image_url') {
              block.type = 'input_image';
              // Flatten image_url.url → image_url (Azure Responses API format)
              if (block.image_url?.url) {
                block.image_url = block.image_url.url;
              }
            }
          }
        }
      }
    }
  }

  try {
    const adapter = getProviderAdapter(targetProvider);

    // Always return the session ID so clients can correlate requests
    res.setHeader('x-session-id', sessionId);

    if (chatRequest.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let streamError = null;
      let streamModel = chatRequest.model;
      let streamProvider = targetProvider;

      // Build streaming fallback chain (same as non-streaming)
      const streamFallbackProviders = buildFallbackChain(tenant, chatRequest.model, targetProvider, providers);

      const doStripThinking = tenant.stripThinking !== false;

      // Helper: check if a streaming chunk is a thinking/reasoning block to strip
      function isThinkingChunk(chunk) {
        if (!doStripThinking || typeof chunk !== 'object') return false;
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) return false;
        // OpenAI-compat: reasoning_content field (used by some proxies)
        if (delta.reasoning_content != null) return true;
        // role-based thinking marker
        if (delta.role === 'thinking') return true;
        // Content with <thinking> or <think> tags (Anthropic via proxies / Qwen / DeepSeek)
        if (typeof delta.content === 'string' && (delta.content.startsWith('<thinking>') || delta.content.startsWith('<think>'))) return true;
        // Content blocks with type: 'thinking'
        if (Array.isArray(delta.content)) {
          return delta.content.every(b => b.type === 'thinking');
        }
        return false;
      }

      // Track if we're inside a thinking block (for multi-chunk thinking spans)
      let inThinkingBlock = false;

      // Helper: attempt a single streaming call. Returns true if stream completed.
      async function attemptStream(provider, request) {
        const streamAdapter = getProviderAdapter(provider);
        let wroteContent = false;
        for await (const chunk of streamAdapter.chatStream(request)) {
          if (chunk.usage) {
            totalInputTokens = chunk.usage.prompt_tokens || 0;
            totalOutputTokens = chunk.usage.completion_tokens || 0;
          }

          // Strip thinking chunks
          if (doStripThinking && typeof chunk === 'object') {
            const delta = chunk.choices?.[0]?.delta;
            if (delta) {
              // Track thinking block boundaries via content string (<thinking> or <think>)
              if (typeof delta.content === 'string') {
                if (!inThinkingBlock && (delta.content.includes('<thinking>') || delta.content.includes('<think>'))) {
                  // Keep content before the opening tag (if any)
                  const beforeTag = delta.content.replace(/<think(?:ing)?>[\s\S]*/, '').trim();
                  inThinkingBlock = true;
                  // Check if closing tag is in the same chunk
                  if (delta.content.includes('</thinking>') || delta.content.includes('</think>')) {
                    const afterTag = delta.content.replace(/.*<\/think(?:ing)?>\s*/s, '').trim();
                    inThinkingBlock = false;
                    const kept = [beforeTag, afterTag].filter(Boolean).join('');
                    if (kept) { delta.content = kept; } else { continue; }
                  } else if (beforeTag) {
                    delta.content = beforeTag;
                  } else {
                    continue; // entire chunk is thinking
                  }
                } else if (inThinkingBlock) {
                  if (delta.content.includes('</thinking>') || delta.content.includes('</think>')) {
                    const afterTag = delta.content.replace(/.*<\/think(?:ing)?>\s*/s, '').trim();
                    inThinkingBlock = false;
                    if (afterTag) { delta.content = afterTag; } else { continue; }
                  } else {
                    continue; // skip thinking content
                  }
                }
              }
              // Skip reasoning_content or role=thinking chunks
              if (isThinkingChunk(chunk)) continue;
              // Strip reasoning_content field but keep the rest of the chunk
              if (delta.reasoning_content != null) {
                delete delta.reasoning_content;
                if (!delta.content && !delta.role && !delta.tool_calls) continue;
              }
            }
          }

          wroteContent = true;
          const data = typeof chunk === 'string' ? chunk : `data: ${JSON.stringify(chunk)}\n\n`;
          res.write(data);
        }
        return wroteContent;
      }

      // Streaming retry loop: try providers, auto-clamp max_tokens, auto-upgrade context model
      let streamSuccess = false;
      let streamDidContextFallback = false;
      let streamHandledFallback = false;
      let streamFallbackType = null;
      let streamFallbackDetail = null;
      for (const fbProvider of streamFallbackProviders) {
        if (!cbIsAvailable(String(fbProvider._id))) continue;
        if (!fbProvider.discoveredModels?.some(m => m.id === chatRequest.model)) continue;

        try {
          await attemptStream(fbProvider, chatRequest);
          streamProvider = fbProvider;
          streamModel = chatRequest.model;
          cbSuccess(String(fbProvider._id));
          streamSuccess = true;
          break;
        } catch (streamErr) {
          // Log every provider attempt
          const errType = isContextOverflowError(streamErr) ? 'context_length_exceeded'
            : isMaxTokensError(streamErr) ? 'max_tokens_exceeded'
            : 'provider_error';
          const streamErrClass = classifyError(streamErr.message);
          logError({ tenantId: tenant._id, sessionId, userName, requestedModel,
            routedModel: chatRequest.model, routingResult,
            errorMessage: `[stream:${fbProvider.name}] ${streamErr.message}`,
            errorType: errType, statusCode: streamErr.status || 502, tenant, messages: chatRequest.messages,
            errorCategory: streamErrClass.category, errorFixedIn: streamErrClass.fixedIn, errorDescription: streamErrClass.description });

          // max_tokens too high → clamp and retry same provider
          if (isMaxTokensError(streamErr)) {
            const limit = extractMaxTokensLimit(streamErr);
            if (limit && (!chatRequest.max_tokens || chatRequest.max_tokens > limit)) {
              logger.info(`[gateway] Stream auto-clamping max_tokens ${chatRequest.max_tokens ?? '(unset)'} → ${limit} for model ${chatRequest.model}`);
              chatRequest.max_tokens = limit;
              try {
                await attemptStream(fbProvider, chatRequest);
                streamProvider = fbProvider;
                streamModel = chatRequest.model;
                cbSuccess(String(fbProvider._id));
                streamSuccess = true;
                break;
              } catch (retryErr) {
                streamError = retryErr;
              }
            } else {
              streamError = streamErr;
            }
            break; // max_tokens issue — don't try other providers
          }

          // Context overflow → try larger model, then truncate as last resort
          if (isContextOverflowError(streamErr)) {
            learnContextWindowFromError(streamErr, chatRequest.model, fbProvider);
            cbFailure(String(fbProvider._id));
            const fallback = findLargerContextModel(chatRequest.model, providers);
            if (fallback) {
              logger.warn(`[gateway] Stream context overflow: ${chatRequest.model} → ${fallback.modelId}`);
              try {
                await attemptStream(fallback.provider, { ...chatRequest, model: fallback.modelId });
                streamProvider = fallback.provider;
                streamModel = fallback.modelId;
                cbSuccess(String(fallback.provider._id));
                streamSuccess = true;
                streamDidContextFallback = true;
                streamHandledFallback = true;
                streamFallbackType = 'context_overflow';
                streamFallbackDetail = `context overflow on ${chatRequest.model} → upgraded to ${fallback.modelId}`;
                break;
              } catch (retryErr) {
                cbFailure(String(fallback.provider._id));
                streamError = retryErr;
              }
            } else {
              // No larger model — truncate and retry on the same model
              const ctxWindow = effectiveContextWindow
                || suggestForModel(chatRequest.model)?.contextWindow;
              if (ctxWindow) {
                const { messages: truncated, dropped } = truncateMessages(
                  chatRequest.messages, ctxWindow, chatRequest.max_tokens || 4096
                );
                if (dropped > 0) {
                  logger.warn(`[gateway] Stream truncation fallback: dropped ${dropped} messages, retrying ${chatRequest.model}`);
                  try {
                    await attemptStream(fbProvider, { ...chatRequest, messages: truncated });
                    chatRequest.messages = truncated; // keep truncated for analytics
                    streamProvider = fbProvider;
                    streamModel = chatRequest.model;
                    cbSuccess(String(fbProvider._id));
                    streamSuccess = true;
                    streamHandledFallback = true;
                    streamFallbackType = 'truncation';
                    streamFallbackDetail = `context overflow on ${chatRequest.model} → dropped ${dropped} oldest messages and retried`;
                    break;
                  } catch (retryErr) {
                    cbFailure(String(fbProvider._id));
                    streamError = retryErr;
                  }
                } else {
                  streamError = streamErr;
                }
              } else {
                streamError = streamErr;
              }
            }
            break; // context overflow — don't try other providers for same model
          }

          // Field mismatch — two sub-cases:
          if (isProviderFieldMismatchError(streamErr)) {
            if (isAzureToolCallsMismatch(streamErr)) {
              // Azure Responses API rejects tool_calls in input: find a non-Azure provider
              // with a model of the same tier (±1 if needed), respecting circuit breaker.
              const alt = findTierMatchAltProvider(fbProvider, chatRequest.model, providers, cbIsAvailable);
              if (alt) {
                logger.warn(`[gateway] Stream Azure tool_calls mismatch on ${fbProvider.name}, retrying ${alt.model} on ${alt.provider.name} (tier match)`);
                try {
                  await attemptStream(alt.provider, { ...chatRequest, model: alt.model });
                  streamProvider = alt.provider;
                  streamModel = alt.model;
                  cbSuccess(String(alt.provider._id));
                  streamSuccess = true;
                  streamHandledFallback = true;
                  streamFallbackType = 'field_mismatch';
                  streamFallbackDetail = `Azure tool_calls param unsupported on ${fbProvider.name} → retried ${alt.model} on ${alt.provider.name}`;
                  break;
                } catch (altErr) {
                  cbFailure(String(alt.provider._id));
                  streamError = altErr;
                }
              }
            } else {
              // Anthropic thinking/betas: find any other provider with the exact same model ID
              const altProvider = providers.find(p =>
                !p._id.equals(fbProvider._id)
                && !streamFallbackProviders.some(fp => fp._id.equals(p._id))
                && cbIsAvailable(String(p._id))
                && p.discoveredModels?.some(m => m.id === chatRequest.model)
              );
              if (altProvider) {
                logger.warn(`[gateway] Stream field-mismatch on ${fbProvider.name}, trying alt provider ${altProvider.name}`);
                try {
                  await attemptStream(altProvider, chatRequest);
                  streamProvider = altProvider;
                  streamModel = chatRequest.model;
                  cbSuccess(String(altProvider._id));
                  streamSuccess = true;
                  streamHandledFallback = true;
                  streamFallbackType = 'field_mismatch';
                  streamFallbackDetail = `field mismatch on ${fbProvider.name} → retried ${chatRequest.model} on ${altProvider.name}`;
                  break;
                } catch (altErr) {
                  cbFailure(String(altProvider._id));
                  streamError = altErr;
                }
              }
            }
          }

          // Other error → try next provider in chain
          cbFailure(String(fbProvider._id));
          streamError = streamErr;
          logger.warn(`[gateway] Stream provider ${fbProvider.name} failed: ${streamErr.message}, trying next…`);
          emitWebhook('provider_down', { provider: fbProvider.name, error: streamErr.message, model: chatRequest.model }, tenant._id);
        }
      }

      // ── Streaming model-level fallback ────────────────────────────────────────
      if (!streamSuccess && streamError && tenant.modelFallbacks?.length) {
        const mfSeq = buildModelFallbackSequence(tenant, chatRequest.model, providers);
        for (const { model: mfModel, provider: mfProvider } of mfSeq) {
          if (!mfProvider || streamSuccess) continue;
          logger.warn(`[gateway] Stream model fallback: ${chatRequest.model} → ${mfModel} on ${mfProvider.name}`);
          try {
            await attemptStream(mfProvider, { ...chatRequest, model: mfModel });
            streamModel = mfModel;
            streamProvider = mfProvider;
            cbSuccess(String(mfProvider._id));
            streamSuccess = true;
            streamError = null;
            break;
          } catch (mfErr) {
            logger.warn(`[gateway] Stream model fallback failed (${mfModel} on ${mfProvider.name}): ${mfErr.message}`);
            streamError = mfErr;
          }
        }
      }

      // If all retries failed, write error to stream
      if (!streamSuccess && streamError) {
        const errType = isContextOverflowError(streamError) ? 'context_length_exceeded'
          : isMaxTokensError(streamError) ? 'max_tokens_exceeded'
          : 'provider_error';
        if (isContextOverflowError(streamError)) {
          const fallback = findLargerContextModel(chatRequest.model, providers);
          res.write(`data: ${JSON.stringify({ error: { message: `Context overflow: ${streamError.message}. Retry with a larger context model.`, fallback_model: fallback?.modelId || null, type: 'context_length_exceeded' } })}\n\n`);
        } else if (isMaxTokensError(streamError)) {
          const limit = extractMaxTokensLimit(streamError);
          res.write(`data: ${JSON.stringify({ error: { message: `max_tokens exceeds model limit${limit ? ` of ${limit}` : ''}. Reduce max_tokens and retry.`, type: 'max_tokens_exceeded', max_tokens_limit: limit || undefined } })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ error: { message: friendlyErrorMessage(streamError.message), type: 'provider_error' } })}\n\n`);
        }
      }

      // Print routed model info (tenant setting) — streaming
      if (streamSuccess && tenant.printRoutedModel) {
        const routeInfo = isAutoRouted
          ? `Model-Routing: ${streamModel} selected (auto-routed, category: ${routingResult?.category || 'unknown'})`
          : `Model-Routing: ${streamModel} selected`;
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `\n\n---\n_${routeInfo}_` }, finish_reason: null }] })}\n\n`);
      }

      // Append context-overflow hint as a final delta so the user sees it inline
      if (streamSuccess && streamDidContextFallback) {
        const hint = '\n\n> ⚠️ Your context window is filling up — starting a new session is recommended to avoid future errors.';
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: hint }, finish_reason: null }] })}\n\n`);
      }
      // Context near-limit warning: when ≥90% full and few larger models available
      if (streamSuccess && !streamDidContextFallback && effectiveContextWindow) {
        const usedTokens = totalInputTokens || estimateChatTokens(chatRequest.messages, 0);
        const fill = usedTokens / effectiveContextWindow;
        if (fill >= 0.90) {
          const largerCount = countLargerContextModels(effectiveContextWindow, providers);
          if (largerCount <= 5) {
            const hint = '\n\n> ⚠️ Your context is growing large. If it exceeds the model limit, it may cause errors. Please start a new session and save open tasks in a todo.md to pass to the new session.';
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: hint }, finish_reason: null }] })}\n\n`);
          }
        }
      }

      // Ensure a usage chunk is always sent so clients (e.g. OpenCode) can track context
      if (streamSuccess) {
        if (totalInputTokens === 0) {
          totalInputTokens = routingResult?.signals?.totalTokens
            || estimateChatTokens(chatRequest.messages, chatRequest.max_tokens || 0);
        }
        // Write a final chunk with usage data (OpenAI-compatible format)
        const usageChunk = {
          choices: [],
          usage: {
            prompt_tokens: totalInputTokens,
            completion_tokens: totalOutputTokens,
            total_tokens: totalInputTokens + totalOutputTokens,
          },
        };
        res.write(`data: ${JSON.stringify(usageChunk)}\n\n`);
      }

      res.write('data: [DONE]\n\n');
      res.end();

      if (streamSuccess) {
        const streamCost = calcCost(streamModel, totalInputTokens, totalOutputTokens, tenant);
        setImmediate(() => {
          gatewayRequestsTotal.inc({ tenant: tenant.slug, model: streamModel, status: 'success' });
          gatewayTokensTotal.inc({ tenant: tenant.slug, type: 'input' }, totalInputTokens);
          gatewayTokensTotal.inc({ tenant: tenant.slug, type: 'output' }, totalOutputTokens);
          gatewayCostUsd.inc({ tenant: tenant.slug }, streamCost);
        });
        logRequest({
          tenantId: tenant._id,
          sessionId,
          userName,
          requestedModel,
          routedModel: streamModel,
          providerId: streamProvider._id,
          isAutoRouted,
          routingResult,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          streaming: true,
          tenant,
          messages: chatRequest.messages,
          experimentId,
          experimentVariant,
          contextWindowUsed: effectiveContextWindow || undefined,
          clientIp: req.ip, viaProxy: !!req.headers['x-forwarded-for'],
          contextFallback: streamDidContextFallback,
          handledFallback: streamHandledFallback,
          fallbackType: streamFallbackType,
          fallbackDetail: streamFallbackDetail,
        });
        // Update session fill cache for context-aware routing of the next request
        if (sessionId && effectiveContextWindow && totalInputTokens > 0) {
          sessionFillCache.set(sessionId, {
            fillPct: totalInputTokens / effectiveContextWindow,
            timestamp: Date.now(),
          });
        }
      }
    } else {
      let finalModel = chatRequest.model;
      let finalProvider = targetProvider;
      let didContextFallback = false;
      let originalModelBeforeFallback = null;
      let didHandledFallback = false;
      let handledFallbackType = null;
      let handledFallbackDetail = null;
      let result;
      const requestStartTime = Date.now();

      // Build fallback provider chain
      const fallbackProviders = buildFallbackChain(tenant, chatRequest.model, targetProvider, providers);

      let lastErr = null;
      for (const fbProvider of fallbackProviders) {
        // Circuit breaker: skip providers with open circuits
        if (!cbIsAvailable(String(fbProvider._id))) {
          logger.info(`[gateway] Skipping provider ${fbProvider.name} — circuit open`);
          continue;
        }

        try {
          const reqForProvider = { ...chatRequest };
          // If fallback provider doesn't have the exact model, keep trying
          if (!fbProvider.discoveredModels?.some(m => m.id === reqForProvider.model)) continue;

          result = await executeChat(fbProvider, reqForProvider);
          finalProvider = fbProvider;
          cbSuccess(String(fbProvider._id));
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;

          // Log every provider error to RequestLog (so 400s are always tracked)
          const fbErrClass = classifyError(err.message);
          logError({
            tenantId: tenant._id, sessionId, userName, requestedModel,
            routedModel: chatRequest.model, routingResult,
            errorMessage: `[provider:${fbProvider.name}] ${err.message}`,
            errorType: isContextOverflowError(err) ? 'context_length_exceeded'
              : isMaxTokensError(err) ? 'max_tokens_exceeded'
              : 'provider_error',
            statusCode: err.status || 502,
            tenant, messages: chatRequest.messages,
            errorCategory: fbErrClass.category, errorFixedIn: fbErrClass.fixedIn, errorDescription: fbErrClass.description,
          });

          // max_tokens too high: auto-clamp and retry on SAME provider (not a failover issue)
          if (isMaxTokensError(err)) {
            const limit = extractMaxTokensLimit(err);
            if (limit && (!chatRequest.max_tokens || chatRequest.max_tokens > limit)) {
              logger.info(`[gateway] Auto-clamping max_tokens ${chatRequest.max_tokens ?? '(unset)'} → ${limit} for model ${chatRequest.model} (provider: ${fbProvider.name})`);
              chatRequest.max_tokens = limit;
              try {
                result = await executeChat(fbProvider, { ...chatRequest });
                finalProvider = fbProvider;
                cbSuccess(String(fbProvider._id));
                lastErr = null;
                break;
              } catch (retryErr) {
                lastErr = retryErr;
              }
            }
            break; // max_tokens error is not a provider-failover issue
          }

          // Context overflow: try larger model, then truncate as last resort
          if (isContextOverflowError(err)) {
            learnContextWindowFromError(err, chatRequest.model, fbProvider);
            cbFailure(String(fbProvider._id));
            const fallback = findLargerContextModel(chatRequest.model, providers);
            if (fallback) {
              logger.warn(`[gateway] Context overflow on ${chatRequest.model}, retrying with ${fallback.modelId}`);
              originalModelBeforeFallback = chatRequest.model;
              try {
                result = await executeChat(fallback.provider, { ...chatRequest, model: fallback.modelId });
                finalModel = fallback.modelId;
                finalProvider = fallback.provider;
                didContextFallback = true;
                result.response.context_fallback = {
                  original_model: originalModelBeforeFallback,
                  fallback_model: fallback.modelId,
                  reason: 'context_length_exceeded',
                };
                cbSuccess(String(fallback.provider._id));
                didHandledFallback = true;
                handledFallbackType = 'context_overflow';
                handledFallbackDetail = `context overflow on ${originalModelBeforeFallback} → upgraded to ${fallback.modelId}`;
                lastErr = null;
                break;
              } catch (retryErr) {
                cbFailure(String(fallback.provider._id));
                lastErr = retryErr;
              }
            } else {
              // No larger model — truncate and retry on same model
              const ctxWindow = effectiveContextWindow
                || suggestForModel(chatRequest.model)?.contextWindow;
              if (ctxWindow) {
                const { messages: truncated, dropped } = truncateMessages(
                  chatRequest.messages, ctxWindow, chatRequest.max_tokens || 4096
                );
                if (dropped > 0) {
                  logger.warn(`[gateway] Truncation fallback: dropped ${dropped} messages, retrying ${chatRequest.model}`);
                  try {
                    result = await executeChat(fbProvider, { ...chatRequest, messages: truncated });
                    chatRequest.messages = truncated;
                    finalProvider = fbProvider;
                    cbSuccess(String(fbProvider._id));
                    lastErr = null;
                    break;
                  } catch (retryErr) {
                    cbFailure(String(fbProvider._id));
                    lastErr = retryErr;
                  }
                } else {
                  lastErr = err;
                }
              } else {
                lastErr = err;
              }
            }
            break; // context overflow is not a provider-failover issue
          }

          // Field mismatch — two sub-cases:
          if (isProviderFieldMismatchError(err)) {
            if (isAzureToolCallsMismatch(err)) {
              // Azure Responses API rejects tool_calls in input: find a non-Azure provider
              // with a model of the same tier (±1 if needed), respecting circuit breaker.
              const alt = findTierMatchAltProvider(fbProvider, chatRequest.model, providers, cbIsAvailable);
              if (alt) {
                logger.warn(`[gateway] Azure tool_calls mismatch on ${fbProvider.name}, retrying ${alt.model} on ${alt.provider.name} (tier match)`);
                try {
                  result = await executeChat(alt.provider, { ...chatRequest, model: alt.model });
                  finalProvider = alt.provider;
                  cbSuccess(String(alt.provider._id));
                  didHandledFallback = true;
                  handledFallbackType = 'field_mismatch';
                  handledFallbackDetail = `Azure tool_calls param unsupported on ${fbProvider.name} → retried ${alt.model} on ${alt.provider.name}`;
                  lastErr = null;
                  break;
                } catch (altErr) {
                  cbFailure(String(alt.provider._id));
                  lastErr = altErr;
                }
              }
            } else {
              // Anthropic thinking/betas: find any other provider with the exact same model ID
              const altProvider = providers.find(p =>
                !p._id.equals(fbProvider._id)
                && !fallbackProviders.some(fp => fp._id.equals(p._id))
                && cbIsAvailable(String(p._id))
                && p.discoveredModels?.some(m => m.id === chatRequest.model)
              );
              if (altProvider) {
                logger.warn(`[gateway] Field-mismatch on ${fbProvider.name}, trying alt provider ${altProvider.name} for model ${chatRequest.model}`);
                try {
                  result = await executeChat(altProvider, { ...chatRequest });
                  finalProvider = altProvider;
                  cbSuccess(String(altProvider._id));
                  didHandledFallback = true;
                  handledFallbackType = 'field_mismatch';
                  handledFallbackDetail = `field mismatch on ${fbProvider.name} → retried ${chatRequest.model} on ${altProvider.name}`;
                  lastErr = null;
                  break;
                } catch (altErr) {
                  cbFailure(String(altProvider._id));
                  lastErr = altErr;
                }
              }
            }
          }

          cbFailure(String(fbProvider._id));
          logger.warn(`[gateway] Provider ${fbProvider.name} failed: ${err.message}, trying next…`);
          emitWebhook('provider_down', { provider: fbProvider.name, error: err.message, model: chatRequest.model }, tenant._id);
        }
      }

      // ── Model-level fallback (after all provider-level retries exhausted) ──────
      // If tenant has modelFallbacks configured for this model, try them now.
      if ((lastErr || !result) && tenant.modelFallbacks?.length) {
        const mfSeq = buildModelFallbackSequence(tenant, chatRequest.model, providers);
        for (const { model: mfModel, provider: mfProvider } of mfSeq) {
          if (!mfProvider) continue;
          logger.warn(`[gateway] Model fallback: ${chatRequest.model} → ${mfModel} on ${mfProvider.name}`);
          try {
            result = await executeChat(mfProvider, { ...chatRequest, model: mfModel });
            finalModel = mfModel;
            finalProvider = mfProvider;
            cbSuccess(String(mfProvider._id));
            lastErr = null;
            break;
          } catch (mfErr) {
            logger.warn(`[gateway] Model fallback failed (${mfModel} on ${mfProvider.name}): ${mfErr.message}`);
            lastErr = mfErr;
          }
        }
      }

      if (lastErr || !result) {
        throw lastErr || new Error('All providers failed');
      }

      const durationMs = Date.now() - requestStartTime;
      const { response, inputTokens, outputTokens, actualCost } = result;
      response.session_id = sessionId;
      // Append context-overflow hint inline so the user sees it in the response
      if (didContextFallback && response.choices?.[0]?.message?.content) {
        response.choices[0].message.content +=
          '\n\n> ⚠️ Your context window is filling up — starting a new session is recommended to avoid future errors.';
      }
      // Print routed model info (tenant setting)
      if (tenant.printRoutedModel && response.choices?.[0]?.message?.content) {
        const routeInfo = isAutoRouted
          ? `Model-Routing: ${finalModel} selected (auto-routed, category: ${routingResult?.category || 'unknown'})`
          : `Model-Routing: ${finalModel} selected`;
        response.choices[0].message.content += `\n\n---\n_${routeInfo}_`;
      }

      // Context near-limit warning: when ≥90% full and few larger models available
      if (!didContextFallback && effectiveContextWindow && response.choices?.[0]?.message?.content) {
        const usedTokens = inputTokens || estimateChatTokens(chatRequest.messages, 0);
        const fill = usedTokens / effectiveContextWindow;
        if (fill >= 0.90) {
          const largerCount = countLargerContextModels(effectiveContextWindow, providers);
          if (largerCount <= 5) {
            response.choices[0].message.content +=
              '\n\n> ⚠️ Your context is growing large. If it exceeds the model limit, it may cause errors. Please start a new session and save open tasks in a todo.md to pass to the new session.';
          }
        }
      }
      res.json(response);

      const assistantContent = response.choices?.[0]?.message?.content || null;
      const finishReason = response.choices?.[0]?.finish_reason || null;

      setImmediate(() => {
        gatewayRequestsTotal.inc({ tenant: tenant.slug, model: finalModel, status: 'success' });
        gatewayTokensTotal.inc({ tenant: tenant.slug, type: 'input' }, inputTokens);
        gatewayTokensTotal.inc({ tenant: tenant.slug, type: 'output' }, outputTokens);
        gatewayCostUsd.inc({ tenant: tenant.slug }, actualCost);
      });
      logRequest({
        tenantId: tenant._id,
        sessionId,
        userName,
        requestedModel,
        routedModel: finalModel,
        providerId: finalProvider._id,
        isAutoRouted,
        routingResult,
        inputTokens,
        outputTokens,
        streaming: false,
        tenant,
        contextFallback: didContextFallback,
        originalModel: originalModelBeforeFallback,
        handledFallback: didHandledFallback,
        fallbackType: handledFallbackType,
        fallbackDetail: handledFallbackDetail,
        messages: chatRequest.messages,
        responseContent: assistantContent,
        finishReason,
        experimentId,
        experimentVariant,
        durationMs,
        contextWindowUsed: effectiveContextWindow || undefined,
        clientIp: req.ip, viaProxy: !!req.headers['x-forwarded-for'],
      });
      // Update session fill cache for context-aware routing of the next request
      if (sessionId && effectiveContextWindow && inputTokens > 0) {
        sessionFillCache.set(sessionId, {
          fillPct: inputTokens / effectiveContextWindow,
          timestamp: Date.now(),
        });
      }
    }
  } catch (err) {
    incError();
    gatewayRequestsTotal.inc({ tenant: req.tenant?.slug || 'unknown', model: req.body?.model || 'unknown', status: 'error' });
    logger.error('[gateway] Provider error', { error: err.message, model: chatRequest.model, tenant: tenant.slug });
    const errType = isContextOverflowError(err) ? 'context_length_exceeded'
      : isMaxTokensError(err) ? 'max_tokens_exceeded'
      : 'provider_error';
    const statusCode = err.status || (errType === 'max_tokens_exceeded' ? 400 : 502);
    const errClass = classifyError(err.message);
    logError({ tenantId: tenant._id, sessionId, userName, requestedModel, routedModel: chatRequest?.model, routingResult, errorMessage: err.message, errorType: errType, statusCode, tenant, messages: chatRequest?.messages, errorCategory: errClass.category, errorFixedIn: errClass.fixedIn, errorDescription: errClass.description, clientIp: req.ip, viaProxy: !!req.headers['x-forwarded-for'] });
    res.status(statusCode).json({ error: { message: friendlyErrorMessage(err.message), type: errType } });
  }
});

// POST /api/:tenant/v1/embeddings
router.post('/:tenant/v1/embeddings', gatewayAuth, async (req, res) => {
  const { tenant } = req;
  const providers = await Provider.find({ _id: { $in: tenant.providerIds } });

  // Parse provider prefix
  const knownSlugs = await getProviderSlugs();
  const parsed = parseModelId(req.body.model, knownSlugs);
  if (parsed.providerSlug) {
    req.body.model = parsed.modelId; // strip prefix for upstream
  }

  // Whitelist / blacklist gate
  if (!isModelAllowed(req.body.model, tenant.modelConfig)) {
    const msg = `Model '${req.body.model}' is not allowed by tenant model policy`;
    logError({ tenantId: tenant._id, requestedModel: req.body.model, errorMessage: msg, errorType: 'access_denied', statusCode: 403, tenant });
    return res.status(403).json({ error: { message: msg, type: 'access_denied' } });
  }

  // Find provider with the requested model
  let targetProvider = null;
  if (parsed.providerSlug) {
    targetProvider = providers.find(p => p.slug === parsed.providerSlug);
  }
  if (!targetProvider) {
    for (const provider of providers) {
      if (provider.discoveredModels?.some(m => m.id === req.body.model)) {
        targetProvider = provider;
        break;
      }
    }
  }

  if (!targetProvider && providers.length > 0) {
    targetProvider = providers[0];
  }

  if (!targetProvider) {
    const msg = `No provider found for model: ${req.body.model}`;
    logError({ tenantId: tenant._id, requestedModel: req.body.model, errorMessage: msg, errorType: 'invalid_request_error', statusCode: 400, tenant });
    return res.status(400).json({ error: { message: msg, type: 'invalid_request_error' } });
  }

  try {
    const adapter = getProviderAdapter(targetProvider);
    const response = await adapter.embeddings(req.body);
    res.json(response);
  } catch (err) {
    const embErrClass = classifyError(err.message);
    logError({ tenantId: tenant._id, requestedModel: req.body.model, errorMessage: err.message, errorType: 'upstream_error', statusCode: 502, tenant, errorCategory: embErrClass.category, errorFixedIn: embErrClass.fixedIn, errorDescription: embErrClass.description });
    res.status(502).json({ error: { message: friendlyErrorMessage(err.message), type: 'upstream_error' } });
  }
});

export default router;
