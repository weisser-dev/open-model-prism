import mongoose from 'mongoose';

const webhookSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
  name: { type: String, required: true },
  url: { type: String, required: true },
  secret: { type: String, required: true },
  events: {
    type: [String],
    required: true,
    enum: [
      'budget_threshold',
      'budget_exceeded',
      'error_spike',
      'provider_down',
      'quota_exhausted',
      'quota_warning',
      'experiment_completed',
    ],
  },
  enabled: { type: Boolean, default: true },
  retryPolicy: {
    maxRetries: { type: Number, default: 3 },
    backoffMs: { type: Number, default: 1000 },
  },
  headers: { type: Map, of: String },
}, { timestamps: true });

webhookSchema.index({ tenantId: 1, enabled: 1 });

export default mongoose.model('Webhook', webhookSchema);
