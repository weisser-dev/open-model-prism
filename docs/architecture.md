# Architecture

## System Overview

Open Model Prism is a Node.js/Express backend that serves both the REST API and the compiled React frontend as static files. MongoDB is the only external dependency. It can run as a single container or split into a Control Plane and one or more Worker pods for horizontal scaling.

### Single-Pod (default)

```
┌─────────────────────────────────────────────────────────────┐
│  Browser / Client Tools                                     │
│  (OpenWebUI · Cursor · Continue · Claude Code · SDK · …)   │
└──────────────────┬──────────────────────────────────────────┘
                   │  HTTP / SSE
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  Open Model Prism  (Node.js 20, Express v5)                 │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Admin UI    │  │  Gateway API │  │  Static Frontend │  │
│  │  /api/prism/admin  │  │  /api/:slug  │  │  React + Mantine │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────┘  │
│         │                 │                                 │
│  ┌──────▼─────────────────▼──────────────────────────────┐  │
│  │  Services                                             │  │
│  │  routerEngine · analyticsEngine · pricingService      │  │
│  │  tokenService · modelEnrichmentService                │  │
│  └──────────────────────────┬────────────────────────────┘  │
│                             │                               │
│  ┌──────────────────────────▼────────────────────────────┐  │
│  │  Provider Adapters                                    │  │
│  │  OpenAI-compat · Bedrock · Azure · Ollama             │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
      MongoDB          LLM Providers    models.dev
   (data store)    (OpenAI, Anthropic,  (enrichment,
                    Bedrock, Ollama…)   optional)
```

### Scaled Deployment (Control Plane + Workers)

For larger teams, the gateway can be split from the Admin UI and scaled independently using `NODE_ROLE`:

```
Clients (Continue · Cursor · Claude Code · Open WebUI · SDK …)
         │
         ├── /api/:tenant/v1/* ──────────────────────────────────────┐
         │                                                           │
         └── /* (admin UI, /api/prism/admin/*, /api/prism/auth/*) ──────────┐   │
                                                                 │   │
                                            ┌────────────────────▼─┐ │
                                            │  Control Plane        │ │
                                            │  NODE_ROLE=control    │ │
                                            │  Admin UI + Admin API │ │
                                            │  Setup · Auth · Users │ │
                                            └──────────────────────┘ │
                                                                      │
                              ┌───────────────────┬──────────────────▼──┐
                              │  Worker Pod 1     │  Worker Pod 2        │  ...
                              │  NODE_ROLE=worker │  NODE_ROLE=worker    │
                              │  Gateway only     │  Gateway only        │
                              └─────────┬─────────┴──────────────────────┘
                                        │
                                   MongoDB  (shared state: tenants, providers,
                                             routing rules, analytics, pod metrics)
```

---

## Deployment Modes

Three modes are available via the `NODE_ROLE` environment variable:

| `NODE_ROLE` | Serves | Use case |
|---|---|---|
| `full` (default) | Admin UI + Gateway | Development, small teams (<50 users) |
| `control` | Admin UI + Admin API only | Control plane in a scaled deployment |
| `worker` | Gateway only (`/api/:tenant/v1/*`) | Horizontally scaled request handling |

All pods share a single MongoDB database. Worker pods are stateless and can be added or removed without downtime. See [operations.md](./operations.md) for capacity planning and configuration details.

---

## Request Flow (Gateway)

Every client request hitting `/api/:tenant/v1/...` passes through these stages:

```
POST /api/team-alpha/v1/chat/completions
  │
  ├─ 1. Tenant Auth
  │     Look up tenant by slug → find API key hash → verify Bearer token
  │     Check key enabled, not expired
  │     Load tenant config (providers, routing, model aliases) — cached 60s
  │
  ├─ 2. Per-Tenant Rate Limiting
  │     Sliding window in-memory counter (requestsPerMinute per tenant)
  │     Returns 429 on breach
  │
  ├─ 3. Model Alias Resolution
  │     Resolve tenant-specific aliases  e.g. "gpt-4" → "gpt-4o"
  │
  ├─ 4. Force-Auto-Route Check
  │     If tenant has forceAutoRoute=true, override requested model with "auto"
  │
  ├─ 5. Auto-Routing  (only if model = "auto")
  │     Signal extraction → override rules → [LLM classifier if needed]
  │     → category + confidence + target model ID
  │     See: docs/routing.md
  │
  ├─ 6. Provider Selection
  │     Find provider that has the target model
  │     Select provider adapter (OpenAI-compat / Bedrock / Azure / Ollama)
  │
  ├─ 7. Context Pre-flight
  │     Estimate total token count (tokenService)
  │     If count > model.contextWindow → findLargerContextModel → swap model
  │
  ├─ 8. Provider Adapter Call
  │     Forward request (non-streaming: await response)
  │     (streaming: pipe SSE chunks directly to client)
  │
  ├─ 9. Context Overflow Retry  (non-streaming only)
  │     If provider returns context-overflow error → retry with larger model
  │     Adds context_fallback field to response
  │
  ├─ 10. Response Enrichment
  │     Inject cost_info, auto_routing, context_fallback into response body
  │
  └─ 11. Async Analytics Logging  (fire-and-forget via setImmediate)
         Write RequestLog, update DailyStat, update DailyUserStat
```

---

## Directory Structure

```
open-model-prism/
├── server/                     Express backend (ESM, Node 20+)
│   ├── index.js                Entry point: routes, middleware, graceful shutdown
│   ├── config.js               Env-var config with defaults
│   ├── db.js                   Mongoose connection + retry logic
│   │
│   ├── models/                 Mongoose schemas
│   │   ├── Tenant.js           Tenants: slug, apiKeyHash, providers, routing, modelConfig
│   │   ├── Provider.js         Providers: type, encrypted credentials, discoveredModels
│   │   ├── User.js             Users: roles, LDAP flag, tenants, lastLogin
│   │   ├── RoutingCategory.js  Categories: key, costTier, defaultModel, examples
│   │   ├── RequestLog.js       Per-request log: tokens, cost, category, model, latency
│   │   └── DailyStat.js        Daily aggregates: cost, tokens, requests per tenant
│   │
│   ├── routes/
│   │   ├── admin/
│   │   │   ├── providers.js    Provider CRUD, check, discover, model patch, suggest
│   │   │   ├── tenants.js      Tenant CRUD, key rotation, model access
│   │   │   ├── categories.js   Category CRUD, presets, apply-preset
│   │   │   ├── dashboard.js    Summary, daily, model breakdown aggregations
│   │   │   ├── users.js        User CRUD with self-protection
│   │   │   ├── ldap.js         LDAP config, test connection
│   │   │   └── tokenize.js     Token estimation endpoint
│   │   ├── gateway/
│   │   │   ├── index.js        Route: /api/:tenant/v1/*
│   │   │   ├── chat.js         Chat completions (streaming + non-streaming)
│   │   │   ├── models.js       Model list, public endpoint
│   │   │   └── embeddings.js   Embedding proxy
│   │   ├── auth.js             Login, JWT issue, /me
│   │   ├── setup.js            First-run setup wizard endpoints
│   │   ├── tenant-portal.js    Self-service API for tenant-admin role
│   │   └── metrics.js          Prometheus /metrics
│   │
│   ├── middleware/
│   │   ├── auth.js             adminAuth: verify JWT → populate req.user
│   │   ├── rbac.js             requireRole, adminOnly, adminOrMaint, anyUser, tenantAdminSelf
│   │   └── setupCheck.js       Block API if setup not complete
│   │
│   ├── services/
│   │   ├── routerEngine.js     Signal extraction, override rules, LLM classifier
│   │   ├── analyticsEngine.js  Async request logging, DailyStat $inc
│   │   ├── pricingService.js   calcCost(): tenant override → pricingDefaults → modelRegistry
│   │   ├── tokenService.js     Offline token estimation, context check, overflow detection
│   │   └── modelEnrichmentService.js  models.dev fetch + offline snapshot fallback
│   │
│   ├── providers/
│   │   ├── index.js            getProviderAdapter() factory
│   │   ├── base.js             BaseAdapter interface
│   │   ├── openai.js           OpenAI-compatible (covers OpenAI, OpenRouter, vLLM, LitServe)
│   │   ├── bedrock.js          AWS Bedrock (via OpenAI adapter)
│   │   ├── azure.js            Azure OpenAI
│   │   └── ollama.js           Ollama (native /api/tags + OpenAI-compat fallback)
│   │
│   ├── data/
│   │   ├── modelRegistry.js    60+ models: tier, pricing, categories, benchmark scores
│   │   ├── presetProfiles.js   7 preset profile bundles
│   │   ├── modelsDev.snapshot.json  Offline model data snapshot (51 models)
│   │   └── pricingDefaults.js  Flat pricing table with fuzzy match
│   │
│   └── utils/
│       ├── encryption.js       AES-256-GCM (encrypt / decrypt)
│       ├── logger.js           Structured JSON logger (colored in dev)
│       ├── sanitize.js         Input sanitisation helpers (NoSQL injection prevention)
│       └── categorySeeds.js    Auto-seed 45 built-in routing categories on startup
│
├── frontend/src/
│   ├── App.jsx                 App shell, routing, nav, role-based visibility
│   ├── hooks/useApi.js         Axios instance with JWT interceptor
│   └── pages/
│       ├── Dashboard.jsx       KPI cards, cost/token charts, model usage
│       ├── Providers.jsx       Provider management, connection check, model registry
│       ├── Tenants.jsx         Tenant management, model access, generate config
│       ├── Models.jsx          Model registry table, tier/pricing inline edit
│       ├── Categories.jsx      Routing category management, preset apply
│       ├── RequestLog.jsx      Request log with filters, context_fallback badge
│       ├── Users.jsx           User management, role assignment
│       ├── LdapSettings.jsx    LDAP/AD configuration
│       ├── MyTenant.jsx        Tenant-admin self-service portal
│       ├── Docs.jsx            In-app documentation
│       ├── Setup.jsx           First-run setup wizard (4 steps)
│       └── Login.jsx           Login form
│
└── docs/                       This documentation
```

---

## Authentication & Security

### Admin UI (JWT)

All `/api/prism/admin/*` and `/api/prism/auth/*` endpoints use JWT Bearer tokens:

```
POST /api/prism/auth/login  →  { token: "eyJ..." }
GET  /api/prism/admin/...   →  Authorization: Bearer eyJ...
```

Tokens are signed with `JWT_SECRET`, contain `{ id, username, role, tenants }`, and have no built-in expiry (server restart invalidates all tokens).

### Gateway (Per-Tenant API Key)

```
omp-<64 hex chars>   (example: omp-a3f9b2...)
```

The key is shown only once on creation. The stored value is `SHA-256(key)`. Checks performed on every request:

1. Extract Bearer token → compute SHA-256 → lookup tenant
2. `keyEnabled === false` → 401 `key_disabled`
3. `keyExpiresAt < now` → 401 `key_expired`
4. Tenant `enabled === false` → 401 `tenant_disabled`

### Credential Encryption

Provider API keys and secrets are encrypted at rest using AES-256-GCM:

```
Format: enc:<ivHex>:<authTagHex>:<ciphertextHex>
Key:    ENCRYPTION_KEY env var (32-byte hex)
```

---

## RBAC Roles

| Role | Scope | Key permissions |
|---|---|---|
| `admin` | Global | Everything — users, LDAP, providers, tenants, categories |
| `maintainer` | Global | Providers, tenants, categories, model registry, analytics |
| `finops` | Global | Read-only: dashboard, costs, request log (all tenants) |
| `tenant-viewer` | Assigned tenants | Read-only: dashboard scoped to own tenants |
| `tenant-admin` | Assigned tenants | Self-service: model access config, generate client configs |

Role checks are applied in middleware before route handlers. Admin/maintainer bypass all tenant-scoping checks.

---

## Offline Mode

Set `OFFLINE=true` to disable all outbound internet calls:

- `modelEnrichmentService` loads `data/modelsDev.snapshot.json` instead of fetching models.dev
- Token estimation uses the built-in character-based heuristic (no external tokenizer)
- All routing, gateway, and admin functionality works fully offline

No other behavior changes. Suitable for air-gapped production environments.

---

## Rate Limiting

Three independent limiters are applied at different layers:

| Layer | Limit | Scope |
|---|---|---|
| Auth endpoints | 20 req/min | Per IP — brute-force protection |
| Admin API | 300 req/min | Per IP |
| Gateway | 600 req/min | Per IP (outer layer) |
| Per-tenant gateway | Configurable req/min | Per tenant (sliding window, in-memory) |

---

## Analytics Pipeline

Request analytics are written asynchronously (fire-and-forget via `setImmediate`) to avoid adding latency to the gateway response path:

```
Gateway response sent to client
  │
  └─ setImmediate →  analyticsEngine.logRequest()
                       │
                       ├─ upsert RequestLog document
                       ├─ $inc DailyStat (cost, tokens, requests)
                       └─ $inc DailyUserStat (per user breakdown)
```

If the analytics write fails, the gateway request is unaffected.
