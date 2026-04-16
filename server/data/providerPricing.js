/**
 * Provider-specific pricing snapshots (USD per 1M tokens).
 *
 * These prices reflect the cloud provider markup, NOT direct API pricing.
 * Used to auto-assign pricing when models are discovered on a specific provider type.
 *
 * Sources:
 *   - AWS Bedrock: AWS Pricing API, eu-central-1, on-demand standard tier (2026-03)
 *   - Azure OpenAI: azure.microsoft.com/pricing/details/azure-openai (2026-Q1)
 *   - Google Gemini: ai.google.dev/gemini-api/docs/pricing (2026-Q1)
 *
 * Pattern matching: keys are lowercased substrings matched against the discovered model ID.
 * More specific patterns (longer) win over shorter ones.
 */

// ── AWS Bedrock (eu-central-1, on-demand standard) ──────────────────────────
export const BEDROCK_PRICING = {
  // Anthropic Claude (Global Cross-region, eu-central-1)
  'claude-sonnet-4-6':  { input: 3.00,   output: 15.00 },
  'claude-opus-4-6':    { input: 5.00,   output: 25.00 },
  'claude-opus-4-5':    { input: 5.00,   output: 25.00 },
  'claude-haiku-4-5':   { input: 1.00,   output: 5.00 },
  'claude-sonnet-4-5':  { input: 3.00,   output: 15.00 },
  'claude-sonnet-4':    { input: 3.00,   output: 15.00 },
  'claude-3-7-sonnet':  { input: 3.00,   output: 15.00 },
  'claude-3-5-sonnet':  { input: 3.00,   output: 15.00 },
  'claude-3-haiku':     { input: 0.25,   output: 1.25 },
  'claude-3-sonnet':    { input: 3.00,   output: 15.00 },

  // Amazon Nova
  'nova-2-lite':       { input: 0.39,   output: 3.27 },
  'nova-2-omni':       { input: 0.40,   output: 3.30 },
  'nova-2-pro':        { input: 1.63,   output: 13.08 },
  'nova-lite':         { input: 0.078,  output: 0.31 },
  'nova-micro':        { input: 0.046,  output: 0.18 },
  'nova-pro':          { input: 0.26,   output: 4.20 },

  // DeepSeek
  'deepseek-v3-1':     { input: 0.70,   output: 2.02 },
  'deepseek-v3-2':     { input: 0.37,   output: 1.11 },
  'deepseek-r1':       { input: 0.70,   output: 2.02 },

  // Google Gemma
  'gemma-3-12b':       { input: 0.11,   output: 0.17 },
  'gemma-3-27b':       { input: 0.28,   output: 0.46 },
  'gemma-3-4b':        { input: 0.024,  output: 0.048 },

  // Meta Llama
  'llama-3-2-1b':      { input: 0.13,   output: 0.13 },
  'llama-3-2-3b':      { input: 0.19,   output: 0.19 },
  'llama3-2-1b':       { input: 0.13,   output: 0.13 },
  'llama3-2-3b':       { input: 0.19,   output: 0.19 },

  // Minimax
  'minimax-m2.5':      { input: 0.36,   output: 1.44 },
  'minimax-m2.1':      { input: 0.36,   output: 1.44 },

  // Mistral
  'magistral-small':   { input: 0.60,   output: 1.80 },
  'ministral-14b':     { input: 0.12,   output: 0.12 },
  'ministral-3b':      { input: 0.06,   output: 0.06 },
  'ministral-8b':      { input: 0.18,   output: 0.09 },
  'mistral-large':     { input: 0.30,   output: 1.80 },
  'pixtral-large':     { input: 2.00,   output: 6.00 },
  'devstral':          { input: 0.48,   output: 1.20 },
  'voxtral-mini':      { input: 0.048,  output: 0.024 },
  'voxtral-small':     { input: 0.06,   output: 0.36 },

  // Moonshot AI
  'kimi-k2-thinking':  { input: 0.73,   output: 3.03 },
  'kimi-k2.5':         { input: 0.72,   output: 3.60 },

  // Nvidia
  'nemotron-nano-3':   { input: 0.072,  output: 0.14 },
  'nemotron-3-super':  { input: 0.09,   output: 0.78 },
  'nemotron-nano-2-vl':{ input: 0.12,   output: 0.36 },
  'nemotron-nano-2':   { input: 0.036,  output: 0.28 },

  // OpenAI on Bedrock
  'gpt-oss-120b':      { input: 0.20,   output: 0.79 },
  'gpt-oss-20b':       { input: 0.09,   output: 0.40 },
  'gpt-oss-safeguard-120b': { input: 0.09, output: 0.72 },
  'gpt-oss-safeguard-20b':  { input: 0.042, output: 0.24 },

  // Qwen
  'qwen3-235b':        { input: 0.29,   output: 1.16 },
  'qwen3-32b':         { input: 0.20,   output: 0.79 },
  'qwen3-coder-480b':  { input: 0.27,   output: 2.16 },
  'qwen3-coder-30b':   { input: 0.20,   output: 0.79 },
  'qwen3-coder-next':  { input: 0.60,   output: 0.72 },
  'qwen3-next-80b':    { input: 0.084,  output: 0.72 },
  'qwen3-vl-235b':     { input: 0.64,   output: 1.60 },

  // Writer
  'palmyra-vision':    { input: 0.09,   output: 0.36 },

  // Z AI
  'glm-5':             { input: 1.20,   output: 3.84 },
  'glm-4-7':           { input: 0.72,   output: 2.64 },
};

// ── Azure OpenAI (updated 2026-04-09 from azure.microsoft.com/pricing) ──────
export const AZURE_PRICING = {
  // GPT-5.4 family (latest)
  'gpt-5.4':           { input: 2.50,   output: 15.00 },
  'gpt-5.4-mini':      { input: 0.75,   output: 4.50 },
  'gpt-5.4-nano':      { input: 0.20,   output: 1.25 },

  // GPT-5.3 family — ChatGPT
  'gpt-5.3-chat':      { input: 1.75,   output: 14.00 },
  'gpt-5.3-chat-latest': { input: 1.75, output: 14.00 },

  // GPT-5.3 family — Codex (Responses API)
  'gpt-5.3-codex':     { input: 1.75,   output: 14.00 },

  // GPT-5.2 family
  'gpt-5.2':           { input: 1.75,   output: 14.00 },
  'gpt-5.2-chat-latest': { input: 1.75, output: 14.00 },
  'gpt-5.2-codex':     { input: 1.75,   output: 14.00 },

  // GPT-5.1 family
  'gpt-5.1':           { input: 1.25,   output: 10.00 },
  'gpt-5.1-chat-latest': { input: 1.25, output: 10.00 },
  'gpt-5.1-codex':     { input: 1.25,   output: 10.00 },
  'gpt-5.1-codex-max': { input: 1.25,   output: 10.00 },
  'gpt-5.1-codex-mini': { input: 0.25,  output: 2.00 },

  // GPT-5 family
  'gpt-5':             { input: 1.25,   output: 10.00 },
  'gpt-5-chat-latest': { input: 1.25,   output: 10.00 },
  'gpt-5-codex':       { input: 1.25,   output: 10.00 },

  // Codex standalone
  'codex-mini':        { input: 1.50,   output: 6.00 },
  'codex-mini-latest': { input: 1.50,   output: 6.00 },

  // ChatGPT-4o
  'chatgpt-4o-latest': { input: 5.00,   output: 15.00 },

  // GPT-4.1 family
  'gpt-4.1':           { input: 2.00,   output: 8.00 },
  'gpt-4-1':           { input: 2.00,   output: 8.00 },
  'gpt-4.1-mini':      { input: 0.40,   output: 1.60 },
  'gpt-4-1-mini':      { input: 0.40,   output: 1.60 },
  'gpt-4.1-nano':      { input: 0.10,   output: 0.40 },
  'gpt-4-1-nano':      { input: 0.10,   output: 0.40 },

  // GPT-4o family
  'gpt-4o':            { input: 2.50,   output: 10.00 },
  'gpt-4o-2024':       { input: 2.50,   output: 10.00 },
  'gpt-4o-mini':       { input: 0.15,   output: 0.60 },

  // Search models
  'gpt-5-search-api':  { input: 1.25,   output: 10.00 },
  'gpt-4o-search-preview': { input: 2.50, output: 10.00 },
  'gpt-4o-mini-search-preview': { input: 0.15, output: 0.60 },

  // Deep research
  'o3-deep-research':  { input: 10.00,  output: 40.00 },
  'o4-mini-deep-research': { input: 2.00, output: 8.00 },

  // Computer use
  'computer-use-preview': { input: 3.00, output: 12.00 },

  // o-series reasoning
  'o3':                { input: 10.00,  output: 40.00 },
  'o3-mini':           { input: 1.10,   output: 4.40 },
  'o4-mini':           { input: 1.10,   output: 4.40 },
  'o1':                { input: 15.00,  output: 60.00 },
  'o1-mini':           { input: 1.10,   output: 4.40 },

  // Legacy
  'gpt-4-turbo':       { input: 10.00,  output: 30.00 },
  'gpt-4':             { input: 30.00,  output: 60.00 },
  'gpt-3.5-turbo':     { input: 0.50,   output: 1.50 },
};

// ── Google Gemini (direct API pricing) ──────────────────────────────────────
export const GEMINI_PRICING = {
  // Gemini 3.x
  'gemini-3.1-pro':    { input: 2.00,   output: 12.00 },
  'gemini-3-1-pro':    { input: 2.00,   output: 12.00 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.50 },
  'gemini-3-flash':    { input: 0.50,   output: 3.00 },

  // Gemini 2.5
  'gemini-2.5-pro':    { input: 1.25,   output: 10.00 },
  'gemini-2-5-pro':    { input: 1.25,   output: 10.00 },
  'gemini-2.5-flash':  { input: 0.30,   output: 2.50 },
  'gemini-2-5-flash':  { input: 0.30,   output: 2.50 },
  'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },

  // Gemini 2.0
  'gemini-2.0-flash':  { input: 0.10,   output: 0.40 },
  'gemini-2-0-flash':  { input: 0.10,   output: 0.40 },

  // Gemini 1.5
  'gemini-1.5-pro':    { input: 1.25,   output: 5.00 },
  'gemini-1.5-flash':  { input: 0.075,  output: 0.30 },
};

// ── OpenAI direct API ───────────────────────────────────────────────────────
export const OPENAI_PRICING = {
  // GPT-5
  'gpt-5':             { input: 10.00,  output: 40.00 },
  'gpt-5-mini':        { input: 1.50,   output: 6.00 },

  // GPT-4.1 family
  'gpt-4.1':           { input: 2.00,   output: 8.00 },
  'gpt-4-1':           { input: 2.00,   output: 8.00 },
  'gpt-4.1-mini':      { input: 0.40,   output: 1.60 },
  'gpt-4-1-mini':      { input: 0.40,   output: 1.60 },
  'gpt-4.1-nano':      { input: 0.10,   output: 0.40 },
  'gpt-4-1-nano':      { input: 0.10,   output: 0.40 },

  // GPT-4o
  'gpt-4o-mini':       { input: 0.15,   output: 0.60 },
  'gpt-4o':            { input: 2.50,   output: 10.00 },

  // GPT-4 legacy
  'gpt-4-turbo':       { input: 10.00,  output: 30.00 },
  'gpt-4':             { input: 30.00,  output: 60.00 },
  'gpt-3.5-turbo':     { input: 0.50,   output: 1.50 },

  // o-series
  'o3':                { input: 10.00,  output: 40.00 },
  'o3-mini':           { input: 1.10,   output: 4.40 },
  'o4-mini':           { input: 1.10,   output: 4.40 },
  'o1':                { input: 15.00,  output: 60.00 },
  'o1-mini':           { input: 1.10,   output: 4.40 },

  // Codex
  'codex-mini':        { input: 1.50,   output: 6.00 },
  'codex':             { input: 3.00,   output: 12.00 },
};

// ── Anthropic direct API ────────────────────────────────────────────────────
export const ANTHROPIC_PRICING = {
  'claude-opus-4':     { input: 15.00,  output: 75.00 },
  'claude-sonnet-4':   { input: 3.00,   output: 15.00 },
  'claude-haiku-4':    { input: 1.00,   output: 5.00 },
  'claude-3-5-sonnet': { input: 3.00,   output: 15.00 },
  'claude-3-5-haiku':  { input: 0.80,   output: 4.00 },
  'claude-3-opus':     { input: 15.00,  output: 75.00 },
  'claude-3-sonnet':   { input: 3.00,   output: 15.00 },
  'claude-3-haiku':    { input: 0.25,   output: 1.25 },
};

// ── Map provider type/name keywords to pricing tables ───────────────────────
const PROVIDER_PRICING_MAP = [
  { keywords: ['bedrock'],                        table: BEDROCK_PRICING },
  { keywords: ['azure', 'az-openai'],             table: AZURE_PRICING },
  { keywords: ['gemini', 'google', 'vertex'],     table: GEMINI_PRICING },
  { keywords: ['anthropic', 'claude'],             table: ANTHROPIC_PRICING },
  { keywords: ['openai', 'openrouter'],            table: OPENAI_PRICING },
];

/**
 * Find the best pricing table for a given provider type and name.
 */
export function getPricingTableForProvider(providerType, providerName) {
  const combined = `${providerType} ${providerName}`.toLowerCase();
  for (const entry of PROVIDER_PRICING_MAP) {
    if (entry.keywords.some(kw => combined.includes(kw))) {
      return entry.table;
    }
  }
  return null;
}

/**
 * Look up pricing for a model ID in a specific pricing table.
 * Uses longest-match-wins strategy for fuzzy matching.
 */
export function lookupModelPricing(modelId, pricingTable) {
  if (!modelId || !pricingTable) return null;
  const normalized = modelId.toLowerCase().replace(/[_.:/]/g, '-');

  // Exact match first
  if (pricingTable[normalized]) return pricingTable[normalized];

  // Longest substring match
  let bestMatch = null;
  let bestLen = 0;
  for (const [pattern, pricing] of Object.entries(pricingTable)) {
    if (normalized.includes(pattern) && pattern.length > bestLen) {
      bestMatch = pricing;
      bestLen = pattern.length;
    }
  }

  return bestMatch;
}

/**
 * Auto-assign pricing for a discovered model based on provider context.
 * Returns { inputPer1M, outputPer1M } or null if no match found.
 */
export function suggestProviderPricing(modelId, providerType, providerName) {
  const table = getPricingTableForProvider(providerType, providerName);
  if (!table) return null;
  return lookupModelPricing(modelId, table);
}
