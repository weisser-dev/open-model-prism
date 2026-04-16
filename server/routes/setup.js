import { Router } from 'express';
import Setup from '../models/Setup.js';
import User from '../models/User.js';
import { invalidateSetupCache, isSetupComplete } from '../middleware/setupCheck.js';
import config from '../config.js';

const router = Router();

// Check if setup is needed
router.get('/status', async (_req, res) => {
  const complete = await isSetupComplete();
  res.json({ setupComplete: complete });
});

// Step 1: Create admin account
router.post('/admin', async (req, res) => {
  const complete = await isSetupComplete();
  if (complete) {
    return res.status(400).json({ error: 'Setup already completed' });
  }

  const { username, password } = req.body;
  if (!username || !password || password.length < 8) {
    return res.status(400).json({ error: 'Username and password (min 8 chars) required' });
  }

  const existing = await User.findOne({ username: username.toLowerCase() });
  if (existing) {
    return res.status(400).json({ error: 'Admin already exists' });
  }

  const passwordHash = await User.hashPassword(password);
  await User.create({ username: username.toLowerCase(), passwordHash, role: 'admin', source: 'local' });

  res.json({ success: true, message: 'Admin account created' });
});

/**
 * DEV ONLY: Return prefill values from environment variables.
 * Set DEV_ADMIN_USERNAME, DEV_ADMIN_PASSWORD, DEV_PROVIDER_* in .env.
 * Returns 404 in production to avoid leaking secrets.
 */
router.get('/dev-defaults', (_req, res) => {
  if (config.nodeEnv === 'production') {
    return res.status(404).json({ error: 'Not available in production' });
  }

  // Only return values that are actually set (don't return empty strings)
  const val = (key) => process.env[key] || null;

  res.json({
    admin: {
      username: val('DEV_ADMIN_USERNAME'),
      password: val('DEV_ADMIN_PASSWORD'),
    },
    provider: {
      name:    val('DEV_PROVIDER_NAME'),
      type:    val('DEV_PROVIDER_TYPE'),
      baseUrl: val('DEV_PROVIDER_URL'),
      apiKey:  val('DEV_PROVIDER_KEY'),
    },
  });
});

// Step 2: Complete setup
router.post('/complete', async (req, res) => {
  const admin = await User.findOne({ role: 'admin' });
  if (!admin) {
    return res.status(400).json({ error: 'Create admin account first' });
  }

  await Setup.findOneAndUpdate(
    {},
    { completed: true, adminUser: admin.username, completedAt: new Date() },
    { upsert: true },
  );

  invalidateSetupCache();
  res.json({ success: true, message: 'Setup completed' });
});

export default router;
