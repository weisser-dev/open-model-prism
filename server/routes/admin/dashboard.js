import { Router } from 'express';
import { adminAuth } from '../../middleware/auth.js';
import RequestLog from '../../models/RequestLog.js';
import DailyStat, { DailyCategoryStat } from '../../models/DailyStat.js';
import Tenant from '../../models/Tenant.js';
import mongoose from 'mongoose';
import { extractSignals } from '../../services/signalExtractor.js';
import Provider from '../../models/Provider.js';
import { calcCost } from '../../services/pricingService.js';
import { decrypt } from '../../utils/encryption.js';
import ConfigChange from '../../models/ConfigChange.js';
import { canViewPrompts } from '../../middleware/rbac.js';

const router = Router();
router.use(adminAuth);

// ── In-memory dashboard cache ───────────────────────────────────────────────
// Avoids re-running heavy aggregations on every 60s poll
const dashboardCache = new Map();
const CACHE_TTLS = { summary: 60_000, models: 60_000, daily: 120_000, categories: 60_000, 'config-changes': 60_000 };

function getCached(endpoint, tenantId, timeRange) {
  const key = `${endpoint}:${tenantId || 'all'}:${timeRange}`;
  const c = dashboardCache.get(key);
  if (c && Date.now() - c.time < (CACHE_TTLS[endpoint] || 30_000)) return c.data;
  return null;
}

function setCache(endpoint, tenantId, timeRange, data) {
  const key = `${endpoint}:${tenantId || 'all'}:${timeRange}`;
  dashboardCache.set(key, { data, time: Date.now() });
  // Prevent unbounded growth — evict old entries periodically
  if (dashboardCache.size > 200) {
    const cutoff = Date.now() - 300_000;
    for (const [k, v] of dashboardCache) { if (v.time < cutoff) dashboardCache.delete(k); }
  }
}

/**
 * Scope a tenantId filter based on user role.
 * tenant-viewer: can only see tenants they are assigned to.
 * All other roles: unrestricted (pass tenantId through as-is).
 */
function scopeTenantFilter(req, requestedTenantId) {
  const { role, tenants: userTenants } = req.user || {};

  if (role !== 'tenant-viewer') {
    // Admin / maintainer / finops: honour the requested filter
    return requestedTenantId || null;
  }

  // tenant-viewer: restrict to assigned tenants
  const allowed = Array.isArray(userTenants) ? userTenants.map(String) : [];
  if (!requestedTenantId) return allowed.length ? allowed : null;
  return allowed.includes(String(requestedTenantId)) ? requestedTenantId : null;
}

/** Convert a string id to ObjectId, returns null if invalid. */
function toOid(id) {
  try { return new mongoose.Types.ObjectId(id); } catch { return null; }
}

/** Build a MongoDB match clause that constrains tenantId for the current user.
 *  Always converts ids to ObjectId so aggregations match the stored BSON type. */
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

  if (!allowed.length) return { tenantId: toOid('000000000000000000000000') }; // returns nothing

  if (requestedTenantId) {
    const oid = toOid(requestedTenantId);
    const isAllowed = oid && allowed.some(id => id.equals(oid));
    return isAllowed ? { tenantId: oid } : { tenantId: toOid('000000000000000000000000') };
  }

  return { tenantId: { $in: allowed } };
}

/** Parse hours or days query param into a Date threshold */
function parseSince(query) {
  if (query.from) return new Date(query.from);
  if (query.hours) return new Date(Date.now() - parseInt(query.hours) * 3600_000);
  const days = parseInt(query.days || '30');
  return new Date(Date.now() - days * 86_400_000);
}

function parseTimeMatch(query) {
  const match = { timestamp: { $gte: parseSince(query) } };
  if (query.to) match.timestamp.$lte = new Date(query.to);
  return match;
}

// Summary KPIs
router.get('/summary', async (req, res) => {
  const { tenantId } = req.query;
  const timeRange = req.query.from ? `custom:${req.query.from}:${req.query.to||''}` : (req.query.hours || req.query.days || '30d');
  const cached = getCached('summary', tenantId, timeRange);
  if (cached) return res.json(cached);

  // Day-range queries: use pre-aggregated DailyStat for the heavy sums
  if (!req.query.from && !req.query.hours) {
    const d = parseInt(req.query.days || '30');
    const sinceStr = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const dsMatch = { date: { $gte: sinceStr }, ...buildTenantMatch(req, tenantId) };

    const [summary] = await DailyStat.aggregate([
      { $match: dsMatch },
      {
        $group: {
          _id: null,
          totalRequests: { $sum: '$requests' },
          totalInputTokens: { $sum: '$inputTokens' },
          totalOutputTokens: { $sum: '$outputTokens' },
          totalActualCost: { $sum: '$actualCostUsd' },
          totalBaselineCost: { $sum: '$baselineCostUsd' },
          totalSaved: { $sum: '$savedUsd' },
          autoRoutedCount: { $sum: '$autoRoutedCount' },
          totalRoutingCost: { $sum: '$routingCostUsd' },
          errorCount: { $sum: '$errorCount' },
          durationMsTotal: { $sum: '$durationMsTotal' },
          durationMsCount: { $sum: '$durationMsCount' },
        },
      },
    ]);

    // unknownErrorCount + uniqueUsers still need RequestLog (can't pre-aggregate these)
    const rlMatch = { ...parseTimeMatch(req.query), ...buildTenantMatch(req, tenantId) };
    let uniqueUsers = null, usersViaProxy = null, usersDirect = null, unknownErrorCount = 0;
    try {
      // Single aggregation replaces 3 separate distinct() calls + 1 aggregate — saves ~3 collection scans
      const [ipStats] = await RequestLog.aggregate([
        { $match: { ...rlMatch, clientIpHash: { $exists: true, $ne: null } } },
        {
          $group: {
            _id: null,
            allIps:   { $addToSet: '$clientIpHash' },
            proxyIps: { $addToSet: { $cond: ['$viaProxy', '$clientIpHash', '$$REMOVE'] } },
            directIps:{ $addToSet: { $cond: [{ $ne: ['$viaProxy', true] }, '$clientIpHash', '$$REMOVE'] } },
          },
        },
      ]);
      if (ipStats?.allIps?.length) {
        uniqueUsers   = ipStats.allIps.length;
        usersViaProxy = ipStats.proxyIps?.filter(Boolean).length || 0;
        usersDirect   = ipStats.directIps?.filter(Boolean).length || 0;
      }
      const [unkErr] = await RequestLog.aggregate([
        { $match: { ...rlMatch, status: 'error', $or: [{ errorCategory: 'unknown' }, { errorCategory: null }] } },
        { $group: { _id: null, count: { $sum: 1 } } },
      ]);
      unknownErrorCount = unkErr?.count || 0;
    } catch { /* non-fatal */ }

    const s = summary || {};
    const avgDurationMs = (s.durationMsCount > 0) ? Math.round(s.durationMsTotal / s.durationMsCount) : 0;

    // autoRoutedCount from DailyStat may be 0 for pre-v1.10.20 data — fall back to RequestLog
    let autoRoutedCount = s.autoRoutedCount || 0;
    if (autoRoutedCount < (s.totalRequests || 0) * 0.5 && (s.totalRequests || 0) > 1000) {
      try {
        const [arCount] = await RequestLog.aggregate([
          { $match: { ...rlMatch, isAutoRouted: true } },
          { $group: { _id: null, count: { $sum: 1 } } },
        ]);
        if (arCount?.count > autoRoutedCount) autoRoutedCount = arCount.count;
      } catch { /* non-fatal */ }
    }
    const result = {
      periodDays: d,
      uniqueUsers, usersViaProxy, usersDirect,
      summary: {
        totalRequests: s.totalRequests || 0, totalInputTokens: s.totalInputTokens || 0,
        totalOutputTokens: s.totalOutputTokens || 0, totalActualCost: s.totalActualCost || 0,
        totalBaselineCost: s.totalBaselineCost || 0, totalSaved: s.totalSaved || 0,
        autoRoutedCount, totalRoutingCost: s.totalRoutingCost || 0,
        errorCount: s.errorCount || 0, unknownErrorCount, avgDurationMs,
      },
    };
    setCache('summary', tenantId, timeRange, result);
    return res.json(result);
  }

  // Hour-range or custom queries: full RequestLog aggregation
  const match = { ...parseTimeMatch(req.query), ...buildTenantMatch(req, tenantId) };

  const [summary] = await RequestLog.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalRequests: { $sum: 1 },
        totalInputTokens: { $sum: '$inputTokens' },
        totalOutputTokens: { $sum: '$outputTokens' },
        totalActualCost: { $sum: '$actualCostUsd' },
        totalBaselineCost: { $sum: '$baselineCostUsd' },
        totalSaved: { $sum: '$savedUsd' },
        autoRoutedCount: { $sum: { $cond: ['$isAutoRouted', 1, 0] } },
        totalRoutingCost: { $sum: '$routingCostUsd' },
        errorCount: { $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] } },
        unknownErrorCount: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'error'] }, { $or: [{ $eq: ['$errorCategory', 'unknown'] }, { $eq: ['$errorCategory', null] }] }] }, 1, 0] } },
        avgDurationMs: { $avg: '$durationMs' },
      },
    },
  ]);

  // Count unique users (by IP hash) — only if tracking is enabled
  let uniqueUsers = null;
  let usersViaProxy = null;
  let usersDirect = null;
  try {
    const [ipStats] = await RequestLog.aggregate([
      { $match: { ...match, clientIpHash: { $exists: true, $ne: null } } },
      {
        $group: {
          _id: null,
          allIps:   { $addToSet: '$clientIpHash' },
          proxyIps: { $addToSet: { $cond: ['$viaProxy', '$clientIpHash', '$$REMOVE'] } },
          directIps:{ $addToSet: { $cond: [{ $ne: ['$viaProxy', true] }, '$clientIpHash', '$$REMOVE'] } },
        },
      },
    ]);
    if (ipStats?.allIps?.length) {
      uniqueUsers   = ipStats.allIps.length;
      usersViaProxy = ipStats.proxyIps?.filter(Boolean).length || 0;
      usersDirect   = ipStats.directIps?.filter(Boolean).length || 0;
    }
  } catch { /* non-fatal */ }

  const result = {
    periodDays: parseInt(req.query.days || req.query.hours || '30'),
    uniqueUsers, usersViaProxy, usersDirect,
    summary: summary || {
      totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0,
      totalActualCost: 0, totalBaselineCost: 0, totalSaved: 0,
      autoRoutedCount: 0, totalRoutingCost: 0, errorCount: 0, unknownErrorCount: 0, avgDurationMs: 0,
    },
  };
  setCache('summary', tenantId, timeRange, result);
  res.json(result);
});

// Model breakdown
router.get('/models', async (req, res) => {
  const { tenantId } = req.query;
  const timeRange = req.query.from ? `custom:${req.query.from}:${req.query.to||''}` : (req.query.hours || req.query.days || '30d');
  const cached = getCached('models', tenantId, timeRange);
  if (cached) return res.json(cached);

  // Day-range queries: use pre-aggregated DailyStat (much faster)
  if (!req.query.from && !req.query.hours) {
    const d = parseInt(req.query.days || '30');
    const sinceStr = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const match = { date: { $gte: sinceStr }, ...buildTenantMatch(req, tenantId) };
    const models = await DailyStat.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$routedModel',
          requests: { $sum: '$requests' },
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
          actualCost: { $sum: '$actualCostUsd' },
          baselineCost: { $sum: '$baselineCostUsd' },
          saved: { $sum: '$savedUsd' },
          autoRouted: { $sum: '$autoRoutedCount' },
          errorCount: { $sum: '$errorCount' },
          durationMsTotal: { $sum: '$durationMsTotal' },
          durationMsCount: { $sum: '$durationMsCount' },
        },
      },
      { $sort: { requests: -1 } },
    ]);
    setCache('models', tenantId, timeRange, models);
    return res.json(models);
  }

  // Hour-range or custom queries: fall back to RequestLog
  const match = { ...parseTimeMatch(req.query), ...buildTenantMatch(req, tenantId) };
  const models = await RequestLog.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$routedModel',
        requests: { $sum: 1 },
        inputTokens: { $sum: '$inputTokens' },
        outputTokens: { $sum: '$outputTokens' },
        actualCost: { $sum: '$actualCostUsd' },
        baselineCost: { $sum: '$baselineCostUsd' },
        saved: { $sum: '$savedUsd' },
        autoRouted: { $sum: { $cond: ['$isAutoRouted', 1, 0] } },
        errorCount: { $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] } },
        durationMsTotal: { $sum: '$durationMs' },
        durationMsCount: { $sum: { $cond: [{ $gt: ['$durationMs', 0] }, 1, 0] } },
      },
    },
    { $sort: { requests: -1 } },
  ]);

  setCache('models', tenantId, timeRange, models);
  res.json(models);
});

// Category distribution
router.get('/categories', async (req, res) => {
  const { tenantId } = req.query;
  const timeRange = req.query.from ? `custom:${req.query.from}:${req.query.to||''}` : (req.query.hours || req.query.days || '30d');
  const cached = getCached('categories', tenantId, timeRange);
  if (cached) return res.json(cached);

  // Day-range queries: use pre-aggregated DailyCategoryStat
  if (!req.query.from && !req.query.hours) {
    const d = parseInt(req.query.days || '30');
    const sinceStr = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const match = { date: { $gte: sinceStr }, ...buildTenantMatch(req, tenantId) };
    const categories = await DailyCategoryStat.aggregate([
      { $match: match },
      {
        $group: {
          _id: { category: '$category', costTier: '$costTier' },
          requests: { $sum: '$requests' },
          actualCost: { $sum: '$actualCostUsd' },
        },
      },
      { $sort: { requests: -1 } },
    ]);
    setCache('categories', tenantId, timeRange, categories);
    return res.json(categories);
  }

  // Hour-range or custom: fall back to RequestLog
  const match = { ...parseTimeMatch(req.query), isAutoRouted: true, ...buildTenantMatch(req, tenantId) };
  const categories = await RequestLog.aggregate([
    { $match: match },
    {
      $group: {
        _id: { category: '$category', costTier: '$costTier' },
        requests: { $sum: 1 },
        actualCost: { $sum: '$actualCostUsd' },
      },
    },
    { $sort: { requests: -1 } },
  ]);

  setCache('categories', tenantId, timeRange, categories);
  res.json(categories);
});

// Daily time series
router.get('/daily', async (req, res) => {
  const { tenantId, days, hours, from, to } = req.query;
  const timeRange = from ? `custom:${from}:${to||''}` : (hours || days || '30d');
  const cached = getCached('daily', tenantId, timeRange);
  if (cached) return res.json(cached);

  // Custom from/to range — use hourly buckets from RequestLog
  if (from) {
    const tenantMatch = buildTenantMatch(req, tenantId);
    const match = { timestamp: { $gte: new Date(from) }, ...tenantMatch };
    if (to) match.timestamp.$lte = new Date(to);

    const hourly = await RequestLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%dT%H:00', date: '$timestamp' } },
          requests:     { $sum: 1 },
          actualCost:   { $sum: '$actualCostUsd' },
          baselineCost: { $sum: '$baselineCostUsd' },
          saved:        { $sum: '$savedUsd' },
          inputTokens:  { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
          activeUsers:  { $addToSet: '$clientIpHash' },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    // Convert activeUsers set to count
    hourly.forEach(h => { h.activeUsers = h.activeUsers?.filter(Boolean).length || 0; });

    setCache('daily', tenantId, timeRange, hourly);
    return res.json(hourly);
  }

  // Hours-based queries aggregate from RequestLog (hourly buckets)
  if (hours) {
    const since = new Date(Date.now() - parseInt(hours) * 3600_000);
    const tenantMatch = buildTenantMatch(req, tenantId);
    const match = { timestamp: { $gte: since }, ...tenantMatch };

    const hourly = await RequestLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%dT%H:00', date: '$timestamp' },
          },
          requests:     { $sum: 1 },
          actualCost:   { $sum: '$actualCostUsd' },
          baselineCost: { $sum: '$baselineCostUsd' },
          saved:        { $sum: '$savedUsd' },
          inputTokens:  { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
          activeUsers:  { $addToSet: '$clientIpHash' },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    hourly.forEach(h => { h.activeUsers = h.activeUsers?.filter(Boolean).length || 0; });

    setCache('daily', tenantId, timeRange, hourly);
    return res.json(hourly);
  }

  // Days-based queries use pre-aggregated DailyStat
  const d = parseInt(days || '30');
  const sinceStr = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

  const tenantMatch = buildTenantMatch(req, tenantId);
  const match = { date: { $gte: sinceStr }, ...tenantMatch };

  const daily = await DailyStat.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$date',
        requests: { $sum: '$requests' },
        actualCost: { $sum: '$actualCostUsd' },
        baselineCost: { $sum: '$baselineCostUsd' },
        saved: { $sum: '$savedUsd' },
        inputTokens: { $sum: '$inputTokens' },
        outputTokens: { $sum: '$outputTokens' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Enrich daily stats with active user counts from RequestLog
  try {
    const usersByDay = await RequestLog.aggregate([
      { $match: { ...parseTimeMatch({ days: days || '30' }), clientIpHash: { $exists: true, $ne: null }, ...buildTenantMatch(req, tenantId) } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, activeUsers: { $addToSet: '$clientIpHash' } } },
    ]);
    const userMap = Object.fromEntries(usersByDay.map(d => [d._id, d.activeUsers?.filter(Boolean).length || 0]));
    daily.forEach(d => { d.activeUsers = userMap[d._id] || 0; });
  } catch { /* non-fatal — activeUsers just won't show */ }

  setCache('daily', tenantId, timeRange, daily);
  res.json(daily);
});

// User statistics
router.get('/users', async (req, res) => {
  const { tenantId, days = 30 } = req.query;
  const since = new Date();
  since.setDate(since.getDate() - parseInt(days));

  const match = { timestamp: { $gte: since }, userName: { $ne: null }, ...buildTenantMatch(req, tenantId) };

  const users = await RequestLog.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$userName',
        requests: { $sum: 1 },
        tokens: { $sum: { $add: ['$inputTokens', '$outputTokens'] } },
        cost: { $sum: '$actualCostUsd' },
      },
    },
    { $sort: { requests: -1 } },
    { $limit: 100 },
  ]);

  res.json(users);
});

// Request log (paginated)
router.get('/requests', async (req, res) => {
  const { tenantId, model, category, user, status, sessionId, from, to, excludeAutocomplete, override, hideResolved, errorCategory, toolAgent, page = 1, limit = 50 } = req.query;
  const match = { ...buildTenantMatch(req, tenantId) };
  if (model && typeof model === 'string') match.routedModel = model;
  if (category && typeof category === 'string') match.category = category;
  if (excludeAutocomplete === '1') match.category = { $nin: ['coding_autocomplete', 'tool_use'] };
  // Source filter — fully signal-based, independent of categories.
  // "Human" = a person typed a new question.
  // "Auto"  = machine-generated: FIM/autocomplete, tool-result continuations, title gen.
  if (toolAgent === 'true') {
    match.$or = [
      { 'routingSignals.isFimRequest': true },
      { 'routingSignals.isToolOutputContinuation': true },
    ];
  }
  if (toolAgent === 'false') {
    match['routingSignals.isFimRequest'] = { $ne: true };
    match['routingSignals.isToolOutputContinuation'] = { $ne: true };
  }
  if (override && typeof override === 'string') match.overrideApplied = { $regex: override, $options: 'i' };
  if (user && typeof user === 'string') match.userName = user;
  if (status && ['success', 'error'].includes(status)) match.status = status;
  if (hideResolved === '1') match.resolvedAt = { $exists: false };
  if (errorCategory && typeof errorCategory === 'string') {
    if (errorCategory === 'unknown') {
      // Match errors without errorCategory OR with errorCategory='unknown'
      match.$or = [{ errorCategory: 'unknown' }, { errorCategory: { $exists: false } }, { errorCategory: null }];
    } else {
      match.errorCategory = errorCategory;
    }
  }
  if (sessionId && typeof sessionId === 'string') match.sessionId = sessionId;
  if (from || to) {
    match.timestamp = {};
    if (from) match.timestamp.$gte = new Date(from);
    if (to)   match.timestamp.$lte = new Date(to);
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [requests, total] = await Promise.all([
    RequestLog.find(match)
      .sort({ timestamp: -1 }).skip(skip).limit(parseInt(limit))
      .lean(),
    RequestLog.countDocuments(match),
  ]);

  // Resolve tenant slugs in one bulk query (instead of per-doc populate)
  const reqTenantIds = [...new Set(requests.map(r => String(r.tenantId)).filter(Boolean))];
  const tenantLookup = {};
  if (reqTenantIds.length) {
    const tenants = await Tenant.find({ _id: { $in: reqTenantIds } }, { slug: 1, name: 1 }).lean();
    for (const t of tenants) tenantLookup[String(t._id)] = { slug: t.slug, name: t.name };
  }
  for (const r of requests) {
    const tid = String(r.tenantId);
    if (tenantLookup[tid]) r.tenantId = { _id: r.tenantId, ...tenantLookup[tid] };
  }

  // Strip prompt/response snapshots for roles that shouldn't see them
  const showPrompts = canViewPrompts(req.user?.role);
  const sanitized = requests.map(r => {
    const obj = r.toObject ? r.toObject() : r;
    if (!showPrompts) {
      delete obj.promptSnapshot;
      delete obj.responseSnapshot;
      delete obj.capturedPaths;
    } else {
      // Decrypt prompt content (AES-256-GCM encrypted at rest)
      if (obj.promptSnapshot) {
        if (obj.promptSnapshot.systemPrompt)    obj.promptSnapshot.systemPrompt    = decrypt(obj.promptSnapshot.systemPrompt);
        if (obj.promptSnapshot.lastUserMessage) obj.promptSnapshot.lastUserMessage = decrypt(obj.promptSnapshot.lastUserMessage);
        if (obj.promptSnapshot.messages?.length) {
          obj.promptSnapshot.messages = obj.promptSnapshot.messages.map(m => ({ ...m, content: decrypt(m.content) }));
        }
      }
      if (obj.responseSnapshot?.content) obj.responseSnapshot.content = decrypt(obj.responseSnapshot.content);
      if (obj.capturedPaths?.length)     obj.capturedPaths = obj.capturedPaths.map(p => decrypt(p));
    }
    // Backfill error classification — re-classify 'unknown' errors too (patterns may have been added since)
    if (obj.status === 'error' && (!obj.errorCategory || obj.errorCategory === 'unknown') && obj.errorMessage) {
      const msg = obj.errorMessage;
      if (/tool_use.*without.*tool_result|tool_call_ids did not have response/i.test(msg))
        Object.assign(obj, { errorCategory: 'fixed', errorFixedIn: 'v1.10.12', errorDescription: 'Orphaned tool calls' });
      else if (/Invalid value.*input_text.*Supported.*output_text/i.test(msg))
        Object.assign(obj, { errorCategory: 'fixed', errorFixedIn: 'v1.10.12', errorDescription: 'Azure content type mapping' });
      else if (/text field.*is blank/i.test(msg))
        Object.assign(obj, { errorCategory: 'fixed', errorFixedIn: 'v1.10.8', errorDescription: 'Bedrock blank text blocks' });
      else if (/Missing.*tools\[0\]\.name/i.test(msg))
        Object.assign(obj, { errorCategory: 'fixed', errorFixedIn: 'v1.10.12', errorDescription: 'Azure tool format' });
      else if (/expected a string.*got null|Invalid value for.*content/i.test(msg))
        Object.assign(obj, { errorCategory: 'fixed', errorFixedIn: 'v1.10.12', errorDescription: 'Azure null content' });
      else if (/cache_control/i.test(msg))
        Object.assign(obj, { errorCategory: 'fixed', errorFixedIn: 'v1.10.15', errorDescription: 'Azure cache_control stripped' });
      else if (/Provider.*not found or not assigned/i.test(msg))
        Object.assign(obj, { errorCategory: 'fixed', errorFixedIn: 'v1.10.15', errorDescription: 'Cross-provider model fallback' });
      else if (/reasoning_effort.*should be.*low.*medium.*high/i.test(msg))
        Object.assign(obj, { errorCategory: 'fixed', errorFixedIn: 'v1.10.16', errorDescription: 'Invalid reasoning_effort stripped' });
      else if (/Invalid value.*'tool'.*Supported.*assistant.*user/i.test(msg))
        Object.assign(obj, { errorCategory: 'fixed', errorFixedIn: 'v1.10.16', errorDescription: 'Azure tool role conversion' });
      else if (/Too many connections|ThrottlingException|ServiceUnavailable/i.test(msg))
        Object.assign(obj, { errorCategory: 'provider', errorDescription: 'Rate limit — wait and retry' });
      else if (/context.*length|maximum.*context|too many tokens|prompt is too long/i.test(msg))
        Object.assign(obj, { errorCategory: 'provider', errorDescription: 'Context window exceeded' });
      else if (/URLBlocked|Tunnel connection failed.*403/i.test(msg))
        Object.assign(obj, { errorCategory: 'proxy', errorDescription: 'Proxy blocking target URL' });
      else if (/ProxyError|Unable to connect to proxy/i.test(msg))
        Object.assign(obj, { errorCategory: 'proxy', errorDescription: 'Proxy unreachable' });
      else if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(msg))
        Object.assign(obj, { errorCategory: 'provider', errorDescription: 'Provider unreachable' });
      else if (/rate_limit.*tenant|Rate limit exceeded for tenant/i.test(msg))
        Object.assign(obj, { errorCategory: 'provider', errorDescription: 'Tenant rate limit exceeded' });
      else if (/max_tokens.*exceeds|maximum tokens.*exceeds/i.test(msg))
        Object.assign(obj, { errorCategory: 'provider', errorDescription: 'Max tokens exceeds model limit' });
      else if (/terminated/i.test(msg))
        Object.assign(obj, { errorCategory: 'provider', errorDescription: 'Stream terminated' });
      else if (/Bad Gateway|502.*Bad/i.test(msg))
        Object.assign(obj, { errorCategory: 'provider', errorDescription: 'Provider 502 Bad Gateway' });
      else if (/Multimodal.*not supported/i.test(msg))
        Object.assign(obj, { errorCategory: 'provider', errorDescription: 'Multimodal not supported' });
      else if (/modelStreamErrorException|invalid sequence.*ToolUse/i.test(msg))
        Object.assign(obj, { errorCategory: 'provider', errorDescription: 'Model invalid tool use' });
      else if (/final assistant content/i.test(msg))
        Object.assign(obj, { errorCategory: 'provider', errorDescription: 'Bedrock validation error' });
      else if (/image url|Unable to access/i.test(msg))
        Object.assign(obj, { errorCategory: 'provider', errorDescription: 'Image URL not accessible' });
      else if (/Server disconnected/i.test(msg))
        Object.assign(obj, { errorCategory: 'provider', errorDescription: 'Server disconnected' });
      else if (/array too long.*128|Invalid.*tools.*array/i.test(msg))
        Object.assign(obj, { errorCategory: 'provider', errorDescription: 'Too many tools (max 128)' });
      else if (/McAfee|Web Gateway|<!DOCTYPE.*html/i.test(msg))
        Object.assign(obj, { errorCategory: 'proxy', errorDescription: 'Proxy/firewall HTML error page' });
      else if (/Unknown parameter.*tool_call/i.test(msg))
        Object.assign(obj, { errorCategory: 'provider', errorDescription: 'Azure unsupported parameter' });
      else if (/tool.*is a duplicate|duplicate tool/i.test(msg))
        Object.assign(obj, { errorCategory: 'provider', errorDescription: 'Duplicate tool name' });
      else if (/toolConfig field must be/i.test(msg))
        Object.assign(obj, { errorCategory: 'provider', errorDescription: 'Bedrock tool config validation' });
      else if (/Server disconnected/i.test(msg))
        Object.assign(obj, { errorCategory: 'provider', errorDescription: 'Server disconnected' });
      else if (/array too long|too many tools/i.test(msg))
        Object.assign(obj, { errorCategory: 'provider', errorDescription: 'Too many tools' });
      else if (/image.*url|Unable to access.*image/i.test(msg))
        Object.assign(obj, { errorCategory: 'provider', errorDescription: 'Image URL error' });
      else if (/promptCaching/i.test(msg))
        Object.assign(obj, { errorCategory: 'provider', errorDescription: 'Prompt caching error' });
      else
        Object.assign(obj, { errorCategory: 'unknown', errorDescription: 'Unclassified error' });
    }
    return obj;
  });

  // Post-backfill filter: if filtering by errorCategory, re-filter after backfill
  // (backfill may have reclassified 'unknown' errors to 'fixed'/'provider'/'proxy')
  let finalRequests = sanitized;
  let finalTotal = total;
  if (errorCategory) {
    finalRequests = sanitized.filter(r => r.errorCategory === errorCategory);
    finalTotal = finalRequests.length;
  }

  res.json({ requests: finalRequests, total: finalTotal, page: parseInt(page), pages: Math.ceil(finalTotal / parseInt(limit)) });
});

// ── GET /api/admin/dashboard/tenants-list — lightweight list for filters ──────
router.get('/tenants-list', async (req, res) => {
  const tenants = await Tenant.find({ active: true }).select('slug name _id').lean();
  res.json(tenants);
});

// ── GET /api/admin/dashboard/top-paths — top 100 captured file paths ──────────
router.get('/top-paths', async (req, res) => {
  const { tenantId, days = 30 } = req.query;
  const since = new Date();
  since.setDate(since.getDate() - parseInt(days));

  const match = {
    timestamp: { $gte: since },
    capturedPaths: { $exists: true, $not: { $size: 0 } },
    ...buildTenantMatch(req, tenantId),
  };

  try {
    const paths = await RequestLog.aggregate([
      { $match: match },
      { $unwind: '$capturedPaths' },
      { $group: { _id: '$capturedPaths', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 100 },
      { $project: { _id: 0, path: '$_id', count: 1 } },
    ]);
    res.json(paths);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /summary/rpm — count requests in the last 60 seconds (global, no tenant filter)
router.get('/rpm', async (req, res) => {
  try {
    const since = new Date(Date.now() - 60 * 1000);
    const count = await RequestLog.countDocuments({ timestamp: { $gte: since } });
    res.json({ rpm: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /reclassify-fim — retroactively classify FIM / tool-agent requests ───
// Backfill source signals on existing requests: re-runs signal detection to set
// isFimRequest, isToolAgentRequest, isToolOutputContinuation, and category.
// Two modes:
//   mode=unclassified (default): only requests with category=null
//   mode=all: re-scan ALL requests (updates source signals on already-classified too)
router.post('/reclassify-fim', async (req, res) => {
  const { days = 30, tenantId, mode = 'unclassified' } = req.body || {};
  const since = new Date();
  since.setDate(since.getDate() - parseInt(days));

  const match = {
    timestamp: { $gte: since },
    ...buildTenantMatch(req, tenantId),
  };
  if (mode !== 'all') {
    // Default: only unclassified OR missing isToolOutputContinuation
    match.$or = [
      { category: null },
      { 'routingSignals.isToolOutputContinuation': { $exists: false } },
    ];
  }

  try {
    const BATCH = 5000;
    let totalScanned = 0;
    let totalUpdated = 0;
    let lastId = null;

    // Process in batches of 5000 until no more records match
    while (true) {
      const batchMatch = { ...match };
      if (lastId) batchMatch._id = { ...batchMatch._id, $gt: lastId };

      const records = await RequestLog.find(batchMatch)
        .select('_id promptSnapshot routingSignals category')
        .sort({ _id: 1 })
        .lean()
        .limit(BATCH);

      if (!records.length) break;
      totalScanned += records.length;
      lastId = records[records.length - 1]._id;

      const bulkOps = [];
      for (const r of records) {
        const systemText = r.promptSnapshot?.systemPrompt || '';
        const lastUser   = r.promptSnapshot?.lastUserMessage || '';
        if (!systemText && !lastUser) continue;

        const fakeRequest = {
          messages: [
            ...(systemText ? [{ role: 'system', content: systemText }] : []),
            ...(lastUser   ? [{ role: 'user',   content: lastUser   }] : []),
          ],
        };
        const signals = extractSignals(fakeRequest);

        const update = {};
        if (signals.isFimRequest)              update['routingSignals.isFimRequest'] = true;
        if (signals.isToolAgentRequest)        update['routingSignals.isToolAgentRequest'] = true;
        if (signals.isToolOutputContinuation)  update['routingSignals.isToolOutputContinuation'] = true;
        if (!r.category && (signals.isFimRequest || signals.isToolAgentRequest)) {
          update.category = signals.isFimRequest ? 'coding_autocomplete' : 'tool_use';
        }

        if (!Object.keys(update).length) continue;

        bulkOps.push({
          updateOne: {
            filter: { _id: r._id },
            update: { $set: update },
          },
        });
      }

      if (bulkOps.length) await RequestLog.bulkWrite(bulkOps);
      totalUpdated += bulkOps.length;

      if (records.length < BATCH) break; // last batch
    }

    res.json({ scanned: totalScanned, updated: totalUpdated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /config-changes — configuration audit trail ─────────────────────────
// Admins see full details (who changed what). Other roles see "Configuration
// changed" without the username — they need to know WHAT changed but not WHO.
router.get('/config-changes', async (req, res) => {
  const since = parseSince(req.query);
  const timeRange = req.query.from ? `custom:${req.query.from}:${req.query.to||''}` : (req.query.hours || req.query.days || '30d');
  const isAdmin = req.user?.role === 'admin';
  const cacheKey = isAdmin ? 'admin' : 'non-admin';
  const cached = getCached('config-changes', cacheKey, timeRange);
  if (cached) return res.json(cached);

  const changes = await ConfigChange.find({ timestamp: { $gte: since } })
    .sort({ timestamp: -1 })
    .limit(100)
    .lean();

  if (!isAdmin) {
    // Strip sensitive info for non-admin roles
    for (const c of changes) {
      c.user = 'admin'; // anonymize who made the change
    }
  }

  setCache('config-changes', cacheKey, timeRange, changes);
  res.json(changes);
});

// ── POST /resolve-error — mark a single error as resolved ───────────────────
router.post('/resolve-error/:id', async (req, res) => {
  if (!['admin', 'maintainer'].includes(req.user?.role)) return res.status(403).json({ error: 'Admin or maintainer only' });
  const result = await RequestLog.findByIdAndUpdate(req.params.id,
    { $set: { resolvedAt: new Date(), resolvedBy: req.user.username } },
    { new: true }
  );
  if (!result) return res.status(404).json({ error: 'Request not found' });
  res.json({ resolved: true, id: req.params.id });
});

// ── POST /resolve-errors-before — bulk resolve all errors before a timestamp ─
router.post('/resolve-errors-before', async (req, res) => {
  if (!['admin', 'maintainer'].includes(req.user?.role)) return res.status(403).json({ error: 'Admin or maintainer only' });
  const { before } = req.body;
  const timestamp = before ? new Date(before) : new Date();
  const result = await RequestLog.updateMany(
    { status: 'error', timestamp: { $lte: timestamp }, resolvedAt: { $exists: false } },
    { $set: { resolvedAt: new Date(), resolvedBy: req.user.username } }
  );
  res.json({ resolved: result.modifiedCount, before: timestamp });
});

// ── POST /recalc-costs — recalculate costs using provider pricing ──────────
// Re-computes actualCostUsd, baselineCostUsd, savedUsd for all requests
// in the given period using current provider pricing instead of stale
// model registry list prices.
router.post('/recalc-costs', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const { days = 30, tenantId } = req.body || {};
  const since = new Date(Date.now() - parseInt(days) * 86_400_000);
  const match = { timestamp: { $gte: since }, ...buildTenantMatch(req, tenantId) };

  try {
    // Load all providers and build a model → pricing lookup
    const providers = await Provider.find().lean();
    const modelPricing = new Map();
    for (const p of providers) {
      for (const m of (p.discoveredModels || [])) {
        if (m.inputPer1M != null) {
          modelPricing.set(m.id, { input: m.inputPer1M, output: m.outputPer1M ?? 0 });
        }
      }
    }

    // Load tenant for tenant-specific pricing overrides
    const tenants = await Tenant.find().lean();
    const tenantMap = new Map(tenants.map(t => [t._id.toString(), t]));

    const records = await RequestLog.find(match)
      .select('_id tenantId routedModel requestedModel inputTokens outputTokens isAutoRouted actualCostUsd baselineCostUsd savedUsd routingCostUsd')
      .lean();

    let updated = 0;
    let totalCostDelta = 0;
    const bulkOps = [];

    for (const r of records) {
      const tenant = tenantMap.get(r.tenantId?.toString());
      const provModel = modelPricing.get(r.routedModel);
      const newActualModel = calcCost(r.routedModel, r.inputTokens || 0, r.outputTokens || 0, tenant, provModel ? { inputPer1M: provModel.input, outputPer1M: provModel.output } : null);
      const routingCost = r.routingCostUsd || 0;
      const newActual = newActualModel + (r.isAutoRouted ? routingCost : 0);

      let newBaseline;
      if (r.isAutoRouted && r.requestedModel && r.requestedModel !== 'auto-prism') {
        const reqProvModel = modelPricing.get(r.requestedModel);
        newBaseline = calcCost(r.requestedModel, r.inputTokens || 0, r.outputTokens || 0, tenant, reqProvModel ? { inputPer1M: reqProvModel.input, outputPer1M: reqProvModel.output } : null);
      } else if (!r.isAutoRouted) {
        newBaseline = newActual;
      } else {
        // auto-prism: keep existing baseline (dynamic baseline can't be recalculated retroactively)
        newBaseline = r.baselineCostUsd || newActual;
      }

      const newSaved = newBaseline - newActual;
      const costDelta = (r.actualCostUsd || 0) - newActual;

      if (Math.abs(costDelta) > 0.000001) {
        bulkOps.push({
          updateOne: {
            filter: { _id: r._id },
            update: { $set: { actualCostUsd: newActual, baselineCostUsd: newBaseline, savedUsd: newSaved } },
          },
        });
        totalCostDelta += costDelta;
        updated++;
      }
    }

    if (bulkOps.length) {
      await RequestLog.bulkWrite(bulkOps);
    }

    // Rebuild DailyStat for affected days
    const affectedDays = [...new Set(records.map(r => r.timestamp || new Date()).map(t => new Date(t).toISOString().slice(0, 10)))];
    let dailyUpdated = 0;

    for (const day of affectedDays) {
      const dayMatch = { date: day, ...buildTenantMatch(req, tenantId) };
      // Delete old daily stats for this day and rebuild from RequestLog
      const dayStart = new Date(day + 'T00:00:00Z');
      const dayEnd = new Date(day + 'T23:59:59.999Z');
      const dayLogs = await RequestLog.aggregate([
        { $match: { timestamp: { $gte: dayStart, $lte: dayEnd }, ...buildTenantMatch(req, tenantId) } },
        {
          $group: {
            _id: { date: day, tenantId: '$tenantId', routedModel: '$routedModel' },
            requests: { $sum: 1 },
            inputTokens: { $sum: '$inputTokens' },
            outputTokens: { $sum: '$outputTokens' },
            actualCostUsd: { $sum: '$actualCostUsd' },
            baselineCostUsd: { $sum: '$baselineCostUsd' },
            savedUsd: { $sum: '$savedUsd' },
          },
        },
      ]);

      for (const d of dayLogs) {
        await DailyStat.findOneAndUpdate(
          { date: d._id.date, tenantId: d._id.tenantId, routedModel: d._id.routedModel },
          { $set: { requests: d.requests, inputTokens: d.inputTokens, outputTokens: d.outputTokens, actualCostUsd: d.actualCostUsd, baselineCostUsd: d.baselineCostUsd, savedUsd: d.savedUsd } },
          { upsert: true },
        );
        dailyUpdated++;
      }
    }

    res.json({
      scanned: records.length,
      updated,
      totalCostDelta: Math.round(totalCostDelta * 1e6) / 1e6,
      dailyStatsRebuilt: dailyUpdated,
      affectedDays: affectedDays.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
