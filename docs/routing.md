# Intelligent Model Routing

Open Model Prism routes incoming requests to the optimal model automatically when clients send `"model": "auto"`. This document describes the full routing pipeline, all signal sources, override rules, and how classifier context limits are handled.

## Overview

```
Incoming Request  ("model": "auto")
        │
        ▼
┌───────────────────────┐
│  Signal Extractor     │  0ms — no LLM call
│  Token count          │
│  Keywords / patterns  │
│  System prompt role   │
│  Content type         │
│  Conversation turns   │
└──────────┬────────────┘
           │ signals
           ▼
┌───────────────────────┐
│  Override Rules       │  0ms — rule engine
│  Vision upgrade       │
│  Domain gate          │
│  Security escalation  │
│  Budget cap           │
│  Confidence fallback  │
└──────────┬────────────┘
           │ category candidate + confidence
           ▼
    confidence ≥ threshold?
      YES ──────────────────────────────────────────→ Model Selector
      NO
           │
           ▼
┌───────────────────────┐
│  LLM Classifier       │  ~200–800ms — only called when needed
│  Prompt summary       │
│  Context truncation   │
│  JSON output          │
└──────────┬────────────┘
           │ category + metadata
           ▼
┌───────────────────────┐
│  Model Selector       │  0ms
│  Category → model     │
│  Capability matching  │
│  Context window check │
└──────────┬────────────┘
           │
           ▼
       Target Model
```

The goal is to call the expensive LLM classifier as infrequently as possible. Many requests can be pre-classified from structural signals alone.

---

## Cost Tiers

Every routing category belongs to one of four cost tiers. The tier determines which class of model handles the request.

| Tier | Use cases | Example categories |
|---|---|---|
| `minimal` | Translation, formatting, simple Q&A, smalltalk | `translation`, `smalltalk_simple`, `format_convert` |
| `low` | Drafting, summarisation, function calls, instruction following | `summarization_short`, `instruction_following`, `function_calling` |
| `medium` | Analysis, long context, data extraction, API integration | `data_analysis`, `long_context_processing`, `api_integration` |
| `high` | Formal reasoning, security review, agentic coding, STEM | `reasoning_formal`, `code_security_review`, `swe_agentic` |

Each tenant maps tiers to specific models via their routing category configuration. A category's `defaultModel` field overrides the tier default.

---

## Signal Extraction

Before the LLM classifier is invoked, structural signals are extracted from the raw request. These signals are cheap (microseconds, no API calls) and often sufficient to make a routing decision.

### Token Count

The total token count of all messages (system + history + current user message) is the strongest single signal for tier selection.

```
< 500 tokens    →  minimal tier candidate
500–2 000       →  low tier candidate
2 000–15 000    →  medium tier candidate
> 15 000        →  high tier candidate (long_context_processing)
> 50 000        →  always high tier, regardless of other signals
```

Token count is estimated offline using a character-based heuristic (~3.5 chars/token, code-aware) — no tokenizer dependency.

### System Prompt Role Detection

The system prompt defines the "mode" of the entire session and overrides most other signals.

```
"You are a senior security auditor..."     →  code_security_review, high tier
"You are a customer support agent..."      →  customer_support, low tier
"You are a legal compliance advisor..."    →  legal_analysis, domain=legal, medium tier min
"You are a data scientist..."              →  data_analysis, medium tier
```

If the system prompt matches a known role pattern, the category is set directly and the LLM classifier is skipped.

### Keyword Rules (configurable)

Keyword rules scan the full message content for domain-specific terms. Each rule specifies:

- **keywords** — list of strings to search for (case-insensitive)
- **match** — `any` (one keyword sufficient) or `all` (all must appear)
- **minMatches** — minimum number of keyword hits required
- **effect** — what happens: override category, set a minimum tier, set a domain flag

Built-in examples:

```
Security Escalation:
  keywords: [private key, jwt, secret, vulnerability, CVE, exploit, crypto]
  match: any, minMatches: 2
  effect: category=code_security_review, tierMin=high

Legal Domain:
  keywords: [GDPR, NDA, liability, compliance, contract, Article]
  match: any, minMatches: 1
  effect: tierMin=medium, domain=legal

Medical Domain:
  keywords: [diagnosis, ICD, treatment, medication, symptoms, clinical]
  match: any, minMatches: 1
  effect: tierMin=medium, domain=medical
```

Keyword rules are stored in the database and fully editable via the admin UI — no deployment required.

### Code Language Detection

The content is scanned for language-specific patterns to enable capability-based model selection:

```
Patterns detected:  .sol, pragma solidity, contract   →  blockchain
                    def , import , .py                →  python
                    SELECT, JOIN, CREATE TABLE         →  sql
                    BEGIN CERTIFICATE, -----BEGIN     →  crypto/certificates
                    func , go mod, :=                 →  go
```

A detected language influences which model is selected within the target tier — for example, routing Python code tasks to `codestral` or `deepseek-coder-v2` instead of a general-purpose model of the same tier.

### Content Type

```
images in messages          →  vision model required (see Vision Upgrade override)
tool_calls in messages      →  function-calling capable model required
structured output schema    →  JSON-mode capable model preferred
streaming: false            →  no streaming constraint — any model eligible
```

### Conversation Turn Count

Longer conversations carry accumulated context and often involve follow-up complexity:

```
turns 1–3   →  no effect
turns 4–7   →  +1 tier upgrade (configurable)
turns 8+    →  +1 tier upgrade, long_context_processing flag
```

Turn-based upgrades are suppressed for categories that are inherently stateless (e.g. `summarization_short`, `translation`).

---

## Override Rules

After signal extraction, a set of override rules adjusts the routing result. Overrides are applied in order; the first matching override wins (or they can stack — configurable).

| Override | Condition | Effect |
|---|---|---|
| **Vision Upgrade** | Images present, category doesn't require vision | Upgrade tier by 1 |
| **Security Escalation** | Security keywords ≥ threshold | Force `code_security_review`, `high` tier |
| **Domain Gate** | Domain = legal / medical / finance | Tier minimum `medium` |
| **Confidence Fallback** | Classifier confidence < threshold (default 0.65) | Force `medium` tier |
| **Conversation Turn Upgrade** | Turns ≥ 4 | +1 tier |
| **Frustration Upgrade** | User frustration signal detected | +1 tier |
| **Output Length Upgrade** | Estimated output = long, tier = minimal | Upgrade to `low` |
| **Budget Cap** | Tenant daily spend ≥ alert threshold | Downgrade to configured max tier |

All overrides are individually toggleable and threshold-adjustable per tenant via the admin UI.

---

## LLM Classifier

When pre-routing signals produce a confidence below the configured threshold (default: 0.65), the LLM classifier is called. It receives a structured summary of the request — not the full content — and returns a JSON routing decision.

### What the classifier receives

```
[System]
You are a precise model router. Classify the request into one of:
- code_generation [low] — Examples: write function, implement class, ...
- data_analysis [medium] — Examples: analyze dataset, find patterns, ...
- reasoning_formal [high] — Examples: prove theorem, formal logic, ...
... (all 45 categories with tier and examples)

Reply with ONLY valid JSON, no markdown:
{"category":"...","confidence":0-1,"complexity":"simple|medium|complex",
 "has_image":bool,"language":"en|de|other","estimated_output_length":"short|medium|long",
 "domain":"general|legal|medical|finance|tech|science","conversation_turn":int,
 "user_frustration_signal":bool,"cost_tier":"minimal|low|medium|high","reasoning":"..."}

[User]
[System]: You are a coding assistant...  (truncated to 500 chars)
[user]: Analyse this repository and identify security vulnerabilities
[CONTEXT_SIGNALS: tokens=82000, languages=[python,yaml], security_keywords=3, turns=1]
```

Note that context signals are injected as metadata — the classifier never sees the full file contents. This keeps the classifier call small and fast regardless of how large the actual payload is.

### Classifier Context Limit Handling

Different classifier models have vastly different context windows:

| Model | Context window | Recommended strategy |
|---|---|---|
| `gpt-4o-mini` | 128 000 tokens | `truncate` |
| `claude-haiku-4-5` | 200 000 tokens | `truncate` |
| `llama-3.1-8b` | 8 192 tokens | `metadata_only` |
| `gemini-flash-2.0` | 1 000 000 tokens | `truncate` |
| `phi-4` | 16 384 tokens | `summary` |

Three strategies are supported:

**`metadata_only`** — the classifier never sees message content, only extracted metadata. Safest for small-context models (< 16k tokens). Lowest classification quality for ambiguous prompts.

```
Classifier input: "tokens=82000, languages=[python], security_keywords=3,
                   system_role=security_auditor, turns=1, has_images=false"
```

**`truncate`** — the last user message and a truncated system prompt are included up to `contextLimit × 0.6` tokens (leaving headroom for the category list and output). Best trade-off for most models.

**`summary`** — a cheap, fast model first generates a 200-token summary of the full context, then the classifier receives that summary. Highest quality for long inputs, but adds one extra API hop.

The strategy and context limit are configured per tenant in the Routing Config UI.

---

## Routing Categories

Open Model Prism ships with 45 built-in routing categories across four cost tiers. Categories are stored in MongoDB and fully editable — add, remove, rename, or adjust defaults without code changes.

### Minimal tier (simple, fast, cheap)

| Key | Description |
|---|---|
| `smalltalk_simple` | Greetings, casual conversation |
| `translation` | Language translation |
| `format_convert` | Convert between formats (Markdown → HTML, JSON → YAML, etc.) |
| `brainstorming` | Quick idea generation, simple lists |
| `proofreading` | Grammar and spelling correction |
| `summarization_short` | Short text summarisation (< 2 pages) |

### Low tier (standard tasks)

| Key | Description |
|---|---|
| `summarization_long` | Long document summarisation |
| `instruction_following` | Step-by-step task completion |
| `function_calling` | Tool use, function call generation |
| `qa_simple` | Simple factual Q&A |
| `classification_extraction` | Entity extraction, labelling |
| `creative_writing` | Stories, poems, marketing copy |
| `sentiment_analysis` | Tone and sentiment detection |
| `devops_infrastructure` | Infrastructure scripts, CI/CD, Docker, Kubernetes |
| `qa_testing` | Test case generation, QA scenarios |

### Medium tier (complex tasks)

| Key | Description |
|---|---|
| `code_generation` | Write code in any language |
| `code_review` | Review and critique code |
| `code_debugging` | Identify and fix bugs |
| `data_analysis` | Analyse datasets, find patterns |
| `api_integration` | API client code, integration logic |
| `long_context_processing` | Tasks requiring large context windows (> 15k tokens) |
| `stem_science` | Science, engineering, technical calculations |
| `question_answering_complex` | Multi-step reasoning Q&A |
| `customer_support` | Support ticket handling, escalation |
| `document_understanding` | PDF, contract, or report comprehension |
| `research_synthesis` | Summarise multiple sources |

### High tier (hardest tasks)

| Key | Description |
|---|---|
| `reasoning_formal` | Mathematical proofs, formal logic |
| `code_security_review` | Security audit, vulnerability analysis |
| `swe_agentic` | Agentic software engineering, multi-step coding |
| `legal_analysis` | Legal document analysis, compliance |
| `medical_analysis` | Clinical/medical content (escalated by domain gate) |
| `system_design` | Architecture, high-level design docs |
| `multimodal_analysis` | Image + text combined analysis |

---

## Preset Profiles

Preset profiles are named bundles of routing categories. When applied, they automatically assign the best available model (ranked by benchmark score for the category's primary capability axis) to each category in the bundle.

The assignment is **non-destructive**: categories that already have a `defaultModel` configured are skipped.

| Profile | Category focus |
|---|---|
| `software_development` | Code generation, debugging, refactoring, security review, DevOps |
| `customer_support` | FAQ, sentiment analysis, summarisation, instruction following |
| `research_analysis` | Data analysis, STEM, long context, formal reasoning |
| `creative_content` | Brainstorming, copywriting, proofreading, format conversion |
| `data_operations` | SQL, data transformation, API integration, QA testing |
| `agentic_workflows` | Agentic SWE, function calling, multi-step tool use |
| `general_all` | All 45 categories — full coverage |


Profiles are selectable in the **Setup Wizard** (step 2 of 4) and re-applicable at any time via `POST /api/prism/admin/categories/apply-preset`.

---

## Model Selection

Once a category and tier are determined, the model is selected as follows:

1. **Category `defaultModel`** — if set, use it directly (highest priority)
2. **Benchmark-weighted price-performance** — within the target tier, models are ranked by a composite price-performance score rather than by cost alone. Benchmark scores (intelligence, coding, math, speed) are weighted based on the routing category so that the most relevant axis dominates. For example, a `code_generation` request weights the `coding` benchmark heavily, while a `summarization_short` request favours the `speed` axis. The result is that auto-routing picks the best value model per tier, not just the cheapest.
3. **Cost mode adjustment** — the active cost mode changes how price factors into the price-performance formula:
   - **Economy** — heavily penalises expensive models using a squared cost factor (`cost²`). Best for high-volume, cost-sensitive workloads.
   - **Balanced** — uses linear cost (`cost¹`). The default behaviour.
   - **Quality** — barely considers cost (`cost⁰·³`). Selects the highest-scoring model in the tier almost regardless of price.
4. **Tenant routing `defaultModel`** — fallback if no category default and no benchmark data
5. **Context window check** — if the selected model's context window is smaller than the estimated token count, escalate to the next larger model (`findLargerContextModel`)

### Budget Guard Auto-Economy

When a tenant's budget guard threshold is reached, all auto-routed requests for that tenant automatically switch to the **economy** cost mode, regardless of the tenant's normal cost mode setting. This prevents runaway spend while still allowing requests to be served.

The fallback cost mode is configurable per tenant via the `guardCostMode` field in the tenant routing configuration. For example, setting `guardCostMode: "balanced"` would use balanced scoring instead of economy when the budget guard triggers.

### Benchmark Scores

Model benchmark scores are stored in `server/data/modelRegistry.js` and cover four axes (0–100 scale, sourced from ArtificialAnalysis, LMArena, HumanEval, MATH-500):

| Axis | Used for categories |
|---|---|
| `intelligence` | General reasoning, research, document understanding |
| `coding` | Code generation, debugging, security review |
| `math` | Reasoning formal, STEM science |
| `speed` | Latency-sensitive, high-throughput tenants |

---

## Response Enrichment

Every auto-routed response includes routing metadata in the response body:

```json
{
  "choices": [...],
  "auto_routing": {
    "category": "code_security_review",
    "confidence": 0.91,
    "complexity": "complex",
    "cost_tier": "high",
    "model_id": "claude-opus-4-6",
    "override_applied": "security_escalation",
    "analysis_time_ms": 312,
    "domain": "tech",
    "reasoning": "Request contains 3 security-related keyword patterns and 82k token codebase"
  },
  "cost_info": {
    "actual_cost": 0.0187,
    "baseline_cost": 0.0210,
    "saved": 0.0023,
    "input_tokens": 82140,
    "output_tokens": 1820
  }
}
```

If a context fallback occurred (model was upgraded due to context overflow), a `context_fallback` field is also included:

```json
"context_fallback": {
  "original_model": "claude-sonnet-4-6",
  "fallback_model": "claude-opus-4-6",
  "reason": "context_overflow"
}
```
