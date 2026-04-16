/**
 * Model Enrichment Service
 *
 * Fetches live model data from models.dev/api.json and optionally OpenRouter.
 * Used as a fallback when the local registry doesn't recognise a model ID.
 *
 * Data is cached in memory and refreshed every 6 hours.
 * Fails silently — the local registry always works offline.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import logger from '../utils/logger.js';
import config from '../config.js';
import { normalise } from '../data/modelRegistry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const require    = createRequire(import.meta.url);

const MODELS_DEV_URL  = 'https://models.dev/api.json';
const SNAPSHOT_PATH   = join(__dirname, '../data/modelsDev.snapshot.json');
const CACHE_TTL_MS    = 6 * 60 * 60 * 1000; // 6 hours
const FETCH_TIMEOUT   = 10_000;

let cache = null;      // { flat: Map<normId, entry>, raw: Object, fetchedAt: Date }
let fetchPromise = null;

/** Infer a cost tier from pricing data */
function inferTier(cost) {
  if (!cost) return null;
  const input  = Number(cost.input  ?? 0);
  const output = Number(cost.output ?? 0);
  // Weight output 2× (it's usually 3-5× more expensive)
  const weighted = (input + output * 2) / 3;
  if (weighted >= 10)  return 'high';
  if (weighted >= 2)   return 'medium';
  if (weighted >= 0.3) return 'low';
  if (weighted > 0)    return 'minimal';
  return null; // free / unknown pricing
}

/** Infer capability categories from model flags + modalities */
function inferCategories(model) {
  const cats = [];
  const name = (model.name || model.id || '').toLowerCase();
  const input = model.modalities?.input || [];

  if (model.reasoning)          cats.push('reasoning_deep');
  if (input.includes('image'))  cats.push('vision_complex');
  if (model.tool_call)          cats.push('tool_use');
  if (/cod(e|ing|er)/i.test(name)) cats.push('coding_complex');
  if (/embed/i.test(name))      cats.push('classification_extraction');
  if (/flash|mini|nano|lite|small/i.test(name)) cats.push('summarization_short');

  return [...new Set(cats)];
}

/** Load the bundled offline snapshot (used when OFFLINE=true) */
function loadOfflineSnapshot() {
  try {
    const raw = require(SNAPSHOT_PATH);
    const result = parseModelsDevData(raw);
    logger.info(`[enrichment] Offline snapshot loaded: ${result.flat.size} models`);
    return result;
  } catch (err) {
    logger.warn(`[enrichment] Could not load offline snapshot: ${err.message}`);
    return null;
  }
}

/** Parse a models.dev-compatible JSON object into our flat Map format */
function parseModelsDevData(raw) {
  const flat = new Map();

  for (const [providerId, provider] of Object.entries(raw)) {
    if (!provider?.models || typeof provider.models !== 'object') continue;

    for (const [modelId, model] of Object.entries(provider.models)) {
      const entry = {
        id:           modelId,
        providerId,
        providerName: provider.name || providerId,
        name:         model.name || modelId,
        tier:         inferTier(model.cost),
        inputPer1M:   model.cost?.input  != null ? Number(model.cost.input)  : null,
        outputPer1M:  model.cost?.output != null ? Number(model.cost.output) : null,
        contextWindow:model.limit?.context ?? null,
        categories:   inferCategories(model),
        reasoning:    model.reasoning ?? false,
        openWeights:  model.open_weights ?? false,
        knowledge:    model.knowledge ?? null,
        source:       'models_dev',
      };

      const normId = normalise(modelId);
      if (!flat.has(normId) || (entry.inputPer1M != null && flat.get(normId).inputPer1M == null)) {
        flat.set(normId, entry);
      }

      const qualified = normalise(`${providerId}/${modelId}`);
      if (!flat.has(qualified)) flat.set(qualified, entry);
    }
  }

  return { flat, raw, fetchedAt: new Date() };
}

/** Fetch and parse models.dev data into a flat Map keyed by normalised ID */
async function fetchModelsDevData() {
  if (config.offline) {
    logger.info('[enrichment] Offline mode — loading snapshot instead of fetching models.dev');
    return loadOfflineSnapshot();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const res = await fetch(MODELS_DEV_URL, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': 'open-model-prism/0.5' },
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const result = parseModelsDevData(raw);
    logger.info(`[enrichment] Loaded ${result.flat.size} models from models.dev`);
    return result;
  } catch (err) {
    clearTimeout(timer);
    logger.warn(`[enrichment] Could not fetch models.dev: ${err.message} — falling back to snapshot`);
    // Network error: fall back to offline snapshot
    return loadOfflineSnapshot();
  }
}

/** Get cached data, fetching if stale or missing */
async function getCache() {
  if (cache && (Date.now() - cache.fetchedAt) < CACHE_TTL_MS) return cache;

  // Prevent concurrent fetches
  if (!fetchPromise) {
    fetchPromise = fetchModelsDevData().then(result => {
      if (result) cache = result;
      fetchPromise = null;
      return result;
    });
  }

  return fetchPromise;
}

/**
 * Look up enrichment data for a model ID from the live models.dev registry.
 * Returns null if not found or if fetch failed.
 */
export async function suggestFromWeb(modelId) {
  if (!modelId) return null;

  const data = await getCache();
  if (!data) return null;

  const needle = normalise(modelId);

  // Pass 1: exact normalised match
  if (data.flat.has(needle)) return data.flat.get(needle);

  // Pass 2: needle contains a known key (longest wins)
  let best = null, bestLen = 0;
  for (const [key, entry] of data.flat) {
    if (needle.includes(key) && key.length > bestLen) {
      best = entry; bestLen = key.length;
    }
  }
  if (best) return best;

  // Pass 3: a known key contains the needle
  for (const [key, entry] of data.flat) {
    if (key.includes(needle) && needle.length >= 3) return entry;
  }

  return null;
}

/** Pre-warm the cache at startup (non-blocking) */
export function warmCache() {
  if (config.offline) return; // skip in offline mode
  getCache().catch(() => {});
}
