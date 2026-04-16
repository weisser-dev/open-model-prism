import mongoose from 'mongoose';

const setupSchema = new mongoose.Schema({
  completed: { type: Boolean, default: false },
  adminUser: { type: String },
  completedAt: { type: Date },
}, { timestamps: true });

export default mongoose.model('Setup', setupSchema);
