import { Router } from 'express';
import Tenant from '../../models/Tenant.js';
import ChatConfig from '../../models/ChatConfig.js';
import Provider from '../../models/Provider.js';
import { getProviderAdapter } from '../../providers/index.js';
import { routeRequest } from '../../services/routerEngine.js';
import { adminAuth } from '../../middleware/auth.js';
import { adminOrMaint } from '../../middleware/rbac.js';
import { logRequest, logError } from '../../services/analyticsEngine.js';
import logger from '../../utils/logger.js';
import crypto from 'crypto';

const router = Router();

// ── In-memory rate limiter for public/token chat ─────────────────────────────
const rateLimitMap = new Map();
function checkRateLimit(key, maxPerMin) {
  const now = Date.now();
  let entry = rateLimitMap.get(key);
  if (!entry || now - entry.windowStart > 60_000) {
    entry = { windowStart: now, count: 0 };
    rateLimitMap.set(key, entry);
  }
  entry.count++;
  return entry.count <= maxPerMin;
}

// ── GET /api/prism/admin/chat/config — get chat settings ─────────────────────
router.get('/config', adminAuth, adminOrMaint, async (_req, res) => {
  let cfg = await ChatConfig.findOne({ singleton: 'default' }).lean();
  if (!cfg) cfg = { enabled: false, visibility: 'admin', allowedModels: [], defaultModel: 'auto', systemPrompt: '', accessTokens: [], rateLimit: { requestsPerMinute: 10, maxTokensPerRequest: 4000 } };
  res.json(cfg);
});

// ── PUT /api/prism/admin/chat/config — update chat settings ──────────────────
router.put('/config', adminAuth, adminOrMaint, async (req, res) => {
  const { enabled, visibility, allowedModels, defaultModel, systemPrompt, rateLimit } = req.body;
  const update = {};
  if (enabled !== undefined) update.enabled = enabled;
  if (visibility !== undefined) update.visibility = visibility;
  if (allowedModels !== undefined) update.allowedModels = allowedModels;
  if (defaultModel !== undefined) update.defaultModel = defaultModel;
  if (systemPrompt !== undefined) update.systemPrompt = systemPrompt;
  if (rateLimit !== undefined) update.rateLimit = rateLimit;
  const cfg = await ChatConfig.findOneAndUpdate(
    { singleton: 'default' },
    { $set: update },
    { upsert: true, new: true, runValidators: true }
  );
  res.json(cfg);
});

// ── POST /api/prism/admin/chat/tokens — generate access token ────────────────
router.post('/tokens', adminAuth, adminOrMaint, async (req, res) => {
  const { label, expiresInHours = 24 } = req.body;
  const token = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + expiresInHours * 3600_000);

  await ChatConfig.findOneAndUpdate(
    { singleton: 'default' },
    { $push: { accessTokens: { token, label: label || 'unnamed', expiresAt } } },
    { upsert: true }
  );
  res.json({ token, label, expiresAt });
});

// ── DELETE /api/prism/admin/chat/tokens/:token — revoke token ────────────────
router.delete('/tokens/:token', adminAuth, adminOrMaint, async (req, res) => {
  await ChatConfig.updateOne(
    { singleton: 'default' },
    { $pull: { accessTokens: { token: req.params.token } } }
  );
  res.json({ deleted: true });
});

// ── GET /api/prism/chat/public/config — public endpoint for chat config ──────
router.get('/public/config', async (_req, res) => {
  const cfg = await ChatConfig.findOne({ singleton: 'default' }).lean();
  if (!cfg || !cfg.enabled) {
    return res.status(403).json({ error: 'Chat is disabled', enabled: false });
  }
  if (cfg.visibility === 'admin') {
    return res.status(403).json({ error: 'Chat is not publicly available' });
  }
  // Return only safe fields
  res.json({
    enabled: true,
    visibility: cfg.visibility,
    allowedModels: cfg.allowedModels,
    defaultModel: cfg.defaultModel,
  });
});

// ── POST /api/prism/chat/public — public/token chat endpoint ─────────────────
router.post('/public', async (req, res) => {
  const cfg = await ChatConfig.findOne({ singleton: 'default' }).lean();
  if (!cfg || !cfg.enabled) {
    return res.status(403).json({ error: { message: 'Chat is disabled. Enable it in Settings.' } });
  }
  if (cfg.visibility === 'admin') {
    return res.status(403).json({ error: { message: 'Chat is not publicly available' } });
  }

  // Token validation for 'token' mode
  if (cfg.visibility === 'token') {
    const chatToken = req.headers['x-chat-token'] || req.query.token;
    if (!chatToken) return res.status(401).json({ error: { message: 'Access token required' } });
    const tokenEntry = cfg.accessTokens?.find(t => t.token === chatToken);
    if (!tokenEntry) return res.status(401).json({ error: { message: 'Invalid access token' } });
    if (tokenEntry.expiresAt && new Date() > new Date(tokenEntry.expiresAt)) {
      return res.status(401).json({ error: { message: 'Access token expired' } });
    }
    // Mark as used (non-blocking)
    ChatConfig.updateOne(
      { singleton: 'default', 'accessTokens.token': chatToken },
      { $set: { 'accessTokens.$.used': true } }
    ).catch(() => {});
  }

  // Rate limit
  const clientKey = req.ip || 'unknown';
  if (!checkRateLimit(clientKey, cfg.rateLimit?.requestsPerMinute || 10)) {
    return res.status(429).json({ error: { message: 'Rate limit exceeded' } });
  }

  // Validate model
  const { model = cfg.defaultModel || 'auto', messages, stream = false, max_tokens, temperature } = req.body;
  if (!messages?.length) return res.status(400).json({ error: { message: 'messages required' } });

  if (cfg.allowedModels?.length && model !== 'auto' && !cfg.allowedModels.includes(model)) {
    return res.status(403).json({ error: { message: `Model ${model} is not allowed in chat` } });
  }

  // Cap max_tokens
  const maxTok = Math.min(max_tokens || cfg.rateLimit?.maxTokensPerRequest || 4000, cfg.rateLimit?.maxTokensPerRequest || 4000);

  // Forward to gateway logic
  await handleChatRequest(req, res, { model, messages, stream, max_tokens: maxTok, temperature, systemPrompt: cfg.systemPrompt });
});

// ── POST /api/prism/admin/chat — JWT-authenticated chat ──────────────────────
router.post('/', adminAuth, async (req, res) => {
  const cfg = await ChatConfig.findOne({ singleton: 'default' }).lean();
  if (!cfg || !cfg.enabled) {
    return res.status(403).json({ error: { message: 'Chat is disabled. Enable it in Settings.' } });
  }
  const { model = 'auto', messages, stream = false, max_tokens, temperature } = req.body;
  if (!messages?.length) return res.status(400).json({ error: { message: 'messages required' } });
  await handleChatRequest(req, res, { model, messages, stream, max_tokens, temperature, systemPrompt: cfg.systemPrompt });
});

// ── Shared chat handler ──────────────────────────────────────────────────────
async function handleChatRequest(req, res, { model, messages, stream, max_tokens, temperature, systemPrompt }) {
  // Use dedicated "chat" tenant (auto-created from "api" tenant on first use)
  let tenant = await Tenant.findOne({ slug: 'chat' });
  if (!tenant) {
    const apiTenant = await Tenant.findOne({ slug: 'api' });
    if (!apiTenant) return res.status(500).json({ error: { message: 'Default tenant not found' } });
    tenant = await Tenant.create({
      ...apiTenant.toObject(),
      _id: undefined,
      slug: 'chat',
      name: 'Built-in Chat',
      apiKeyHash: undefined, // no external API key needed
      active: true,
      internal: true,        // system-managed tenant
      createdAt: undefined,
      updatedAt: undefined,
    });
    logger.info(`[chat] Auto-created "chat" tenant (cloned from "api")`);
  }

  // Inject system prompt if configured
  const finalMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages.filter(m => m.role !== 'system')]
    : messages;

  try {
    let finalModel = model;
    let routingResult = null;
    let finalProvider = null;

    if (model === 'auto' || model === 'auto-prism') {
      const chatRequest = { model, messages: finalMessages, max_tokens, temperature };
      routingResult = await routeRequest(tenant, chatRequest);
      finalModel = routingResult.modelId;
      finalProvider = await Provider.findById(routingResult.providerId);
    }

    if (!finalProvider) {
      const providers = await Provider.find({ _id: { $in: tenant.providerIds } });
      for (const p of providers) {
        if (p.discoveredModels?.some(m => m.id === finalModel && m.visible !== false)) {
          finalProvider = p;
          break;
        }
      }
    }

    if (!finalProvider) {
      return res.status(404).json({ error: { message: `No provider found for model ${finalModel}` } });
    }

    const adapter = getProviderAdapter(finalProvider);
    const chatPayload = {
      model: finalModel,
      messages: finalMessages,
      stream,
      ...(max_tokens && { max_tokens }),
      ...(temperature != null && { temperature }),
    };

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const streamResponse = await adapter.chatStream(chatPayload);
      for await (const chunk of streamResponse) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }

      if (routingResult) {
        res.write(`data: ${JSON.stringify({
          auto_routing: {
            selected_model: finalModel,
            category: routingResult.category,
            cost_tier: routingResult.costTier,
            confidence: routingResult.confidence,
            selection_method: routingResult.selectionMethod,
            routing_time_ms: routingResult.analysisTimeMs,
          },
        })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();

      // Log chat request
      logRequest({
        tenantId: tenant._id, sessionId: 'chat', userName: req.user?.username || 'chat',
        requestedModel: model, routedModel: finalModel, providerId: finalProvider._id,
        isAutoRouted: !!routingResult, routingResult, inputTokens: 0, outputTokens: 0,
        streaming: true, tenant, messages: finalMessages, clientIp: req.ip, viaProxy: !!req.headers['x-forwarded-for'],
      });
    } else {
      const response = await adapter.chat(chatPayload);
      if (routingResult) {
        response.auto_routing = {
          selected_model: finalModel,
          category: routingResult.category,
          cost_tier: routingResult.costTier,
          confidence: routingResult.confidence,
          selection_method: routingResult.selectionMethod,
          routing_time_ms: routingResult.analysisTimeMs,
        };
      }
      // Log chat request
      const inputTokens = response.usage?.prompt_tokens || 0;
      const outputTokens = response.usage?.completion_tokens || 0;
      logRequest({
        tenantId: tenant._id, sessionId: 'chat', userName: req.user?.username || 'chat',
        requestedModel: model, routedModel: finalModel, providerId: finalProvider._id,
        isAutoRouted: !!routingResult, routingResult, inputTokens, outputTokens,
        streaming: false, tenant, messages: finalMessages, clientIp: req.ip, viaProxy: !!req.headers['x-forwarded-for'],
      });

      res.json(response);
    }
  } catch (err) {
    logError({
      tenantId: tenant._id, sessionId: 'chat', userName: req.user?.username || 'chat',
      requestedModel: model, errorMessage: err.message, errorType: 'provider_error',
      statusCode: 502, tenant, messages: finalMessages, clientIp: req.ip, viaProxy: !!req.headers['x-forwarded-for'],
    });
    if (!res.headersSent) {
      res.status(502).json({ error: { message: err.message, type: 'provider_error' } });
    }
  }
}

export default router;
