/**
 * Default pricing for known models (USD per 1M tokens).
 * Used when tenant hasn't configured custom pricing.
 */
export const PRICING_DEFAULTS = {
  // Anthropic Claude (Bedrock eu-central-1 on-demand pricing)
  'claude-opus-4-6': { input: 5.00, output: 25.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'claude-opus-4-5': { input: 5.00, output: 25.00 },
  'claude-sonnet-4-5': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5': { input: 0.80, output: 4.00 },
  'claude-sonnet-4': { input: 3.00, output: 15.00 },
  'claude-3-7-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-5-haiku': { input: 0.80, output: 4.00 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },

  // OpenAI
  'gpt-5': { input: 10.00, output: 40.00 },
  'gpt-5-mini': { input: 1.50, output: 6.00 },
  'gpt-5-codex': { input: 3.00, output: 12.00 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1-nano': { input: 0.10, output: 0.40 },
  'codex-mini': { input: 1.50, output: 6.00 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'o1': { input: 15.00, output: 60.00 },
  'o1-mini': { input: 1.10, output: 4.40 },
  'o3': { input: 10.00, output: 40.00 },
  'o3-mini': { input: 1.10, output: 4.40 },
  'o4-mini': { input: 1.10, output: 4.40 },

  // Qwen (Bedrock / vLLM)
  'qwen3-32b': { input: 0.20, output: 0.79 },
  'qwen3-coder-30b': { input: 0.20, output: 0.60 },
  'qwen3-235b': { input: 0.29, output: 1.16 },

  // Google Gemini
  'gemini-2.5-pro': { input: 1.25, output: 10.00 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },

  // Meta Llama
  'llama-3.3-70b': { input: 0.59, output: 0.79 },
  'llama-3.1-8b': { input: 0.05, output: 0.08 },
  'llama-3.1-405b': { input: 3.00, output: 3.00 },

  // Mistral
  'mistral-large': { input: 2.00, output: 6.00 },
  'mistral-small': { input: 0.10, output: 0.30 },
  'codestral': { input: 0.30, output: 0.90 },

  // DeepSeek
  'deepseek-v3': { input: 0.27, output: 1.10 },
  'deepseek-r1': { input: 0.55, output: 2.19 },
};

/**
 * Find pricing for a model ID using fuzzy matching.
 * Tries exact match first, then partial/prefix matching.
 */
export function findDefaultPricing(modelId) {
  if (!modelId) return null;
  const lower = modelId.toLowerCase();

  // Exact match
  if (PRICING_DEFAULTS[lower]) return PRICING_DEFAULTS[lower];

  // Partial match — find the longest matching key
  let bestMatch = null;
  let bestLen = 0;
  for (const [key, pricing] of Object.entries(PRICING_DEFAULTS)) {
    if (lower.includes(key) && key.length > bestLen) {
      bestMatch = pricing;
      bestLen = key.length;
    }
  }

  return bestMatch;
}
