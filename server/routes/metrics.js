import { Router } from 'express';
import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

const router = Router();

// Collect default Node.js metrics (CPU, memory, event loop lag, etc.)
collectDefaultMetrics({ register });

// ── Custom metrics ────────────────────────────────────────────────────────────

export const httpRequestsTotal = new Counter({
  name: 'omp_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

export const httpRequestDuration = new Histogram({
  name: 'omp_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const gatewayRequestsTotal = new Counter({
  name: 'omp_gateway_requests_total',
  help: 'Total gateway (tenant) requests',
  labelNames: ['tenant', 'model', 'status'],
  registers: [register],
});

export const gatewayTokensTotal = new Counter({
  name: 'omp_gateway_tokens_total',
  help: 'Total tokens processed by gateway',
  labelNames: ['tenant', 'type'],
  registers: [register],
});

export const gatewayCostUsd = new Counter({
  name: 'omp_gateway_cost_usd_total',
  help: 'Total cost in USD charged across all tenants',
  labelNames: ['tenant'],
  registers: [register],
});

export const activeProviders = new Gauge({
  name: 'omp_providers_active',
  help: 'Number of providers with status=connected',
  registers: [register],
});

// ── Metrics endpoint ──────────────────────────────────────────────────────────
router.get('/', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

export default router;
