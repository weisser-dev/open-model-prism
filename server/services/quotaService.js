import Quota from '../models/Quota.js';

/**
 * Check all enabled quotas for a tenant and determine enforcement state.
 * @param {import('mongoose').Types.ObjectId} tenantId
 * @returns {Promise<{ allowed: boolean, quotas: Array, activeEnforcement: string }>}
 */
export async function checkQuotas(tenantId) {
  const quotas = await Quota.find({ tenantId, enabled: true }).lean();

  let allowed = true;
  let activeEnforcement = 'none';
  const mapped = [];

  for (const q of quotas) {
    const pct = q.limit > 0 ? Math.round((q.currentUsage / q.limit) * 100) : 0;
    mapped.push({
      type: q.quotaType,
      usage: q.currentUsage,
      limit: q.limit,
      pct,
      enforcement: q.enforcement,
    });

    if (pct < 100) continue;

    if (q.enforcement === 'hard_block') {
      allowed = false;
      activeEnforcement = 'hard_block';
    }
    if (q.enforcement === 'auto_economy' && activeEnforcement !== 'hard_block') {
      activeEnforcement = 'auto_economy';
    }
    if (q.enforcement === 'soft_warning' && activeEnforcement === 'none') {
      activeEnforcement = 'soft_warning';
    }
  }

  return { allowed, quotas: mapped, activeEnforcement };
}

/**
 * Increment usage counters for matching quotas.
 * @param {import('mongoose').Types.ObjectId} tenantId
 * @param {{ tokens?: number, requests?: number, costUsd?: number }} deltas
 */
export async function incrementUsage(tenantId, { tokens = 0, requests = 0, costUsd = 0 } = {}) {
  const ops = [];

  if (tokens > 0) {
    ops.push(
      Quota.updateMany(
        { tenantId, quotaType: 'tokens_monthly', enabled: true },
        { $inc: { currentUsage: tokens } },
      ),
    );
  }

  if (requests > 0) {
    ops.push(
      Quota.updateMany(
        { tenantId, quotaType: { $in: ['requests_daily', 'requests_monthly'] }, enabled: true },
        { $inc: { currentUsage: requests } },
      ),
    );
  }

  if (costUsd > 0) {
    ops.push(
      Quota.updateMany(
        { tenantId, quotaType: 'cost_monthly', enabled: true },
        { $inc: { currentUsage: costUsd } },
      ),
    );
  }

  if (ops.length) await Promise.all(ops);
}

/**
 * Reset all quotas whose resetAt has passed and schedule the next reset.
 * @returns {Promise<number>} Number of quotas reset.
 */
export async function resetExpiredQuotas() {
  const now = new Date();
  const expired = await Quota.find({ resetAt: { $lte: now }, enabled: true });

  if (!expired.length) return 0;

  const ops = expired.map((q) => {
    const nextReset = new Date(q.resetAt);
    if (q.period === 'daily') {
      nextReset.setDate(nextReset.getDate() + 1);
    } else {
      nextReset.setDate(nextReset.getDate() + 30);
    }

    return Quota.updateOne(
      { _id: q._id },
      { $set: { currentUsage: 0, resetAt: nextReset, lastResetAt: now } },
    );
  });

  await Promise.all(ops);
  return expired.length;
}

/** Mapping from config key to { quotaType, period } */
const CONFIG_MAP = {
  tokensMonthly:   { quotaType: 'tokens_monthly',   period: 'monthly' },
  requestsDaily:   { quotaType: 'requests_daily',    period: 'daily'   },
  requestsMonthly: { quotaType: 'requests_monthly',  period: 'monthly' },
  costMonthly:     { quotaType: 'cost_monthly',      period: 'monthly' },
};

/**
 * Create default quotas for a tenant from a config object.
 * Only creates quotas that do not already exist.
 * @param {import('mongoose').Types.ObjectId} tenantId
 * @param {Record<string, number>} limits  e.g. { tokensMonthly: 1000000, requestsDaily: 1000 }
 */
export async function createDefaultQuotas(tenantId, limits = {}) {
  const existing = await Quota.find({ tenantId }).lean();
  const existingTypes = new Set(existing.map((q) => q.quotaType));
  const now = new Date();

  const docs = [];
  for (const [key, limitValue] of Object.entries(limits)) {
    const cfg = CONFIG_MAP[key];
    if (!cfg || existingTypes.has(cfg.quotaType)) continue;

    const resetAt = new Date(now);
    if (cfg.period === 'daily') {
      resetAt.setDate(resetAt.getDate() + 1);
    } else {
      resetAt.setDate(resetAt.getDate() + 30);
    }

    docs.push({
      tenantId,
      quotaType: cfg.quotaType,
      limit: limitValue,
      period: cfg.period,
      resetAt,
    });
  }

  if (docs.length) await Quota.insertMany(docs);
}
