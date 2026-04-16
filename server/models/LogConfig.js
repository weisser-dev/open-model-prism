import mongoose from 'mongoose';

/**
 * Singleton log configuration document — there is at most one.
 * Fetched at startup and when the admin updates settings.
 */
const logConfigSchema = new mongoose.Schema({
  singleton: { type: String, default: 'default', unique: true },

  logLevel: {
    type: String,
    enum: ['debug', 'info', 'warn', 'error'],
    default: 'info',
  },

  // Whether to store prompt content in RequestLog documents
  promptLogging: { type: Boolean, default: false },

  // How much of the prompt to capture:
  //   last_user — only the last user message (default, lower storage overhead)
  //   full       — all messages including system prompt
  promptLogLevel: { type: String, enum: ['last_user', 'full'], default: 'last_user' },

  // Whether to show routing decisions in response headers / enriched payload
  routingDecisionLogging: { type: Boolean, default: true },

  // Track unique users by anonymized IP hash (SHA-256) — shown on Dashboard
  trackUsersByIp: { type: Boolean, default: true },

  // Path capture — extract filesystem paths from prompts for repo usage analytics
  pathCapture: {
    enabled: { type: Boolean, default: false },
  },

  // Prompt retention — auto-strip prompt/response content after N hours to save storage
  // Set promptRetentionEnabled=true and configure hours (default 48h, 0 = keep forever)
  promptRetentionEnabled: { type: Boolean, default: true },
  promptRetentionHours:   { type: Number, default: 48, min: 1, max: 8760 }, // max 1 year

  // File logging — write JSONL entries per request to disk (for offline analysis)
  fileLogging: {
    enabled:    { type: Boolean, default: false },
    directory:  { type: String, default: '/var/log/open-model-prism' },
    maxSizeMb:  { type: Number, default: 100 },
    maxFiles:   { type: Number, default: 7 },
    // If true, include full message content in JSONL (requires promptLogging=true to also store in DB)
    includePrompts: { type: Boolean, default: false },
  },

  updatedBy: { type: String },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model('LogConfig', logConfigSchema);
