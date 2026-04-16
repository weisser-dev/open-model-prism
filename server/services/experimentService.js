import crypto from 'node:crypto';
import Experiment from '../models/Experiment.js';

// ── In-memory cache: tenantId → { experiments, expiresAt } ──────────────────
const cache = new Map();
const CACHE_TTL_MS = 60_000;

/**
 * Find an active experiment for the given tenant and optional routing category.
 * Results are cached per tenant for 60 s.
 *
 * @param {import('mongoose').Types.ObjectId|string} tenantId
 * @param {string} [category]
 * @returns {Promise<import('../models/Experiment.js').default|null>}
 */
export async function getActiveExperiment(tenantId, category) {
  const key = String(tenantId);
  const now = Date.now();

  let entry = cache.get(key);
  if (!entry || entry.expiresAt <= now) {
    const experiments = await Experiment.find({
      tenantId,
      status: 'active',
    }).lean();
    entry = { experiments, expiresAt: now + CACHE_TTL_MS };
    cache.set(key, entry);
  }

  for (const exp of entry.experiments) {
    // Empty targetCategories means "match all categories"
    if (
      exp.targetCategories.length === 0 ||
      (category && exp.targetCategories.includes(category))
    ) {
      return exp;
    }
  }

  return null;
}

/**
 * Deterministic variant selection using a hash of experimentId + sessionId.
 * The same session always receives the same variant.
 *
 * @param {object} experiment  Experiment document (or lean object)
 * @param {string} sessionId   Unique session / request-group identifier
 * @returns {{ variantName: string, model: string, providerId: import('mongoose').Types.ObjectId|null }}
 */
export function selectVariant(experiment, sessionId) {
  const { variants } = experiment;
  if (!variants || variants.length === 0) {
    throw new Error('Experiment has no variants');
  }

  const hash = crypto
    .createHash('sha256')
    .update(`${experiment._id}${sessionId}`)
    .digest();

  // Use first 4 bytes as a 32-bit unsigned integer
  const hashValue = hash.readUInt32BE(0);
  const totalWeight = variants.reduce((sum, v) => sum + (v.weight ?? 50), 0);
  const bucket = hashValue % totalWeight;

  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.weight ?? 50;
    if (bucket < cumulative) {
      return {
        variantName: variant.name,
        model: variant.model,
        providerId: variant.providerId ?? null,
      };
    }
  }

  // Fallback (should never reach here)
  const last = variants[variants.length - 1];
  return {
    variantName: last.name,
    model: last.model,
    providerId: last.providerId ?? null,
  };
}

/**
 * Atomically increment metrics for a specific variant inside an experiment.
 *
 * @param {string} experimentId
 * @param {string} variantName
 * @param {object} result
 * @param {number}  [result.inputTokens]
 * @param {number}  [result.outputTokens]
 * @param {number}  [result.costUsd]
 * @param {boolean} [result.error]
 * @param {number}  [result.qualityScore]
 * @param {number}  [result.latencyMs]
 * @returns {Promise<import('../models/Experiment.js').default|null>}
 */
export async function recordResult(experimentId, variantName, {
  inputTokens = 0,
  outputTokens = 0,
  costUsd = 0,
  error = false,
  qualityScore,
  latencyMs = 0,
} = {}) {
  const inc = {
    'metrics.$[m].requests':         1,
    'metrics.$[m].totalInputTokens':  inputTokens,
    'metrics.$[m].totalOutputTokens': outputTokens,
    'metrics.$[m].totalCostUsd':      costUsd,
    'metrics.$[m].totalLatencyMs':    latencyMs,
  };

  if (error) {
    inc['metrics.$[m].errorCount'] = 1;
  }

  if (qualityScore != null) {
    inc['metrics.$[m].totalQualityScore'] = qualityScore;
    inc['metrics.$[m].qualityCount'] = 1;
  }

  return Experiment.findOneAndUpdate(
    { _id: experimentId },
    { $inc: inc },
    {
      arrayFilters: [{ 'm.variantName': variantName }],
      new: true,
    },
  );
}

// ── Statistical helpers ─────────────────────────────────────────────────────

/**
 * Two-tailed z-test for two proportions (e.g. error rates).
 * @returns {{ z: number, significant: boolean }}
 */
function zTestProportions(successes1, n1, successes2, n2, alpha = 0.05) {
  if (n1 === 0 || n2 === 0) return { z: 0, significant: false };
  const p1 = successes1 / n1;
  const p2 = successes2 / n2;
  const pPool = (successes1 + successes2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  if (se === 0) return { z: 0, significant: false };
  const z = (p1 - p2) / se;
  // z_crit ≈ 1.96 for α = 0.05 two-tailed
  const zCrit = alpha === 0.05 ? 1.96 : 2.576;
  return { z, significant: Math.abs(z) > zCrit };
}

/**
 * Two-tailed z-test for two means (using normal approximation).
 * Requires variance estimates — we use sample variance computed from totals.
 * Since we only store totals (not individual observations), we approximate
 * the standard error using the mean itself as a rough proxy for spread.
 * For a production system you would store sum-of-squares; this is a
 * pragmatic approximation.
 *
 * @returns {{ z: number, significant: boolean }}
 */
function zTestMeans(mean1, n1, mean2, n2, alpha = 0.05) {
  if (n1 < 2 || n2 < 2) return { z: 0, significant: false };
  // Approximate SD as fraction of mean (coefficient of variation ≈ 0.5)
  const cv = 0.5;
  const sd1 = Math.abs(mean1) * cv || 1;
  const sd2 = Math.abs(mean2) * cv || 1;
  const se = Math.sqrt((sd1 * sd1) / n1 + (sd2 * sd2) / n2);
  if (se === 0) return { z: 0, significant: false };
  const z = (mean1 - mean2) / se;
  const zCrit = alpha === 0.05 ? 1.96 : 2.576;
  return { z, significant: Math.abs(z) > zCrit };
}

/**
 * Analyse an experiment: per-variant stats and simple significance tests.
 *
 * @param {string} experimentId
 * @returns {Promise<{
 *   variants: Array<{ name: string, stats: object, sampleSize: number }>,
 *   significant: boolean,
 *   recommendation: string,
 * }>}
 */
export async function analyzeExperiment(experimentId) {
  const experiment = await Experiment.findById(experimentId).lean();
  if (!experiment) throw new Error('Experiment not found');

  const variantStats = experiment.metrics.map((m) => {
    const n = m.requests || 0;
    const avgCost    = n > 0 ? m.totalCostUsd / n : 0;
    const avgLatency = n > 0 ? m.totalLatencyMs / n : 0;
    const errorRate  = n > 0 ? m.errorCount / n : 0;
    const avgQuality = m.qualityCount > 0
      ? m.totalQualityScore / m.qualityCount
      : null;

    return {
      name: m.variantName,
      sampleSize: n,
      stats: {
        avgCostUsd: avgCost,
        avgLatencyMs: avgLatency,
        errorRate,
        avgQuality,
        totalRequests: n,
        totalErrors: m.errorCount,
      },
    };
  });

  // Determine significance: compare first variant (control) against each other
  let significant = false;
  let recommendation = 'Insufficient data or no significant difference detected.';

  if (variantStats.length >= 2) {
    const control = variantStats[0];
    const minSample = experiment.minSampleSize ?? 100;

    const allAboveMin = variantStats.every((v) => v.sampleSize >= minSample);
    if (!allAboveMin) {
      recommendation = `Waiting for minimum sample size (${minSample}) across all variants.`;
    } else {
      let bestVariant = control;
      let bestScore = -Infinity;

      for (const v of variantStats) {
        // Composite score: lower cost + lower error rate + higher quality
        const quality = v.stats.avgQuality ?? 0;
        const score = quality - v.stats.errorRate * 100 - v.stats.avgCostUsd * 10;
        if (score > bestScore) {
          bestScore = score;
          bestVariant = v;
        }
      }

      // Run z-tests between control and best challenger
      for (let i = 1; i < variantStats.length; i++) {
        const challenger = variantStats[i];

        const errTest = zTestProportions(
          control.stats.totalErrors, control.sampleSize,
          challenger.stats.totalErrors, challenger.sampleSize,
        );
        const costTest = zTestMeans(
          control.stats.avgCostUsd, control.sampleSize,
          challenger.stats.avgCostUsd, challenger.sampleSize,
        );
        const qualityTest = (control.stats.avgQuality != null && challenger.stats.avgQuality != null)
          ? zTestMeans(
              control.stats.avgQuality, control.sampleSize,
              challenger.stats.avgQuality, challenger.sampleSize,
            )
          : { significant: false };

        if (errTest.significant || costTest.significant || qualityTest.significant) {
          significant = true;
        }
      }

      if (significant) {
        if (bestVariant.name === control.name) {
          recommendation = `Control variant "${control.name}" performs best. No change recommended.`;
        } else {
          recommendation = `Variant "${bestVariant.name}" outperforms control. Consider promoting it.`;
        }
      } else {
        recommendation = 'No statistically significant difference detected between variants.';
      }
    }
  }

  return { variants: variantStats, significant, recommendation };
}

/**
 * Clear the active-experiment cache (call after creating / updating experiments).
 */
export function invalidateExperimentCache() {
  cache.clear();
}
