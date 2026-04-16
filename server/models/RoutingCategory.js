import mongoose from 'mongoose';

const routingCategorySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  description: { type: String },
  costTier: { type: String, enum: ['micro', 'minimal', 'low', 'medium', 'advanced', 'high', 'ultra', 'critical'], required: true },
  examples: [{ type: String }],
  defaultModel: { type: String },
  fallbackModel: { type: String },
  requiresVision: { type: Boolean, default: false },
  // v2.1.1: optional system-prompt injection for the TARGET model.
  // When set, this text is appended to the forwarded request's system
  // message whenever the router classifies a request into this category.
  // This lets the router prime the target model for the specific task
  // type — e.g. "You are an expert software engineer …" for coding
  // categories, or "You are a careful legal analyst …" for legal analysis.
  // Empty string = no injection.
  targetSystemPrompt: { type: String, default: '' },
  isBuiltIn: { type: Boolean, default: false },
  order: { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model('RoutingCategory', routingCategorySchema);
