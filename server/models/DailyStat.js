import mongoose from 'mongoose';

const dailyStatSchema = new mongoose.Schema({
  date: { type: String, required: true }, // YYYY-MM-DD
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  routedModel: { type: String, required: true },
  requests: { type: Number, default: 0 },
  inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  actualCostUsd: { type: Number, default: 0 },
  baselineCostUsd: { type: Number, default: 0 },
  savedUsd: { type: Number, default: 0 },
  // v1.10.20 — dashboard acceleration fields
  autoRoutedCount: { type: Number, default: 0 },
  routingCostUsd: { type: Number, default: 0 },
  errorCount: { type: Number, default: 0 },
  durationMsTotal: { type: Number, default: 0 },   // sum of all durationMs values
  durationMsCount: { type: Number, default: 0 },   // count of requests with durationMs (for avg calc)
});

dailyStatSchema.index({ date: 1, tenantId: 1, routedModel: 1 }, { unique: true });

// ── Category breakdown (pre-aggregated for /categories endpoint) ──────────
const dailyCategoryStatSchema = new mongoose.Schema({
  date: { type: String, required: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  category: { type: String, required: true },
  costTier: { type: String },
  requests: { type: Number, default: 0 },
  actualCostUsd: { type: Number, default: 0 },
});

dailyCategoryStatSchema.index({ date: 1, tenantId: 1, category: 1, costTier: 1 }, { unique: true });

export const DailyCategoryStat = mongoose.model('DailyCategoryStat', dailyCategoryStatSchema);
export default mongoose.model('DailyStat', dailyStatSchema);
