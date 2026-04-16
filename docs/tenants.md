# Tenant Management

A **tenant** represents an isolated gateway endpoint. Each team, project, or application gets its own tenant with a unique URL, API key, and configuration.


## Tenant Configuration

| Field | Description |
|---|---|
| `name` | Display name |
| `slug` | URL segment — determines the gateway endpoint: `/api/<slug>/v1` |
| `providerIds` | Assigned providers (models from these providers are accessible) |
| `routing` | Auto-routing config: classifier provider, model, overrides |
| `modelConfig` | Model access control: mode + list |
| `modelAliases` | Map of alias → real model ID |
| `rateLimit` | Requests per minute (per tenant, sliding window) |
| `keyEnabled` | Whether the API key accepts requests |
| `keyLifetimeDays` | 7 / 14 / 30 / 60 / 90 / 365 / 0 (unlimited) |
| `keyExpiresAt` | Computed expiry timestamp |
| `forceAutoRoute` | Override all model requests to use auto-routing |

## API Key Lifecycle

### Generation

API keys are generated as `omp-<64 hex chars>`. The key is shown **once** at creation time. The stored value is `SHA-256(key)` — the plaintext is never persisted.

### Rotation

Clicking **Rotate Key** on a tenant immediately invalidates the old key and generates a new one. The new key is shown once and must be copied before closing the modal.

### Custom Keys

Opt-in: enter a custom key (minimum 16 characters). The custom key is stored encrypted (AES-256-GCM) and validated at request time the same way as generated keys.

### Lifetime & Expiry

Keys can be configured with an expiry period. On creation or rotation, `keyExpiresAt = now + keyLifetimeDays × 86400s`. At the gateway, every request checks:

```
keyEnabled === false  →  401  { error: "api_key_disabled" }
keyExpiresAt < now   →  401  { error: "api_key_expired" }
```

Keys with no expiry (`keyLifetimeDays = 0`) never expire.

### Enable / Disable

A key can be disabled without deleting it. The UI shows a warning modal before disabling — any active clients using the key will immediately start receiving 401 errors.

## Model Access Control

Each tenant can restrict which models are accessible via the gateway using three modes:

### `all` (default)
All models from assigned providers are available. No filtering applied.

### `whitelist`
Only models explicitly listed are accessible. Requests to any other model return an error.

```
list: ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4-6"]
→ Only these 3 models work for this tenant
```

### `blacklist`
All models are accessible **except** those explicitly listed.

```
list: ["claude-opus-4-6", "o3"]
→ These expensive models are blocked; everything else works
```

The model access config can be set by:
- **Admin / maintainer**: via the Tenants page → Models tab
- **tenant-admin**: via the My Tenant page → Model Access tab (self-service)

### Enforcement Details

Whitelist/blacklist filtering is enforced on **chat completions and embeddings requests** — not only on the model listing endpoint. The internal `auto-prism` model always bypasses whitelist/blacklist filtering so that auto-routing classification requests are never blocked by tenant model policies.

## Model Aliases

Tenants can define aliases that map client-facing model names to actual provider model IDs:

```json
{
  "gpt-4": "gpt-4o",
  "fast":  "gpt-4o-mini",
  "smart": "claude-opus-4-6"
}
```

Clients using the tenant endpoint can reference `model: "smart"` and the request is transparently forwarded to `claude-opus-4-6`.

## Max Output Tokens Clamping

The gateway automatically clamps `max_tokens` to the model's known output limit. If a request specifies a `max_tokens` value that exceeds the target model's maximum output capacity, the gateway reduces it to the model's limit before forwarding the request. This prevents upstream provider rejections due to out-of-range token counts.

## Budget Guards

Budget guards allow per-tenant spending controls. They are configured with two objects:

### `budgetLimits`

| Field | Description |
|---|---|
| `dailyUsd` | Maximum spend per day (USD) |
| `weeklyUsd` | Maximum spend per week (USD) |
| `monthlyUsd` | Maximum spend per month (USD) |

### `budgetGuard`

| Field | Default | Description |
|---|---|---|
| `enabled` | `false` | Enable budget guard enforcement |
| `thresholdPct` | `80` | Percentage of budget limit that triggers the guard |
| `blockTiers` | `['high', 'premium']` | Model tiers that are rejected when the guard is active |
| `guardCostMode` | `'economy'` | Cost mode for auto-routed requests when the guard is active (`economy` \| `balanced`) |

### Behavior

When spending reaches the `thresholdPct` of any configured budget limit:

- **Auto-routed requests** are switched to the `guardCostMode` (default: `economy`), steering them toward cheaper models.
- **Direct requests** for models in the `blockTiers` list are rejected with HTTP `429`.

## Routing Configuration

Each tenant has its own routing configuration:

```json
{
  "classifierProvider": "<provider-id>",
  "classifierModel":    "gpt-4o-mini",
  "defaultModel":       "gpt-4o",
  "forceAutoRoute":     false,
  "overrides": {
    "visionUpgrade":          true,
    "confidenceFallback":     true,
    "confidenceThreshold":    0.65,
    "domainGate":             true,
    "conversationTurnUpgrade": true,
    "frustrationUpgrade":     true,
    "outputLengthUpgrade":    true
  }
}
```

See [routing.md](routing.md) for full details on how routing works.

## Tenant-Admin Self-Service

Users with the `tenant-admin` role can manage their assigned tenants without admin access:

### My Tenant page

- **Model Access tab** — switch between all/whitelist/blacklist, select models via checkboxes grouped by provider
- **Generate Config tab** — generate ready-to-paste configs for Continue, OpenCode, Cursor, Claude Code, Open WebUI, Python SDK, Node.js SDK

### Tenant Portal API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/prism/tenant-portal/mine` | List own tenants |
| `GET` | `/api/prism/tenant-portal/:id` | Get tenant config (no API key hash) |
| `PUT` | `/api/prism/tenant-portal/:id/model-config` | Update model access mode and list |
| `GET` | `/api/prism/tenant-portal/:id/models` | List accessible models (respects model access config) |

Admins and maintainers also have access to these endpoints and see all tenants via `/mine`.

## Generate Config

The **Generate Config** button (code icon) per tenant opens a modal with configuration snippets for popular tools. The endpoint URL and API key placeholder are pre-filled; the user just needs to substitute their actual key.

| Tool | Config format | Location |
|---|---|---|
| Continue | YAML schema v1 | `~/.continue/config.yaml` |
| OpenCode | JSON with `$schema` | `~/.config/opencode/config.json` |
| Cursor | Manual settings | Settings → Models → OpenAI |
| Claude Code | Shell env var | `~/.bashrc` / `.env` |
| Open WebUI | Docker env | `docker-compose.yml` |
| Python SDK | Code snippet | `example.py` |
| Node.js SDK | Code snippet | `example.mjs` |
