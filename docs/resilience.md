# Error Detection, Handling & Fallbacks

Model Prism sits between your application and LLM providers. When something goes wrong it tries to recover silently before surfacing an error to the caller. This page explains every layer of that recovery stack.

---

## Error Classification

Every failed request is classified into one of four categories, visible in **Request Log → Failed Requests** and in analytics:

| Category | Meaning | Action |
|----------|---------|--------|
| `provider` | Transient provider issue (rate limit, context overflow, bad gateway, etc.) | Retry / fallback triggered automatically |
| `proxy` | Corporate proxy or firewall blocking the outbound call | Investigate network / proxy config |
| `fixed` | Error pattern that was fixed in a specific version — old log entries only | Upgrade to the indicated version |
| `unknown` | Unclassified — no pattern matched | Open an issue with the error message |

The classifier matches the raw error message against a set of regex patterns. Notable `provider` patterns:

- Rate limit / throttling (AWS Bedrock, OpenAI, Azure)
- Context window exceeded (`context_length_exceeded`)
- `max_tokens` exceeds model limit
- Stream terminated / server disconnected
- Bad Gateway (502)
- Model-invalid tool use sequence
- Azure Responses API unsupported parameters
- Anthropic-specific params (`thinking`, `betas`) sent to wrong provider type
- Duplicate tool names, Bedrock tool config validation

---

## Recovery Layers

Fallbacks are applied in order. Model Prism moves to the next layer only if the current one fails or is exhausted.

```
Request
  │
  ├─ 1. Circuit Breaker check         (skip providers with open circuits)
  ├─ 2. Provider fallback chain       (configured per-tenant)
  │     ├─ max_tokens auto-clamp      (same provider, adjusted limit)
  │     ├─ Context overflow           (tier-aware model upgrade)
  │     ├─ Field-mismatch retry       (cross-provider, tier-matched)
  │     └─ Generic error              (next provider in chain)
  ├─ 3. Truncation fallback           (drop oldest messages, same model)
  └─ 4. Model-level fallback          (tenant-configured model substitution)
```

---

## 1. Circuit Breaker

Each provider has an in-memory circuit breaker. After repeated failures the circuit opens and that provider is skipped entirely for a cooldown window. This prevents a degraded provider from adding latency to every request.

- State is per-pod (not shared across pods in a multi-pod deployment)
- Resets automatically after the cooldown window
- Configurable in **Tenant → Resilience** settings

---

## 2. Provider Fallback Chain

Each tenant can have multiple providers assigned. When the primary provider fails, Model Prism tries the next provider in the configured fallback chain — as long as it also has the requested model.

Configure under **Tenant → Resilience → Provider fallback chains**.

### max_tokens auto-clamp

If a provider rejects the request because `max_tokens` exceeds the model's output limit, Model Prism clamps `max_tokens` to the reported limit and retries on the **same provider** automatically. No fallback to another provider is triggered.

### Context Overflow — tier-aware model upgrade

When a request exceeds the context window of the target model (either detected by the pre-flight token estimator or rejected by the provider), Model Prism upgrades to a model with a larger context window.

**Tier search order:** same tier → one tier below (cheaper) → one tier above → any tier (last resort).

Within each tier, the model with the smallest sufficient context window is chosen to minimise cost overshoot.

Example: a `high`-tier model overflows →
1. Look for another `high` model with a larger context on any assigned provider
2. Fall back to `advanced` (one below)
3. Fall back to `ultra` (one above)

When this fallback fires, the response includes:
- A `context_fallback` field in non-streaming responses
- A trailing notice appended to the response content:
  > ⚠️ Your context window is filling up — starting a new session is recommended to avoid future errors.

**Pre-flight check:** For sessions with a known fill percentage (tracked per `session_id`), Model Prism proactively upgrades the model *before* the request is sent when the session is at ≥ 90 % of the context window.

**Auto-learned context windows:** When a provider returns a context-length error (e.g. Bedrock's `prompt is too long: 204366 tokens > 200000 maximum`), Model Prism parses the actual limit and persists it to the provider's discovered model entry. This corrects registry defaults (e.g. Anthropic direct API: 1M tokens, Bedrock: 200k) and prevents the same error from recurring. The learned value is also cached in-memory for the current process.

**Near-limit warning:** When a request succeeds but used ≥ 90 % of the model's context window, and there are 5 or fewer models with larger context available, the response includes a notice asking the user to start a new session and save open tasks.

### Field-mismatch cross-provider retry

Some errors indicate that the chosen provider cannot handle certain parameters in the request — not a transient failure, but a structural mismatch:

| Error pattern | Cause | Fallback behaviour |
|---------------|-------|--------------------|
| `Unknown parameter: 'thinking'` / `betas not supported` | Anthropic-specific params sent to a non-Anthropic provider | Retry on any other provider that has the **exact same model ID** |
| `Unknown parameter: 'input[N].tool_calls'` | Azure Responses API does not accept `tool_calls` in input messages | Retry on a **non-Azure** provider with a model of the same tier (±1 if needed) |

For the Azure tool_calls case, all `azure` and `azure-proxy` provider types are excluded from the search. The circuit breaker state is respected.

---

## 3. Truncation Fallback

If no larger-context model is available and the context is overflowing, Model Prism drops the oldest conversation turns (keeping system prompt and recent messages) and retries on the same model.

---

## 4. Model-Level Fallbacks

Configured per-tenant under **Tenant → Resilience → Model Fallbacks**. Applied after all provider-level retries are exhausted.

Two strategies:

| Strategy | Behaviour |
|----------|-----------|
| **Specific** | Explicit ordered list of fallback models, each optionally pinned to a specific provider. Up to 4 fallbacks per rule. |
| **Next Tier Within Provider** | Automatically steps down to the next lower tier available on the same provider. |

Model fallbacks apply to both streaming and non-streaming requests.

---

## What Is Not Retried

To avoid infinite retry loops or masking genuine client errors, certain error types stop immediately:

- `max_tokens` issues — clamped and retried once on the same provider, then stopped (different providers would have the same limit)
- Context overflow — one model upgrade attempt, then truncation, then fail (retrying on a different provider at the same context size would overflow again)
- 4xx client errors that are not known field-mismatch patterns (e.g. invalid request body, auth errors)

---

## Observability

All fallback events are logged:

- Request Log shows `requestedModel` vs `routedModel` — a mismatch indicates a fallback occurred
- `context_fallback.original_model` in the response body identifies context-upgrade events
- Gateway logs (`LOG_LEVEL=debug`) include a line per fallback attempt:
  ```
  [gateway] Stream context overflow: claude-sonnet-4-6 → claude-opus-4-5 (tier match)
  [gateway] Azure tool_calls mismatch on AzureEU, retrying gpt-4o on OpenAI (tier match)
  [gateway] Stream provider AzureEU failed: …, trying next…
  ```
- Provider Health table in **System → Provider Health** shows error rates per provider over the last 5 minutes

---

## Source Classification (Human vs Auto)

Every request is classified by **source** — independent of its routing category:

| Source | Meaning | Detection |
|--------|---------|-----------|
| **Human** | A person typed a question | `NOT isFimRequest AND NOT isToolOutputContinuation` |
| **Auto** | Machine-generated request | `isFimRequest OR isToolOutputContinuation` |

Source and category are fully independent — a human question can appear in any category, including `swe_agentic`, `tool_use_agentic`, `coding_medium`, etc. The source filter never checks categories.

### isToolOutputContinuation

Detects requests where the last user message is not a new human intent but a tool result or agent-injected content:

- Tool result prefixes: `Tool output for`, `tool_result`, `Result of`, `Output of`
- XML tool blocks: `<tool_result>`, `<function_results>`, `<result>`
- Code-fence file dumps from agents (` ```filename `)
- IDE launch commands (`"C:\...\java.exe"`)
- IDE context injections (`This is the currently open file:`)
- Content blocks with `tool_result` or `tool_use_result` type
- Messages with `tool_call_id`

### Backfill

After upgrading, existing requests may not have `isToolOutputContinuation` set. Use **Settings → Data Maintenance → Backfill Source Signals** to re-run signal detection on historical data. The backfill re-processes prompt snapshots stored in the DB.

### Prompt Analyses

The Prompt Analyzer only evaluates **Human** source requests. Auto-generated requests (FIM, tool continuations) are excluded at the query level. Within Human requests, the analyzer de-duplicates by `systemPromptHash` so the same coding session is only analyzed once
