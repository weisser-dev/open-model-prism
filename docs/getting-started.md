# Getting Started

## Prerequisites

- **Node.js** 20+ (recommended: via [nvm](https://github.com/nvm-sh/nvm))
- **Docker** & **Docker Compose** (for MongoDB, or run MongoDB locally)
- **just** (optional, for convenience commands) — install: `brew install just` / `cargo install just`

## Option 1: Docker Compose (recommended)

```bash
git clone https://github.com/weisser-dev/open-model-prism
cd open-model-prism
cp .env.example .env   # edit JWT_SECRET and ENCRYPTION_KEY
docker compose up -d
```

Open **http://localhost:3000** — the setup wizard will guide you through initial configuration.

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `MONGODB_URI` | No | `mongodb://mongodb:27017/openmodelprism` | MongoDB connection string |
| `JWT_SECRET` | **Yes** | `change-me` | Secret for JWT token signing — change in production |
| `ENCRYPTION_KEY` | **Yes** | `change-me-32-chars` | 32-byte hex key for AES-256-GCM credential encryption |
| `PORT` | No | `3000` | HTTP server port |
| `CORS_ORIGINS` | No | `*` | Allowed CORS origins (comma-separated) |
| `OFFLINE` | No | `false` | `true` = disable all outbound internet (air-gapped environments) |
| `LOG_LEVEL` | No | `info` | `debug` / `info` / `warn` / `error` |
| `NODE_ENV` | No | `development` | `production` = JSON structured logs |

## Option 2: Local Development (hot reload)

```bash
# Install dependencies
just install
# or: cd server && npm install && cd ../frontend && npm install

# Start MongoDB
docker compose up -d mongodb

# Terminal 1 — backend with file watching
just dev-backend
# or: cd server && npm run dev

# Terminal 2 — frontend (Vite HMR)
just dev-frontend
# or: cd frontend && npm run dev
```

- Frontend: **http://localhost:5173** (proxies `/api` to backend)
- Backend: **http://localhost:3000**

## Setup Wizard

The wizard runs on first start. It guides you through four steps:

1. **Admin Account** — create the first admin user (username + password, min 8 chars)
2. **First Provider** — connect an LLM provider (OpenAI, Ollama, OpenRouter, etc.)
   - Enter a name, select type, enter base URL (no `/v1` suffix) and API key
   - Click **Test & Add Provider** — connection is verified and models discovered automatically
   - Optional: test a model in the built-in chat widget before continuing
   - Click **Skip for now** if you want to add providers later
3. **Profiles** — select one or more preset profiles to pre-configure routing categories
   - Each profile is a bundle of routing categories with recommended model assignments
   - Skippable — you can apply profiles later from the Categories page
4. **Complete** — setup done, redirects to dashboard

## First Tenant

1. Go to **Tenants** in the sidebar
2. Click **Add Tenant**
3. Choose a `slug` (e.g. `team-alpha`) — this determines your gateway URL
4. Assign one or more providers
5. Click **Save** and **copy the API key** — shown only once

Your gateway endpoint is now live:
```
https://your-host/api/team-alpha/v1
```

## Using the Gateway

### OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    api_key="omp-your-api-key",
    base_url="http://localhost:3000/api/team-alpha/v1",
)

response = client.chat.completions.create(
    model="gpt-4o",           # any model from your providers
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

### Auto-Routing

```python
response = client.chat.completions.create(
    model="auto",             # Open Model Prism chooses the best model
    messages=[{"role": "user", "content": "Write a Python function to parse JSON"}]
)

# Response includes routing info:
# response.auto_routing.category   → "code_generation"
# response.auto_routing.model_id   → "deepseek-coder-v2"
# response.cost_info.saved         → 0.0042
```

### curl

```bash
curl http://localhost:3000/api/team-alpha/v1/chat/completions \
  -H "Authorization: Bearer omp-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "auto", "messages": [{"role": "user", "content": "Hello!"}]}'
```

## Connecting Client Tools

Use the **Generate Config** button on the Tenants page to get ready-to-paste configuration for:

- **Continue** (`~/.continue/config.yaml`)
- **OpenCode** (`~/.config/opencode/config.json`)
- **Cursor** (Settings → Models → Override Base URL)
- **Claude Code** (`ANTHROPIC_BASE_URL` environment variable)
- **Open WebUI** (Docker Compose env vars)
- **Python / Node.js SDK** (code snippets)

## Auto-Routing Setup

To enable auto-routing for a tenant:

1. Go to **Tenants** → edit the tenant → **Routing** tab
2. Select a **Classifier Provider** and **Classifier Model** (a small, fast model like `gpt-4o-mini`)
3. Configure **Override Rules** as needed
4. Go to **Categories** and set a `defaultModel` for each tier (or apply a preset profile)
5. Send requests with `"model": "auto"`

See [routing.md](routing.md) for a full description of how the routing pipeline works.

## Production Deployment

```bash
# Build image
docker build -t open-model-prism .

# Run
docker run -d \
  -p 3000:3000 \
  -e MONGODB_URI=mongodb://your-mongo:27017/openmodelprism \
  -e JWT_SECRET=your-long-random-secret \
  -e ENCRYPTION_KEY=your-32-char-hex-key \
  -e NODE_ENV=production \
  open-model-prism
```

For air-gapped environments:
```bash
docker run -d ... -e OFFLINE=true open-model-prism
```

## Useful Commands

```bash
just                    # Show all available commands
just install            # Install all dependencies
just dev                # Start backend + frontend in dev mode
just docker-up          # Start with Docker Compose
just docker-rebuild     # Rebuild and restart
just docker-logs        # View application logs
just mongo-shell        # Open MongoDB shell
just clean              # Remove everything
just release 1.0.0      # Tag and push a release
```
