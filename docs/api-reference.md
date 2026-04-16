# API Reference

## Gateway API

The gateway exposes an OpenAI-compatible REST API. All authenticated endpoints require a tenant API key as a Bearer token.

**Base URL:** `https://your-host/api/<tenant-slug>/v1`

**Authentication:** `Authorization: Bearer omp-<your-api-key>`

---

### POST /v1/chat/completions

Chat completions. Supports streaming and non-streaming.

**Request:**
```json
{
  "model": "gpt-4o",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user",   "content": "Hello!" }
  ],
  "temperature": 0.7,
  "max_tokens": 1024,
  "stream": false
}
```

Set `"model": "auto"` to enable automatic routing. Open Model Prism will classify the request and select the best model.

**`max_tokens` clamping:** If `max_tokens` exceeds the selected model's maximum output limit, the server automatically clamps it to that limit rather than returning an error.

**Model policy enforcement:** The tenant's model access configuration (whitelist or blacklist) is enforced server-side. If the requested model is not permitted, the gateway returns a `403` error (see Error Responses).

**Response (non-streaming):**
```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Hello! How can I help?" },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 24,
    "completion_tokens": 9,
    "total_tokens": 33
  },
  "cost_info": {
    "actual_cost": 0.0000087,
    "baseline_cost": 0.0000087,
    "saved": 0,
    "input_tokens": 24,
    "output_tokens": 9
  }
}
```

When `model=auto`, an additional `auto_routing` field is included:
```json
{
  "auto_routing": {
    "category": "smalltalk_simple",
    "confidence": 0.94,
    "complexity": "simple",
    "cost_tier": "minimal",
    "model_id": "gpt-4o-mini",
    "override_applied": "",
    "analysis_time_ms": 8,
    "domain": "general",
    "reasoning": "Short greeting, no technical content"
  }
}
```

When a context overflow fallback occurred:
```json
{
  "context_fallback": {
    "original_model": "claude-sonnet-4-6",
    "fallback_model": "claude-opus-4-6",
    "reason": "context_overflow"
  }
}
```

**Streaming:** Set `"stream": true` to receive Server-Sent Events. The stream follows the standard OpenAI SSE format with `data: {...}` lines and a final `data: [DONE]`.

---

### POST /v1/embeddings

Text embeddings. The tenant's model whitelist/blacklist policy is enforced; requests for disallowed models return `403`.

**Request:**
```json
{
  "model": "text-embedding-3-small",
  "input": "The quick brown fox"
}
```

**Response:**
```json
{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "index": 0,
      "embedding": [0.0023064255, -0.009327292, ...]
    }
  ],
  "model": "text-embedding-3-small",
  "usage": { "prompt_tokens": 5, "total_tokens": 5 }
}
```

---

### GET /v1/models

List models available to this tenant. Respects the tenant's model access config (whitelist/blacklist).

**Auth:** Required (Bearer token)

**Response:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-4o",
      "object": "model",
      "created": 1715367049,
      "owned_by": "openai"
    }
  ]
}
```

---

### GET /v1/models/public

Same as `/v1/models` but **no authentication required**. Useful for client setup tools that probe available models before auth is configured.

---

### GET /v1/health

Tenant health check. **No authentication required.**

**Response (200 — healthy):**
```json
{
  "status": "ok",
  "tenant": "team-alpha",
  "providers": [
    { "name": "OpenAI", "status": "ok", "models": 47 }
  ],
  "timestamp": "2026-04-01T12:00:00.000Z"
}
```

**Response (503 — degraded):**
```json
{
  "status": "degraded",
  "tenant": "team-alpha",
  "providers": [
    { "name": "OpenAI", "status": "error", "error": "Connection refused" }
  ]
}
```

---

## Error Responses

All gateway errors follow the OpenAI error format:

```json
{
  "error": {
    "message": "API key expired",
    "type": "authentication_error",
    "code": "key_expired"
  }
}
```

| HTTP | Type | Code | Cause |
|---|---|---|---|
| 401 | `authentication_error` | `missing_api_key` | No Bearer token |
| 401 | `authentication_error` | `invalid_api_key` | Key not found |
| 401 | `authentication_error` | `key_disabled` | Key disabled |
| 401 | `authentication_error` | `key_expired` | Key past expiry date |
| 429 | `rate_limit_error` | `rate_limit_exceeded` | Per-tenant rate limit hit |
| 400 | `invalid_request_error` | — | Malformed request body |
| 403 | `access_denied` | — | Model '...' is not allowed by tenant model policy |
| 503 | `provider_error` | — | Upstream provider unavailable |

---

## Admin API

All admin endpoints require a valid JWT Bearer token. Role requirements are noted per endpoint.

**Base URL:** `https://your-host/api/prism/admin`

**Authentication:** `Authorization: Bearer <jwt-token>`

Login: `POST /api/prism/auth/login` → `{ token: "eyJ..." }`

---

### Providers

| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/providers` | maintainer+ | List all providers |
| `POST` | `/providers` | maintainer+ | Create provider |
| `PUT` | `/providers/:id` | maintainer+ | Update provider |
| `DELETE` | `/providers/:id` | maintainer+ | Delete provider |
| `POST` | `/providers/:id/check` | maintainer+ | Test connection with detailed log |
| `POST` | `/providers/:id/discover` | maintainer+ | Discover and save models |
| `POST` | `/providers/:id/chat` | maintainer+ | Test chat request (setup wizard) |
| `GET` | `/providers/models/all` | maintainer+ | Flat list of all models across providers |
| `GET` | `/providers/models/suggest` | maintainer+ | Auto-suggest metadata for a model ID |
| `PATCH` | `/providers/:id/models/:modelId` | maintainer+ | Update model metadata |
| `POST` | `/providers/models/reorder-tier` | maintainer+ | Bulk reorder priorities within a tier |

---

### Tenants

| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/tenants` | maintainer+ | List all tenants |
| `POST` | `/tenants` | maintainer+ | Create tenant |
| `PUT` | `/tenants/:id` | maintainer+ | Update tenant |
| `DELETE` | `/tenants/:id` | maintainer+ | Delete tenant |
| `POST` | `/tenants/:id/rotate-key` | maintainer+ | Rotate API key |
| `POST` | `/tenants/:id/set-key` | maintainer+ | Set custom API key |
| `PUT` | `/tenants/:id/model-config` | maintainer+ | Update model access config |

**set-key request body:**
```json
{
  "apiKey": "omp-custom-key-value",
  "keyLifetimeDays": 90
}
```

---

### Categories

| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/categories` | any user | List all routing categories |
| `POST` | `/categories` | maintainer+ | Create category |
| `PUT` | `/categories/:id` | maintainer+ | Update category |
| `DELETE` | `/categories/:id` | maintainer+ | Delete category |
| `POST` | `/categories/reset-defaults` | maintainer+ | Re-seed deleted built-in categories |
| `GET` | `/categories/presets` | any user | List available preset profiles |
| `POST` | `/categories/apply-preset` | maintainer+ | Apply preset profiles (assigns default models) |

**apply-preset request body:**
```json
{
  "profileIds": ["software_development", "data_operations"],
  "providerId": "<optional-provider-id>"
}
```

**apply-preset response:**
```json
{
  "profiles": ["software_development", "data_operations"],
  "categoriesConsidered": 14,
  "updated": 11,
  "skipped": 3,
  "assignments": [
    { "category": "code_generation", "model": "deepseek-coder-v2", "tier": "medium", "score": 91 }
  ]
}
```

---

### Dashboard

| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/dashboard/summary` | any user | KPI summary (cost, tokens, requests, savings) |
| `GET` | `/dashboard/daily` | any user | Daily time-series (cost + tokens per day) |
| `GET` | `/dashboard/models` | any user | Model usage breakdown |
| `GET` | `/dashboard/categories` | any user | Category usage breakdown |
| `GET` | `/dashboard/users` | any user | Per-user usage breakdown |
| `GET` | `/dashboard/requests` | any user | Paginated request log |

All dashboard endpoints accept `?days=7|30|90` and `?tenantId=<id>`. Tenant-viewer and tenant-admin roles are automatically scoped to their assigned tenants.

---

### Users

| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/users` | admin | List all users |
| `POST` | `/users` | admin | Create user |
| `PUT` | `/users/:id` | admin | Update user (role, tenants, password, active) |
| `DELETE` | `/users/:id` | admin | Delete user (cannot delete self or last admin) |

---

### LDAP

| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/ldap` | admin | Get LDAP configuration |
| `PUT` | `/ldap` | admin | Update LDAP configuration |
| `POST` | `/ldap/test` | admin | Test LDAP connection and group mapping |

---

### Routing Rule Sets

| Method | Endpoint | Role | Description |
|---|---|---|---|
| `POST` | `/routing/rule-sets` | maintainer+ | Create, update, or delete routing rule sets |

---

### System

| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/system/overview` | admin | System overview (pods, counters) |
| `GET` | `/system/log-config` | admin | Get file logging configuration |
| `PUT` | `/system/log-config` | admin | Update file logging configuration |
| `DELETE` | `/system/pods/:podId` | admin | Evict pod |

---

### Token Estimation

| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/tokenize` | any user | Estimate tokens for a text string (`?text=...`) |
| `POST` | `/tokenize` | any user | Estimate tokens for a messages array |

**POST body:**
```json
{
  "messages": [
    { "role": "user", "content": "Hello, how are you?" }
  ]
}
```

**Response:**
```json
{
  "estimated_tokens": 12,
  "method": "heuristic",
  "chars": 20
}
```

---

## Tenant Portal API

Self-service API for `tenant-admin` role. Also accessible by admin and maintainer.

**Base URL:** `https://your-host/api/tenant-portal`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/mine` | List own tenants |
| `GET` | `/:id` | Get tenant config |
| `PUT` | `/:id/model-config` | Update model access (mode + list) |
| `GET` | `/:id/models` | List accessible models |

**model-config request body:**
```json
{
  "mode": "whitelist",
  "list": ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4-6"]
}
```

---

## Global Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Server health + DB status |
| `GET` | `/metrics` | None | Prometheus metrics |
| `GET` | `/api/prism/setup/status` | None | Whether first-run setup is complete |
| `POST` | `/api/prism/setup/admin` | None | Create initial admin account (setup only) |
| `POST` | `/api/prism/setup/complete` | JWT | Mark setup as complete |
| `POST` | `/api/prism/auth/login` | None | Login → JWT |
| `GET` | `/api/prism/auth/me` | JWT | Current user info |
