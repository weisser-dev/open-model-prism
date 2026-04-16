import mongoose from 'mongoose';

const tenantSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, match: /^[a-z0-9-]+$/ },
  name: { type: String, required: true },
  apiKeyHash: { type: String, unique: true, sparse: true, index: true },
  apiKeyPrefix: { type: String },    // first 12 chars for display
  apiKeyEncrypted: { type: String }, // AES-256-GCM encrypted full key (admin-only retrieval)
  providerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Provider' }],
  modelConfig: {
    mode: { type: String, enum: ['whitelist', 'blacklist', 'all'], default: 'all' },
    list: [{ type: String }],
    aliases: { type: Map, of: String, default: {} },
  },
  routing: {
    enabled: { type: Boolean, default: false },
    classifierModel: { type: String },
    classifierProvider: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider' },
    classifierFallbacks: [{
      model:    { type: String },
      provider: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider' },
    }],
    defaultModel: { type: String },
    baselineModel: { type: String },
    // Legacy boolean — kept only as read fallback for pre-2.1 tenants.
    // forceAutoRouteMode is the canonical field; `true` ≡ 'all', `false` ≡ 'off'.
    forceAutoRoute: { type: Boolean, default: false },
    // v2.1.0: 4-step strictness control for model override routing.
    //   off       — never force-route; user's model choice is always respected.
    //   fim_only  — force-route ONLY syntactic FIM / autocomplete requests to the
    //               cheapest coder model; all other requests keep the user's model.
    //   smart     — force-route via classifier, BUT if the user's selected model is
    //               a capable match for the classified category (e.g. any "coding_*"
    //               / "reasoning_*" / "system_design" category), keep the user's
    //               model even when the tier is higher than strictly necessary.
    //               Only re-routes when the category is clearly trivial
    //               (chat_title_generation, smalltalk_*, translation, …).
    //   all       — classic behaviour: always force-route to the router's choice.
    forceAutoRouteMode: {
      type: String,
      enum: ['off', 'fim_only', 'smart', 'all'],
      default: 'off',
    },
    overrides: {
      visionUpgrade: { type: Boolean, default: true },
      toolCallUpgrade: { type: Boolean, default: true },
      toolCallMinTier: { type: String, enum: ['low', 'medium', 'advanced', 'high', 'ultra'], default: 'medium' },
      confidenceFallback: { type: Boolean, default: true },
      confidenceThreshold: { type: Number, default: 0.4 },
      domainGate: { type: Boolean, default: true },
      conversationTurnUpgrade: { type: Boolean, default: false },
      frustrationUpgrade: { type: Boolean, default: true },
      outputLengthUpgrade: { type: Boolean, default: true },
    },
  },
  // Provider fallback chains — ordered list of providers to try on failure
  fallbackChains: [{
    modelPattern: { type: String, required: true }, // glob or exact model ID ('*' = default chain)
    providers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Provider' }], // ordered
    maxRetries: { type: Number, default: 2 },
    _id: false,
  }],
  // Model-level fallbacks — when a specific model fails, try alternative models (same or different provider)
  modelFallbacks: [{
    type:          { type: String, enum: ['specific', 'next-tier'], default: 'specific' },
    sourcePattern: { type: String, required: true }, // exact model ID or '*' for all
    fallbacks: [{
      model:      { type: String, required: true },
      providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', default: null },
      _id: false,
    }],
    _id: false,
  }],
  pricing: { type: Map, of: new mongoose.Schema({ input: Number, output: Number }, { _id: false }), default: {} },
  rateLimit: {
    requestsPerMinute: { type: Number, default: 0 },   // 0 = unlimited
    tokensPerMinute: { type: Number, default: 0 },     // 0 = unlimited
  },
  budgetLimits: {
    dailyUsd:   { type: Number, default: 0 },   // 0 = unlimited
    weeklyUsd:  { type: Number, default: 0 },
    monthlyUsd: { type: Number, default: 0 },
  },
  budgetGuard: {
    enabled:      { type: Boolean, default: false },
    thresholdPct: { type: Number, default: 80 },   // block high tiers when this % of any limit is reached
    blockTiers:   { type: [String], default: ['high', 'premium'] }, // model tiers to block at threshold
    guardCostMode: { type: String, default: 'economy', enum: ['economy', 'balanced'] }, // force cost mode when guard is active
  },
  active: { type: Boolean, default: true },
  isDefault: { type: Boolean, default: false }, // protected system tenant — cannot be deleted
  internal: { type: Boolean, default: false },  // system-managed tenant (e.g. built-in chat)

  // API key lifecycle (legacy single-key fields — still used for backward compat)
  keyEnabled: { type: Boolean, default: true },
  keyLifetimeDays: { type: Number, default: 0 }, // 0 = unlimited
  keyExpiresAt: { type: Date, default: null },    // set on key generation/rotation
  customApiKey: { type: Boolean, default: false }, // true = user supplied the key value
  stripThinking: { type: Boolean, default: true }, // strip extended thinking / reasoning from responses
  printRoutedModel: { type: Boolean, default: false }, // append "Model-Routing: <model> selected" to every response
  defaultSystemPrompt: { type: String, default: 'Always respond in the same language the user writes in, unless explicitly asked otherwise.' }, // injected into every non-FIM request; empty string = disabled

  // Multi-API-key support — multiple keys per tenant
  apiKeys: [{
    hash:      { type: String, required: true },
    prefix:    { type: String },
    encrypted: { type: String },
    label:     { type: String, default: '' },
    enabled:   { type: Boolean, default: true },
    custom:    { type: Boolean, default: false },
    expiresAt: { type: Date, default: null },
    lastUsedAt:{ type: Date },
    createdAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

export default mongoose.model('Tenant', tenantSchema);
