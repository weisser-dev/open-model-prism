import { Router } from 'express';
import crypto from 'crypto';
import { adminAuth } from '../../middleware/auth.js';
import { adminOrMaint, adminOnly } from '../../middleware/rbac.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { logRequest } from '../../services/analyticsEngine.js';
import Tenant from '../../models/Tenant.js';
import Provider from '../../models/Provider.js';
import { routeRequest } from '../../services/routerEngine.js';
import { getProviderAdapter } from '../../providers/index.js';
import { calcCost } from '../../services/pricingService.js';
import { logConfigChange } from '../../services/auditService.js';

const router = Router();
router.use(adminAuth);

function generateApiKey() {
  return 'omp-' + crypto.randomBytes(32).toString('hex');
}

function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/** Compute expiry date from lifetime (0 = unlimited → null) */
function computeExpiry(lifetimeDays) {
  if (!lifetimeDays || lifetimeDays === 0) return null;
  const d = new Date();
  d.setDate(d.getDate() + lifetimeDays);
  return d;
}

/** Attach decrypted apiKeyPlaintext to a plain tenant object (for admin use). */
function withPlaintext(obj) {
  if (obj.apiKeyEncrypted) {
    try { obj.apiKeyPlaintext = decrypt(obj.apiKeyEncrypted); } catch { /* ignore */ }
  }
  delete obj.apiKeyHash;
  delete obj.apiKeyEncrypted;
  return obj;
}

// List all tenants
router.get('/', async (_req, res) => {
  const tenants = await Tenant.find().select('-apiKeyHash');
  res.json(tenants.map(t => withPlaintext(t.toObject())));
});

// Get single tenant
router.get('/:id', async (req, res) => {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  res.json(withPlaintext(tenant.toObject()));
});

// Create tenant
router.post('/', adminOrMaint, async (req, res) => {
  const {
    slug, name, providerIds, modelConfig, routing, pricing, rateLimit,
    keyLifetimeDays = 0, budgetLimits, budgetGuard,
  } = req.body;
  if (!slug || !name) {
    return res.status(400).json({ error: 'Slug and name required' });
  }

  const existing = await Tenant.findOne({ slug });
  if (existing) return res.status(400).json({ error: 'Slug already in use' });

  const apiKey = generateApiKey();
  const keyExpiresAt = computeExpiry(keyLifetimeDays);

  const tenant = await Tenant.create({
    slug, name,
    apiKeyHash: hashApiKey(apiKey),
    apiKeyPrefix: apiKey.slice(0, 12),
    apiKeyEncrypted: encrypt(apiKey),
    providerIds, modelConfig, routing, pricing, rateLimit,
    keyLifetimeDays,
    keyExpiresAt,
    keyEnabled: true,
    ...(budgetLimits !== undefined && { budgetLimits }),
    ...(budgetGuard  !== undefined && { budgetGuard }),
  });

  res.status(201).json({ ...withPlaintext(tenant.toObject()), apiKey });
});

// Update tenant
router.put('/:id', adminOrMaint, async (req, res) => {
  const {
    name, providerIds, modelConfig, routing, pricing, rateLimit, active,
    keyEnabled, keyLifetimeDays, budgetLimits, budgetGuard, stripThinking, printRoutedModel, defaultSystemPrompt,
    fallbackChains, modelFallbacks,
  } = req.body;
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  const beforeState = tenant.toObject();

  if (name !== undefined) tenant.name = name;
  if (providerIds !== undefined) tenant.providerIds = providerIds;
  if (modelConfig !== undefined) tenant.modelConfig = modelConfig;
  if (routing !== undefined) tenant.routing = routing;
  if (pricing !== undefined) tenant.pricing = pricing;
  if (rateLimit !== undefined) tenant.rateLimit = rateLimit;
  if (active !== undefined) tenant.active = active;
  if (keyEnabled !== undefined) tenant.keyEnabled = keyEnabled;
  if (keyLifetimeDays !== undefined) tenant.keyLifetimeDays = keyLifetimeDays;
  if (budgetLimits !== undefined) tenant.budgetLimits = budgetLimits;
  if (budgetGuard  !== undefined) tenant.budgetGuard  = budgetGuard;
  if (stripThinking !== undefined) tenant.stripThinking = stripThinking;
  if (printRoutedModel !== undefined) tenant.printRoutedModel = printRoutedModel;
  if (defaultSystemPrompt !== undefined) tenant.defaultSystemPrompt = defaultSystemPrompt;
  if (fallbackChains !== undefined) tenant.fallbackChains = fallbackChains;
  if (modelFallbacks !== undefined) tenant.modelFallbacks = modelFallbacks;

  await tenant.save();
  logConfigChange({ user: req.user?.username, action: 'update', target: 'tenant', targetId: tenant._id, targetName: tenant.name || tenant.slug, before: beforeState, after: tenant.toObject() });
  res.json(withPlaintext(tenant.toObject()));
});

// Rotate API key (auto-generate)
router.post('/:id/rotate-key', adminOrMaint, async (req, res) => {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const apiKey = generateApiKey();
  tenant.apiKeyHash = hashApiKey(apiKey);
  tenant.apiKeyPrefix = apiKey.slice(0, 12);
  tenant.apiKeyEncrypted = encrypt(apiKey);
  tenant.keyExpiresAt = computeExpiry(tenant.keyLifetimeDays);
  tenant.customApiKey = false;
  await tenant.save();

  res.json({ apiKey, expiresAt: tenant.keyExpiresAt, message: 'API key rotated. Save this key — it will not be shown again.' });
});

// Set custom API key (user-supplied value)
router.post('/:id/set-key', adminOrMaint, async (req, res) => {
  const { apiKey, keyLifetimeDays } = req.body;
  if (!apiKey || apiKey.length < 1) {
    return res.status(400).json({ error: 'Custom key must be at least 1 character' });
  }
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  tenant.apiKeyHash = hashApiKey(apiKey);
  tenant.apiKeyPrefix = apiKey.slice(0, Math.min(12, apiKey.length));
  tenant.apiKeyEncrypted = encrypt(apiKey);
  if (keyLifetimeDays !== undefined) tenant.keyLifetimeDays = parseInt(keyLifetimeDays) || 0;
  tenant.keyExpiresAt = computeExpiry(tenant.keyLifetimeDays);
  tenant.customApiKey = true;
  await tenant.save();

  res.json({ message: 'Custom API key saved.', prefix: tenant.apiKeyPrefix, expiresAt: tenant.keyExpiresAt });
});

// ── Multi-API-key management ─────────────────────────────────────────────────

// List all API keys for a tenant (hashes hidden)
router.get('/:id/keys', async (req, res) => {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const keys = (tenant.apiKeys || []).map(k => ({
    _id: k._id,
    prefix: k.prefix,
    label: k.label,
    enabled: k.enabled,
    custom: k.custom,
    expiresAt: k.expiresAt,
    lastUsedAt: k.lastUsedAt,
    createdAt: k.createdAt,
  }));

  // Include legacy key as first entry if exists
  const legacyKey = tenant.apiKeyPrefix ? {
    _id: 'legacy',
    prefix: tenant.apiKeyPrefix,
    label: 'Primary key',
    enabled: tenant.keyEnabled,
    custom: tenant.customApiKey,
    expiresAt: tenant.keyExpiresAt,
    lastUsedAt: null,
    createdAt: tenant.createdAt,
    isLegacy: true,
  } : null;

  res.json({ keys: legacyKey ? [legacyKey, ...keys] : keys });
});

// Add a new API key (auto-generated)
router.post('/:id/keys', adminOrMaint, async (req, res) => {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const { label = '', keyLifetimeDays = 0 } = req.body;
  const apiKey = generateApiKey();
  const expiresAt = computeExpiry(keyLifetimeDays);

  tenant.apiKeys.push({
    hash: hashApiKey(apiKey),
    prefix: apiKey.slice(0, 12),
    encrypted: encrypt(apiKey),
    label,
    enabled: true,
    custom: false,
    expiresAt,
  });
  await tenant.save();

  const added = tenant.apiKeys[tenant.apiKeys.length - 1];
  res.status(201).json({
    _id: added._id,
    apiKey,
    prefix: added.prefix,
    label: added.label,
    expiresAt: added.expiresAt,
    message: 'Additional API key created. Save this key — it will not be shown again.',
  });
});

// Add a custom API key (user-supplied value)
router.post('/:id/keys/custom', adminOrMaint, async (req, res) => {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const { apiKey, label = '', keyLifetimeDays = 0 } = req.body;
  if (!apiKey || apiKey.length < 1) {
    return res.status(400).json({ error: 'Custom key must be at least 1 character' });
  }

  // Check for duplicate hash
  const keyHash = hashApiKey(apiKey);
  if (tenant.apiKeyHash === keyHash || tenant.apiKeys.some(k => k.hash === keyHash)) {
    return res.status(400).json({ error: 'This key already exists for this tenant' });
  }

  const expiresAt = computeExpiry(keyLifetimeDays);
  tenant.apiKeys.push({
    hash: keyHash,
    prefix: apiKey.slice(0, Math.min(12, apiKey.length)),
    encrypted: encrypt(apiKey),
    label,
    enabled: true,
    custom: true,
    expiresAt,
  });
  await tenant.save();

  const added = tenant.apiKeys[tenant.apiKeys.length - 1];
  res.status(201).json({
    _id: added._id,
    prefix: added.prefix,
    label: added.label,
    expiresAt: added.expiresAt,
    message: 'Custom API key added.',
  });
});

// Update a key (enable/disable, label)
router.patch('/:id/keys/:keyId', adminOrMaint, async (req, res) => {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const key = tenant.apiKeys.id(req.params.keyId);
  if (!key) return res.status(404).json({ error: 'API key not found' });

  if (req.body.enabled !== undefined) key.enabled = req.body.enabled;
  if (req.body.label !== undefined) key.label = req.body.label;
  await tenant.save();

  res.json({ _id: key._id, prefix: key.prefix, label: key.label, enabled: key.enabled });
});

// Delete (revoke) a key
router.delete('/:id/keys/:keyId', adminOrMaint, async (req, res) => {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const key = tenant.apiKeys.id(req.params.keyId);
  if (!key) return res.status(404).json({ error: 'API key not found' });

  key.deleteOne();
  await tenant.save();

  res.json({ success: true, message: 'API key revoked' });
});

// ── Add provider to default tenant (used by setup wizard + providers page prompt)
// POST /api/prism/admin/tenants/default/add-provider  { providerId }
router.post('/default/add-provider', adminOrMaint, async (req, res) => {
  const { providerId } = req.body;
  if (!providerId) return res.status(400).json({ error: 'providerId required' });

  const tenant = await Tenant.findOne({ isDefault: true });
  if (!tenant) return res.status(404).json({ error: 'Default tenant not found' });

  const already = tenant.providerIds.some(id => String(id) === String(providerId));
  if (!already) {
    tenant.providerIds.push(providerId);
    await tenant.save();
  }

  res.json({ added: !already, tenantId: tenant._id, tenantSlug: tenant.slug });
});

// Delete tenant — with cascade cleanup of associated data
router.delete('/:id', adminOnly, async (req, res) => {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  if (tenant.isDefault) return res.status(403).json({ error: 'Cannot delete the default tenant' });

  // ── Cascade cleanup ────────────────────────────────────────────────────
  const tenantId = req.params.id;
  const cascade = {};
  try {
    const RequestLog = (await import('../../models/RequestLog.js')).default;
    const DailyStat  = (await import('../../models/DailyStat.js')).default;
    const r1 = await RequestLog.deleteMany({ tenantId });
    cascade.requestLogs = r1.deletedCount;
    const r2 = await DailyStat.deleteMany({ tenantId });
    cascade.dailyStats = r2.deletedCount;
  } catch { /* non-fatal — orphans will be caught by cleanup-legacy */ }

  try {
    const Quota = (await import('../../models/Quota.js')).default;
    const r3 = await Quota.deleteMany({ tenantId });
    cascade.quotas = r3.deletedCount;
  } catch { /* non-fatal */ }

  try {
    const RoutingRuleSet = (await import('../../models/RoutingRuleSet.js')).default;
    const r4 = await RoutingRuleSet.deleteMany({ tenantId });
    cascade.ruleSets = r4.deletedCount;
  } catch { /* non-fatal */ }

  await Tenant.findByIdAndDelete(tenantId);
  logConfigChange({ user: req.user?.username, action: 'delete', target: 'tenant', targetId: tenantId, targetName: tenant.name || tenant.slug });
  res.json({ success: true, cascade });
});

// ── Admin test-request: run a request against a tenant without needing its API key
// POST /api/admin/tenants/:id/test-request
// Body: { model: "auto" | "<modelId>", messages: [...], systemPrompt?: string }
router.post('/:id/test-request', adminOrMaint, async (req, res) => {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const { model = 'auto-prism', messages = [], systemPrompt } = req.body;
  if (!messages.length) return res.status(400).json({ error: 'messages required' });

  const chatRequest = {
    model,
    messages: systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages,
    temperature: 0.7,
    max_tokens: 1024,
  };

  let routingResult = null;
  let finalModel = model;

  try {
    // Find providers upfront (needed for fallback model resolution)
    const providers = await Provider.find({ _id: { $in: tenant.providerIds } });

    // Auto-routing or model resolution
    if (model === 'auto-prism') {
      if (tenant.routing?.enabled) {
        routingResult = await routeRequest(tenant, chatRequest);
        chatRequest.model = routingResult.modelId;
        finalModel = routingResult.modelId;
      } else {
        // Routing disabled — fall back to first visible model across providers
        const first = providers.flatMap(p => p.discoveredModels || [])
          .find(m => m.visible !== false);
        if (!first) return res.status(400).json({ error: 'No models available for this tenant' });
        chatRequest.model = first.id;
        finalModel = first.id;
      }
    }
    let targetProvider = providers.find(p =>
      p.discoveredModels?.some(m => m.id === chatRequest.model)
    ) || providers[0];

    if (!targetProvider) return res.status(400).json({ error: 'No provider found for model: ' + chatRequest.model });

    const adapter = getProviderAdapter(targetProvider);
    const response = await adapter.chat(chatRequest);

    const inputTokens  = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    const cost = calcCost(finalModel, inputTokens, outputTokens, tenant);

    // Log to request log (same as gateway — admin try-requests are real requests)
    logRequest({
      tenantId:       tenant._id,
      userName:       req.user?.username ? `admin:${req.user.username}` : 'admin:try',
      requestedModel: model,
      routedModel:    finalModel,
      providerId:     targetProvider._id,
      isAutoRouted:   model === 'auto-prism',
      routingResult,
      inputTokens,
      outputTokens,
      streaming:      false,
      tenant,
      messages:       chatRequest.messages,
    });

    res.json({
      content:         response.choices?.[0]?.message?.content || '',
      model:           finalModel,
      inputTokens,
      outputTokens,
      costUsd:         Math.round(cost * 1e6) / 1e6,
      routingCostUsd:  routingResult?.routingCostUsd
        ? Math.round(routingResult.routingCostUsd * 1e6) / 1e6
        : undefined,
      routing:      routingResult ? {
        category:    routingResult.category,
        costTier:    routingResult.costTier,
        confidence:  routingResult.confidence,
        domain:      routingResult.domain,
        reason:      routingResult.reason,
        preRouted:   routingResult.preRouted,
        analysisMs:  routingResult.analysisTimeMs,
        classifierTokens: (routingResult.classifierInputTokens || routingResult.classifierOutputTokens)
          ? { in: routingResult.classifierInputTokens, out: routingResult.classifierOutputTokens }
          : undefined,
        signals: routingResult.signals ? {
          totalTokens:       routingResult.signals.totalTokens,
          detectedDomains:   routingResult.signals.detectedDomains,
          detectedLanguages: routingResult.signals.detectedLanguages,
          hasImages:         routingResult.signals.hasImages,
          hasToolCalls:      routingResult.signals.hasToolCalls,
          conversationTurns: routingResult.signals.conversationTurns,
        } : null,
      } : null,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
