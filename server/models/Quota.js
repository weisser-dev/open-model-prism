import mongoose from 'mongoose';

const quotaSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  quotaType: {
    type: String,
    enum: ['tokens_monthly', 'requests_daily', 'requests_monthly', 'cost_monthly'],
    required: true,
  },
  limit: { type: Number, required: true },
  currentUsage: { type: Number, default: 0 },
  enforcement: {
    type: String,
    enum: ['hard_block', 'soft_warning', 'auto_economy'],
    default: 'hard_block',
  },
  period: { type: String, enum: ['daily', 'monthly'], default: 'monthly' },
  resetAt: { type: Date },
  lastResetAt: { type: Date },
  enabled: { type: Boolean, default: true },
}, { timestamps: true });

quotaSchema.index({ tenantId: 1, quotaType: 1 }, { unique: true });

export default mongoose.model('Quota', quotaSchema);
