import mongoose from 'mongoose';
import { slugify } from '../utils/slugify.js';

const discoveredModelSchema = new mongoose.Schema({
  id:           { type: String, required: true },
  name:         { type: String },
  capabilities: [{ type: String }],
  contextWindow:   { type: Number },
  maxOutputTokens: { type: Number },
  ownedBy:      { type: String },
  // Model Registry metadata (set manually by admin)
  tier:         { type: String, enum: ['critical', 'ultra', 'high', 'advanced', 'medium', 'low', 'minimal', 'micro', null], default: null },
  categories:   [{ type: String }], // routing category slugs this model handles well
  priority:     { type: Number, default: 50, min: 1, max: 100 }, // higher = preferred within tier
  notes:        { type: String, default: '' },
  inputPer1M:   { type: Number, default: null }, // USD per 1M input tokens
  outputPer1M:  { type: Number, default: null }, // USD per 1M output tokens
  manualPricing: { type: Boolean, default: false }, // true = admin set pricing, skip auto-update
  manualContext: { type: Boolean, default: false }, // true = admin set context/maxOutput, skip auto-update
  visible:      { type: Boolean, default: true }, // false = hidden from all tenant model lists
}, { _id: false });

const providerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true, match: /^[a-z0-9][a-z0-9-]*$/ },
  type: {
    type: String,
    required: true,
    enum: ['openai', 'ollama', 'vllm', 'bedrock', 'bedrock-proxy', 'azure', 'azure-proxy', 'openrouter', 'custom'],
  },
  config: {
    baseUrl: { type: String },
    auth: {
      type: { type: String, enum: ['api_key', 'bearer', 'aws_credentials', 'none'], default: 'api_key' },
      apiKey: { type: String },
      accessKeyId: { type: String },
      secretAccessKey: { type: String },
      region: { type: String },
    },
    options: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  status: { type: String, enum: ['connected', 'error', 'unchecked'], default: 'unchecked' },
  statusMessage: { type: String },
  lastChecked: { type: Date },
  discoveredModels: [discoveredModelSchema],
}, { timestamps: true });

// Generate a unique slug from a name, appending -2, -3, etc. if needed
providerSchema.statics.generateUniqueSlug = async function (name) {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;
  while (await this.findOne({ slug: candidate })) {
    candidate = `${base}-${suffix++}`;
  }
  return candidate;
};

export default mongoose.model('Provider', providerSchema);
