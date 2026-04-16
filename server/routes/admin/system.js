import { Router } from 'express';
import PodMetrics from '../../models/PodMetrics.js';
import LogConfig from '../../models/LogConfig.js';
import RequestLog from '../../models/RequestLog.js';
import { adminOnly, adminOrMaint, canViewCosts, canChat } from '../../middleware/rbac.js';
import { snapshot } from '../../utils/requestCounters.js';
import { getPodId } from '../../services/podHeartbeat.js';
import { getHealthReport, getErrorRate } from '../../services/circuitBreakerService.js';
import Provider from '../../models/Provider.js';
import User from '../../models/User.js';
import logger from '../../utils/logger.js';

const router = Router();

// ── POST /api/admin/system/verify-password ───────────────────────────────────
// Re-authenticate the current admin user before allowing Danger Zone operations.
router.post('/verify-password', adminOnly, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.passwordHash) return res.status(400).json({ error: 'Password verification not available for LDAP users' });

    const valid = await user.verifyPassword(password);
    if (!valid) return res.status(401).json({ error: 'Invalid password' });

    res.json({ verified: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/system/export-settings ────────────────────────────────────
// Exports all configuration collections as a single JSON document for backup.
// Sensitive fields (API keys, password hashes) are included for full restore
// capability — the export itself is admin-only + password-gated in the UI.
router.get('/export-settings', adminOnly, async (req, res) => {
  try {
    const Tenant          = (await import('../../models/Tenant.js')).default;
    const RoutingCategory = (await import('../../models/RoutingCategory.js')).default;
    const RoutingRuleSet  = (await import('../../models/RoutingRuleSet.js')).default;
    const ChatConfig      = (await import('../../models/ChatConfig.js')).default;
    const LdapConfig      = (await import('../../models/LdapConfig.js')).default;
    const SystemConfig    = (await import('../../models/SystemConfig.js')).default;
    const Webhook         = (await import('../../models/Webhook.js')).default;
    const Quota           = (await import('../../models/Quota.js')).default;
    const Experiment      = (await import('../../models/Experiment.js')).default;

    const exportData = {
      _meta: {
        exportedAt: new Date().toISOString(),
        version: process.env.npm_package_version || '2.1.2',
        type: 'model-prism-settings-export',
      },
      providers:         await Provider.find().lean(),
      tenants:           await Tenant.find().lean(),
      routingCategories: await RoutingCategory.find().lean(),
      routingRuleSets:   await RoutingRuleSet.find().lean(),
      logConfig:         await LogConfig.findOne({ singleton: 'default' }).lean(),
      users:             (await User.find().lean()).map(u => { const { passwordHash: _, ...rest } = u; return rest; }),
    };

    // Optional collections — may not exist in all deployments
    try { exportData.chatConfig   = await ChatConfig.findOne({ singleton: 'default' }).lean(); } catch {}
    try { exportData.ldapConfig   = await LdapConfig.findOne({ singleton: 'default' }).lean(); } catch {}
    try { exportData.systemConfig = await SystemConfig.findOne({ singleton: 'default' }).lean(); } catch {}
    try { exportData.webhooks     = await Webhook.find().lean(); } catch {}
    try { exportData.quotas       = await Quota.find().lean(); } catch {}
    try { exportData.experiments  = await Experiment.find().lean(); } catch {}

    res.setHeader('Content-Disposition', `attachment; filename="model-prism-settings-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(exportData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/system/import-settings ───────────────────────────────────
// Imports a previously exported settings JSON to restore configuration.
// Uses upsert logic: existing documents are updated by _id, new ones created.
// Does NOT touch RequestLogs, DailyStats, or other analytics data.
router.post('/import-settings', adminOnly, async (req, res) => {
  try {
    const data = req.body;
    if (!data?._meta?.type || data._meta.type !== 'model-prism-settings-export') {
      return res.status(400).json({ error: 'Invalid export file — missing or wrong _meta.type' });
    }

    const Tenant          = (await import('../../models/Tenant.js')).default;
    const RoutingCategory = (await import('../../models/RoutingCategory.js')).default;
    const RoutingRuleSet  = (await import('../../models/RoutingRuleSet.js')).default;
    const ChatConfig      = (await import('../../models/ChatConfig.js')).default;
    const LdapConfig      = (await import('../../models/LdapConfig.js')).default;
    const SystemConfig    = (await import('../../models/SystemConfig.js')).default;
    const Webhook         = (await import('../../models/Webhook.js')).default;
    const Quota           = (await import('../../models/Quota.js')).default;

    const stats = { providers: 0, tenants: 0, categories: 0, ruleSets: 0, other: 0 };

    // Helper: upsert array of documents by _id
    async function upsertMany(Model, docs, statKey) {
      if (!Array.isArray(docs)) return;
      for (const doc of docs) {
        const { _id, __v, ...fields } = doc;
        if (_id) {
          await Model.findByIdAndUpdate(_id, fields, { upsert: true, new: true });
        } else {
          await Model.create(fields);
        }
        stats[statKey]++;
      }
    }

    // Helper: upsert singleton document
    async function upsertSingleton(Model, doc) {
      if (!doc) return;
      const { _id, __v, ...fields } = doc;
      await Model.findOneAndUpdate({ singleton: 'default' }, fields, { upsert: true });
      stats.other++;
    }

    await upsertMany(Provider, data.providers, 'providers');
    await upsertMany(Tenant, data.tenants, 'tenants');
    await upsertMany(RoutingCategory, data.routingCategories, 'categories');
    await upsertMany(RoutingRuleSet, data.routingRuleSets, 'ruleSets');

    if (data.logConfig)    await upsertSingleton(LogConfig, data.logConfig);
    if (data.chatConfig)   { try { await upsertSingleton(ChatConfig, data.chatConfig); } catch {} }
    if (data.ldapConfig)   { try { await upsertSingleton(LdapConfig, data.ldapConfig); } catch {} }
    if (data.systemConfig) { try { await upsertSingleton(SystemConfig, data.systemConfig); } catch {} }
    if (data.webhooks)     { try { await upsertMany(Webhook, data.webhooks, 'other'); } catch {} }
    if (data.quotas)       { try { await upsertMany(Quota, data.quotas, 'other'); } catch {} }

    logger.info('[system] import-settings: restored configuration', stats);
    res.json({ success: true, imported: stats, from: data._meta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/system/overview ────────────────────────────────────────────
// Active pods + this-pod counters + provider health summary
router.get('/overview', canViewCosts, async (req, res) => {
  try {
    // All pods that have sent a heartbeat in the last 90 s (TTL filter)
    const pods = await PodMetrics.find().sort({ updatedAt: -1 }).lean();

    // Blocked / error counters from this pod
    const counters = snapshot();

    // Provider health: last 5 min from request log
    const since = new Date(Date.now() - 5 * 60 * 1000);
    const providerStats = await RequestLog.aggregate([
      { $match: { timestamp: { $gte: since } } },
      {
        $group: {
          _id:        '$providerId',
          total:      { $sum: 1 },
          errors:     { $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] } },
          avgRouting: { $avg: '$routingMs' },
          avgDuration:{ $avg: '$durationMs' },
        },
      },
    ]);

    // Traffic summary: last 60 min bucketed per minute
    const trafficSince = new Date(Date.now() - 60 * 60 * 1000);
    const trafficBuckets = await RequestLog.aggregate([
      { $match: { timestamp: { $gte: trafficSince } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%dT%H:%M', date: '$timestamp' },
          },
          requests: { $sum: 1 },
          tokens:   { $sum: { $add: ['$inputTokens', '$outputTokens'] } },
          errors:   { $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({
      thisPod:   getPodId(),
      pods,
      counters,
      providerStats,
      trafficBuckets,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/system/pods ────────────────────────────────────────────────
router.get('/pods', canViewCosts, async (req, res) => {
  try {
    const pods = await PodMetrics.find().sort({ updatedAt: -1 }).lean();
    res.json(pods);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const FILE_LOGGING_DEFAULTS = {
  enabled: false,
  directory: '/var/log/open-model-prism',
  maxSizeMb: 100,
  maxFiles: 7,
  includePrompts: false,
};

// ── GET /api/admin/system/log-config ─────────────────────────────────────────
router.get('/log-config', canViewCosts, async (req, res) => {
  try {
    let cfg = await LogConfig.findOne({ singleton: 'default' }).lean();
    if (!cfg) {
      cfg = await LogConfig.create({ singleton: 'default' });
      cfg = cfg.toObject();
    }
    // Ensure fileLogging always has all defaults (handles old documents without the field)
    cfg.fileLogging = { ...FILE_LOGGING_DEFAULTS, ...(cfg.fileLogging || {}) };
    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/admin/system/pods/:podId — evict a pod from the dashboard ────
// Deletes the PodMetrics document. If the pod is still running it will re-appear
// on the next heartbeat (30 s). Use this to clear stale/offline pod records.
router.delete('/pods/:podId', adminOrMaint, async (req, res) => {
  const result = await PodMetrics.deleteOne({ podId: req.params.podId });
  if (result.deletedCount === 0) return res.status(404).json({ error: 'Pod not found' });
  res.json({ evicted: true, podId: req.params.podId });
});

// ── PUT /api/admin/system/log-config ─────────────────────────────────────────
router.put('/log-config', adminOnly, async (req, res) => {
  try {
    const { logLevel, promptLogging, promptLogLevel, routingDecisionLogging, fileLogging, pathCapture, trackUsersByIp, promptRetentionEnabled, promptRetentionHours } = req.body;

    const update = { updatedAt: new Date(), updatedBy: req.user?.username };
    if (logLevel !== undefined)               update.logLevel = logLevel;
    if (promptLogging !== undefined)          update.promptLogging = promptLogging;
    if (promptLogLevel !== undefined)         update.promptLogLevel = promptLogLevel;
    if (routingDecisionLogging !== undefined) update.routingDecisionLogging = routingDecisionLogging;
    if (trackUsersByIp !== undefined)         update.trackUsersByIp = trackUsersByIp;
    if (pathCapture !== undefined)             update.pathCapture = pathCapture;
    if (promptRetentionEnabled !== undefined) update.promptRetentionEnabled = promptRetentionEnabled;
    if (promptRetentionHours !== undefined)   update.promptRetentionHours = Math.max(1, Math.min(8760, parseInt(promptRetentionHours) || 48));
    if (fileLogging !== undefined) {
      // Always store a complete fileLogging object — merge over defaults so
      // partial updates (e.g. just { enabled: true }) don't lose other fields.
      // Strip any _id that Mongoose may have attached to the subdoc.
      const { _id: _ignored, ...fl } = fileLogging || {};
      update.fileLogging = { ...FILE_LOGGING_DEFAULTS, ...fl };
    }

    const cfg = await LogConfig.findOneAndUpdate(
      { singleton: 'default' },
      { $set: update },
      { upsert: true, new: true },
    );

    // Apply log level change immediately on this pod
    if (logLevel) logger.setLevel(logLevel);

    // Bust the analytics engine's LogConfig cache so next request picks up the new settings
    const { invalidateLogConfigCache } = await import('../../services/analyticsEngine.js');
    invalidateLogConfigCache();

    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/system/circuit-breaker — provider health + error rates ────
router.get('/circuit-breaker', canViewCosts, async (_req, res) => {
  try {
    const report = getHealthReport();
    // Enrich with provider names
    const providerIds = report.map(r => r.providerId).filter(Boolean);
    const providers = providerIds.length
      ? await Provider.find({ _id: { $in: providerIds } }).select('name slug type').lean()
      : [];
    const providerMap = Object.fromEntries(providers.map(p => [p._id.toString(), p]));

    const enriched = report.map(r => ({
      ...r,
      providerName: providerMap[r.providerId]?.name || r.providerId,
      providerSlug: providerMap[r.providerId]?.slug || '',
      providerType: providerMap[r.providerId]?.type || '',
      errorRate: Math.round(getErrorRate(r.providerId) * 1000) / 10, // percentage with 1 decimal
    }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/system/shrink-logs ───────────────────────────────────────
// Strip prompt/response content from old logs while keeping metadata.
// Useful for GDPR compliance and storage management.
router.post('/shrink-logs', adminOnly, async (req, res) => {
  try {
    const hours = Math.max(1, parseInt(req.body?.olderThanHours) || 24);
    const cutoff = new Date(Date.now() - hours * 3_600_000);
    const result = await RequestLog.updateMany(
      {
        timestamp: { $lt: cutoff },
        $or: [
          { promptSnapshot: { $exists: true } },
          { responseSnapshot: { $exists: true } },
          { capturedPaths:   { $exists: true } },
        ],
      },
      { $unset: { promptSnapshot: 1, responseSnapshot: 1, capturedPaths: 1 } },
    );
    logger.info(`[system] shrink-logs: stripped prompt/response content from ${result.modifiedCount} logs older than ${hours}h`);
    res.json({ shrunk: result.modifiedCount, olderThanHours: hours, cutoff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/system/cleanup-legacy ────────────────────────────────────
// Finds and removes orphaned data: dangling provider references in tenants,
// request logs / daily stats / quotas for deleted tenants, and other stale
// cross-collection references. Safe to run repeatedly — idempotent.
router.post('/cleanup-legacy', adminOnly, async (req, res) => {
  try {
    const Tenant = (await import('../../models/Tenant.js')).default;
    const DailyStat = (await import('../../models/DailyStat.js')).default;
    const Quota = (await import('../../models/Quota.js')).default;
    const RoutingRuleSet = (await import('../../models/RoutingRuleSet.js')).default;
    const result = { danglingProviders: 0, orphanedLogs: 0, orphanedStats: 0, orphanedQuotas: 0, orphanedRuleSets: 0 };

    // 1. Remove dangling provider IDs from tenants
    const allProviderIds = new Set((await Provider.find().select('_id').lean()).map(p => String(p._id)));
    const tenants = await Tenant.find().lean();
    for (const t of tenants) {
      const valid = (t.providerIds || []).filter(id => allProviderIds.has(String(id)));
      if (valid.length !== (t.providerIds || []).length) {
        const removed = (t.providerIds || []).length - valid.length;
        await Tenant.updateOne({ _id: t._id }, { $set: { providerIds: valid } });
        result.danglingProviders += removed;
      }
      // Clean up classifier provider if it no longer exists
      if (t.routing?.classifierProvider && !allProviderIds.has(String(t.routing.classifierProvider))) {
        await Tenant.updateOne({ _id: t._id }, { $unset: { 'routing.classifierProvider': '', 'routing.classifierModel': '' } });
        result.danglingProviders++;
      }
    }

    // 2. Remove orphaned request logs for deleted tenants
    const allTenantIds = new Set(tenants.map(t => String(t._id)));
    const logTenantIds = await RequestLog.distinct('tenantId');
    const orphanedTenantIds = logTenantIds.filter(id => id && !allTenantIds.has(String(id)));
    if (orphanedTenantIds.length) {
      const r = await RequestLog.deleteMany({ tenantId: { $in: orphanedTenantIds } });
      result.orphanedLogs = r.deletedCount;
    }

    // 3. Remove orphaned daily stats
    const statTenantIds = await DailyStat.distinct('tenantId');
    const orphanedStatIds = statTenantIds.filter(id => id && !allTenantIds.has(String(id)));
    if (orphanedStatIds.length) {
      const r = await DailyStat.deleteMany({ tenantId: { $in: orphanedStatIds } });
      result.orphanedStats = r.deletedCount;
    }

    // 4. Remove orphaned quotas
    try {
      const quotaTenantIds = await Quota.distinct('tenantId');
      const orphanedQuotaIds = quotaTenantIds.filter(id => id && !allTenantIds.has(String(id)));
      if (orphanedQuotaIds.length) {
        const r = await Quota.deleteMany({ tenantId: { $in: orphanedQuotaIds } });
        result.orphanedQuotas = r.deletedCount;
      }
    } catch { /* Quota collection may not exist */ }

    // 5. Remove orphaned rule sets
    try {
      const rsTenantIds = await RoutingRuleSet.distinct('tenantId');
      const orphanedRsIds = rsTenantIds.filter(id => id && !allTenantIds.has(String(id)));
      if (orphanedRsIds.length) {
        const r = await RoutingRuleSet.deleteMany({ tenantId: { $in: orphanedRsIds }, isDefault: { $ne: true } });
        result.orphanedRuleSets = r.deletedCount;
      }
    } catch { /* non-fatal */ }

    const total = Object.values(result).reduce((a, b) => a + b, 0);
    logger.info(`[system] cleanup-legacy: removed ${total} orphaned items`, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
