import mongoose from 'mongoose';

const webhookLogSchema = new mongoose.Schema({
  webhookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Webhook', required: true, index: true },
  event: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed },
  statusCode: { type: Number },
  responseTimeMs: { type: Number },
  attempt: { type: Number, default: 1 },
  success: { type: Boolean, default: false },
  errorMessage: { type: String },
  timestamp: { type: Date, default: Date.now },
});

webhookLogSchema.index({ webhookId: 1, timestamp: -1 });
webhookLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 2592000 });

export default mongoose.model('WebhookLog', webhookLogSchema);
