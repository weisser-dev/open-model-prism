import { Router } from 'express';
import { adminAuth } from '../../middleware/auth.js';
import { adminOrMaint } from '../../middleware/rbac.js';
import { setupCheck } from '../../middleware/setupCheck.js';
import Provider from '../../models/Provider.js';
import { getProviderAdapter } from '../../providers/index.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { suggestForModelAsync } from '../../data/modelRegistry.js';
import { suggestProviderPricing } from '../../data/providerPricing.js';
import { logConfigChange } from '../../services/auditService.js';

const router = Router();
router.use(adminAuth);

// List all providers
router.get('/', async (_req, res) => {
  const providers = await Provider.find().select('-config.auth.apiKey -config.auth.secretAccessKey');
  // Add hasCredentials flag for Bedrock providers (so UI knows credentials exist)
  const result = providers.map(p => {
    const obj = p.toObject ? p.toObject() : p;
    if (obj.config?.auth?.accessKeyId) {
      obj.config.auth.hasCredentials = true;
      delete obj.config.auth.accessKeyId; // don't leak encrypted value
    }
    return obj;
  });
  res.json(result);
});

// Get single provider
router.get('/:id', async (req, res) => {
  const provider = await Provider.findById(req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  // Mask secrets for display
  const obj = provider.toObject();
  if (obj.config?.auth?.apiKey) obj.config.auth.apiKey = '***';
  if (obj.config?.auth?.secretAccessKey) obj.config.auth.secretAccessKey = '***';
  res.json(obj);
});

// Create provider
router.post('/', adminOrMaint, async (req, res) => {
  const { name, type, config: providerConfig } = req.body;
  if (!name || !type) {
    return res.status(400).json({ error: 'Name and type required' });
  }

  // Encrypt secrets
  if (providerConfig?.auth?.apiKey) {
    providerConfig.auth.apiKey = encrypt(providerConfig.auth.apiKey);
  }
  if (providerConfig?.auth?.secretAccessKey) {
    providerConfig.auth.secretAccessKey = encrypt(providerConfig.auth.secretAccessKey);
  }

  const slug = req.body.slug || await Provider.generateUniqueSlug(name);
  const provider = await Provider.create({ name, slug, type, config: providerConfig });
  res.status(201).json(provider);
});

// Update provider
router.put('/:id', adminOrMaint, async (req, res) => {
  const { name, type, config: providerConfig } = req.body;
  const provider = await Provider.findById(req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  if (name) provider.name = name;
  if (req.body.slug) provider.slug = req.body.slug;
  if (type) provider.type = type;
  if (providerConfig) {
    // Merge config shallowly so partial updates (e.g. only baseUrl) don't wipe other fields
    const merged = { ...provider.config.toObject?.() ?? provider.config, ...providerConfig };

    // Preserve existing auth if none sent
    if (!providerConfig.auth) {
      merged.auth = provider.config.auth;
    } else {
      // Only re-encrypt if new values provided (not masked / empty)
      if (merged.auth?.apiKey && merged.auth.apiKey !== '***') {
        merged.auth.apiKey = encrypt(merged.auth.apiKey);
      } else {
        merged.auth.apiKey = provider.config.auth?.apiKey;
      }
      if (merged.auth?.accessKeyId && merged.auth.accessKeyId !== '***') {
        merged.auth.accessKeyId = encrypt(merged.auth.accessKeyId);
      } else {
        merged.auth.accessKeyId = provider.config.auth?.accessKeyId;
      }
      if (merged.auth?.secretAccessKey && merged.auth.secretAccessKey !== '***') {
        merged.auth.secretAccessKey = encrypt(merged.auth.secretAccessKey);
      } else {
        merged.auth.secretAccessKey = provider.config.auth?.secretAccessKey;
      }
    }
    provider.config = merged;
  }

  await provider.save();
  res.json(provider);
});

// Delete provider — with cascade cleanup of dangling references
router.delete('/:id', adminOrMaint, async (req, res) => {
  const providerId = req.params.id;
  const provider = await Provider.findById(providerId);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  // ── Cascade cleanup ────────────────────────────────────────────────────
  const Tenant = (await import('../../models/Tenant.js')).default;

  // 1. Remove provider from all tenants' providerIds
  const tenantPull = await Tenant.updateMany(
    { providerIds: providerId },
    { $pull: { providerIds: providerId } }
  );

  // 2. Clear classifier references that point to this provider
  await Tenant.updateMany(
    { 'routing.classifierProvider': providerId },
    { $unset: { 'routing.classifierProvider': '', 'routing.classifierModel': '' } }
  );

  // 3. Remove this provider from classifier fallback chains
  await Tenant.updateMany(
    { 'routing.classifierFallbacks.provider': providerId },
    { $pull: { 'routing.classifierFallbacks': { provider: providerId } } }
  );

  // 4. Remove from fallbackChains
  await Tenant.updateMany(
    { 'fallbackChains.providers': providerId },
    { $pull: { 'fallbackChains.$[].providers': providerId } }
  );

  await Provider.findByIdAndDelete(providerId);

  logConfigChange({ user: req.user?.username, action: 'delete', target: 'provider', targetId: providerId, targetName: provider.name || provider.slug });
  res.json({ success: true, cascade: { tenantsUpdated: tenantPull.modifiedCount } });
});

// Test connection
router.post('/:id/test', adminOrMaint, async (req, res) => {
  const provider = await Provider.findById(req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  try {
    const adapter = getProviderAdapter(provider);
    const result = await adapter.testConnection();
    provider.status = 'connected';
    provider.statusMessage = null;
    provider.lastChecked = new Date();
    await provider.save();
    res.json({ success: true, message: 'Connection successful' });
  } catch (err) {
    provider.status = 'error';
    provider.statusMessage = err.message;
    provider.lastChecked = new Date();
    await provider.save();
    res.status(400).json({ success: false, error: err.message });
  }
});

// Discover models — probes /v1 and /api/v1 if apiPath not yet set, persists the winner
router.post('/:id/discover', adminOrMaint, async (req, res) => {
  const provider = await Provider.findById(req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  try {
    const adapter = getProviderAdapter(provider);
    const models = await adapter.listModels();

    // Persist the discovered API path if the adapter found one during probing
    const effectivePath = adapter._effectivePath;
    if (effectivePath && effectivePath !== (provider.config?.options?.apiPath)) {
      if (!provider.config.options) provider.config.options = {};
      provider.config.options.apiPath = effectivePath;
      provider.markModified('config');
    }

    // Merge: preserve existing registry metadata, auto-enrich new models
    const existingMap = new Map(
      (provider.discoveredModels || []).map(m => [m.id, m.toObject ? m.toObject() : m])
    );

    const merged = await Promise.all(models.map(async rawModel => {
      const existing = existingMap.get(rawModel.id);
      if (existing) {
        // Always fetch suggestion — individual fields decide whether to apply it
        const suggestion = await suggestForModelAsync(rawModel.id);
        const updated = {
          ...existing,
          name:          rawModel.name || existing.name,
          capabilities:  rawModel.capabilities || existing.capabilities,
        };
        // Refresh contextWindow & maxOutputTokens unless admin set them manually
        if (!existing.manualContext) {
          updated.contextWindow   = suggestion?.contextWindow   || rawModel.contextWindow || existing.contextWindow;
          updated.maxOutputTokens = suggestion?.maxOutputTokens  ?? existing.maxOutputTokens ?? null;
        }
        // Re-enrich tier/categories if still unset
        if (!existing.tier && suggestion) {
          updated.tier       = suggestion.tier       ?? existing.tier ?? null;
          updated.categories = suggestion.categories ?? existing.categories ?? [];
          updated.priority   = suggestion.priority   ?? existing.priority ?? 50;
        }
        // Always refresh pricing from provider tables — unless admin set it manually
        if (!existing.manualPricing) {
          const providerPricing = suggestProviderPricing(rawModel.id, provider.type, provider.name);
          updated.inputPer1M  = providerPricing?.input  ?? suggestion?.inputPer1M  ?? existing.inputPer1M ?? null;
          updated.outputPer1M = providerPricing?.output ?? suggestion?.outputPer1M ?? existing.outputPer1M ?? null;
        }
        return updated;
      }
      // New model — auto-suggest from local registry + models.dev
      const suggestion = await suggestForModelAsync(rawModel.id);
      // Provider-specific pricing takes precedence over generic registry pricing
      const providerPricing = suggestProviderPricing(rawModel.id, provider.type, provider.name);
      return {
        ...rawModel,
        tier:            suggestion?.tier            ?? null,
        categories:      suggestion?.categories      ?? [],
        priority:        suggestion?.priority        ?? 50,
        maxOutputTokens: suggestion?.maxOutputTokens ?? null,
        inputPer1M:      providerPricing?.input  ?? suggestion?.inputPer1M  ?? null,
        outputPer1M:     providerPricing?.output ?? suggestion?.outputPer1M ?? null,
        notes:       '',
        visible:     true,
      };
    }));

    provider.discoveredModels = merged;
    provider.status = 'connected';
    provider.lastChecked = new Date();

    // Azure: auto-detect which deployments use Chat Completions vs Responses API
    if (provider.type === 'azure' && adapter.autoDetectApiTypes) {
      try {
        const detected = await adapter.autoDetectApiTypes();
        if (detected.responses.length) {
          if (!provider.config.options) provider.config.options = {};
          provider.config.options.responsesModels = detected.responses.join(',');
          provider.config.options.deployments = detected.chatCompletions.join(',');
          provider.markModified('config');
        }
      } catch { /* non-fatal — keep existing config */ }
    }

    await provider.save();
    const enrichedCount = merged.filter(m => m.tier).length;
    res.json({ models: merged, count: merged.length, enrichedCount, apiPath: effectivePath || provider.config?.options?.apiPath || '/v1' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Chat proxy for "Try Models" — admin only, not tenant-billed
router.post('/:id/chat', adminOrMaint, async (req, res) => {
  const provider = await Provider.findById(req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  const { model, messages } = req.body;
  if (!model || !messages?.length) {
    return res.status(400).json({ error: 'model and messages required' });
  }

  try {
    const adapter = getProviderAdapter(provider);
    const result = await adapter.chat({ model, messages });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Test connection with detailed log (url + error info); auto-retries http→https
router.post('/:id/check', adminOrMaint, async (req, res) => {
  const provider = await Provider.findById(req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  const baseUrl = (provider.config?.baseUrl || '').replace(/\/$/, '');
  if (!baseUrl) {
    return res.status(400).json({ success: false, error: 'No base URL configured', log: ['✗ No base URL configured'] });
  }

  const log = [];
  const isHttp = baseUrl.startsWith('http://');

  async function tryUrl(url) {
    const apiPaths = provider.config?.options?.apiPath
      ? [provider.config.options.apiPath]
      : ['/v1', '/api/v1'];
    log.push(`→ Trying base: ${url}  (will probe: ${apiPaths.join(', ')})`);
    // Clone provider with overridden baseUrl for this attempt
    const cloned = provider.toObject();
    cloned.config = { ...cloned.config, baseUrl: url };
    const adapter = getProviderAdapter(cloned);
    const models = await adapter.listModels();
    if (adapter._effectivePath) log.push(`   ✓ Responded on path: ${adapter._effectivePath}/models`);
    return { url, effectivePath: adapter._effectivePath, modelCount: models.length };
  }

  let successResult = null;
  let lastErr = null;

  try {
    successResult = await tryUrl(baseUrl);
    log.push(`✓ Connection successful (${successResult.modelCount} models)`);
  } catch (err) {
    lastErr = err;
    log.push(`✗ Failed: ${err.message}`);

    // Auto-retry with https if original was http
    if (isHttp) {
      const httpsUrl = baseUrl.replace(/^http:\/\//, 'https://');
      log.push(`→ Retrying with HTTPS...`);
      try {
        successResult = await tryUrl(httpsUrl);
        log.push(`✓ HTTPS connection successful (${successResult.modelCount} models) — consider updating Base URL to https://`);
      } catch (err2) {
        log.push(`✗ HTTPS also failed: ${err2.message}`);
      }
    }
  }

  if (successResult) {
    const usedHttps = successResult.url !== baseUrl;
    // Persist discovered apiPath if found
    if (successResult.effectivePath && successResult.effectivePath !== provider.config?.options?.apiPath) {
      if (!provider.config.options) provider.config.options = {};
      provider.config.options.apiPath = successResult.effectivePath;
      provider.markModified('config');
    }
    provider.status = 'connected';
    provider.statusMessage = null;
    provider.lastChecked = new Date();
    await provider.save();
    res.json({ success: true, log, suggestUrl: usedHttps ? successResult.url : null });
  } else {
    provider.status = 'error';
    provider.statusMessage = lastErr?.message || 'Connection failed';
    provider.lastChecked = new Date();
    await provider.save();
    res.status(400).json({ success: false, error: lastErr?.message, log });
  }
});

// ── Model Registry ───────────────────────────────────────────────────────────

// GET all models across all providers (flat, enriched with provider info)
router.get('/models/all', async (_req, res) => {
  const providers = await Provider.find().select('name slug type discoveredModels status');
  const models = [];
  for (const p of providers) {
    for (const m of p.discoveredModels || []) {
      models.push({
        providerId: p._id,
        providerName: p.name,
        providerSlug: p.slug,
        providerType: p.type,
        providerStatus: p.status,
        id: m.id,
        prefixedId: `${p.slug}/${m.id}`,
        name: m.name || m.id,
        capabilities: m.capabilities,
        contextWindow: m.contextWindow,
        tier: m.tier,
        categories: m.categories,
        priority: m.priority ?? 50,
        notes: m.notes,
        inputPer1M: m.inputPer1M ?? null,
        outputPer1M: m.outputPer1M ?? null,
        visible: m.visible !== false, // default true
      });
    }
  }
  res.json(models);
});

// GET auto-suggest pricing/tier/categories for a model ID (local + models.dev live)
router.get('/models/suggest', async (req, res) => {
  const { modelId } = req.query;
  if (!modelId) return res.status(400).json({ error: 'modelId required' });
  const suggestion = await suggestForModelAsync(modelId);
  if (!suggestion) return res.status(404).json({ error: 'No suggestion found for this model ID' });
  res.json(suggestion);
});

// POST bulk-reorder priorities within a tier (accepts ordered array of { providerId, modelId })
router.post('/models/reorder-tier', adminOrMaint, async (req, res) => {
  const { items } = req.body; // [{ providerId, modelId }, ...] in desired order (index 0 = highest priority)
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array required' });
  }

  // Assign priorities: first item gets highest priority within the set
  const baseScore = 100;
  const step = Math.floor(90 / Math.max(items.length, 1));

  // Group by provider to minimise DB writes
  const byProvider = {};
  items.forEach((item, idx) => {
    const pid = String(item.providerId);
    if (!byProvider[pid]) byProvider[pid] = [];
    byProvider[pid].push({ modelId: item.modelId, priority: baseScore - idx * step });
  });

  for (const [providerId, updates] of Object.entries(byProvider)) {
    const provider = await Provider.findById(providerId);
    if (!provider) continue;
    for (const { modelId, priority } of updates) {
      const model = provider.discoveredModels.find(m => m.id === modelId);
      if (model) model.priority = priority;
    }
    provider.markModified('discoveredModels');
    await provider.save();
  }

  res.json({ success: true });
});

// PATCH update registry metadata for a single model within a provider
router.patch('/:id/models/:modelId', adminOrMaint, async (req, res) => {
  const { tier, categories, priority, notes, inputPer1M, outputPer1M, visible,
          contextWindow, maxOutputTokens } = req.body;
  const provider = await Provider.findById(req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  const model = provider.discoveredModels.find(m => m.id === req.params.modelId);
  if (!model) return res.status(404).json({ error: 'Model not found in provider' });
  const beforeModel = { tier: model.tier, priority: model.priority, visible: model.visible, inputPer1M: model.inputPer1M, outputPer1M: model.outputPer1M, contextWindow: model.contextWindow };

  if (tier !== undefined)            model.tier            = tier;
  if (categories !== undefined)      model.categories      = categories;
  if (priority !== undefined)        model.priority        = priority;
  if (notes !== undefined)           model.notes           = notes;
  if (inputPer1M !== undefined)      { model.inputPer1M    = inputPer1M;  model.manualPricing = true; }
  if (outputPer1M !== undefined)     { model.outputPer1M   = outputPer1M; model.manualPricing = true; }
  if (visible !== undefined)         model.visible         = visible;
  if (contextWindow !== undefined)   { model.contextWindow   = contextWindow || null;  model.manualContext = true; }
  if (maxOutputTokens !== undefined) { model.maxOutputTokens = maxOutputTokens || null; model.manualContext = true; }

  provider.markModified('discoveredModels');
  await provider.save();
  const afterModel = { tier: model.tier, priority: model.priority, visible: model.visible, inputPer1M: model.inputPer1M, outputPer1M: model.outputPer1M, contextWindow: model.contextWindow };
  logConfigChange({ user: req.user?.username, action: 'update', target: 'model', targetId: provider._id, targetName: `${req.params.modelId} (${provider.name})`, before: beforeModel, after: afterModel });
  res.json(model);
});

export default router;
