/**
 * Parse a model ID that may be prefixed with a provider slug.
 *
 *   "my-anthropic/claude-haiku-4-5" → { providerSlug: "my-anthropic", modelId: "claude-haiku-4-5" }
 *   "claude-haiku-4-5"              → { providerSlug: null,           modelId: "claude-haiku-4-5" }
 *
 * Only splits on the FIRST slash. Model IDs from HuggingFace-style providers
 * (e.g. "meta-llama/Llama-3-8b") are disambiguated by checking whether the prefix
 * is a known provider slug.
 */
export function parseModelId(raw, knownSlugs) {
  const slashIdx = raw.indexOf('/');
  if (slashIdx === -1) return { providerSlug: null, modelId: raw };

  const candidate = raw.slice(0, slashIdx);
  const rest = raw.slice(slashIdx + 1);

  if (knownSlugs.has(candidate)) {
    return { providerSlug: candidate, modelId: rest };
  }

  // Not a known provider slug — treat the whole string as a model ID
  return { providerSlug: null, modelId: raw };
}
