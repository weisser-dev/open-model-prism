import mongoose from 'mongoose';
import config from './config.js';

export async function connectDB() {
  try {
    await mongoose.connect(config.mongoUri);
    console.log('[db] Connected to MongoDB');
  } catch (err) {
    console.error('[db] MongoDB connection failed:', err.message);
    throw err;
  }

  mongoose.connection.on('error', (err) => {
    console.error('[db] MongoDB error:', err.message);
  });
}
