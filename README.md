<p align="center">
  <img src="docs/logo.svg" alt="Open Model Prism" width="140" />
</p>

# Open Model Prism

[![Live Demo](https://img.shields.io/badge/Live%20Demo-weisser--dev.github.io-blue)](https://weisser-dev.github.io/open-model-prism/)

> **Idea & Architecture by [weisser-dev](https://github.com/weisser-dev) — Developed 100% by Claude Sonnet & Opus**

A **multi-tenant, OpenAI-API-compatible LLM gateway** with intelligent model routing, cost tracking, and a full admin UI.

Connect any LLM provider (OpenAI, Anthropic, AWS Bedrock, Azure OpenAI, Ollama, vLLM, OpenRouter, and more) through a single unified endpoint. Automatically classify incoming requests and route them to the optimal model based on task type, content signals, cost tier, and capability benchmarks.

---

## Key Features

- **Multi-provider gateway** — OpenAI, Anthropic, AWS Bedrock, Azure OpenAI, Ollama, vLLM, OpenRouter, and more through a single OpenAI-compatible API
- **Intelligent auto-routing** — LLM classifier + keyword rules + system prompt role detection route each request to the optimal model and tier
- **Four-step force-route strictness** <sup>v2.1</sup> — `off` / `fim_only` / `smart` / `all`. `smart` keeps the user's deliberate model choice whenever the classified category is substantial (coding, reasoning, system design, analysis …) and only re-routes trivial categories like smalltalk or chat title generation. A configurable per-request opt-out token (`--model-prism-accept-model` by default) lets senior developers bypass force-routing for a single prompt
- **Category-specific target system prompts** <sup>v2.1.1</sup> — Each routing category can carry an optional system prompt that is injected into the forwarded request, priming the target model for the specific task type (e.g. coding categories → "You are an expert software engineer…"; legal → "You are a careful legal analyst…"). Configurable per category in the admin UI; 10 built-in categories ship with sensible defaults
- **8-tier cost hierarchy** — micro, minimal, low, medium, advanced, high, ultra, critical — with configurable cost mode (economy/balanced/quality) and explicit tier boost
- **Test Route** — dry-run any prompt through the full routing pipeline and see a step-by-step trace of every decision (signal extraction, rule matching, classifier output, overrides, model selection)
- **Synthetic Tests** <sup>AI</sup> — generate test prompts using AI, run them against the current routing config, and evaluate results with AI-powered analysis including quality and cost optimization suggestions
- **Routing Debug Panel** — every auto-routed request in the log shows an expandable debug view with extracted signals, pre-routing status, classifier confidence, applied overrides, and final model selection
- **Configurable override rules** — vision upgrade, tool call minimum tier, frustration detection, conversation turn escalation, domain gate, confidence fallback — each with description tooltips
- **Multi-tenant isolation** — per-tenant API keys, model whitelists, rate limits, quotas, and independent routing configuration
- **Cost tracking & savings** — real-time dashboard with spending, savings vs baseline, model distribution, and daily trends
- **Guided tour** — interactive walkthrough highlighting key UI areas including the new routing debug and synthetic test features

---

## Table of Contents

- [Key Features](#key-features)
- [Requirements](#requirements)
- [Local Development](#local-development)
- [Environment Variables](#environment-variables)
- [Architecture](#architecture)
- [Gateway Usage](#gateway-usage)
- [Production Deployment](#production-deployment)
- [Operations & Maintenance](#operations--maintenance)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)

---

## Requirements

| Dependency | Version | Notes |
|---|---|---|
| Node.js | 22+ | Backend + frontend build |
| Docker | 24+ | MongoDB in dev, full stack in prod |
| Docker Compose | v2 (`docker compose`) | Not `docker-compose` v1 |
| [just](https://github.com/casey/just) | any | Optional but recommended command runner |
| MongoDB | 7 | Provided via Docker Compose |

Install `just` on macOS:
```bash
brew install just
```

On Linux:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://just.systems/install.sh | bash -s -- --to /usr/local/bin
```

---

## Local Development

### 1. Clone and enter the repo

```bash
git clone https://github.com/weisser-dev/open-model-prism
cd model-prism
```

### 2. Copy environment file

```bash
cp .env.example .env
```

Edit `.env` — at minimum set `JWT_SECRET` and `ENCRYPTION_KEY`:

```bash
JWT_SECRET=your-random-secret-at-least-32-chars
ENCRYPTION_KEY=exactly-32-chars-here-!-padding
```

Generate secure values:
```bash
# JWT_SECRET
openssl rand -hex 32

# ENCRYPTION_KEY (must be exactly 32 characters)
openssl rand -hex 16
```

### 3. Start everything

```bash
just dev
```

This single command:
- Starts MongoDB in Docker
- Waits for MongoDB to be healthy
- Starts the backend on **http://localhost:3000** (hot reload via nodemon)
- Starts the frontend on **http://localhost:5173** (hot reload via Vite HMR)

Open **http://localhost:5173** and follow the 4-step setup wizard.

> The setup wizard creates your first admin user, connects your first provider, and sets up your first tenant. Takes about 2 minutes.

### 4. Available dev commands

```bash
just dev          # Start MongoDB + backend + frontend with hot reload
just dev-clean    # Wipe DB, fresh start (setup wizard reappears)
just logs         # Tail backend logs
just mongo        # Open MongoDB shell
just build        # Build production Docker image
just up           # Start via Docker Compose (production-like)
just down         # Stop Docker Compose
just clean        # Remove all containers, volumes, node_modules
```

### 5. Manual setup (without just)

```bash
# Terminal 1 — MongoDB
docker compose up -d mongodb

# Terminal 2 — Backend
cd server && npm install && npm run dev

# Terminal 3 — Frontend
cd frontend && npm install && npm run dev
```

---

## Environment Variables

All configuration after initial setup lives in the admin UI. Only infrastructure-level settings need env vars:

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_SECRET` | **yes** | — | JWT signing secret. Min 32 chars. Never rotate without invalidating all sessions. |
| `ENCRYPTION_KEY` | **yes** | — | AES-256-GCM key for encrypting provider API keys at rest. Exactly 32 chars. **Changing this breaks all saved provider credentials.** |
| `MONGODB_URI` | no | `mongodb://mongodb:27017/openmodelprism` | MongoDB connection string |
| `PORT` | no | `3000` | Backend HTTP port |
| `NODE_ENV` | no | `development` | `production` enables structured JSON logs |
| `NODE_ROLE` | no | `full` | `full` / `control` / `worker` — see [Horizontal Scaling](#horizontal-scaling) |
| `CORS_ORIGINS` | no | `*` | Comma-separated allowed origins |
| `LOG_LEVEL` | no | `info` | `debug` / `info` / `warn` / `error` |
| `OFFLINE` | no | `false` | `true` disables all outbound internet (air-gapped mode) |

---

## Architecture

**Single-pod (default)** — everything in one container:
```
Clients  →  Model Prism (NODE_ROLE=full)  →  MongoDB
                 Admin UI + Gateway + API
```

**Scaled deployment** — control plane + worker pods:
```
Clients (Continue · Cursor · Claude Code · Open WebUI · SDK …)
  │
  ├─ /api/:tenant/v1/*  ───────────────────► Worker pods  (NODE_ROLE=worker, scale freely)
  ├─ /api/v1/*  (default tenant shorthand) ┘
  ├─ /v1/*      (no-prefix shorthand)      ┘
  │
  └─ /* (admin UI, /api/prism/admin/*, auth) ────► Control plane  (NODE_ROLE=control, 1–2 pods)

All pods share one MongoDB — config changes propagate via Change Streams (<500ms)
or 15s polling fallback on standalone MongoDB.
```

**Gateway request pipeline:**
```
POST /api/{tenant}/v1/chat/completions
  ├─ Tenant Auth (API key → SHA-256 hash, expiry, enabled check)
  ├─ Per-Tenant Rate Limiting (sliding window, in-memory)
  ├─ Model Policy (whitelist/blacklist gate — auto-prism always passes)
  ├─ Signal Extraction (token count, keywords, system prompt, code language)
  ├─ Override Rules (vision, domain gate, security escalation, budget cap, …)
  ├─ [LLM Classifier — only called when pre-routing confidence < threshold]
  ├─ Model Selection (category → benchmark-weighted price-performance matching)
  ├─ Context Pre-flight (token estimate vs context window → auto-upgrade)
  ├─ max_tokens Clamping (auto-clamp to model output limit)
  ├─ Budget Guard (auto-economy mode when threshold reached)
  ├─ Provider Adapter (OpenAI-compat · Bedrock · Azure · Ollama)
  ├─ Response Enrichment (cost_info, auto_routing, context_fallback)
  └─ Async Analytics (RequestLog, DailyStat — fire-and-forget)
```

---

## Gateway Usage

```bash
# Standard OpenAI-compatible request
curl https://your-host/api/my-team/v1/chat/completions \
  -H "Authorization: Bearer omp-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "Hello"}]}'

# Auto-routing — Model Prism classifies and routes to the optimal model
curl ... -d '{"model": "auto", "messages": [...]}'
```

Auto-routing responses include:
```json
{
  "auto_routing": { "category": "code_generation", "model_id": "deepseek-coder-v2", "confidence": 0.91 },
  "cost_info": { "actual_cost": 0.0004, "baseline_cost": 0.0031, "saved": 0.0027 }
}
```

**Client tool integration** — use the per-tenant **Generate Config** button in the admin UI for ready-to-paste snippets for Continue, OpenCode, Cursor, Claude Code, Open WebUI, Python/Node.js SDKs.

---

## Production Deployment

### Docker Compose (single pod)

```bash
git clone https://github.com/weisser-dev/open-model-prism
cd model-prism

# Create .env with real secrets
cat > .env <<EOF
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 16)
NODE_ENV=production
EOF

docker compose up -d
```

The app is now running on port 3000. Put a reverse proxy (Caddy, nginx, Traefik) in front.

**Caddy example:**
```caddy
prism.yourdomain.com {
    reverse_proxy localhost:3000
}
```

### Kubernetes (Helm)

A Helm chart is included in the `helm/` directory:

```bash
helm install model-prism ./helm \
  --namespace model-prism \
  --create-namespace

kubectl port-forward svc/model-prism 3000:80 -n model-prism
# → http://localhost:3000 — setup wizard
```

See [`helm/README.md`](helm/README.md) for the full configuration reference.

### First-run checklist

- [ ] `JWT_SECRET` set to a random 32+ char string
- [ ] `ENCRYPTION_KEY` set to exactly 32 characters — **write this down, cannot be changed later without re-entering all provider API keys**
- [ ] MongoDB data directory persisted (bind mount or named volume)
- [ ] Reverse proxy configured with TLS
- [ ] Setup wizard completed (admin user, first provider, first tenant)

---

## Operations & Maintenance

### Horizontal Scaling

```bash
# Scale worker pods (gateway only)
docker compose -f docker-compose.yml -f docker-compose.scaled.yml up --scale worker=3 -d
```

Worker pods (`NODE_ROLE=worker`) handle gateway traffic. The control pod (`NODE_ROLE=control`) runs the admin UI and analytics. All pods share one MongoDB.

### Logs

```bash
# Docker
docker logs open-model-prism -f

# Just
just logs

# Adjust log level without restart — via admin UI: System → Log Level
```

### MongoDB Backup & Restore

**Manual backup:**
```bash
docker exec open-model-prism-mongodb \
  sh -lc 'mongodump --archive --gzip' > backup_$(date +%Y%m%d).archive.gz
```

**Restore:**
```bash
cat backup_20260101.archive.gz | docker exec -i open-model-prism-mongodb \
  sh -lc 'mongorestore --archive --gzip --drop'
```

### Upgrading

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker image prune -f
```

The GitHub Actions workflow does this automatically on push to `main`.

### Rotating JWT_SECRET

All active admin sessions will be invalidated immediately. Provider API keys are **not** affected.

1. Stop the app
2. Update `JWT_SECRET` in `.env`
3. Start the app — all users must log in again

### Rotating ENCRYPTION_KEY

⚠️ **This is destructive.** All saved provider API keys will become undecryptable.

1. Export all provider configs before rotating
2. Update `ENCRYPTION_KEY`
3. Restart — re-enter all provider API keys via the admin UI

---

## Troubleshooting

**Setup wizard doesn't appear**
→ The app detects an existing admin user. If starting fresh, run `just dev-clean` to wipe the DB.

**Provider connection fails ("Could not reach provider")**
→ Use the "Check Connection" button — it runs a detailed probe and shows exactly which URL/path failed. Common causes: wrong base URL (should not include `/v1`), wrong API key, SSL certificate issues (enable "Skip SSL" for self-signed certs).

**"Cannot read properties of undefined (reading 'toLowerCase')"on Models page**
→ A provider is missing the `providerName` field. Re-save the provider in the admin UI to trigger model re-discovery.

**Charts show no data on dashboard**
→ Analytics are written asynchronously. Wait for a few requests to complete, then refresh. If still empty, check `LOG_LEVEL=debug` for analytics errors.

**Context overflow / model escalation not working**
→ Ensure the provider's models have `contextWindow` values in the model registry. Models with no context window set will not trigger auto-upgrade.

**LDAP login fails**
→ Check the LDAP config in Settings → LDAP. The `bindDN` user needs read access to the user search base. Enable `debug` log level to see the full LDAP bind attempt.

---

## Documentation

| Document | Contents |
|---|---|
| [docs/getting-started.md](docs/getting-started.md) | Installation, setup wizard, first tenant, production deployment |
| [docs/architecture.md](docs/architecture.md) | System overview, request flow, directory structure, security, RBAC |
| [docs/routing.md](docs/routing.md) | Full routing pipeline: signal extraction, override rules, LLM classifier, categories, presets, model selection |
| [docs/providers.md](docs/providers.md) | Provider types, connection testing, model discovery, adapters, model registry |
| [docs/tenants.md](docs/tenants.md) | Tenant config, API key lifecycle, model access control, routing config, self-service portal |
| [docs/analytics.md](docs/analytics.md) | Cost tracking, token stats, dashboard metrics, Prometheus |
| [docs/api-reference.md](docs/api-reference.md) | All gateway and admin API endpoints with request/response examples |
| [docs/operations.md](docs/operations.md) | Production deployment: scaling, capacity planning, nginx config, security hardening, backup, upgrades |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

---

## License

Licensed under the **Apache License 2.0**.

See [LICENSE](./LICENSE) for details.
