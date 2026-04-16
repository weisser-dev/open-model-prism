# Open Model Prism — Requirements

## 1. Projektziel

Open Model Prism ist ein **Multi-Tenant, OpenAI-API-kompatibler LLM-Gateway** mit intelligentem Model-Routing. Er ermöglicht es, beliebige LLM-Provider (OpenAI, Anthropic, AWS Bedrock, Azure OpenAI, Ollama, vLLM, OpenRouter, LitServe, etc.) über eine einheitliche Oberfläche zu konfigurieren und per automatischer Klassifizierung das optimale Modell pro Request auszuwählen.

## 2. Kernfeatures

### 2.1 Provider-Management

- **Beliebig viele Provider-Connections** konfigurierbar (z.B. 10 AWS Accounts, 3 Ollama-Instanzen, OpenRouter, etc.)
- **Unterstützte Provider-Typen:**
  - OpenAI API Spec (Standard) — OpenAI, Anthropic API, LitServe, custom Gateways
  - Ollama (OpenAI-kompatibel + native API)
  - vLLM (OpenAI-kompatibel)
  - AWS Bedrock (eigene Auth via Access Key / IAM Role / VPC Endpoint)
  - Azure OpenAI (eigene Base-URLs, API-Versionen, Deployments)
  - OpenRouter, Together AI, Groq, etc.
- **Pro Connection:**
  - Name / Label
  - Provider-Typ (Dropdown)
  - Base URL
  - Auth-Methode (API Key, Bearer Token, AWS Credentials, keine)
  - Optionale Konfiguration (VPC Endpoint, Region, API-Version, etc.)
  - Connection-Test (Verify-Button)
- **Auto-Discovery:** Nach erfolgreicher Connection werden verfügbare Modelle automatisch via `/v1/models` (oder Provider-spezifischem Endpoint) abgerufen

### 2.2 Endpoint/Tenant-Management

- **Beliebig viele Endpoints** (= Tenants/Teams) anlegbar
- **Pro Endpoint:**
  - Eindeutiger Slug (z.B. `team-alpha`) → API unter `/api/team-alpha/v1/...`
  - Eigener API-Key zur Absicherung
  - Zugewiesene Provider-Connections (1..N)
  - **Model-Liste:** Zusammenführung aller Models aus zugewiesenen Providern
  - **Whitelist-Modus:** Nur explizit freigegebene Models werden exponiert
  - **Blacklist-Modus:** Alle Models außer den geblockten werden exponiert
  - **Routing-Modell aktivieren/deaktivieren** (Auto-Routing ja/nein)
  - **Routing-Konfiguration** (welcher Classifier, welche Kategorien, welche Overrides)
  - Eigenes Pricing-Override pro Modell
- **Jeder Endpoint ist vollständig OpenAI-API-Spec-kompatibel:**
  - `GET /api/{tenant}/v1/models`
  - `POST /api/{tenant}/v1/chat/completions`
  - `POST /api/{tenant}/v1/embeddings`
  - Streaming (SSE) Support
- **Drop-in fähig** für OpenWebUI, Cursor, Continue, Claude Code, etc.

### 2.3 Intelligentes Model-Routing

- **Classifier-Modell** frei wählbar (z.B. ein günstiges/schnelles Modell aus den konfigurierten Providern)
- **30+ vordefinierte Routing-Kategorien** (angelehnt an das bestehende System):
  - Minimal-Tier: smalltalk, translation, summarization_short, classification_extraction, creative_short, vision_simple, email
  - Low-Tier: summarization_long, analysis_simple, math_simple, fact_check, roleplay, coding_simple, coding_medium, sql, data_transformation
  - Medium-Tier: creative_long, analysis_complex, coding_complex, tool_use, vision_complex, document_qa, planning, prompt_engineering, math_complex, reasoning_deep, multilingual
  - High-Tier: system_design, research, sensitive_critical, vision_critical
- **Eigene Kategorien** anlegbar (Name, Beschreibung, Beispiele, Ziel-Modell, Cost-Tier)
- **Routing-Overrides** konfigurierbar:
  - Vision-Upgrade (Bild erkannt → Vision-fähiges Modell)
  - Confidence-Fallback (niedrige Confidence → höherwertiges Modell)
  - Domain-Gate (legal/medical/finance → Mindest-Tier)
  - Conversation-Turn-Upgrade (lange Konversation → Upgrade)
  - User-Frustration-Signal (Upgrade bei Unzufriedenheit)
  - Output-Length-Upgrade (langer Output → leistungsfähigeres Modell)
- **Kategorie → Modell Mapping** pro Endpoint konfigurierbar
- **Fallback-Modell** pro Endpoint definierbar

### 2.4 Pricing & Kosten-Tracking

- **Pro Modell:** Input-Preis und Output-Preis (USD/1M Tokens) hinterlegbar
  - Manuell einpflegbar über UI
  - Automatische Vorschläge falls bekannt (eingebaute Pricing-Datenbank für gängige Modelle)
- **Kosten-Berechnung** für jeden Request (actual cost)
- **Baseline-Kosten** berechnen (was hätte es mit dem Default-Modell gekostet?)
- **Einsparungen** tracken (Baseline - Actual - Classifier-Kosten)
- **Persistierung** in Datenbank (jeder Request wird geloggt)

### 2.5 Dashboard & Analytics (pro Tenant)

- **Summary-Karten:**
  - Gesamtkosten (Zeitraum)
  - Einsparungen vs. Baseline (absolut + prozentual)
  - Gesamtzahl Requests
  - Gesamtzahl Tokens (Input/Output)
- **Model-Tabelle:** Pro-Modell Aufschlüsselung (Requests, Kosten, Einsparung)
- **Kategorie-Verteilung:** 31+ Kategorien mit Cost-Tier-Badges
- **Task-Verteilung:** Horizontale Balken (code, analysis, chat, creative, etc.)
- **Zeitverlauf:** Tägliche Kosten-/Einsparungs-Kurve
- **User-Statistiken:** Top-User nach Requests/Tokens/Kosten
- **Recurring-Request-Erkennung:** Patterns erkennen die auf Batch-Jobs hindeuten
- **Request-Log:** Detaillierte Tabelle aller Requests (filterbar nach Tenant, User, Modell, Kategorie, Zeitraum)
- **Globales Dashboard:** Aggregierte Sicht über alle Tenants (für Admins)

### 2.6 Setup & Konfiguration

- **First-Run Setup Page:** Beim ersten Start wird ein Setup-Wizard angezeigt:
  1. Datenbank-Verbindung prüfen (bereits via Env-Var/YAML konfiguriert)
  2. Admin-Account anlegen
  3. Erste Provider-Connection einrichten
  4. Ersten Endpoint/Tenant anlegen
  5. Model-Discovery + Routing konfigurieren
- **Danach:** Vollständiges Admin-UI für alle Konfigurationen

## 3. Technische Anforderungen

### 3.1 Tech-Stack

- **Runtime:** Node.js (Backend + Frontend in einem Container)
- **Backend:** Express.js oder Fastify
- **Frontend:** React (Vite) — wird vom Backend als Static Files ausgeliefert
- **Datenbank:** MongoDB (Konfiguration, Tenants, Routing-Rules) ODER PostgreSQL
  - DB-Connection via Env-Vars (`MONGO_URI` / `DATABASE_URL`)
  - K8s: Connection-Daten über ConfigMap/Secret/YAML
- **Container:** Ein einzelnes Docker-Image (Backend + gebautes Frontend)

### 3.2 Deployment

- **Docker:** `docker run -e MONGO_URI=... -p 3000:3000 openmodelprism`
- **Docker Compose:** Mit MongoDB/Postgres als Service
- **Kubernetes:** Helm Chart oder plain YAML, DB-Credentials via Secrets
- **Umgebungsvariablen** für DB-Connection, Admin-Credentials, Log-Level, Port

### 3.3 API-Kompatibilität

- Vollständig kompatibel mit OpenAI API Spec v1:
  - `GET /v1/models`
  - `POST /v1/chat/completions` (Streaming + Non-Streaming)
  - `POST /v1/embeddings`
- Pro-Tenant API-Pfad: `/api/{tenant}/v1/...`
- Auth: Bearer Token (API-Key pro Endpoint)
- Response-Erweiterungen (optional, non-breaking):
  - `cost_info` Block (Kosten des Requests)
  - `auto_routing` Block (Routing-Entscheidung, Einsparung)

### 3.4 Sicherheit

- API-Keys pro Endpoint (hashed in DB)
- Admin-UI mit Login (Session-basiert oder JWT)
- CORS konfigurierbar
- Rate-Limiting pro Endpoint (optional)
- Keine Secrets im Frontend exponiert
- Provider-Credentials verschlüsselt in DB

### 3.5 Observability

- Structured Logging (JSON)
- Health-Endpoint (`GET /health`)
- Metriken-Endpoint (optional, Prometheus-kompatibel)
- Request-Logging mit Routing-Entscheidung

## 4. Nicht-funktionale Anforderungen

- **Performance:** Routing-Overhead < 500ms (Classifier-Latenz abhängig vom gewählten Modell)
- **Streaming:** Durchleitung von SSE-Streams ohne Buffering
- **Skalierbarkeit:** Stateless Backend (DB für State) → horizontal skalierbar
- **Resilience:** Fallback auf Default-Modell wenn Classifier fehlschlägt
- **Erweiterbarkeit:** Neue Provider-Typen einfach hinzufügbar (Provider-Plugin-System)
