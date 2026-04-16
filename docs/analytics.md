# Analytics & Cost Tracking

Open Model Prism tracks every gateway request and aggregates statistics at multiple levels: per-tenant, per-model, per-user, and per-day. All analytics are written asynchronously (fire-and-forget) so they never add latency to the gateway response.

## Metrics Tracked Per Request

| Field | Description |
|---|---|
| `tenantId` | Which tenant made the request |
| `userId` | User identifier (from API key or explicit header) |
| `model` | Actual model used (after routing resolution) |
| `requestedModel` | Model requested by client (may be "auto" or an alias) |
| `category` | Auto-routing category (if auto-routed) |
| `inputTokens` | Prompt + context tokens |
| `outputTokens` | Generated tokens |
| `inputCost` | Input token cost (USD) |
| `outputCost` | Output token cost (USD) |
| `actualCost` | Total actual cost |
| `baselineCost` | Cost at list price of the originally requested model |
| `saved` | `baselineCost - actualCost` (reflects routing savings) |
| `durationMs` | End-to-end request duration |
| `status` | `success` or `error` |
| `errorMessage` | Error details if status = error |
| `autoRouted` | Whether auto-routing was used |
| `contextFallback` | Whether a context overflow fallback occurred |
| `streaming` | Whether the response was streamed |

## Cost Calculation

Costs are calculated using a three-level pricing lookup:

```
1. Tenant pricing override  (set per-model on the tenant)
   ↓ not found
2. pricingDefaults.js        (flat table with fuzzy model name matching)
   ↓ not found
3. modelRegistry.js          (inputPer1M / outputPer1M fields)
   ↓ not found
4. $0.00                     (unknown model — no cost tracked)
```

The **baseline cost** is calculated at the list price of the *originally requested model* (before routing). This allows the dashboard to show how much was saved by routing to a cheaper model.

**Example:**
```
Client requests:  model="auto" (resolves to gpt-4o-mini via routing)
Baseline model:   gpt-4o (default if client had specified a model)

inputTokens:  1 200
outputTokens: 340

actualCost:   1200/1M × $0.15  +  340/1M × $0.60  = $0.000384
baselineCost: 1200/1M × $2.50  +  340/1M × $10.00 = $0.006400
saved:        $0.006016  (94% savings)
```

## Real Savings Tracking

Savings are calculated against what the user **actually requested**, not a hardcoded baseline model. This produces more accurate cost-saving figures.

- **Explicit model requests**: When a client specifies a concrete model (e.g. `model="gpt-4o"`), the baseline cost is calculated using that model's pricing. Savings reflect the difference if auto-routing selected a cheaper alternative.
- **Auto-prism calls**: When the client sends `model="auto"`, the baseline is derived from the **tenant's baseline configuration** — the default high-tier model configured for the tenant. This replaces the previous behaviour of always comparing against a single hardcoded model.

The response's `auto_routing` enrichment object now includes two additional fields:

| Field | Description |
|---|---|
| `baseline_model` | The model ID used to compute the baseline cost for this request |
| `selection_method` | How the routed model was chosen (e.g. `category_match`, `benchmark_weighted`, `fallback`) |

These fields are also persisted in the request log and are available in analytics exports.

## Daily Aggregates

For dashboard performance, per-day aggregates are maintained in `DailyStat`:

```
DailyStat {
  tenantId,
  date: "2026-04-01",
  requests:       1 240,
  autoRoutedCount: 980,
  inputTokens:    4 820 000,
  outputTokens:     920 000,
  actualCost:        18.42,
  baselineCost:      74.80,
  saved:             56.38,
}
```

Updates are written with `$inc` operators — no read-modify-write cycles.

## Dashboard

The dashboard provides an overview across all tenants (admin/maintainer) or scoped to assigned tenants (tenant-viewer/tenant-admin).

### KPI Cards

| Card | Value | Subtitle |
|---|---|---|
| Total Cost | Sum of actual cost | Last N days |
| Savings vs Baseline | Sum of saved | Percentage of baseline |
| Requests | Total request count | % auto-routed (count) |
| Input Tokens | Sum of input tokens | "Prompt / context tokens" |
| Output Tokens | Sum of output tokens | "Generated tokens" |
| Total Tokens | Input + Output | Breakdown in subtitle |

### Charts

**Cost Over Time** — Area chart, two series:
- Actual Cost ($) — filled blue
- Baseline Cost ($) — filled grey (shows what would have been spent without routing)

**Token Usage Over Time** — Stacked bar chart:
- Input Tokens (orange)
- Output Tokens (yellow)

Toggle between cost and token view with the segmented control.

**Model Usage** — Bar chart: requests per model over the selected period.

### Filters

- **Tenant selector** — filter dashboard to a single tenant (all tenants by default)
- **Time range** — Last 7 / 30 / 90 days

## Request Log

The request log shows individual requests with full details. Available to `admin`, `maintainer`, and `finops` roles.

Filters:
- **Tenant** — filter by specific tenant
- **Model** — filter by model used
- **Status** — all / success / error
- **Auto-routed** — show only auto-routed requests
- **Date range** — custom start/end

Special indicators:
- **`context_fallback` badge** — orange badge showing original → fallback model when context overflow occurred
- **`auto_routed` badge** — shows the resolved category and confidence. When `selection_method` is `benchmark_weighted`, the badge tooltip also displays the benchmark axes that influenced model selection (e.g. `coding: 89, math: 88`).
- **Error badge** — red badge with truncated error message on hover

## Token Estimation

For requests where the provider does not return token counts in the response (e.g. streaming), tokens are estimated offline:

```
estimatedTokens ≈ totalChars / 3.5
```

Adjustments:
- Code blocks counted at 1 char per token (code is denser)
- Per-message overhead: ~4 tokens per message (role + separators)
- System prompt counted separately

The token service also performs a **pre-flight check** before sending to the provider: if estimated tokens exceed the model's context window, the request is automatically upgraded to a larger-context model without the client seeing an error.

## Prometheus Metrics

Available at `/metrics` (unauthenticated — firewall in production):

- `http_requests_total` — by method, path, status
- `http_request_duration_seconds` — histogram
- `omp_gateway_requests_total` — by tenant, model, status
- `omp_gateway_tokens_total` — input/output by tenant
- `omp_gateway_cost_total` — actual cost by tenant
- Node.js default metrics (event loop lag, heap, GC)
