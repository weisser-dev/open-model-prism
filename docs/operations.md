# Operations Guide

## Deployment Modes

Open Model Prism supports three deployment modes controlled by the `NODE_ROLE` environment variable:

| Mode | `NODE_ROLE` | Description |
|---|---|---|
| Full (default) | `full` | Admin UI + Gateway in one pod. Use for dev and small deployments (<50 users). |
| Control Plane | `control` | Admin API + Frontend only. No gateway routes served. |
| Worker | `worker` | Gateway only (`/api/:tenant/v1/*`). Scales horizontally. |

---

## Single-Pod Deployment (default)

```bash
docker compose up -d
```

Everything runs in one container. This is the backward-compatible default.

**Good for:** local development, small teams (<50 developers).

Notes:
- MongoDB starts with `--replSet rs0` to enable Change Streams.
- If Change Streams are unavailable, the system automatically falls back to polling (15-second interval).

---

## Scaled Deployment (Control Plane + Workers)

```bash
docker compose -f docker-compose.yml -f docker-compose.scaled.yml up -d --scale worker=3
```

Architecture:

- **1x Control Plane** (port 3000) — Admin UI, Admin API, setup wizard, authentication.
- **Nx Worker Pods** — Gateway only, handling all `/api/:tenant/v1/*` traffic.
- **Load balancer** routes `/api/:tenant/v1/*` to workers and everything else to the control plane.

All state is in MongoDB — worker pods are fully stateless and can be added or removed at any time.

### Capacity Planning

| Team Size | Workers | Estimated Load | Notes |
|---|---|---|---|
| 1–20 developers | 1 (full mode) | ~300 req/min | Single pod is fine |
| 20–80 developers | 2–3 workers | 600–2,400 req/min | `--scale worker=2` |
| 80–200 developers | 4–6 workers | 2,400–6,000 req/min | Add nginx in front |
| 200+ developers | 8+ workers | 6,000+ req/min | Consider a dedicated MongoDB cluster |

**Reference load:** 100 developers using Continue or Cursor generate roughly 15–30 req/min each — autocomplete: 10–20/min, inline chat: 2–5/min, agentic: 1–3/min. Each worker handles ~600 req/min at the Express rate limit (per-IP; in practice significantly higher with a load balancer in front).

---

## Load Balancer Configuration

Example nginx upstream config for a scaled deployment:

```nginx
upstream omp_workers {
    server worker1:3000;
    server worker2:3000;
    server worker3:3000;
}

upstream omp_control {
    server control:3000;
}

server {
    listen 443 ssl;
    server_name omp.example.com;

    # Route AI client traffic to workers
    location /api/ {
        # Tenant gateway traffic
        location ~ ^/api/[^/]+/v1/ {
            proxy_pass http://omp_workers;
            proxy_http_version 1.1;
            proxy_set_header Connection "";
        }

        # Admin API stays on control plane
        location /api/prism/admin/ {
            proxy_pass http://omp_control;
        }

        location /api/prism/auth/ {
            proxy_pass http://omp_control;
        }
    }

    # Admin UI and everything else goes to control plane
    location / {
        proxy_pass http://omp_control;
    }
}
```

Health check endpoint for load balancer probes: `GET /health`

---

## MongoDB Considerations

The included `docker-compose.yml` starts MongoDB with `--replSet rs0` (single-node replica set). This is sufficient for Change Streams and requires no additional configuration for most deployments.

**Connection string for the included replica set:**

```
mongodb://mongodb:27017/openmodelprism?replicaSet=rs0&directConnection=true
```

**For production:**

- Use MongoDB Atlas or a 3-node replica set for high availability.
- Set `MONGO_URI` to a full connection string with `tls=true` and credentials.
- Change Streams enable sub-500ms cross-pod cache invalidation (provider config, tenant config).
- If Change Streams are unavailable, the system falls back to polling every 15 seconds automatically — no manual configuration required.

---

## Security Hardening

### Credentials and Secrets

- **Provider credentials:** encrypted at rest with AES-256-GCM.
- **Tenant API keys:** SHA-256 hashed — never stored in plaintext.
- **Admin passwords:** bcrypt.

### Network

- Terminate HTTPS at the load balancer or reverse proxy. Open Model Prism speaks HTTP internally.
- Set `CORS_ORIGINS` to specific domains (not `*`) in production.
- Firewall the `/metrics` endpoint — it is a Prometheus scrape target intended for internal monitoring only.

### MongoDB

- Use `MONGO_URI` with `tls=true` and credentials in production.
- Restrict MongoDB network access to the application pods only.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NODE_ROLE` | `full` | `full` / `control` / `worker` |
| `MONGO_URI` | `mongodb://localhost:27017/openmodelprism` | MongoDB connection string |
| `JWT_SECRET` | *(required)* | JWT signing secret — 32+ characters |
| `ENCRYPTION_KEY` | *(required)* | 32-byte hex string for AES-256-GCM |
| `PORT` | `3000` | Server listen port |
| `CORS_ORIGINS` | `*` | Comma-separated list of allowed origins |
| `OFFLINE` | `false` | `true` disables all outbound internet calls |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `NODE_ENV` | `development` | `production` enables JSON structured logs |

---

## System Dashboard

**URL:** `/system` (admin and maintainer roles only)

The system dashboard shows the live state of all pods registered with the shared MongoDB:

- **Pod list** with role badges — control (violet), worker (orange)
- **Per-pod resource metrics** — heap memory, RSS, CPU usage
- **Per-pod request rate** — req/min, blocked req/min
- **60-minute traffic chart** across all pods
- **Provider error rates** by provider

Pod heartbeats are written to MongoDB every 30 seconds with a 90-second TTL. Pods that stop sending heartbeats disappear from the dashboard automatically.

**Runtime controls** (apply immediately to the selected pod, no restart required):

- Log level
- Prompt logging toggle
- File logging configuration

---

## Monitoring

| Endpoint | Purpose | Access |
|---|---|---|
| `GET /health` | Health check — returns `{ status, role, timestamp }` | Public (used by load balancers) |
| `GET /metrics` | Prometheus metrics | Internal only — firewall this |

Pod metrics are stored in the `podmetrics` MongoDB collection with a 90-second TTL index.

---

## Backup

- Back up the `openmodelprism` MongoDB database. It contains all tenant configuration, provider configuration, routing rules, users, and analytics.
- Provider credentials are encrypted with `ENCRYPTION_KEY` — back up this value separately and store it securely. Without it, encrypted credentials cannot be decrypted.
- Request logs grow approximately 1 KB per request. For high-volume deployments, consider adding a TTL index on `RequestLog.timestamp` to cap collection size automatically.

---

## Upgrading

```bash
git pull
docker compose build
docker compose up -d
```

All application state is stored in MongoDB. To achieve zero downtime, bring up new pods before terminating old ones — the load balancer will route traffic away from pods that fail their `/health` check.
