# Open Model Prism — Claude Code Context

## Project Overview
Multi-tenant OpenAI-API-compatible LLM gateway with intelligent routing, cost tracking, and admin UI.
Single Docker container (Node.js Express backend + React/Mantine frontend served as static files).

## Repo Structure
```
server/           Express backend (ESM, Node 20+)
  config.js       Env-var config (PORT, MONGODB_URI, JWT_SECRET, ENCRYPTION_KEY, OFFLINE, …)
  index.js        App entry: routes, middleware, rate limiters, graceful shutdown
  models/         Mongoose schemas (Tenant, Provider, User, RequestLog, DailyStat, …)
  routes/
    admin/        Admin REST API (providers, tenants, categories, dashboard, users, ldap, tokenize)
    gateway/      OpenAI-compat proxy (/api/:tenant/v1/…)
    auth.js       Login / JWT
    metrics.js    Prometheus /metrics endpoint
  middleware/
    auth.js       adminAuth — verifies JWT, populates req.user
    rbac.js       requireRole / adminOnly / adminOrMaint / canReadConfig / canViewCosts / anyUser
    setupCheck.js Redirects to /api/prism/setup if first-run not complete
  services/
    analyticsEngine.js  Async request logging (fire-and-forget)
    modelEnrichmentService.js  Live models.dev fetch + offline snapshot fallback
    pricingService.js   calcCost() — tenant override → pricingDefaults → modelRegistry
    routerEngine.js     LLM classifier → category → model selection
    tokenService.js     Offline token estimation, context overflow detection
  data/
    modelRegistry.js         60+ models: tier, pricing, categories, patterns
    modelsDev.snapshot.json  Bundled offline copy of models.dev data
  utils/
    encryption.js    AES-256-GCM (encrypt/decrypt)
    logger.js        Structured JSON logger (colored in dev)
    pricingDefaults.js  Flat pricing table with fuzzy match
    sanitize.js      Input sanitization helpers (NoSQL injection prevention)
  providers/       Provider adapters (OpenAI-compat, Bedrock, Azure, Ollama)

frontend/src/
  pages/           React pages (Providers, Tenants, Models, Dashboard, Users, …)
  hooks/useApi.js  Axios instance with JWT interceptor
```

## Key Patterns

### Authentication
- Admin UI: JWT in `Authorization: Bearer` header, signed with `JWT_SECRET`
- Gateway: Per-tenant API key (`omp-<hex>`), SHA-256 hashed in DB
- RBAC roles: `admin` > `maintainer` > `finops` > `auditor` > `tenant-maintainer` > `tenant-admin` > `tenant-viewer` > `chat-user`
- RBAC middleware (server/middleware/rbac.js):
  - `adminOnly`      — destructive ops, user management, license activation
  - `adminOrMaint`   — config writes (providers, tenants, routing, webhooks, experiments)
  - `canReadConfig`  — sensitive reads for auditor compliance (providers, tenants, users list, experiments, webhooks, prompt settings)
  - `canViewCosts`   — financial/analytics reads (costs, quotas, categories, routing rules, license info, system overview)
  - `anyUser`        — dashboard, request logs, tokenizer (tenant-scoped where applicable)
  - `canChat`        — chat endpoint access
- RBAC is applied at two levels: mount-level in `index.js` (minimum guard) + route-level in route files (fine-grained for writes)

### Gateway Flow
```
POST /api/:tenant/v1/chat/completions
  → tenant auth (hash check, expiry, enabled)
  → per-tenant rate limit (sliding window, in-memory)
  → model alias resolution
  → force-auto-route check
  → auto-routing (LLM classifier if model=auto)
  → provider selection
  → context pre-flight (token estimate vs context window)
  → provider adapter call
  → context overflow retry (if ValidationException/context error → next larger model)
  → response enrichment (cost_info, auto_routing, context_fallback)
  → async analytics logging
```

### Offline Mode
Set `OFFLINE=true` to disable all outbound internet calls.
- `modelEnrichmentService.js` loads `data/modelsDev.snapshot.json` instead of fetching models.dev
- No other behavior changes — all core functionality works fully offline

### Model Registry
`data/modelRegistry.js` is the canonical source of truth for model metadata.
`suggestForModel(id)` does 3-pass fuzzy matching (exact → needle-contains-pattern → pattern-contains-needle).
`suggestForModelAsync(id)` adds live models.dev as a final fallback.

### Error Conventions
- Admin API: `{ error: "message" }` with appropriate HTTP status
- Gateway errors: OpenAI-compatible `{ error: { message, type, code } }`

## Dev Commands
```bash
just dev          # hot-reload backend + frontend
just build        # production build
docker compose up # full stack with MongoDB
```

## Environment Variables
| Variable | Default | Notes |
|----------|---------|-------|
| `MONGODB_URI` | `mongodb://localhost:27017/openmodelprism` | |
| `JWT_SECRET` | change-me | Required in prod |
| `ENCRYPTION_KEY` | change-me-32-chars | 32-byte hex for AES-256-GCM |
| `PORT` | `3000` | |
| `CORS_ORIGINS` | `*` | Comma-separated origins |
| `OFFLINE` | `false` | `true` = no outbound internet calls |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `NODE_ENV` | `development` | `production` = JSON logs |

## Common Tasks

### Add a new model to the registry
Edit `server/data/modelRegistry.js` — add an entry with `id`, `family`, `vendor`, `tier`, `inputPer1M`, `outputPer1M`, `contextWindow`, `categories`, `patterns`.
Then regenerate the offline snapshot:
```bash
node --input-type=module -e "
import { MODEL_REGISTRY } from './server/data/modelRegistry.js';
// ... (see existing generation script in repo history)
"
```

### Add a new admin route
1. Create `server/routes/admin/myroute.js`
2. Import and mount in `server/index.js` with appropriate RBAC middleware
3. Add RBAC: `adminOrMaint` for write ops, `anyUser` for read-only

### Add a new provider adapter
1. Create `server/providers/myprovider.js` extending `BaseAdapter`
2. Register in `server/providers/index.js`
3. Add provider type to the frontend Providers page dropdown

## Docs Site
```
docs-site/          Astro 6 documentation site
  src/pages/model-prism/   13 doc pages
  src/components/          Nav, Footer, DocsSidebar, Search
  src/layouts/             Base.astro, DocsPage.astro
  dist/                    Built output (gitignored)
```

Build for embedding in Express server (served at /docs):
  cd docs-site && DOCS_BASE_PATH=/docs npm run build

Build for standalone GH Pages / Cloudflare Pages (served at /):
  cd docs-site && npm run build

Dev:
  cd docs-site && npm run dev
