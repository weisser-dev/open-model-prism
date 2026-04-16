import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import config from './config.js';
import { connectDB } from './db.js';
import logger from './utils/logger.js';
import { incBlocked } from './utils/requestCounters.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const { nodeRole } = config;
const isControl = nodeRole === 'control' || nodeRole === 'full';
const isWorker  = nodeRole === 'worker'  || nodeRole === 'full';

logger.info(`[boot] Starting Open Model Prism in role: ${nodeRole}`);

const app = express();

// ── Security & parsing ────────────────────────────────────────────────────────
// Trust the first proxy hop (X-Forwarded-For) — typical for k8s ingress / reverse proxy.
// Using 1 instead of true avoids express-rate-limit ERR_ERL_PERMISSIVE_TRUST_PROXY.
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: config.corsOrigins === '*' ? true : config.corsOrigins.split(',').map(s => s.trim()),
  credentials: true,
}));
app.use(express.json({ limit: '4mb' }));
app.use(logger.requestMiddleware());

// ── Shared blocked-request counter ───────────────────────────────────────────
function blockedHandler(_req, res) {
  incBlocked();
  res.status(429).json({ error: 'Too many requests, please slow down.' });
}

// ── Rate limiters ─────────────────────────────────────────────────────────────
const adminLimiter = rateLimit({
  windowMs: 60_000, max: 300,
  standardHeaders: 'draft-7', legacyHeaders: false,
  handler: blockedHandler,
});

const authLimiter = rateLimit({
  windowMs: 60_000, max: 20,
  standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (req, res) => { incBlocked(); res.status(429).json({ error: 'Too many login attempts, please try again later.' }); },
});

const gatewayLimiter = rateLimit({
  windowMs: 60_000, max: 600,
  standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (req, res) => { incBlocked(); res.status(429).json({ error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } }); },
});

// ── Always-available endpoints ────────────────────────────────────────────────
const metricsRouter = (await import('./routes/metrics.js')).default;
app.use('/metrics', metricsRouter);

app.get('/health', async (_req, res) => {
  const mongoose = (await import('mongoose')).default;
  const dbReady  = mongoose.connection.readyState === 1;
  res.status(dbReady ? 200 : 503).json({
    status:    dbReady ? 'ok' : 'db_not_ready',
    role:      nodeRole,
    timestamp: new Date().toISOString(),
  });
});

// ── Control-plane routes (admin UI + admin API) ───────────────────────────────
if (isControl) {
  const { adminAuth }           = await import('./middleware/auth.js');
  const { adminOrMaint, canReadConfig, canViewCosts, anyUser } = await import('./middleware/rbac.js');

  const setupRoutes        = (await import('./routes/setup.js')).default;
  const authRoutes         = (await import('./routes/auth.js')).default;
  const adminProviderRoutes= (await import('./routes/admin/providers.js')).default;
  const adminTenantRoutes  = (await import('./routes/admin/tenants.js')).default;
  const adminCategoryRoutes= (await import('./routes/admin/categories.js')).default;
  const adminDashboardRoutes=(await import('./routes/admin/dashboard.js')).default;
  const adminUserRoutes    = (await import('./routes/admin/users.js')).default;
  const adminLdapRoutes    = (await import('./routes/admin/ldap.js')).default;
  const adminTokenizeRoutes= (await import('./routes/admin/tokenize.js')).default;
  const adminRoutingRoutes = (await import('./routes/admin/routing.js')).default;
  const adminSystemRoutes  = (await import('./routes/admin/system.js')).default;
const adminBenchmarkRoutes=(await import('./routes/admin/benchmarks.js')).default;
  const adminQuotaRoutes   = (await import('./routes/admin/quotas.js')).default;
  const adminExperimentRoutes=(await import('./routes/admin/experiments.js')).default;
  const adminWebhookRoutes = (await import('./routes/admin/webhooks.js')).default;
  const adminChatRoutes        = (await import('./routes/admin/chat.js')).default;
  const adminPromptEngineerRoutes = (await import('./routes/admin/prompt-engineer.js')).default;
  const adminAppearanceRoutes = (await import('./routes/admin/appearance.js')).default;
  const adminIdeConfigRoutes = (await import('./routes/admin/ideConfig.js')).default;
  const { publicRouter: publicIdeConfigRoutes } = await import('./routes/admin/ideConfig.js');
  const tenantPortalRoutes = (await import('./routes/tenant-portal.js')).default;

  app.use('/api/prism/setup',            setupRoutes);
  app.use('/api/prism/auth',             authLimiter, authRoutes);
  app.use('/api/prism/admin/providers',        adminLimiter, adminAuth, canReadConfig,  adminProviderRoutes);
  app.use('/api/prism/admin/tenants',          adminLimiter, adminAuth, canReadConfig,  adminTenantRoutes);
  app.use('/api/prism/admin/categories',       adminLimiter, adminAuth, canViewCosts,   adminCategoryRoutes);
  app.use('/api/prism/admin/dashboard',        adminLimiter, adminAuth, anyUser,        adminDashboardRoutes);
  app.use('/api/prism/admin/users',            adminLimiter, adminAuth, canReadConfig,  adminUserRoutes);
  app.use('/api/prism/admin/ldap',             adminLimiter, adminAuth,                 adminLdapRoutes);   // adminOnly per-route in ldap.js
  app.use('/api/prism/admin/tokenize',         adminLimiter, adminAuth, anyUser,        adminTokenizeRoutes);
  app.use('/api/prism/admin/routing',          adminLimiter, adminAuth, canViewCosts,   adminRoutingRoutes);
  app.use('/api/prism/admin/system',           adminLimiter, adminAuth, canViewCosts,   adminSystemRoutes);
app.use('/api/prism/admin/benchmarks',       adminLimiter, adminAuth, anyUser,        adminBenchmarkRoutes);
  app.use('/api/prism/admin/quotas',           adminLimiter, adminAuth, canViewCosts,   adminQuotaRoutes);
  app.use('/api/prism/admin/experiments',      adminLimiter, adminAuth, canReadConfig,  adminExperimentRoutes);
  app.use('/api/prism/admin/webhooks',         adminLimiter, adminAuth, canReadConfig,  adminWebhookRoutes);
  app.use('/api/prism/admin/chat',                                                      adminChatRoutes);   // handles own auth (admin + public)
  app.use('/api/prism/admin/prompt-engineer',  adminLimiter, adminAuth, canReadConfig,  adminPromptEngineerRoutes);
  app.use('/api/prism/admin/appearance',       adminLimiter, adminAuth,                 adminAppearanceRoutes); // adminOnly per-route for writes
  app.use('/api/prism/ide-config',             adminLimiter, adminAuth,                 adminIdeConfigRoutes);  // anyUser per-route
  app.use('/api/prism/public/ide-config',      adminLimiter,                              publicIdeConfigRoutes); // no auth
  app.use('/api/prism/tenant-portal',    adminLimiter, adminAuth,               tenantPortalRoutes);
}

// ── Worker routes (gateway) ───────────────────────────────────────────────────
// IMPORTANT: mounted BEFORE the control-plane static file server so that
// gateway paths (/api/v1/*, /v1/*, /api/:tenant/v1/*) are handled here and
// never fall through to the SPA catch-all.
if (isWorker) {
  // Shorthand rewrites → routes to the "api" default tenant via the gateway.
  // Supports two clean entry-points clients may use:
  //   /api/v1/*  — base URL is http://host/api   (most common)
  //   /v1/*      — base URL is http://host        (tools that don't add /api)
  // Both rewrite to /api/api/v1/* internally; the gateway sees /:tenant/v1/*
  // with tenant="api". Direct /api/api/* access is blocked in the gateway.
  app.use((req, _res, next) => {
    const p = req.path;
    if (p.startsWith('/api/v1/') || p === '/api/v1') {
      req.url = req.url.replace(/^\/api\/v1(\/|$)/, '/api/api/v1$1');
      req._shorthand = true;
    } else if (p.startsWith('/v1/') || p === '/v1') {
      const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      req.url = '/api/api/v1' + p.slice(3) + qs;
      req._shorthand = true;
    }
    next();
  });

  const gatewayRoutes = (await import('./routes/gateway/index.js')).default;
  app.use('/api', gatewayLimiter, gatewayRoutes);
}

// ── Control-plane: React frontend (after gateway so /api/v1/* never hits SPA catch-all)
if (isControl) {
  // Public IDE config generator page (no auth, standalone HTML)
  const { configPageHtml } = await import('./routes/public/configPage.js');
  app.get('/public/config', (req, res) => {
    const origin = `${req.protocol}://${req.get('host')}`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(configPageHtml(origin));
  });

  // Serve pre-built docs site at /docs (build with: cd docs-site && DOCS_BASE_PATH=/docs npm run build)
  const docsPublicDir = join(__dirname, '../docs-site/dist');
  try {
    const { existsSync } = await import('fs');
    if (existsSync(docsPublicDir)) {
      app.use('/docs', express.static(docsPublicDir));
      // SPA-style fallback for docs sub-pages (Astro static output)
      app.get('/docs/*', (_req, res) => {
        res.sendFile(join(docsPublicDir, 'index.html'));
      });
    }
  } catch { /* docs not built yet — skip */ }

  const publicDir = join(__dirname, 'public');
  app.use(express.static(publicDir));
  app.get('{*path}', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
    res.sendFile(join(publicDir, 'index.html'));
  });
}

// Workers running in pure worker mode return 404 for any admin/frontend path
if (!isControl && isWorker) {
  app.use((req, res) => {
    if (!req.path.startsWith('/api')) {
      return res.status(404).send('Not available on worker pods. Access the control plane for the admin UI.');
    }
    res.status(404).json({ error: 'Not found' });
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────
let server;

async function start() {
  await connectDB();


  server = app.listen(config.port, '0.0.0.0', () => {
    logger.info(`[${nodeRole}] Server running on port ${config.port}`);
  });

  // ── Control-plane startup tasks ───────────────────────────────────────────
  if (isControl) {
    // Pre-warm model enrichment cache
    import('./services/modelEnrichmentService.js').then(m => m.warmCache()).catch(() => {});

    // Auto-seed built-in routing categories
    import('./utils/categorySeeds.js').then(async ({ seedCategories }) => {
      const result = await seedCategories();
      if (result.created > 0) logger.info(`[setup] Auto-seeded ${result.created} routing categories`);
    }).catch(() => {});

    // Auto-seed default tenant
    import('./utils/defaultTenantSeed.js').then(({ seedDefaultTenant }) => {
      seedDefaultTenant().catch(err => logger.warn('[seed] defaultTenantSeed failed', { error: err.message }));
    }).catch(err => logger.warn('[seed] seed failed', { error: err.message }));

    // Load log config from DB and apply — but respect explicit LOG_LEVEL env var
    import('./models/LogConfig.js').then(async ({ default: LogConfig }) => {
      const cfg = await LogConfig.findOne({ singleton: 'default' });
      if (cfg?.logLevel && !process.env.LOG_LEVEL) logger.setLevel(cfg.logLevel);
    }).catch(() => {});

    // Periodic quota reset (every 5 minutes)
    import('./services/quotaService.js').then(({ resetExpiredQuotas }) => {
      setInterval(() => resetExpiredQuotas().catch(() => {}), 300_000).unref();
      resetExpiredQuotas().catch(() => {}); // run once at startup
    }).catch(() => {});

    // Prompt retention — periodically strip old prompt data
    import('./services/retentionService.js').then(({ startRetentionService }) => {
      startRetentionService();
    }).catch(() => {});


    // Cross-pod cache invalidation (Change Streams + polling fallback)
    import('./services/cacheInvalidation.js').then(async ({ startCacheInvalidation, onCollectionChange }) => {
      const { invalidateRuleSetCache } = await import('./services/routerEngine.js');
      onCollectionChange('routingrulesets',   invalidateRuleSetCache);
      onCollectionChange('routingcategories', invalidateRuleSetCache);
      await startCacheInvalidation();
    }).catch(err => logger.warn('[cache-invalidation] failed to start', { error: err.message }));

    // Prompt Analyzer auto-analysis (hourly, opt-in)
    import('./routes/admin/prompt-engineer.js').then(m => m.startAutoAnalyzeScheduler()).catch(() => {});
  }

  // ── All roles: pod heartbeat ──────────────────────────────────────────────
  import('./services/podHeartbeat.js').then(m => m.startHeartbeat()).catch(() => {});

  // ── Worker startup tasks ──────────────────────────────────────────────────
  if (isWorker && nodeRole === 'worker') {
    // Workers also need cache invalidation for routing rule sets
    import('./services/cacheInvalidation.js').then(async ({ startCacheInvalidation, onCollectionChange }) => {
      const { invalidateRuleSetCache } = await import('./services/routerEngine.js');
      onCollectionChange('routingrulesets',   invalidateRuleSetCache);
      onCollectionChange('routingcategories', invalidateRuleSetCache);
      await startCacheInvalidation();
    }).catch(err => logger.warn('[cache-invalidation] failed to start', { error: err.message }));
  }
}

async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully…`);
  import('./services/podHeartbeat.js').then(m => m.stopHeartbeat()).catch(() => {});
  server?.close(async () => {
    logger.info('HTTP server closed');
    const mongoose = (await import('mongoose')).default;
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
    process.exit(0);
  });
  setTimeout(() => { logger.warn('Forced exit after timeout'); process.exit(1); }, 15_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

start().catch(err => {
  logger.error('Failed to start', { error: err.message });
  process.exit(1);
});

export default app;
