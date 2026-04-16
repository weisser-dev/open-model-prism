# Open Model Prism — Implementation Tasks

> ✅ = Done · 🔄 = In Progress · [ ] = Planned

## Phase 1: Projekt-Setup & Grundgerüst ✅

- [x] **1.1** Projekt initialisieren (package.json, .gitignore, .env.example, Dockerfile, docker-compose.yml)
- [x] **1.2** Backend-Grundgerüst: Express v5 Server mit Health-Endpoint
- [x] **1.3** MongoDB-Anbindung (Mongoose) mit Connection-Handling + Env-Var Config
- [x] **1.4** Frontend-Grundgerüst: React + Vite + Mantine UI (dark theme)
- [x] **1.5** Multi-Stage Dockerfile (Frontend Build → Backend serves static)
- [x] **1.6** Setup-Detection: Middleware prüft ob Setup abgeschlossen ist

## Phase 2: Setup Wizard ✅

- [x] **2.1** Setup-Status Model (DB) + API-Endpoint (`GET /api/setup/status`)
- [x] **2.2** Admin-Account erstellen (`POST /api/setup/admin`)
- [x] **2.3** Admin-Auth: Login/Logout mit JWT (stateless, multi-pod-safe)
- [x] **2.4** Setup-Frontend: Stepper-Flow (Admin → Provider → Done)
- [x] **2.5** Redirect-Logik: Setup nicht abgeschlossen → Setup-Page
- [x] **2.6** Setup: Auto-Test + Auto-Discover nach Provider-Anlage (mit StatusRows)

## Phase 3: Provider-Management ✅

- [x] **3.1** Provider-Model mit verschlüsselten Credentials
- [x] **3.2** Encryption-Utility AES-256-GCM (`enc:ivHex:tagHex:data`)
- [x] **3.3** Provider CRUD API (`/api/admin/providers`)
- [x] **3.4** Provider-Adapter: Base-Klasse mit Interface-Definition
- [x] **3.5** Provider-Adapter: OpenAI-kompatibel (OpenAI, OpenRouter, vLLM, LitServe, etc.)
- [x] **3.6** Provider-Adapter: Ollama (native `/api/tags` + OpenAI-compat fallback)
- [x] **3.7** Provider-Adapter: AWS Bedrock (placeholder → OpenAI adapter)
- [x] **3.8** Provider-Adapter: Azure OpenAI (placeholder → OpenAI adapter)
- [x] **3.9** Connection-Test Endpoint (`POST /api/admin/providers/:id/test`)
- [x] **3.10** Model-Discovery: probt `/v1` + `/api/v1`, speichert `config.options.apiPath`
- [x] **3.11** Provider-Frontend: Liste, Erstellen, Bearbeiten, skipSSL, Try-Models-Chat, Connection-Check mit Log
- [x] **3.12** Smart URL-Validierung: erkennt `/v1`-Suffix, warnt + bietet Strip an
- [x] **3.13** HTTP→HTTPS Auto-Retry beim Connection-Check
- [x] **3.14** Auto-Model-Discovery nach Provider-Save

## Phase 4: Tenant/Endpoint-Management ✅

- [x] **4.1** Tenant-Model mit gehashtem API-Key (SHA-256)
- [x] **4.2** Tenant CRUD API (`/api/admin/tenants`)
- [x] **4.3** API-Key Generierung + Rotation
- [x] **4.4** Tenant → Provider Zuordnung
- [x] **4.5** Model Whitelist/Blacklist Konfiguration pro Tenant
- [x] **4.6** Model-Aliase pro Tenant
- [x] **4.7** Tenant-Config Caching (In-Memory mit TTL 60s)
- [x] **4.8** Tenant-Frontend: Liste, Erstellen, Bearbeiten, API-Key Management
- [x] **4.9** API-Key Aktivierung/Deaktivierung (mit Warning-Modal bei Disable)
- [x] **4.10** Custom API-Key (eigener Wert statt generiert, opt-in, min 16 Zeichen)
- [x] **4.11** API-Key Lifetime: 7 / 14 / 30 / 60 / 90 / 365 Tage oder unbegrenzt
- [x] **4.12** Expired-Key Rejection im Gateway (401 + `key_expired` / `key_disabled`)

## Phase 5: Gateway API (OpenAI-Spec-kompatibel) ✅

- [x] **5.1** Tenant-Auth Middleware: Bearer Token → Tenant Lookup (SHA-256 Hash)
- [x] **5.2** `GET /api/{tenant}/v1/models` — Aggregierte Model-Liste
- [x] **5.3** `POST /api/{tenant}/v1/chat/completions` — Non-Streaming Proxy
- [x] **5.4** `POST /api/{tenant}/v1/chat/completions` — Streaming Proxy (SSE)
- [x] **5.5** `POST /api/{tenant}/v1/embeddings` — Embedding Proxy
- [x] **5.6** Request/Response-Transformation (OpenAI-Format)
- [x] **5.7** Error-Handling: Provider-Fehler → OpenAI-kompatible Errors
- [x] **5.8** Cost-Info + Routing-Info in Response injiziert
- [x] **5.9** `GET /api/{tenant}/v1/models/public` ohne Auth (public endpoint)
- [x] **5.10** `GET /api/{tenant}/v1/health` ohne Auth (public health per tenant)
- [x] **5.11** Rate-Limiting pro Tenant (sliding window in-memory, requestsPerMinute per tenant)

## Phase 6: Routing-Kategorien ✅

- [x] **6.1** RoutingCategory-Model mit Built-in Flag
- [x] **6.2** 31 vordefinierte Kategorien (4 Cost-Tiers: minimal/low/medium/high)
- [x] **6.3** Category CRUD API (`/api/admin/categories`)
- [x] **6.4** Category-Model-Mapping pro Tenant
- [x] **6.5** Category-Frontend: Liste, Erstellen, Bearbeiten, Model-Zuordnung

## Phase 7: Intelligentes Model-Routing ✅

- [x] **7.1–7.13** Router Engine vollständig implementiert
- [x] **7.14** Integration in Gateway-Chat-Endpoint (`model="auto"`)
- [x] **7.15** Routing-Config Frontend pro Tenant (Classifier, Overrides, Mappings)

## Phase 8: Pricing & Kosten-Tracking 🔄

- [x] **8.1** Pricing-Defaults: 30+ Modelle (Claude, GPT, Gemini, Llama, Mistral, DeepSeek…)
- [x] **8.2** Pricing-Override pro Tenant/Modell
- [x] **8.3** Kosten-Berechnung pro Request (actual + baseline + saved)
- [x] **8.4** RequestLog-Model + Async-Logging (fire-and-forget via setImmediate)
- [x] **8.5** DailyStat-Model + Aggregation
- [x] **8.6** DailyCategoryStat + DailyUserStat
- [x] **8.7** Cost-Info in Response injiziert
- [x] **8.8** Auto-Routing-Info in Response injiziert
- [x] **8.9** Pricing-Frontend: Modell-Preise einsehen + bearbeiten *(covered by Phase 17 Model Registry)*
- [x] **8.10** RequestLog: `status` (success/error) + `errorMessage` + `durationMs` Felder

## Phase 9: Dashboard & Analytics ✅

- [x] **9.1–9.6** Dashboard API: Summary, Model-Breakdown, Categories, Daily Stats, Users, Request-Log
- [x] **9.7** Recurring-Request-Erkennung
- [x] **9.8–9.14** Dashboard Frontend vollständig
- [x] **9.15** Tenant-Switcher: Dashboard pro Tenant + globale Sicht
- [x] **9.16** Request-Log: `filterFailed` prop → zeigt nur Fehler-Requests
- [x] **9.17** Dashboard request filter unterstützt `?status=error`

## Phase 10: Polish & Production-Readiness 🔄

- [x] **10.1** Structured Logging (JSON, konfigurierbar)
- [x] **10.2** Health-Endpoint mit DB-Connection-Check
- [x] **10.3** Graceful Shutdown
- [x] **10.4** CORS konfigurierbar via Env-Var
- [x] **10.5** Docker Compose (App + MongoDB) finalisiert
- [ ] **10.6** K8s YAML Beispiele
- [x] **10.7** README.md aktualisiert (Attribution, Feature-Übersicht, Config-Tabelle)
- [x] **10.8** CLAUDE.md für das Projekt
- [x] **10.9** LICENSE (MIT)
- [x] **10.10** Security: Input-Validation, NoSQL-Injection Prevention (sanitize.js, enum guards, ObjectId validation)
- [x] **10.11** Rate-Limiting, Request-Size-Limits (authLimiter/adminLimiter/gatewayLimiter, IPv6-safe)
- [x] **10.12** Prometheus Metrics Endpoint

## Phase 11: Helm Charts (K8s)

- [ ] **11.1** Helm Chart Grundstruktur (Chart.yaml, values.yaml)
- [ ] **11.2** Deployment + Service Templates
- [ ] **11.3** MongoDB Subchart / External DB Konfiguration
- [ ] **11.4** Ingress Template mit TLS
- [ ] **11.5** ConfigMap + Secret Management
- [ ] **11.6** HPA (Horizontal Pod Autoscaler)
- [ ] **11.7** README für Helm Usage

## Phase 12: Tests

- [ ] **12.1** Unit Tests: Encryption Utility
- [ ] **12.2** Unit Tests: Router Engine (Kategorie-Extraktion, Overrides)
- [ ] **12.3** Unit Tests: Provider Adapter (Mock-HTTP)
- [ ] **12.4** Integration Tests: Gateway API (Auth, Routing, Billing)
- [ ] **12.5** Integration Tests: Admin API (CRUD, Permissions)
- [ ] **12.6** E2E Tests: Setup Wizard Flow

## Phase 13: Dokumentation

- [ ] **13.1** docs/ aktualisieren (API Reference, Config Reference)
- [ ] **13.2** Architecture Diagram aktualisieren
- [ ] **13.3** CHANGELOG.md aktualisieren (alle Phasen)

---

## Phase 14: Multi-User & RBAC ✅

- [x] **14.1** User-Model: Rollen (admin / maintainer / finops / tenant-viewer), LDAP-Flag, Active, LastLogin
- [x] **14.2** RBAC Middleware: `requireRole(...roles)` + Shorthands
- [x] **14.3** Auth-Update: JWT enthält `role` + `tenants`; Login nutzt User-Model statt Admin
- [x] **14.4** Setup-Update: erstellt ersten User mit `role: admin`
- [x] **14.5** User-Management API (`/api/admin/users`): CRUD, Schutzmechanismen (letzter Admin, Selbst-Delete)
- [x] **14.6** LDAP-Config Model + Service (`ldapjs`): Bind, Search, Group→Role Mapping
- [x] **14.7** LDAP-Auth Fallback im Login-Flow (lokaler User hat Vorrang)
- [x] **14.8** LDAP-Config API (`/api/admin/ldap`): GET/PUT/Test
- [x] **14.9** Users-Frontend: Tabelle, Erstellen, Bearbeiten (Rolle/Tenants/Aktiv/PW), Löschen
- [x] **14.10** LDAP-Settings-Frontend: Enable, Server, Bind, Search, Group-Mapping, Test
- [x] **14.11** App.jsx: rollenbasierte Navigation, currentUser im Sidebar angezeigt
- [x] **14.12** Docs-Seite in Navigation (erklärt API, Endpoints, Rollen, Key-Lifetime)
- [x] **14.13** Tenant-Viewer-Scoping: Dashboard-API filtert nach `req.user.tenants` bei tenant-viewer Rolle
- [x] **14.14** Role-Checks auf bestehenden Admin-Routen (Providers/Tenants: adminOrMaint; Dashboard: anyUser)

## Phase 15: Tenant API-Key Lifecycle ✅

- [x] **15.1** Tenant-Model: `keyEnabled` Boolean (default true)
- [x] **15.2** Tenant-Model: `keyLifetimeDays` (7/14/30/60/90/365/0=unlimited)
- [x] **15.3** Tenant-Model: `keyExpiresAt` Date (gesetzt bei Key-Generierung basierend auf Lifetime)
- [x] **15.4** Tenant-Model: `customApiKey` optional (verschlüsselt, user-defined)
- [x] **15.5** Gateway: Key-Expiry Check (401 + `{ error: "api_key_expired" }`)
- [x] **15.6** Gateway: Key-Enabled Check (401 + `{ error: "api_key_disabled" }`)
- [x] **15.7** Tenant-Frontend: Enable/Disable Toggle mit Warning-Modal
- [x] **15.8** Tenant-Frontend: Key-Lifetime Selector
- [x] **15.9** Tenant-Frontend: Custom API-Key Option (opt-in, advanced)
- [x] **15.10** Tenant-Frontend: Ablaufdatum anzeigen + "läuft bald ab" Badge

## Phase 16: Gateway Public Endpoints ✅

- [x] **16.1** `GET /api/{tenant}/v1/models/public` — öffentlich ohne Auth
- [x] **16.2** `GET /api/{tenant}/v1/health` — öffentlich, zeigt Tenant-Status + Provider-Availability
- [x] **16.3** Tenant-Frontend: Public-Endpoint-Links (Health + Models) pro Tenant
- [x] **16.4** Endpoint-URLs in Tenants-Frontend anzeigen (copy-to-clipboard)

---

## Phase 17: Model Registry ✅

- [x] **17.1** Provider.discoveredModels Schema: Felder `tier`, `categories[]`, `priority`, `notes`
- [x] **17.2** Provider.discoveredModels Schema: Felder `inputPer1M`, `outputPer1M` (USD/1M Token)
- [x] **17.3** API: `GET /api/admin/providers/models/all` — flache Liste aller Modelle über alle Provider
- [x] **17.4** API: `PATCH /api/admin/providers/:id/models/:modelId` — Registry-Metadaten updaten (inkl. Preise)
- [x] **17.5** API: `GET /api/admin/providers/models/suggest?modelId=xxx` — Auto-Suggest aus lokalem Registry
- [x] **17.6** API: `POST /api/admin/providers/models/reorder-tier` — Bulk-Reorder von Prioritäten innerhalb eines Tiers
- [x] **17.7** Lokale Registry-Datenbank (`server/data/modelRegistry.js`): 60+ Modelle mit Pricing, Tier, Kategorien, Context-Window
  - Abdeckung: Anthropic Claude, OpenAI GPT/O-series, Google Gemini, Meta Llama, Mistral, DeepSeek, Qwen, Cohere, Microsoft Phi
  - Fuzzy-Matching: 3-Pass (exact → substring longest wins → reverse contains)
  - Patterns: z.B. `opus46`, `opus.4.6`, `claude-opus-4-6` matchen alle auf Claude Opus 4.6
- [x] **17.8** Models-Frontend: Seite "Model Registry" mit Tabelle, Inline-Editing
- [x] **17.9** Models-Frontend: Gruppierung nach Provider / Tier / Kategorie / Flat
- [x] **17.10** Models-Frontend: Filter nach Provider, Tier, Kategorie, Freitext
- [x] **17.11** Models-Frontend: Tier-Spalte → Rang innerhalb des Tiers anzeigen (1, 2, 3…)
- [x] **17.12** Models-Frontend: Up/Down-Buttons zum Reorder innerhalb eines Tiers
- [x] **17.13** Models-Frontend: Preisfelder (Input/1M + Output/1M USD) inline editierbar
- [x] **17.14** Models-Frontend: "Auto-Suggest" Button (Wand-Icon) → füllt Tier/Preise/Kategorien aus lokalem Registry
- [x] **17.15** Models-Frontend: Kategorien-MultiSelect zeigt nur vorhandene Routing-Kategorien
- [x] **17.16** Models-Frontend: "Neue Kategorie anlegen" Modal direkt aus Model-Editing heraus
- [x] **17.17** Pricing-Sync: `pricingService.js` uses modelRegistry as fallback (tenant override → pricingDefaults → modelRegistry)
- [ ] **17.18** Benchmark-basierte Auto-Kategorisierung: Modelle anhand von Benchmark-Daten (ArtificialAnalysis o.ä.) automatisch Kategorien zuordnen

---

## Phase 18: Offline Mode, Token Estimation & Context Fallback 🔄

- [x] **18.1** `OFFLINE=true` env flag — disables all outbound internet calls (models.dev, etc.)
- [x] **18.2** `config.offline` propagated to modelEnrichmentService (skip fetch + warmCache when offline)
- [x] **18.3** `tokenService.js` — offline token estimation: char-based heuristic (~3.5 chars/token, code-aware), no external deps
- [x] **18.4** `estimateChatTokens(messages, maxTokens)` — per-message overhead, role + content tokens
- [x] **18.5** `checkContextFits(messages, maxTokens, contextWindow)` — pre-flight check before sending request
- [x] **18.6** `isContextOverflowError(err)` — detects Bedrock/OpenAI/Anthropic/Azure context overflow errors by message patterns
- [x] **18.7** Gateway pre-flight: estimate tokens before sending; if overflow detected → auto-upgrade to next-larger model
- [x] **18.8** Gateway post-error retry (non-streaming): catch context overflow → `findLargerContextModel()` → retry once; adds `context_fallback` field to response
- [x] **18.9** Gateway stream error handling: detect overflow in stream, write error event with `fallback_model` hint; client can retry
- [x] **18.10** `findLargerContextModel()` — sorts all visible tenant models by contextWindow, returns smallest model larger than current
- [x] **18.11** `OFFLINE=true` documented in README.md env vars table
- [x] **18.12** Token estimation admin API endpoint (`GET /api/admin/tokenize` + `POST /api/admin/tokenize`)
- [x] **18.13** Offline model data snapshot: `data/modelsDev.snapshot.json` (51 models, 9 vendors) — auto-loaded when `OFFLINE=true` or on fetch failure
- [x] **18.14** UI: `context_fallback` badge in Request Log — orange "fallback" badge with tooltip showing original→fallback model

---

## Phase 19: UX Improvements & Extended Configuration ✅

- [x] **19.1** Categories: Auto-seed built-in categories on startup (non-blocking, skips existing)
- [x] **19.2** Categories: Full list/card view toggle with SegmentedControl
- [x] **19.3** Categories: Add/Edit modal with all fields (key, name, description, costTier, examples, defaultModel, requiresVision)
- [x] **19.4** Categories: Delete button (built-ins deletable, restorable via Reset Defaults)
- [x] **19.5** Categories: "Reset Defaults" button — re-seeds any deleted built-in categories
- [x] **19.6** Categories: 14 additional benchmark-inspired categories (45 total, based on artificialanalysis.ai dimensions)
  - Added: `brainstorming`, `proofreading`, `format_convert`, `instruction_following`, `function_calling`, `devops_infrastructure`, `qa_testing`, `long_context_processing`, `data_analysis`, `stem_science`, `api_integration`, `swe_agentic`, `reasoning_formal`, `code_security_review`
- [x] **19.7** Tenants: Models tab in create/edit modal — whitelist/blacklist/all with per-model checkboxes grouped by provider
- [x] **19.8** Tenants: "Generate Config" button per tenant — modal with tabs for 7 tools
  - **Continue** — YAML schema v1 format (`~/.continue/config.yaml`)
  - **OpenCode** — JSON with `$schema`, `provider.custom` structure (`~/.config/opencode/config.json`)
  - **Cursor** — settings instructions
  - **Claude Code** — `ANTHROPIC_BASE_URL` env var approach
  - **Open WebUI** — Docker compose env vars
  - **Python SDK** — `openai` library snippet
  - **Node.js SDK** — `openai` npm snippet
  - Config generator shows documentation links per tool
- [x] **19.9** Tenants: Model access mode badge in tenant table (all / whitelist·N / blacklist·N)
- [x] **19.10** Model Registry: Hidden models (`visible=false`) always shown in admin UI — greyed out (opacity 0.45), never filtered out
- [x] **19.11** Setup: Dev-defaults env var pre-fill (`DEV_ADMIN_*` / `DEV_PROVIDER_*`) — auto-fills setup wizard form in non-production
- [x] **19.12** Setup: Connection guard — wizard does NOT advance if connection test fails
- [x] **19.13** Setup: URL issue detection + auto-fix (`/v1`, `/api/v1`, `/api` suffix warning)
- [x] **19.14** Setup: In-wizard chat widget after successful model discovery
- [x] **19.15** Setup: Post-setup redirect to dashboard (not login screen)
- [x] **19.16** Setup: "Finish Setup" explicit button after provider verification

## Phase 20: Benchmark-Based Categorization & Preset Wizard ✅

- [x] **20.1** Benchmark data integration — 51-model `BENCHMARKS` lookup in `modelRegistry.js` (intelligence/coding/math/speed 0-100); `withBenchmarks()` helper attaches scores non-mutating; `getBenchmarks(modelIds)` export
- [x] **20.2** Preset profiles — 7 named bundles in `server/data/presetProfiles.js`: `software_development`, `customer_support`, `research_analysis`, `creative_content`, `data_operations`, `agentic_workflows`, `general_all`
- [x] **20.3** Preset wizard in setup — step 2 of 4 (after provider, before complete): card grid of all profiles with checkbox selection; `POST /api/admin/categories/apply-preset` assigns best models per category by benchmark intelligence score
- [x] **20.4** `GET /api/admin/categories/presets` — returns all preset profiles; `POST /api/admin/categories/apply-preset` ranks provider models by tier + benchmark score, sets `defaultModel` on unset categories (non-destructive)
- [x] **20.5** Tenant-admin role — new RBAC role `tenant-admin` scoped to assigned tenants; `tenant-portal` API (`/api/tenant-portal/*`); `MyTenant` self-service page with Model Access tab + Generate Config tab
- [ ] **20.6** Category import/export — JSON export of category configuration for sharing between instances

---

## Phase 21: Configurable Signal Extraction & Rules Engine ✅

- [x] **21.1** `RoutingRuleSet` Mongoose model — per-tenant or global default; fields: `tokenThresholds`, `signalWeights`, `turnUpgrade`, `keywordRules[]`, `systemPromptRoles[]`, `classifier` settings
- [x] **21.2** `signalExtractor.js` service — extracts `totalTokens`, `hasImages`, `hasToolCalls`, `conversationTurns`, `detectedDomains`, `detectedLanguages` from raw request; `applyRuleSet()` scores signals against DB rules; `buildClassifierContext()` with three strategies: `truncate`, `metadata_only`, `summary`
- [x] **21.3** `routerEngine.js` updated — signal extraction runs first on every request; if `applyRuleSet()` returns confidence ≥ threshold → classifier is bypassed entirely; classifier receives compact metadata summary respecting its context limit
- [x] **21.4** `RequestLog` extended — `routingSignals` field stores per-request signals snapshot (totalTokens, hasImages, detectedDomains, detectedLanguages, preRouted, signalSource)
- [x] **21.5** `analyticsEngine.js` updated — populates `routingSignals` from `routingResult.signals` on every auto-routed request
- [x] **21.6** Admin API `routes/admin/routing.js` — CRUD for rule sets (`GET/POST/PUT/DELETE /rule-sets`, `POST /set-default`); `POST /rule-sets/seed-defaults` creates sensible default with 4 keyword rules + 4 system prompt roles
- [x] **21.7** `RoutingConfig.jsx` frontend — 5-tab UI: Thresholds (token tier sliders + signal weights), Keyword Rules (add/edit/delete modal), Prompt Roles (regex patterns), Classifier (confidence threshold + context strategy), Benchmark

## Phase 22: Routing Benchmark / Simulation ✅

- [x] **22.1** `POST /api/admin/routing/benchmark` — re-simulates last N auto-routed requests from RequestLog against a proposed rule set; uses stored `routingSignals` (full) or `inputTokens + domain` (partial); returns tier distribution diff, classifier bypass rate, cost delta, and list of changed decisions
- [x] **22.2** Benchmark UI in RoutingConfig — time window + request limit selectors; side-by-side current vs proposed tier distribution; diff cards (tier shifts, classifier bypasses, cost delta); scrollable table of changed routing decisions

---

## Phase 23: Infrastructure & Observability ✅

- [x] **23.1** `PodMetrics` Mongoose model — TTL 90s, one document per running pod (podId, role, hostname, pid, heap, RSS, CPU, event-loop lag, req/min, blocked/min, uptime)
- [x] **23.2** `podHeartbeat.js` service — writes pod metrics to MongoDB every 30s via `findOneAndUpdate` upsert; pod ID is a per-process UUID; stopped cleanly on SIGTERM
- [x] **23.3** `requestCounters.js` utility — in-memory per-second ring-buffer (60 slots) tracking req/min, blocked/min, error count, active connections; used by heartbeat + gateway
- [x] **23.4** `cacheInvalidation.js` service — watches `routingrulesets`, `routingcategories`, `tenants`, `providers` collections; Change Streams primary, 15s polling fallback when Change Streams unavailable (standalone MongoDB)
- [x] **23.5** `LogConfig` Mongoose model — singleton DB document: logLevel, promptLogging, routingDecisionLogging, fileLogging config
- [x] **23.6** `GET/PUT /api/admin/system/log-config` — read/write log settings; PUT applies log level immediately to this pod via `logger.setLevel()`
- [x] **23.7** `GET /api/admin/system/overview` — active pods, this-pod counters, provider health (5-min rolling window from RequestLog), 60-min traffic buckets
- [x] **23.8** `SystemDashboard.jsx` — `/system` page for admin/maintainer: pod cards (heap bar, req/min, blocked, EL lag), KPI row, 60-min traffic chart (requests/tokens/errors toggle), provider health table, log settings accordion
- [x] **23.9** Gateway blocked-request tracking — `incBlocked()` called on per-IP rate limit hit and per-tenant rate limit hit; rate-limit handlers unified via `blockedHandler`
- [x] **23.10** Cache-miss recovery in gateway — if model not found in any known provider, evict tenant cache and re-fetch from DB (handles new provider added while pod cache is warm)
- [x] **23.11** `logger.js` extended — `setLevel(level)` / `getLevel()` for runtime log level changes; log level loaded from `LogConfig` DB on startup

---

## Phase 24: Control Plane / Worker Split ✅

- [x] **24.1** `NODE_ROLE` env var in `config.js` — `full` (default) / `control` / `worker`; invalid values fall back to `full`
- [x] **24.2** `server/index.js` restructured — conditional route mounting via `isControl` / `isWorker` flags; all route modules loaded with dynamic `import()` so unused code is never evaluated
- [x] **24.3** `control` role mounts: setup, auth, all `/api/admin/*`, tenant-portal, React static frontend
- [x] **24.4** `worker` role mounts: gateway only (`/api/:tenant/v1/*`); returns informative 404 for frontend/admin paths
- [x] **24.5** `GET /health` returns `role` field — load balancers can differentiate pod types
- [x] **24.6** Pod heartbeat writes `role` field to `PodMetrics`; cache invalidation + heartbeat start on all roles
- [x] **24.7** `docker-compose.yml` updated — MongoDB starts with `--replSet rs0`; `rs-init` one-shot service runs `rs.initiate()` on first boot; `app` service uses `NODE_ROLE=full`
- [x] **24.8** `docker-compose.scaled.yml` — override file for multi-pod deployment: `control` service (port 3000), scalable `worker` service; base `app` disabled; use `--scale worker=N`
- [x] **24.9** `SystemDashboard.jsx` updated — pod cards show role badge (violet=control, orange=worker, gray=full); KPI card breaks down active pods by role
- [x] **24.10** `docs/operations.md` created — deployment modes, capacity planning table, nginx config, security hardening, env vars, system dashboard, monitoring, backup, upgrade procedure

---

## Phase 25: Routing Quality-of-Life, Observability & UX ✅

- [x] **25.1** Default tenant + default rule set seeding on startup (`utils/defaultTenantSeed.js`) — idempotent, creates "api" tenant with pre-configured overrides and a default RoutingRuleSet
- [x] **25.2** Default tenant + rule set protection — DELETE endpoints return 403 when `isDefault=true`; delete buttons disabled in UI with tooltip
- [x] **25.3** Default tenant badge ("default") in Tenants table; default rule set "system" badge in RoutingConfig
- [x] **25.4** `toolCallUpgrade` routing override — forces minimum `medium` tier when request contains `tools`/`functions`; prevents models from printing raw `<function=...>` XML instead of executing tool calls
- [x] **25.5** `costMode` on RoutingRuleSet (`balanced`/`economy`/`quality`) — economy shifts tier down 1 step, quality shifts up 1 step; applied after all tenant overrides; Select in Classifier tab
- [x] **25.6** Request Log: tenant filter Select dropdown (fetches active tenants from `/api/admin/dashboard/tenants-list`)
- [x] **25.7** Request Log: expandable prompt rows — click chevron to expand `promptSnapshot` (system prompt, message list or last-user-message) inline in table
- [x] **25.8** Request Log: admin-only `LogConfigPanel` accordion — toggle prompt DB storage, select capture depth (last-user/full), enable JSONL file logging with directory + size + rotation config
- [x] **25.9** Request Log: `promptSnapshot` subdoc on RequestLog model — only stored when `cfg.promptLogging=true`; two levels: `last_user` (last user message only) or `full` (all messages)
- [x] **25.10** JSONL file logging — one `.jsonl` file per day in configurable directory; each line = JSON object with full request metadata + optional prompt; for offline grep-based agent-usage analysis
- [x] **25.11** `analyticsEngine.js` refactored — LogConfig cached (60s TTL) to avoid per-request DB reads; `buildPromptSnapshot(messages, level)` helper; `writeRequestJsonl()` async file writer; `invalidateLogConfigCache()` export called by PUT log-config
- [x] **25.12** System Dashboard: pod version badge — `package.json` version read at boot by `podHeartbeat.js`, written to `PodMetrics.version`; shown as `v{version}` badge on each pod card
- [x] **25.13** System Dashboard: pod evict button — trash icon on non-self pods; `DELETE /api/admin/system/pods/:podId` removes PodMetrics document; pod reappears on next heartbeat if still alive
- [x] **25.14** `/v1/*` gateway shorthand — tools that configure base URL without `/api` prefix now work; `req.url = '/api/api/v1' + path.slice(3)` rewrite added alongside existing `/api/v1/*` handling
- [x] **25.15** `/api/api/*` direct-access guard in gateway — `req._shorthand` flag set on rewrites; gateway blocks direct double-prefix access; prevents unintended route exposure
- [x] **25.16** Dashboard: model-usage chart X-axis — tick labels truncated at 28 chars, rotated -35°, height 100px; full name in Recharts tooltip; prevents label overflow on narrow bar charts
- [x] **25.17** Sidebar footer — copyright `© {year} github.com/weisser-dev`, Docs link (github.com/weisser-dev/open-model-prism/wiki), GitHub link; rendered below Logout button
- [x] **25.18** Benchmark no-data fix — backend returns `{ simulated: 0, message }` when no historical data; frontend guards with `simulated === 0` check before rendering diff/tier cards (was crashing on undefined)

---

## Phase 26: API Namespace Isolation ✅

- [x] **26.1** Move all control-plane routes from `/api/*` to `/api/prism/*` to prevent future OpenAI spec conflicts:
  - `/api/setup/*` → `/api/prism/setup/*`
  - `/api/auth/*` → `/api/prism/auth/*`
  - `/api/admin/*` → `/api/prism/admin/*`
  - `/api/tenant-portal/*` → `/api/prism/tenant-portal/*`
- [x] **26.2** Gateway stays at `/api/:tenant/v1/*`; shorthand rewrites (`/api/v1/*`, `/v1/*`) unchanged
- [x] **26.3** Add `/prism/{*path}` guard in gateway router — prevents `prism` from ever being resolved as a tenant slug
- [x] **26.4** Update all 14 frontend pages + App.jsx: replace all `/api/admin/`, `/api/auth/`, `/api/setup/`, `/api/tenant-portal/` references with `/api/prism/` equivalents
- [x] **26.5** Update docs (api-reference.md, architecture.md, operations.md, tenants.md, providers.md, routing.md), README.md, CLAUDE.md to reflect new namespace

---

## Zusammenfassung

| Phase | Status | Tasks | Beschreibung |
|-------|--------|-------|-------------|
| 1  | ✅ | 6  | Projekt-Setup & Grundgerüst |
| 2  | ✅ | 6  | Setup Wizard (inkl. Auto-Test+Discover) |
| 3  | ✅ | 14 | Provider-Management (inkl. smart URL, HTTP→HTTPS, Try-Models) |
| 4  | ✅ | 12 | Tenant/Endpoint-Management (inkl. Key-Lifecycle) |
| 5  | ✅ | 11 | Gateway API (OpenAI-Spec, Public Endpoints, Per-Tenant Rate Limit) |
| 6  | ✅ | 5  | Routing-Kategorien |
| 7  | ✅ | 15 | Intelligentes Model-Routing |
| 8  | ✅ | 10 | Pricing & Kosten-Tracking |
| 9  | ✅ | 17 | Dashboard & Analytics |
| 10 | ✅ | 12 | Polish & Production-Readiness |
| 11 | [ ] | 7  | Helm Charts |
| 12 | [ ] | 6  | Tests |
| 13 | [ ] | 3  | Dokumentation |
| 14 | ✅ | 14 | Multi-User & RBAC + LDAP |
| 15 | ✅ | 10 | Tenant API-Key Lifecycle |
| 16 | ✅ | 4  | Gateway Public Endpoints |
| 17 | ✅ | 18 | Model Registry (Preise, Tier, Ranking, Auto-Suggest, Pricing-Sync) |
| 18 | ✅ | 14 | Offline Mode, Token Estimation & Context Fallback |
| 19 | ✅ | 16 | UX Improvements: Categories redesign, Tenant model activation, Generate Config, hidden model visibility |
| 20 | ✅ | 6  | Benchmark Categorization, Preset Wizard, tenant-admin role & self-service portal |
| 21 | ✅ | 7  | Configurable Signal Extraction & Rules Engine |
| 22 | ✅ | 2  | Routing Benchmark / Simulation |
| 23 | ✅ | 11 | Infrastructure & Observability (pod heartbeat, cache invalidation, system dashboard, log config) |
| 24 | ✅ | 10 | Control Plane / Worker Split (NODE_ROLE, docker-compose.scaled.yml, operations docs) |
| 25 | ✅ | 18 | Routing QoL & Observability: default tenant/ruleset, toolCallUpgrade, costMode, prompt logging, pod evict, /v1 shorthand, UX fixes |
| 26 | ✅ | 5  | API Namespace Isolation: /api/prism/* for control-plane, gateway stays at /api/:tenant/v1/* |

**Status-Übersicht:** 23 von 26 Phasen vollständig abgeschlossen. Offene Phasen: 11 (Helm), 12 (Tests), 13 (Docs bereits größtenteils abgedeckt durch inline-Dokumentation).
