# Model Prism — Roadmap

> Last updated: 2026-04-06 (v1.6.9)

This roadmap reflects planned features, roughly ordered by priority and grouped into milestones. Priorities may shift based on community feedback, community feedback, and real-world usage patterns.

**Legend:** `P0` = Critical · `P1` = High · `P2` = Medium · `P3` = Nice-to-have

---

## Milestone 1: Production Hardening

Focus: Make Model Prism bulletproof for production deployments at scale.

### Response Caching / Semantic Cache `P0`

Identical or near-identical prompts return cached responses instead of making a new API call. This is the single highest-impact cost optimization after auto-routing.

- **Exact-match cache**: SHA-256 hash of (model + messages + temperature) → cached response
- **Semantic cache** (Enterprise): Embedding-based similarity — if a request is > 95% similar to a recent one, serve the cached response
- **Per-tenant cache policy**: Enable/disable, TTL, max cache size
- **Cache hit metrics**: Track cache hit rate, saved tokens, saved cost in dashboard
- **Invalidation**: TTL-based + manual purge via admin API
- Building on: `promptSnapshot` already captures message content; cache can reuse the same hashing logic

### ~~Provider Fallback Chains~~ `Done`

Shipped in v1.6.9. Per-tenant fallback chains with circuit breaker, health-aware routing, automatic failover, webhook notifications on provider_down.

- **Per-tenant fallback config**: Ordered list of providers per model (e.g. OpenAI → Azure → Bedrock)
- **Health-aware routing**: Skip providers with > 5% error rate in the last 5 minutes
- **Automatic failover**: On 5xx / timeout → try next provider in chain
- **Circuit breaker**: After N consecutive failures, temporarily remove provider from rotation
- **Fallback metrics**: Track failover events, provider error rates in dashboard
- Building on: `Provider.status` field already exists; `PodMetrics` already tracks provider health

### ~~Helm Chart & Kubernetes~~ `Done`

Shipped in [ohara-helm](https://github.com/ai-ohara-systems/ohara-helm). Separate Deployments for control plane and workers, HPA, Ingress, NetworkPolicy, PDB.

### Test Suite `P1`

Automated tests to prevent regressions. Currently zero test coverage.

- **Unit tests**: Encryption utils, token estimation, pricing calculation, model registry fuzzy match, signal extraction, rule set application
- **Integration tests**: Gateway auth flow, auto-routing end-to-end (with mocked provider), budget enforcement, rate limiting, context overflow fallback
- **Admin API tests**: CRUD for providers, tenants, categories, users, rule sets
- **E2E tests**: Setup wizard flow, login, dashboard loads, request log filters
- Framework: Vitest (backend) + Playwright (E2E)

---

## Milestone 2: Enterprise Differentiation

Focus: Features for the next milestone.

### Guardrails / Content Filtering → Prompt Flux `P0`

Guardrails are being built as a standalone product: **[Prompt Flux](https://github.com/weisser-dev/open-model-prism — intelligent API middleware that automatically improves prompts and enforces configurable guardrails via self-hosted LLMs. Prompt Flux sits between Model Prism and the client, so guardrails apply transparently without changing Model Prism's gateway logic.

Model Prism's role: **Prompt Flux integration endpoint** — a lightweight hook that lets tenants point their requests through Prompt Flux before routing. Planned:

- **Per-tenant Prompt Flux URL**: Optional middleware URL in tenant config; gateway forwards pre-/post-processing to Prompt Flux
- **Guardrail status in RequestLog**: Log whether guardrails were applied, which rules fired, and whether the request was modified/blocked
- **Dashboard integration**: Show guardrail hit rates, blocked requests, and PII redaction stats alongside routing analytics

### ~~Usage Quotas~~ `Done`

Shipped in v1.6.9. Token/request/cost quotas per tenant with hard_block, soft_warning, or auto_economy enforcement. Automatic periodic reset. Webhook notifications on quota_warning and quota_exhausted.

### ~~A/B Testing for Routing~~ `Done`

Shipped in v1.6.9. Experiment model with weighted variants, consistent session-based hashing, per-variant metrics (cost, latency, quality, errors), z-test statistical analysis, admin API for experiment lifecycle.

### ~~Webhooks & Event Notifications~~ `Done`

Shipped in v1.6.9. Per-tenant + global webhooks with HMAC-SHA256 signing, retry with exponential backoff, delivery logging with 30-day TTL. Events: budget_threshold, budget_exceeded, error_spike, provider_down, quota_exhausted, quota_warning, experiment_completed.

---

## Milestone 3: Routing Intelligence

Focus: Make the routing engine smarter and more adaptive.

### ~~Automated Quality Scoring~~ `Done`

Shipped in v1.6.9. 0–100 quality score per request based on 6 signals: completeness, length adequacy, refusal detection, error indicators, language consistency, format compliance. Stored in RequestLog with full breakdown. Integrated into A/B experiment metrics.

### Prompt Templates / Prompt Registry `P2`

Centrally managed system prompts with versioning and routing hints.

- **Template CRUD**: Name, version, system prompt content, routing hints (preferred model, min tier, category override)
- **Per-tenant assignment**: Tenants can use shared templates or override with their own
- **Version history**: Track changes, rollback to previous versions
- **Usage analytics**: Which templates are used most, cost per template
- **Routing integration**: Template routing hints override auto-routing when set

### Session-Aware Routing `P2`

Use session context to make smarter routing decisions within a conversation.

- **Session model pinning**: Once a model is selected for a session, stick with it (avoid model bouncing)
- **Complexity escalation**: If early messages are simple but later ones get complex, upgrade the model mid-session
- **Session cost tracking**: Budget awareness at session level, not just request level
- Building on: `sessionId` already tracked in RequestLog; sessions endpoint already aggregates

### Multi-Model Orchestration `P3`

Route different parts of a request to different models.

- **Chain-of-thought routing**: Use a cheap model for initial reasoning, expensive model for final answer
- **Parallel execution**: Send same request to 2 models, return the better response (judge model picks)
- **Decomposition**: Split complex requests into sub-tasks, route each to the optimal model
- This is exploratory / long-term — depends on demand

---

## Milestone 4: Platform & Ecosystem

Focus: Make Model Prism a platform, not just a gateway.

### Native Provider Adapters `P1`

Replace OpenAI-compat wrappers with native adapters for major cloud providers.

- **AWS Bedrock**: Native SDK, IAM role auth, region selection, inference profiles
- **Azure OpenAI**: Deployment name mapping, AAD token auth, content filtering passthrough
- **Google Vertex AI**: Service account auth, regional endpoints, Gemini-specific features
- Benefits: Better error messages, native auth, provider-specific features

### Category Import/Export `P2`

Share routing configurations between Model Prism instances.

- **Export**: JSON file with categories, rule sets, keyword rules, system prompt roles
- **Import**: Merge or replace mode, conflict resolution (skip existing, overwrite, rename)
- **Presets marketplace** (future): Community-shared routing profiles

### Request Replay `P2`

Re-send a historical request through a different model for comparison.

- **Replay UI**: Select a request from the log, pick a different model, execute, compare results side-by-side
- **Batch replay**: Replay N requests through a new model to evaluate before switching
- **Integration with A/B testing**: Use replay data to inform experiment design

### Plugin / Extension System `P3`

Allow custom pre/post-processing hooks without forking the codebase.

- **Hook points**: Pre-routing, post-routing, pre-request (to provider), post-response (from provider)
- **Plugin format**: ESM modules loaded from a `plugins/` directory
- **Use cases**: Custom logging, request transformation, response enrichment, integration with internal tools

### Multi-Region / Edge Routing `P3`

Route requests to the geographically closest or lowest-latency provider.

- **Latency-based routing**: Ping providers periodically, prefer lowest latency
- **Region affinity**: Route EU traffic to EU providers (data residency)
- **Edge deployment**: Worker pods in multiple regions, single control plane

---

## Milestone 5: Developer Experience

Focus: Make Model Prism easier to set up, use, and extend.

### CLI Tool `P2`

Command-line tool for managing Model Prism without the UI.

- `prism init` — guided setup (like the web wizard)
- `prism tenant create/list/rotate-key`
- `prism provider add/test/discover`
- `prism benchmark run --hours 4`
- `prism logs --tenant my-app --follow`
- `prism export/import` for configuration backup

### SDK / Client Libraries `P2`

Official SDKs that add Model Prism-specific features on top of OpenAI compatibility.

- **Python**: `pip install model-prism` — wraps `openai` SDK, adds session tracking, cost callbacks
- **TypeScript**: `npm install @ohara/model-prism` — same concept
- **Features**: Automatic `x-session-id` header, cost tracking callbacks, retry with fallback, type-safe auto-routing metadata

### Interactive Playground `P2`

Browser-based chat interface in the admin UI for testing routing decisions.

- **Model selector**: Pick a model or use `auto-prism`
- **Routing inspector**: See the routing decision in real-time (category, tier, confidence, overrides)
- **Cost preview**: Estimated cost before sending
- **Compare mode**: Send same prompt to 2 models side-by-side
- Building on: Setup wizard already has a basic chat widget

### OpenAPI Spec `P3`

Auto-generated OpenAPI 3.1 spec for the entire admin API.

- Enables code generation for client SDKs
- Swagger UI at `/api/prism/docs`
- Useful for integrations

---

## Timeline Estimate

| Milestone | Target | Status |
|-----------|--------|--------|
| **1: Production Hardening** | Q2 2026 | Helm done, fallback chains done, response caching next |
| **2: Enterprise Differentiation** | Q3 2026 | Quotas done, A/B testing done, webhooks done. Guardrails → Prompt Flux in development |
| **3: Routing Intelligence** | Q3–Q4 2026 | Quality scoring done. Prompt templates + session-aware routing next |
| **4: Platform & Ecosystem** | Q4 2026+ | Native adapters first |
| **5: Developer Experience** | Ongoing | CLI + playground whenever time allows |

---

## How to Influence the Roadmap

- **Community members
- **Community**: Open issues on [GitHub](https://github.com/ai-ohara-systems/model-prism/issues) with feature requests
- **Contact**: ai@github.com/weisser-dev
