import mongoose from 'mongoose';

const systemConfigSchema = new mongoose.Schema({
  key:   { type: String, required: true, unique: true, index: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true });

export default mongoose.model('SystemConfig', systemConfigSchema);
