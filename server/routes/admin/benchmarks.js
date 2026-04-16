import { Router } from 'express';
import { adminAuth } from '../../middleware/auth.js';
import RequestLog from '../../models/RequestLog.js';
import Tenant from '../../models/Tenant.js';
import mongoose from 'mongoose';

const router = Router();
router.use(adminAuth);

/** Convert a string id to ObjectId, returns null if invalid. */
function toOid(id) {
  try { return new mongoose.Types.ObjectId(id); } catch { return null; }
}

/** Build tenant match clause respecting RBAC. */
function buildTenantMatch(req, requestedTenantId) {
  const { role, tenants: userTenants } = req.user || {};

  if (role !== 'tenant-viewer') {
    const match = {};
    if (requestedTenantId) {
      const oid = toOid(requestedTenantId);
      if (oid) match.tenantId = oid;
    }
    return match;
  }

  const allowed = (Array.isArray(userTenants) ? userTenants : [])
    .map(toOid).filter(Boolean);

  if (!allowed.length) return { tenantId: toOid('000000000000000000000000') };

  if (requestedTenantId) {
    const oid = toOid(requestedTenantId);
    const isAllowed = oid && allowed.some(id => id.equals(oid));
    return isAllowed ? { tenantId: oid } : { tenantId: toOid('000000000000000000000000') };
  }

  return { tenantId: { $in: allowed } };
}

// ── GET /activity — Full activity dump for AI evaluation ─────────────────────
// Returns recent requests with complete decision context:
//   request info, routing decision, model chosen, cost, response snapshot
router.get('/activity', async (req, res) => {
  const { tenantId, hours = 2, page = 1, limit = 100, status, model, sessionId } = req.query;
  const since = new Date(Date.now() - parseFloat(hours) * 3600_000);

  const match = { timestamp: { $gte: since }, ...buildTenantMatch(req, tenantId) };
  if (status && ['success', 'error'].includes(status)) match.status = status;
  if (model && typeof model === 'string') match.routedModel = model;
  if (sessionId && typeof sessionId === 'string') match.sessionId = sessionId;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const cap = Math.min(parseInt(limit), 500);

  const [requests, total] = await Promise.all([
    RequestLog.find(match)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(cap)
      .lean(),
    RequestLog.countDocuments(match),
  ]);

  // Bulk resolve tenant slugs
  const _tIds = [...new Set(requests.map(r => String(r.tenantId)).filter(Boolean))];
  const _tMap = {};
  if (_tIds.length) {
    const ts = await Tenant.find({ _id: { $in: _tIds } }, { slug: 1, name: 1 }).lean();
    for (const t of ts) _tMap[String(t._id)] = t;
  }

  // Map to a flat, AI-friendly activity dump format
  const activity = requests.map(r => ({
    id:             r._id,
    timestamp:      r.timestamp,
    sessionId:      r.sessionId || null,
    tenant:         _tMap[String(r.tenantId)]?.slug || null,
    user:           r.userName || null,
    // What was requested
    request: {
      model:          r.requestedModel,
      streaming:      r.streaming,
      promptSnapshot: r.promptSnapshot || null,
    },
    // What was decided
    decision: {
      routedModel:    r.routedModel,
      isAutoRouted:   r.isAutoRouted,
      category:       r.category || null,
      taskType:       r.taskType || null,
      complexity:     r.complexity || null,
      costTier:       r.costTier || null,
      confidence:     r.confidence || null,
      overrideApplied: r.overrideApplied || null,
      domain:         r.domain || null,
      language:       r.language || null,
      routingMs:      r.routingMs || null,
      routingCostUsd: r.routingCostUsd || 0,
      routingSignals: r.routingSignals || null,
    },
    // What came back
    output: {
      status:           r.status,
      errorMessage:     r.errorMessage || null,
      durationMs:       r.durationMs || null,
      inputTokens:      r.inputTokens,
      outputTokens:     r.outputTokens,
      responseSnapshot: r.responseSnapshot || null,
      finishReason:     r.responseSnapshot?.finishReason || null,
    },
    // Cost analysis
    cost: {
      actualCostUsd:   r.actualCostUsd,
      baselineCostUsd: r.baselineCostUsd,
      savedUsd:        r.savedUsd,
    },
    // Context fallback info
    contextFallback: r.contextFallback ? {
      originalModel: r.originalModel,
      fallbackModel: r.routedModel,
    } : null,
  }));

  res.json({
    activity,
    total,
    page: parseInt(page),
    pages: Math.ceil(total / cap),
    periodHours: parseFloat(hours),
  });
});

// ── GET /sessions — List sessions with aggregated stats ──────────────────────
router.get('/sessions', async (req, res) => {
  const { tenantId, hours = 24, page = 1, limit = 50 } = req.query;
  const since = new Date(Date.now() - parseFloat(hours) * 3600_000);

  const match = {
    timestamp: { $gte: since },
    sessionId: { $exists: true, $ne: null },
    ...buildTenantMatch(req, tenantId),
  };

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const cap = Math.min(parseInt(limit), 200);

  const sessions = await RequestLog.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$sessionId',
        tenant:       { $first: '$tenantId' },
        user:         { $first: '$userName' },
        firstRequest: { $min: '$timestamp' },
        lastRequest:  { $max: '$timestamp' },
        requests:     { $sum: 1 },
        totalInput:   { $sum: '$inputTokens' },
        totalOutput:  { $sum: '$outputTokens' },
        totalCost:    { $sum: '$actualCostUsd' },
        totalSaved:   { $sum: '$savedUsd' },
        models:       { $addToSet: '$routedModel' },
        categories:   { $addToSet: '$category' },
        errors:       { $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] } },
        autoRouted:   { $sum: { $cond: ['$isAutoRouted', 1, 0] } },
      },
    },
    { $sort: { lastRequest: -1 } },
    { $skip: skip },
    { $limit: cap },
  ]);

  // Count total distinct sessions
  const countResult = await RequestLog.aggregate([
    { $match: match },
    { $group: { _id: '$sessionId' } },
    { $count: 'total' },
  ]);
  const total = countResult[0]?.total || 0;

  // Populate tenant slugs
  const tenantIds = [...new Set(sessions.map(s => String(s.tenant)))];
  const tenants = await Tenant.find({ _id: { $in: tenantIds } }).select('slug name').lean();
  const tenantMap = new Map(tenants.map(t => [String(t._id), t]));

  res.json({
    sessions: sessions.map(s => ({
      sessionId:    s._id,
      tenant:       tenantMap.get(String(s.tenant))?.slug || null,
      user:         s.user || null,
      firstRequest: s.firstRequest,
      lastRequest:  s.lastRequest,
      durationMs:   new Date(s.lastRequest) - new Date(s.firstRequest),
      requests:     s.requests,
      totalInput:   s.totalInput,
      totalOutput:  s.totalOutput,
      totalCost:    Math.round(s.totalCost * 1e6) / 1e6,
      totalSaved:   Math.round(s.totalSaved * 1e6) / 1e6,
      models:       s.models.filter(Boolean),
      categories:   s.categories.filter(Boolean),
      errors:       s.errors,
      autoRouted:   s.autoRouted,
    })),
    total,
    page: parseInt(page),
    pages: Math.ceil(total / cap),
  });
});

// ── GET /sessions/:sessionId — All requests in a session ─────────────────────
router.get('/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const match = { sessionId, ...buildTenantMatch(req, req.query.tenantId) };

  const requests = await RequestLog.find(match)
    .sort({ timestamp: 1 })
    .lean();

  if (!requests.length) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Bulk resolve tenant
  const _sTid = String(requests[0].tenantId);
  const _sT = await Tenant.findById(_sTid, { slug: 1, name: 1 }).lean();

  const first = requests[0];
  const last = requests[requests.length - 1];

  res.json({
    sessionId,
    tenant:       _sT?.slug || null,
    user:         first.userName || null,
    firstRequest: first.timestamp,
    lastRequest:  last.timestamp,
    durationMs:   new Date(last.timestamp) - new Date(first.timestamp),
    totalRequests: requests.length,
    requests: requests.map(r => ({
      id:        r._id,
      timestamp: r.timestamp,
      request: {
        model:          r.requestedModel,
        streaming:      r.streaming,
        promptSnapshot: r.promptSnapshot || null,
      },
      decision: {
        routedModel:     r.routedModel,
        isAutoRouted:    r.isAutoRouted,
        category:        r.category || null,
        costTier:        r.costTier || null,
        confidence:      r.confidence || null,
        overrideApplied: r.overrideApplied || null,
        routingSignals:  r.routingSignals || null,
      },
      output: {
        status:           r.status,
        errorMessage:     r.errorMessage || null,
        inputTokens:      r.inputTokens,
        outputTokens:     r.outputTokens,
        responseSnapshot: r.responseSnapshot || null,
      },
      cost: {
        actualCostUsd:   r.actualCostUsd,
        baselineCostUsd: r.baselineCostUsd,
        savedUsd:        r.savedUsd,
      },
    })),
  });
});

// ── GET /evaluate — Structured evaluation dataset for AI benchmarking ────────
// Returns logs in a format optimized for an AI to evaluate routing quality:
// - Was the right model chosen?
// - Could a cheaper/faster model have handled it?
// - Were there quality issues?
router.get('/evaluate', async (req, res) => {
  const { tenantId, hours = 2, limit = 200, autoRoutedOnly = 'true' } = req.query;
  const since = new Date(Date.now() - parseFloat(hours) * 3600_000);

  const match = {
    timestamp: { $gte: since },
    status: 'success',
    ...buildTenantMatch(req, tenantId),
  };
  if (autoRoutedOnly === 'true') match.isAutoRouted = true;

  const cap = Math.min(parseInt(limit), 500);

  const requests = await RequestLog.find(match)
    .sort({ timestamp: -1 })
    .limit(cap)
    .lean();

  // Bulk resolve tenants
  const _eTids = [...new Set(requests.map(r => String(r.tenantId)).filter(Boolean))];
  const _eTMap = {};
  if (_eTids.length) {
    const ts = await Tenant.find({ _id: { $in: _eTids } }, { slug: 1 }).lean();
    for (const t of ts) _eTMap[String(t._id)] = t.slug;
  }

  const evaluationSet = requests.map(r => ({
    id:        r._id,
    timestamp: r.timestamp,
    sessionId: r.sessionId || null,
    tenant:    _eTMap[String(r.tenantId)] || null,

    // Input context for evaluation
    input: {
      requestedModel:  r.requestedModel,
      promptSnapshot:  r.promptSnapshot || null,
      capturedPaths:   r.capturedPaths || [],
    },

    // Routing decision to evaluate
    routingDecision: {
      routedModel:     r.routedModel,
      category:        r.category,
      taskType:        r.taskType || null,
      complexity:      r.complexity || null,
      costTier:        r.costTier,
      confidence:      r.confidence,
      overrideApplied: r.overrideApplied || null,
      domain:          r.domain || null,
      language:        r.language || null,
      routingMs:       r.routingMs,
      signals:         r.routingSignals || null,
    },

    // Result to assess quality
    result: {
      inputTokens:      r.inputTokens,
      outputTokens:     r.outputTokens,
      durationMs:       r.durationMs || null,
      responseSnapshot: r.responseSnapshot || null,
      contextFallback:  r.contextFallback,
      originalModel:    r.originalModel || null,
    },

    // Cost data for efficiency analysis
    costAnalysis: {
      actualCostUsd:   r.actualCostUsd,
      baselineCostUsd: r.baselineCostUsd,
      savedUsd:        r.savedUsd,
      routingCostUsd:  r.routingCostUsd,
    },
  }));

  res.json({
    evaluationSet,
    total: evaluationSet.length,
    periodHours: parseFloat(hours),
    generatedAt: new Date().toISOString(),
    instructions: {
      purpose: 'Evaluate routing quality of auto-prism decisions',
      suggestedChecks: [
        'Was the chosen model appropriate for the task category and complexity?',
        'Could a cheaper model have handled this request equally well?',
        'Was a more expensive model needed (quality vs cost trade-off)?',
        'Were routing overrides justified?',
        'Did context fallbacks indicate poor initial model selection?',
        'Are there patterns of over-routing (using expensive models for simple tasks)?',
        'Are there patterns of under-routing (using cheap models for complex tasks)?',
      ],
    },
  });
});

// ── GET /model-comparison — Compare model performance across similar requests ─
router.get('/model-comparison', async (req, res) => {
  const { tenantId, hours = 24, category } = req.query;
  const since = new Date(Date.now() - parseFloat(hours) * 3600_000);

  const match = {
    timestamp: { $gte: since },
    status: 'success',
    ...buildTenantMatch(req, tenantId),
  };
  if (category && typeof category === 'string') match.category = category;

  const comparison = await RequestLog.aggregate([
    { $match: match },
    {
      $group: {
        _id: { model: '$routedModel', category: '$category', costTier: '$costTier' },
        requests:       { $sum: 1 },
        avgInputTokens: { $avg: '$inputTokens' },
        avgOutputTokens:{ $avg: '$outputTokens' },
        avgCostUsd:     { $avg: '$actualCostUsd' },
        totalCostUsd:   { $sum: '$actualCostUsd' },
        avgConfidence:  { $avg: '$confidence' },
        avgRoutingMs:   { $avg: '$routingMs' },
        errors:         { $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] } },
        contextFallbacks: { $sum: { $cond: ['$contextFallback', 1, 0] } },
      },
    },
    { $sort: { '_id.category': 1, requests: -1 } },
  ]);

  res.json({
    comparison: comparison.map(c => ({
      model:            c._id.model,
      category:         c._id.category || 'uncategorized',
      costTier:         c._id.costTier || 'unknown',
      requests:         c.requests,
      avgInputTokens:   Math.round(c.avgInputTokens),
      avgOutputTokens:  Math.round(c.avgOutputTokens),
      avgCostUsd:       Math.round(c.avgCostUsd * 1e6) / 1e6,
      totalCostUsd:     Math.round(c.totalCostUsd * 1e6) / 1e6,
      avgConfidence:    c.avgConfidence ? Math.round(c.avgConfidence * 100) / 100 : null,
      avgRoutingMs:     c.avgRoutingMs ? Math.round(c.avgRoutingMs) : null,
      contextFallbacks: c.contextFallbacks,
    })),
    periodHours: parseFloat(hours),
  });
});

export default router;
