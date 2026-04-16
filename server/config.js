import 'dotenv/config';

/**
 * NODE_ROLE controls which parts of the application are started:
 *
 *   full     (default) — Admin API + Gateway + Frontend served as static files.
 *                        Use this for single-pod / dev deployments.
 *
 *   control  — Admin API + Frontend only. No gateway routes.
 *              Handles: setup wizard, auth, all /api/admin/*, tenant-portal, UI.
 *              Typically one or two stable instances behind a load balancer.
 *
 *   worker   — Gateway only (POST /api/:tenant/v1/*). No admin API, no frontend.
 *              Scales horizontally to handle LLM traffic. Registers itself in DB
 *              via pod heartbeat so the control plane can monitor it.
 */
const VALID_ROLES = ['full', 'control', 'worker'];
const rawRole = process.env.NODE_ROLE || 'full';

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/openmodelprism',
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  encryptionKey: process.env.ENCRYPTION_KEY || 'change-me-32-chars-encryption-k!',
  corsOrigins: process.env.CORS_ORIGINS || '*',
  logLevel: process.env.LOG_LEVEL || 'info',
  adminSecret: process.env.ADMIN_SECRET || '',
  // Offline mode: disables all outbound internet calls (models.dev, etc.)
  offline: process.env.OFFLINE === 'true' || process.env.OFFLINE === '1',
  // Node role: 'full' | 'control' | 'worker'
  nodeRole: VALID_ROLES.includes(rawRole) ? rawRole : 'full',
};

export default config;
