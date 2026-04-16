import mongoose from 'mongoose';

const chatConfigSchema = new mongoose.Schema({
  singleton:     { type: String, default: 'default', unique: true },
  // Master toggle — when false, chat is completely disabled
  enabled:       { type: Boolean, default: false },
  // Visibility: 'admin' (logged-in only), 'public' (anyone), 'token' (one-time token required)
  visibility:    { type: String, enum: ['admin', 'public', 'token'], default: 'admin' },
  // Which models are available in the chat dropdown (empty = all)
  allowedModels: [{ type: String }],
  // Default model for new chat sessions
  defaultModel:  { type: String, default: 'auto' },
  // Optional system prompt injected into every chat
  systemPrompt:  { type: String, default: '' },
  // One-time access tokens (for 'token' visibility mode)
  accessTokens: [{
    token:     { type: String, required: true, index: true },
    label:     { type: String },  // e.g. "demo-user-1"
    expiresAt: { type: Date },
    used:      { type: Boolean, default: false },
    _id: false,
  }],
  // Rate limit for public/token access
  rateLimit: {
    requestsPerMinute: { type: Number, default: 10 },
    maxTokensPerRequest: { type: Number, default: 4000 },
  },
}, { timestamps: true });

export default mongoose.model('ChatConfig', chatConfigSchema);
