import mongoose from 'mongoose';

const configChangeSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now, index: true },
  user:      { type: String, required: true },  // username
  action:    { type: String, enum: ['create', 'update', 'delete'], required: true },
  target:    { type: String, enum: ['rule-set', 'tenant', 'category', 'model'], required: true, index: true },
  targetId:  { type: mongoose.Schema.Types.ObjectId },
  targetName: { type: String },  // human-readable: "Default Rule Set", "Dev Team Alpha"
  summary:   { type: String },   // auto-generated: "costMode: balanced → quality"
  changes: [{
    field:  { type: String },    // dot-path: "routing.overrides.toolCallUpgrade"
    before: { type: mongoose.Schema.Types.Mixed },
    after:  { type: mongoose.Schema.Types.Mixed },
    _id: false,
  }],
});

// Auto-delete after 90 days
configChangeSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 86400 });

export default mongoose.model('ConfigChange', configChangeSchema);
