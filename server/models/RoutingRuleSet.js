import mongoose from 'mongoose';

const keywordRuleSchema = new mongoose.Schema({
  name:       { type: String, required: true },
  enabled:    { type: Boolean, default: true },
  keywords:   [{ type: String }],
  match:      { type: String, enum: ['any', 'all'], default: 'any' },
  minMatches: { type: Number, default: 1 },
  searchIn:   { type: String, enum: ['all', 'user', 'system'], default: 'all' },
  effect: {
    category: { type: String, default: '' },
    tierMin:  { type: String, enum: ['', 'micro', 'minimal', 'low', 'medium', 'advanced', 'high', 'ultra', 'critical'], default: '' },
    tierMax:  { type: String, enum: ['', 'micro', 'minimal', 'low', 'medium', 'advanced', 'high', 'ultra', 'critical'], default: '' },
    domain:   { type: String, default: '' },
  },
}, { _id: true });

const systemPromptRoleSchema = new mongoose.Schema({
  name:    { type: String, required: true },
  enabled: { type: Boolean, default: true },
  pattern: { type: String, required: true }, // regex string, case-insensitive
  effect: {
    category: { type: String, default: '' },
    tierMin:  { type: String, enum: ['', 'micro', 'minimal', 'low', 'medium', 'advanced', 'high', 'ultra', 'critical'], default: '' },
    domain:   { type: String, default: '' },
  },
}, { _id: true });

const routingRuleSetSchema = new mongoose.Schema({
  name:            { type: String, required: true },
  description:     { type: String, default: '' },
  isGlobalDefault: { type: Boolean, default: false },
  tenantId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', default: null },

  tokenThresholds: {
    micro:      { type: Number, default: 150 },   // below this → micro (trivial completions)
    minimal:    { type: Number, default: 500 },
    low:        { type: Number, default: 2000 },
    medium:     { type: Number, default: 15000 },
    alwaysHigh: { type: Number, default: 50000 }, // above this → always high, skip classifier
  },

  signalWeights: {
    tokenCount:        { type: Number, default: 0.8, min: 0, max: 1 },
    systemPromptRole:  { type: Number, default: 0.9, min: 0, max: 1 },
    contentKeywords:   { type: Number, default: 0.85, min: 0, max: 1 },
    codeLanguage:      { type: Number, default: 0.7, min: 0, max: 1 },
    conversationTurns: { type: Number, default: 0.4, min: 0, max: 1 },
  },

  turnUpgrade: {
    enabled:   { type: Boolean, default: true },
    threshold: { type: Number, default: 4 },
  },

  keywordRules:      [keywordRuleSchema],
  systemPromptRoles: [systemPromptRoleSchema],

  classifier: {
    confidenceThreshold: { type: Number, default: 0.65 },
    contextLimitTokens:  { type: Number, default: 4000 },
    contextStrategy:     { type: String, enum: ['metadata_only', 'truncate', 'summary'], default: 'truncate' },
  },
  // Cost optimization mode — adjusts tier selection after routing:
  //   balanced (default): no adjustment
  //   economy:  high→medium, medium→low  (save cost, accept lower quality)
  //   quality:  low→medium, medium→high  (spend more, maximize quality)
  costMode: { type: String, enum: ['balanced', 'economy', 'quality'], default: 'balanced' },
  // Explicit tier offset applied AFTER costMode: -2 .. +2 (stacks with costMode's ±1)
  tierBoost: { type: Number, min: -2, max: 2, default: 0 },
  isDefault: { type: Boolean, default: false }, // protected system rule set — cannot be deleted
}, { timestamps: true });

// Only one global default allowed
routingRuleSetSchema.index({ isGlobalDefault: 1 });

export default mongoose.model('RoutingRuleSet', routingRuleSetSchema);
