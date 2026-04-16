import DailyStat from '../models/DailyStat.js';

export async function checkBudget(tenant) {
  const limits = tenant.budgetLimits || {};
  const guard = tenant.budgetGuard || {};

  // No limits configured at all → fast path
  const hasAnyLimit = limits.dailyUsd > 0 || limits.weeklyUsd > 0 || limits.monthlyUsd > 0;
  if (!hasAnyLimit) return { blocked: false, guardActive: false, blockedTiers: [] };

  const tenantId = tenant._id;
  const now = new Date();

  // Helper: sum actualCostUsd for this tenant since `daysBack` days ago
  async function spendSince(daysBack) {
    const since = new Date(now);
    since.setDate(since.getDate() - daysBack);
    const sinceStr = since.toISOString().slice(0, 10);
    const [row] = await DailyStat.aggregate([
      { $match: { tenantId, date: { $gte: sinceStr } } },
      { $group: { _id: null, total: { $sum: '$actualCostUsd' } } },
    ]);
    return row?.total ?? 0;
  }

  // Fetch only what's needed
  const [dailySpend, weeklySpend, monthlySpend] = await Promise.all([
    limits.dailyUsd   > 0 ? spendSince(1)  : Promise.resolve(0),
    limits.weeklyUsd  > 0 ? spendSince(7)  : Promise.resolve(0),
    limits.monthlyUsd > 0 ? spendSince(30) : Promise.resolve(0),
  ]);

  // Check hard limits
  if (limits.dailyUsd   > 0 && dailySpend   >= limits.dailyUsd)   return { blocked: true, guardActive: false, blockedTiers: [] };
  if (limits.weeklyUsd  > 0 && weeklySpend  >= limits.weeklyUsd)  return { blocked: true, guardActive: false, blockedTiers: [] };
  if (limits.monthlyUsd > 0 && monthlySpend >= limits.monthlyUsd) return { blocked: true, guardActive: false, blockedTiers: [] };

  // Check guard threshold
  if (guard.enabled && guard.thresholdPct > 0) {
    const pct = guard.thresholdPct / 100;
    const guardTriggered =
      (limits.dailyUsd   > 0 && dailySpend   >= pct * limits.dailyUsd)   ||
      (limits.weeklyUsd  > 0 && weeklySpend  >= pct * limits.weeklyUsd)  ||
      (limits.monthlyUsd > 0 && monthlySpend >= pct * limits.monthlyUsd);
    if (guardTriggered) {
      return {
        blocked: false,
        guardActive: true,
        blockedTiers: guard.blockTiers || ['high', 'premium'],
        guardCostMode: guard.guardCostMode || 'economy',
      };
    }
  }

  return { blocked: false, guardActive: false, blockedTiers: [] };
}
