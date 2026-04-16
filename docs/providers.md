# Provider Management

A **provider** is any LLM backend that Open Model Prism can forward requests to. Multiple providers can be connected simultaneously; each tenant selects which providers it has access to.

## Supported Provider Types

| Type | Description | Notes |
|---|---|---|
| `openai` | OpenAI-compatible API | Covers OpenAI, OpenRouter, LitServe, LocalAI, LM Studio, vLLM |
| `ollama` | Ollama local server | Probes `/api/tags` for model list; falls back to OpenAI-compat |
| `vllm` | vLLM inference server | OpenAI-compatible adapter |
| `bedrock` | AWS Bedrock | Routes via OpenAI adapter (Bedrock-compatible endpoint) |
| `azure` | Azure OpenAI Service | OpenAI-compatible with deployment-based model names |
| `openrouter` | OpenRouter aggregator | OpenAI-compatible; auto-discovers 100+ models |
| `custom` | Any OpenAI-compatible endpoint | Generic fallback for unlisted providers |

## Adding a Provider

1. Go to **Providers** in the sidebar
2. Click **Add Provider**
3. Enter a name and select the provider type
4. Enter the **Base URL** — do not include `/v1` or `/api/v1` (auto-detected)
5. Enter the **API Key** (leave empty for local providers like Ollama)
6. Click **Test Connection** — the connection check probes multiple path variants and logs results
7. Click **Discover Models** to auto-populate the model list

### URL Detection

Open Model Prism automatically detects the correct API path by probing:
- `<baseUrl>/v1/models`
- `<baseUrl>/api/v1/models`
- `<baseUrl>/models`

The detected path is stored as `config.options.apiPath` and used for all subsequent requests.

The setup wizard and provider form both warn if the URL contains a `/v1` suffix and offer a one-click auto-fix.

### HTTP → HTTPS Upgrade

If a connection test succeeds over HTTP but fails over HTTPS, the form suggests switching to HTTPS. If it succeeds over HTTP only, a warning is shown — the connection works but HTTPS is recommended.

## Model Discovery

After a successful connection test, click **Discover Models** (or the provider form triggers it automatically). The discovery process:

1. Fetches `/v1/models` from the provider
2. For each model: looks up the local model registry (`modelRegistry.js`) for tier, pricing, categories, and benchmark scores
3. Falls back to `models.dev` API (or offline snapshot if `OFFLINE=true`) for additional enrichment
4. Saves results to `provider.discoveredModels[]`

Discovered models can be individually edited in the **Models** page:
- Adjust tier and priority within tier (affects routing order)
- Override input/output pricing (USD per 1M tokens)
- Assign routing categories
- Toggle visibility (`visible=false` hides from tenant model lists but remains visible to admins, greyed out)
- Set `maxOutputTokens` — maximum output token limit for the model

### Max Output Tokens

Each discovered model can carry a `maxOutputTokens` field that caps the number of tokens the model is allowed to generate in a single response.

- **Auto-populated**: During model discovery, the value is filled from the model registry (`modelRegistry.js`) when a match is found.
- **Admin-configurable**: Admins can override the value per model via the provider settings (Models page).
- **Gateway enforcement**: When the gateway forwards a request, it automatically clamps the client-supplied `max_tokens` parameter to the model's `maxOutputTokens` limit before sending to the upstream provider. If the client omits `max_tokens`, the model's limit is applied as the default. This prevents requests from exceeding provider-imposed output limits and avoids upstream validation errors.

### Auto-Suggest

Each model in the registry has an **Auto-Suggest** button (wand icon) that fills tier, pricing, and categories from the built-in model registry using fuzzy matching. The matching logic runs three passes:

1. Exact ID match
2. Registry pattern is a substring of the model ID
3. Model ID is a substring of the registry pattern

## Model Registry

The local model registry (`server/data/modelRegistry.js`) contains metadata for 60+ models:

```js
{
  id:            'claude-opus-4-6',
  family:        'claude',
  vendor:        'Anthropic',
  tier:          'high',
  inputPer1M:    15.00,   // USD
  outputPer1M:   75.00,   // USD
  maxOutputTokens: 32000,
  contextWindow: 200000,
  categories:    ['reasoning_formal', 'code_generation', 'system_design'],
  patterns:      ['opus46', 'opus-4-6', 'claude-opus-4-6'],
  benchmarks: {
    intelligence: 93,
    coding:       89,
    math:         88,
    speed:        25,    // 0=slow, 100=fast
  }
}
```

### Benchmark Scores

Benchmark scores (0–100 scale) are sourced from public benchmarks (ArtificialAnalysis, LMArena, HumanEval, MATH-500) and used by the routing engine to select the most capable model for a given task type.

| Axis | Source benchmarks | Used for routing categories |
|---|---|---|
| `intelligence` | MMLU, GPQA, LMSYS Arena | General reasoning, research, document understanding |
| `coding` | HumanEval, SWE-bench | Code generation, debugging, security review |
| `math` | MATH-500, AIME | Reasoning formal, STEM science |
| `speed` | Time-to-first-token, throughput | Latency-sensitive routing |

## Connection Check

The connection check (`POST /api/prism/admin/providers/:id/check`) runs a detailed diagnostic:

```
✓ Resolved base URL: https://api.openai.com
✓ GET /v1/models returned 200
✓ Found 47 models
✓ Test chat request succeeded (model: gpt-4o-mini)
✓ Streaming test succeeded
```

Each line is logged and displayed in the UI. If the check fails at any step, the log shows exactly where to help diagnose the issue.

## Provider Adapters

All provider adapters extend `BaseAdapter` and implement:

- `chat(request)` — non-streaming chat completions
- `stream(request, onChunk)` — streaming chat completions
- `embed(request)` — embeddings
- `listModels()` — model discovery

The OpenAI-compatible adapter handles the majority of providers. Ollama has a custom adapter that translates between the Ollama format and OpenAI format. Bedrock and Azure use the OpenAI adapter with different base URL and auth patterns.
