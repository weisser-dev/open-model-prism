import mongoose from 'mongoose';

const requestLogSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  timestamp: { type: Date, default: Date.now, index: true },
  sessionId: { type: String, index: true },
  userName: { type: String, index: true },
  requestedModel: { type: String, default: 'unknown' },
  routedModel: { type: String, default: 'none', index: true },
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider' },
  category: { type: String, index: true },
  taskType: { type: String },
  complexity: { type: String },
  costTier: { type: String, index: true },
  confidence: { type: Number },
  inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  actualCostUsd: { type: Number, default: 0 },
  baselineCostUsd: { type: Number, default: 0 },
  savedUsd: { type: Number, default: 0 },
  routingCostUsd: { type: Number, default: 0 }, // classifier model cost (0 when pre-routed)
  isAutoRouted: { type: Boolean, default: false },
  routingMs: { type: Number },
  overrideApplied: { type: String },
  domain: { type: String },
  language: { type: String },
  streaming: { type: Boolean },
  status: { type: String, enum: ['success', 'error'], default: 'success', index: true },
  errorMessage: { type: String },
  errorType: { type: String, index: true }, // context_length_exceeded, max_tokens_exceeded, provider_error, etc.
  errorCategory: { type: String, enum: ['fixed', 'provider', 'proxy', 'unknown', null], default: null, index: true },
  errorFixedIn: { type: String },          // e.g. "v1.10.12" — which version fixed this error
  errorDescription: { type: String },      // human-readable short description
  resolvedAt: { type: Date },              // when this error was marked as resolved
  resolvedBy: { type: String },            // username who resolved it
  durationMs: { type: Number },
  // Fallback tracking — set when an error was caught and recovered automatically
  contextFallback:  { type: Boolean, default: false },
  originalModel:    { type: String },
  handledFallback:  { type: Boolean, default: false, index: true },
  fallbackType:     { type: String, enum: ['context_overflow', 'field_mismatch', 'provider_chain', 'truncation', 'model_level', null], default: null },
  fallbackDetail:   { type: String },   // human-readable: "context overflow on X → upgraded to Y (tier: high)"
  // Context window of the model that served this request (for fill % calculation)
  contextWindowUsed: { type: Number },
  // Anonymized client IP hash (SHA-256) — for unique user counting
  clientIpHash: { type: String, index: true },
  // Whether request came through a reverse proxy (X-Forwarded-For present)
  viaProxy: { type: Boolean },
  // Short hash of the system prompt — used to visually group requests from the same agent
  systemPromptHash: { type: String, index: true },
  // Prompt snapshot (populated when LogConfig.promptLogging = true)
  promptSnapshot: {
    systemPrompt:    { type: String },  // first system message, truncated to 2000 chars
    lastUserMessage: { type: String },  // last user message, truncated to 4000 chars
    messageCount:    { type: Number },
    // Full message array stored only when promptLogLevel = 'full'
    messages: [{
      role:    { type: String },
      content: { type: String }, // truncated to 8000 chars per message
    }],
  },
  // File paths extracted from prompt (populated when LogConfig.pathCapture.enabled = true)
  capturedPaths: [{ type: String }],
  // Response snapshot (populated when LogConfig.promptLogging = true)
  responseSnapshot: {
    content:       { type: String },  // assistant response text, truncated to 4000 chars
    finishReason:  { type: String },  // stop, length, etc.
  },
  // Quality scoring (populated post-response when responseSnapshot exists)
  qualityScore: { type: Number },  // 0-100
  qualityBreakdown: {
    completeness:     { type: Number },
    lengthAdequacy:   { type: Number },
    noRefusal:        { type: Number },
    noErrors:         { type: Number },
    languageMatch:    { type: Number },
    formatCompliance: { type: Number },
  },
  // A/B experiment tracking
  experimentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Experiment', index: true },
  experimentVariant: { type: String },
  // Routing signals snapshot (populated when auto-routing is used)
  routingSignals: {
    totalTokens:       { type: Number },
    hasImages:         { type: Boolean },
    hasToolCalls:      { type: Boolean },
    conversationTurns: { type: Number },
    detectedDomains:   [{ type: String }],
    detectedLanguages: [{ type: String }],
    preRouted:         { type: Boolean }, // true = signal extractor bypassed classifier
    isFimRequest:      { type: Boolean }, // true = FIM/autocomplete detected
    isToolAgentRequest:  { type: Boolean }, // true = tool-agent system prompt detected
    isToolOutputContinuation: { type: Boolean }, // true = last user msg is tool result, not human prompt
    prevSessionFillPct:  { type: Number },  // fill % of previous request in same session (0-1)
    signalSource:      { type: String },  // e.g. 'keyword_rule:Security Escalation'
  },
});

requestLogSchema.index({ tenantId: 1, timestamp: -1 });
// Compound indexes for common filter combinations (dashboard /requests endpoint)
requestLogSchema.index({ status: 1, timestamp: -1 });
requestLogSchema.index({ errorCategory: 1, timestamp: -1 });
requestLogSchema.index({ tenantId: 1, status: 1, timestamp: -1 });
requestLogSchema.index({ category: 1, timestamp: -1 });
// Compound index for dashboard uniqueUsers aggregation (clientIpHash + viaProxy + tenantId + timestamp)
requestLogSchema.index({ tenantId: 1, timestamp: -1, clientIpHash: 1, viaProxy: 1 }, { sparse: true });
// Sparse index for prompt retention cleanup — only covers docs that still have prompt data
requestLogSchema.index({ 'promptSnapshot.lastUserMessage': 1, timestamp: -1 }, { sparse: true });

export default mongoose.model('RequestLog', requestLogSchema);
