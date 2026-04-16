# Open Model Prism — Architecture & Design

## 1. High-Level Architektur

```
                    ┌──────────────────────────────────────────┐
                    │           Docker Container               │
                    │                                          │
  Clients           │  ┌─────────────────────────────────┐    │
  (OpenWebUI,       │  │         Node.js Server           │    │
   Cursor,          │  │                                   │    │
   Continue,  ──────┼─►│  ┌───────────┐  ┌─────────────┐ │    │
   Claude Code)     │  │  │  API Layer │  │  Admin API  │ │    │
                    │  │  │ (OpenAI    │  │  (Config,   │ │    │
                    │  │  │  Spec)     │  │  Dashboard) │ │    │
                    │  │  └─────┬──────┘  └──────┬──────┘ │    │
                    │  │        │                 │        │    │
                    │  │  ┌─────▼─────────────────▼──────┐│    │
                    │  │  │       Core Services           ││    │
                    │  │  │  ┌──────────┐ ┌───────────┐  ││    │
                    │  │  │  │ Router   │ │ Provider   │  ││    │
                    │  │  │  │ Engine   │ │ Manager    │  ││    │
                    │  │  │  └──────────┘ └───────────┘  ││    │
                    │  │  │  ┌──────────┐ ┌───────────┐  ││    │
                    │  │  │  │ Tenant   │ │ Analytics  │  ││    │
                    │  │  │  │ Manager  │ │ Engine     │  ││    │
                    │  │  │  └──────────┘ └───────────┘  ││    │
                    │  │  └──────────────────────────────┘│    │
                    │  │                                   │    │
                    │  │  ┌───────────────────────────────┐│    │
                    │  │  │   Static Frontend (React)     ││    │
                    │  │  └───────────────────────────────┘│    │
                    │  └─────────────────────────────────┘    │
                    └──────────────────┬───────────────────────┘
                                       │
                    ┌──────────────────▼───────────────────────┐
                    │         MongoDB / PostgreSQL              │
                    │  (Config, Tenants, Routing, Analytics)    │
                    └──────────────────────────────────────────┘
                                       │
          ┌────────────────────────────┼────────────────────────────┐
          ▼                            ▼                            ▼
   ┌─────────────┐            ┌──────────────┐            ┌──────────────┐
   │   Provider   │            │   Provider    │            │   Provider    │
   │   OpenAI     │            │   Bedrock     │            │   Ollama      │
   │   (API Key)  │            │   (IAM/VPC)   │            │   (local)     │
   └─────────────┘            └──────────────┘            └──────────────┘
```

## 2. Request-Flow

```
Client Request
  │
  ▼
POST /api/{tenant}/v1/chat/completions
  │
  ├─ 1. Auth: API-Key validieren (Bearer Token → Tenant lookup)
  │
  ├─ 2. Tenant Config laden (aus Cache/DB)
  │     ├─ Zugewiesene Provider
  │     ├─ Model Whitelist/Blacklist
  │     └─ Routing-Konfiguration
  │
  ├─ 3. Model Resolution
  │     ├─ model="auto" → Router Engine
  │     │     ├─ Classifier-Request an konfiguriertes Classifier-Modell
  │     │     ├─ Kategorie ermitteln (31+ Kategorien)
  │     │     ├─ Overrides anwenden (6 Regeln)
  │     │     └─ Ziel-Modell + Provider bestimmen
  │     │
  │     └─ model="gpt-4o" → Direkt-Routing
  │           └─ Model in welchem Provider? → Provider bestimmen
  │
  ├─ 4. Request an Provider weiterleiten
  │     ├─ Provider-spezifische Transformation (Auth, Format)
  │     └─ Streaming durchleiten (SSE Passthrough)
  │
  ├─ 5. Response anreichern
  │     ├─ cost_info (Kosten berechnen)
  │     └─ auto_routing (falls geroutet)
  │
  └─ 6. Analytics loggen (async, non-blocking)
        ├─ gateway_requests (Rohdaten)
        ├─ daily_stats (Aggregate)
        └─ recurring_patterns (Batch-Erkennung)
```

## 3. Datenbank-Schema

### 3.1 Collections/Tabellen

#### `providers` — Provider-Connections
```json
{
  "_id": "ObjectId",
  "name": "AWS Bedrock Team-A",
  "type": "bedrock",                          // openai | ollama | vllm | bedrock | azure | openrouter | custom
  "config": {
    "baseUrl": "https://bedrock-runtime.eu-central-1.amazonaws.com",
    "auth": {
      "type": "aws_credentials",              // api_key | bearer | aws_credentials | none
      "accessKeyId": "encrypted:...",
      "secretAccessKey": "encrypted:...",
      "region": "eu-central-1"
    },
    "options": {
      "vpcEndpoint": "...",
      "apiVersion": "2023-09-30"
    }
  },
  "status": "connected",                      // connected | error | unchecked
  "lastChecked": "2026-04-01T12:00:00Z",
  "discoveredModels": [
    {
      "id": "eu.anthropic.claude-sonnet-4-6",
      "name": "Claude Sonnet 4.6",
      "capabilities": ["chat", "vision", "streaming"],
      "contextWindow": 1000000
    }
  ],
  "createdAt": "...",
  "updatedAt": "..."
}
```

#### `tenants` — Endpoints/Teams
```json
{
  "_id": "ObjectId",
  "slug": "team-alpha",
  "name": "Team Alpha",
  "apiKey": "hashed:sha256:...",
  "providerIds": ["provider_id_1", "provider_id_2"],
  "modelConfig": {
    "mode": "whitelist",                       // whitelist | blacklist | all
    "list": ["eu.anthropic.claude-sonnet-4-6", "auto"],
    "aliases": {
      "gpt-4": "eu.anthropic.claude-sonnet-4-6"
    }
  },
  "routing": {
    "enabled": true,
    "classifierModel": "qwen3-32b",
    "classifierProvider": "provider_id_1",
    "defaultModel": "eu.anthropic.claude-sonnet-4-6",
    "baselineModel": "eu.anthropic.claude-sonnet-4-6",
    "forceAutoRoute": false,
    "overrides": {
      "visionUpgrade": true,
      "confidenceFallback": true,
      "confidenceThreshold": 0.4,
      "domainGate": true,
      "conversationTurnUpgrade": true,
      "frustrationUpgrade": true,
      "outputLengthUpgrade": true
    }
  },
  "pricing": {
    "eu.anthropic.claude-sonnet-4-6": { "input": 3.00, "output": 15.00 },
    "eu.anthropic.claude-haiku-4-5": { "input": 1.00, "output": 5.00 }
  },
  "rateLimit": {
    "requestsPerMinute": 60,
    "tokensPerMinute": 100000
  },
  "active": true,
  "createdAt": "...",
  "updatedAt": "..."
}
```

#### `routing_categories` — Routing-Kategorien
```json
{
  "_id": "ObjectId",
  "key": "coding_medium",
  "name": "Code Review & Medium Coding",
  "description": "Code-Review, Unit Tests, Bug Fixes (< 50 Zeilen)",
  "costTier": "low",                          // minimal | low | medium | high
  "examples": [
    "Code-Review machen",
    "Unit Tests schreiben",
    "Bug fixen"
  ],
  "defaultModel": "qwen3-coder-30b",
  "fallbackModel": "claude-sonnet-4-6",
  "requiresVision": false,
  "isBuiltIn": true,                          // false für benutzerdefinierte
  "order": 14
}
```

#### `category_model_mappings` — Kategorie→Modell pro Tenant
```json
{
  "_id": "ObjectId",
  "tenantId": "tenant_id",
  "categoryKey": "coding_medium",
  "modelId": "eu.qwen.qwen3-coder-30b",
  "providerId": "provider_id_1"
}
```

#### `requests_log` — Request-Log
```json
{
  "_id": "ObjectId",
  "tenantId": "tenant_id",
  "timestamp": "2026-04-01T12:00:00Z",
  "userName": "user@example.com",
  "requestedModel": "auto",
  "routedModel": "eu.anthropic.claude-haiku-4-5",
  "providerId": "provider_id_1",
  "category": "smalltalk_simple",
  "taskType": "chat",
  "complexity": "simple",
  "costTier": "minimal",
  "confidence": 0.95,
  "inputTokens": 150,
  "outputTokens": 50,
  "actualCostUsd": 0.00045,
  "baselineCostUsd": 0.0009,
  "savedUsd": 0.00045,
  "isAutoRouted": true,
  "routingMs": 120,
  "overrideApplied": "",
  "domain": "general",
  "language": "de",
  "streaming": true
}
```

#### `daily_stats` — Tages-Aggregate
```json
{
  "date": "2026-04-01",
  "tenantId": "tenant_id",
  "routedModel": "eu.anthropic.claude-haiku-4-5",
  "requests": 1500,
  "inputTokens": 2500000,
  "outputTokens": 800000,
  "actualCostUsd": 4.50,
  "baselineCostUsd": 12.00,
  "savedUsd": 7.50
}
```

#### `setup` — Setup-Status
```json
{
  "completed": true,
  "adminUser": "admin",
  "completedAt": "2026-04-01T10:00:00Z"
}
```

## 4. Backend-Architektur

### 4.1 Verzeichnisstruktur

```
open-model-prism/
├── server/
│   ├── index.js                    # Entry point
│   ├── config.js                   # Env-Var Handling
│   ├── middleware/
│   │   ├── auth.js                 # API-Key + Admin Auth
│   │   ├── rateLimit.js            # Rate Limiting
│   │   └── cors.js                 # CORS Config
│   ├── routes/
│   │   ├── setup.js                # Setup Wizard API
│   │   ├── admin/
│   │   │   ├── providers.js        # CRUD Provider-Connections
│   │   │   ├── tenants.js          # CRUD Tenants/Endpoints
│   │   │   ├── categories.js       # CRUD Routing-Kategorien
│   │   │   ├── dashboard.js        # Dashboard/Analytics API
│   │   │   └── settings.js         # Globale Settings
│   │   └── gateway/
│   │       ├── models.js           # GET /api/{tenant}/v1/models
│   │       ├── chat.js             # POST /api/{tenant}/v1/chat/completions
│   │       └── embeddings.js       # POST /api/{tenant}/v1/embeddings
│   ├── services/
│   │   ├── providerManager.js      # Provider-Connection Handling
│   │   ├── modelDiscovery.js       # Auto-Discovery von Modellen
│   │   ├── routerEngine.js         # Classifier + Routing-Logik
│   │   ├── tenantManager.js        # Tenant-Config Caching
│   │   ├── analyticsEngine.js      # Request-Logging + Aggregation
│   │   ├── pricingService.js       # Kosten-Berechnung
│   │   └── batchDetector.js        # Recurring-Request-Erkennung
│   ├── providers/                  # Provider-Adapter (Plugin-System)
│   │   ├── base.js                 # Abstract Provider Interface
│   │   ├── openai.js               # OpenAI-kompatible APIs
│   │   ├── ollama.js               # Ollama
│   │   ├── bedrock.js              # AWS Bedrock
│   │   ├── azure.js                # Azure OpenAI
│   │   └── index.js                # Provider Registry
│   ├── models/                     # Mongoose/Sequelize Models
│   │   ├── Provider.js
│   │   ├── Tenant.js
│   │   ├── RoutingCategory.js
│   │   ├── RequestLog.js
│   │   ├── DailyStat.js
│   │   └── Setup.js
│   └── utils/
│       ├── encryption.js           # Credentials verschlüsseln
│       ├── classifier.js           # Classifier-Prompt Builder
│       └── pricing-defaults.js     # Bekannte Model-Preise
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/
│   │   │   ├── Setup.jsx           # Setup Wizard
│   │   │   ├── Dashboard.jsx       # Kosten-Dashboard
│   │   │   ├── Providers.jsx       # Provider-Verwaltung
│   │   │   ├── Tenants.jsx         # Tenant/Endpoint-Verwaltung
│   │   │   ├── Routing.jsx         # Routing-Konfiguration
│   │   │   ├── Categories.jsx      # Kategorie-Editor
│   │   │   ├── Models.jsx          # Model-Übersicht
│   │   │   ├── RequestLog.jsx      # Request-Log Viewer
│   │   │   └── Login.jsx           # Admin Login
│   │   ├── components/
│   │   │   ├── SummaryCards.jsx
│   │   │   ├── ModelTable.jsx
│   │   │   ├── CategoryDistribution.jsx
│   │   │   ├── CostChart.jsx
│   │   │   ├── UserStats.jsx
│   │   │   └── BatchPatterns.jsx
│   │   └── hooks/
│   │       └── useApi.js
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── Dockerfile
├── docker-compose.yml
├── package.json
├── .env.example
├── .gitignore
├── requirements.md
├── design.md
└── tasks.md
```

### 4.2 Provider-Adapter-System

```
┌──────────────────────────────────────────┐
│            BaseProvider (Abstract)        │
│                                          │
│  + listModels(): Model[]                 │
│  + chat(request): Response               │
│  + chatStream(request): AsyncIterable    │
│  + embeddings(request): Response         │
│  + testConnection(): boolean             │
│  + transformRequest(req): ProviderReq    │
│  + transformResponse(res): OpenAIRes     │
└──────────────────┬───────────────────────┘
                   │
     ┌─────────────┼─────────────┬─────────────┐
     ▼             ▼             ▼             ▼
 OpenAI        Bedrock        Azure        Ollama
 Provider      Provider      Provider     Provider
 (+ vLLM,      (boto3/       (API-ver-   (native +
  OpenRouter,   IAM Auth)     sioning)    compat)
  LitServe)
```

Jeder Provider implementiert:
- **`listModels()`** — Modelle abrufen (Provider-spezifisch)
- **`chat(request)`** — Non-Streaming Request
- **`chatStream(request)`** — Streaming Request (SSE Passthrough)
- **`transformRequest()`** — OpenAI-Format → Provider-Format
- **`transformResponse()`** — Provider-Format → OpenAI-Format
- **`testConnection()`** — Verbindungstest

### 4.3 Router Engine

```
Incoming Request (model="auto")
  │
  ├─ 1. Prompt-Summary extrahieren
  │     ├─ System-Prompt (max 500 chars)
  │     ├─ Letzte 3 Messages (max 600 chars)
  │     └─ Meta: Tools, Reasoning-Effort, Bilder
  │
  ├─ 2. Classifier-Modell auswählen
  │     ├─ Kurzer Prompt (≤12K) → günstiges Modell
  │     └─ Langer Prompt (>12K) → Modell mit großem Context
  │
  ├─ 3. Classifier aufrufen
  │     ├─ System-Prompt mit Kategorien + Beispielen
  │     ├─ Temperature: 0.0
  │     └─ Response: JSON mit Kategorie + Signalen
  │
  ├─ 4. Kategorie → Modell Lookup
  │     └─ Tenant-spezifisches Mapping (DB)
  │
  ├─ 5. Overrides anwenden (6 Regeln)
  │     └─ Tenant-spezifisch aktiviert/deaktiviert
  │
  └─ 6. ModelRecommendation zurückgeben
        ├─ model_id + provider_id
        ├─ category, confidence, complexity
        ├─ cost_tier, override_applied
        └─ analysis_time_ms
```

### 4.4 Caching-Strategie

- **Tenant-Config:** In-Memory Cache (TTL: 60s) — vermeidet DB-Lookup pro Request
- **Provider-Models:** In-Memory Cache (TTL: 5min) — Model-Liste nicht bei jedem Request abfragen
- **Routing-Categories:** In-Memory Cache (TTL: 5min) — Kategorien ändern sich selten
- **Pricing:** In-Memory Cache (TTL: 10min)
- Cache-Invalidierung über Admin-API (manuell) oder TTL-basiert

## 5. Frontend-Design

### 5.1 Seiten

| Seite | Beschreibung |
|-------|-------------|
| **Setup** | First-Run Wizard (DB, Admin, Provider, Tenant) |
| **Login** | Admin-Authentifizierung |
| **Dashboard** | Kosten-KPIs, Charts, Model-Tabelle (pro Tenant + global) |
| **Providers** | Provider-Connections verwalten (CRUD, Test, Model-Discovery) |
| **Tenants** | Endpoints/Teams verwalten (CRUD, API-Key, Provider-Zuordnung) |
| **Routing** | Routing-Konfiguration pro Tenant (Classifier, Overrides, Mappings) |
| **Categories** | Routing-Kategorien verwalten (Built-in + Custom) |
| **Models** | Alle bekannten Modelle, Pricing, Capabilities |
| **Request Log** | Filterbarer Log aller Requests |

### 5.2 UI-Framework

- React + Vite
- UI-Library: shadcn/ui oder Mantine (modern, leichtgewichtig)
- Charts: Recharts oder Chart.js
- Routing: React Router
- State: React Query (Server State) + Zustand (Client State)

## 6. Deployment

### 6.1 Dockerfile

```dockerfile
# Stage 1: Build Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
COPY server/package*.json ./
RUN npm install --production
COPY server/ ./
COPY --from=frontend-builder /app/frontend/dist ./public
EXPOSE 3000
CMD ["node", "index.js"]
```

### 6.2 Umgebungsvariablen

```env
# Database
MONGO_URI=mongodb://localhost:27017/openmodelprism
# oder: DATABASE_URL=postgresql://user:pass@host:5432/openmodelprism

# Server
PORT=3000
NODE_ENV=production
LOG_LEVEL=info

# Security
ADMIN_SECRET=...                    # Initial Admin Password (Setup)
ENCRYPTION_KEY=...                  # Für Provider-Credentials

# Optional
CORS_ORIGINS=*
RATE_LIMIT_RPM=60
```

### 6.3 Docker Compose

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - MONGO_URI=mongodb://mongodb:27017/openmodelprism
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
    depends_on:
      mongodb:
        condition: service_healthy

  mongodb:
    image: mongo:7
    volumes:
      - mongo_data:/data/db
    healthcheck:
      test: echo 'db.runCommand("ping").ok' | mongosh --quiet
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  mongo_data:
```
