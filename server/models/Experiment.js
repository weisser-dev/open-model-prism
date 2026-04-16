import mongoose from 'mongoose';

const metricSchema = new mongoose.Schema({
  variantName:      { type: String },
  requests:         { type: Number, default: 0 },
  totalInputTokens: { type: Number, default: 0 },
  totalOutputTokens:{ type: Number, default: 0 },
  totalCostUsd:     { type: Number, default: 0 },
  errorCount:       { type: Number, default: 0 },
  totalQualityScore:{ type: Number, default: 0 },
  qualityCount:     { type: Number, default: 0 },
  totalLatencyMs:   { type: Number, default: 0 },
}, { _id: false });

const variantSchema = new mongoose.Schema({
  name:       { type: String, required: true },
  model:      { type: String, required: true },
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider' },
  weight:     { type: Number, default: 50 },
}, { _id: false });

const experimentSchema = new mongoose.Schema({
  name:             { type: String, required: true },
  tenantId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  description:      { type: String },
  status:           { type: String, enum: ['draft', 'active', 'paused', 'completed'], default: 'draft' },
  variants:         [variantSchema],
  targetCategories: [{ type: String }],
  startDate:        { type: Date },
  endDate:          { type: Date },
  minSampleSize:    { type: Number, default: 100 },
  metrics:          [metricSchema],
}, { timestamps: true });

export default mongoose.model('Experiment', experimentSchema);
