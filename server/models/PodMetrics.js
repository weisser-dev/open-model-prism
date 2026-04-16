import mongoose from 'mongoose';

const podMetricsSchema = new mongoose.Schema({
  podId:       { type: String, required: true, index: true },
  role:        { type: String, enum: ['full', 'control', 'worker'], default: 'full' },
  version:     { type: String },   // package.json version
  hostname:    { type: String },
  pid:         { type: Number },
  startedAt:   { type: Date },
  updatedAt:   { type: Date, default: Date.now },

  // Resource usage
  heapUsedMb:  { type: Number },
  heapTotalMb: { type: Number },
  rssMb:       { type: Number },
  cpuUser:     { type: Number },   // CPU user time delta (ms)
  cpuSystem:   { type: Number },   // CPU system time delta (ms)
  eventLoopLagMs: { type: Number },

  // Request counters (since last heartbeat interval)
  reqPerMin:     { type: Number, default: 0 },
  blockedPerMin: { type: Number, default: 0 },
  errorsPerMin:  { type: Number, default: 0 },

  // Gateway state
  activeConnections: { type: Number, default: 0 },
  uptimeSeconds:     { type: Number },
});

// TTL: auto-expire documents after 90 seconds (3 × heartbeat interval).
// If a pod stops sending heartbeats it disappears from the dashboard automatically.
podMetricsSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 90 });

export default mongoose.model('PodMetrics', podMetricsSchema);
