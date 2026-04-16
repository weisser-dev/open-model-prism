import { findDefaultPricing } from '../utils/pricingDefaults.js';
import { suggestForModel } from '../data/modelRegistry.js';

/**
 * Calculate cost in USD for a request.
 *
 * Pricing priority:
 *  1. Tenant-specific pricing override
 *  2. Provider discoveredModels pricing (passed as providerModel)
 *  3. Static pricingDefaults.js
 *  4. MODEL_REGISTRY (inputPer1M / outputPer1M)
 */
export function calcCost(modelId, inputTokens, outputTokens, tenant = null, providerModel = null) {
  // 1. Tenant-specific pricing override
  let pricing = null;
  if (tenant?.pricing) {
    const tenantPricing = tenant.pricing instanceof Map
      ? tenant.pricing.get(modelId)
      : tenant.pricing[modelId];
    if (tenantPricing) pricing = tenantPricing;
  }

  // 2. Provider discoveredModel pricing (passed directly from gateway)
  if (!pricing && providerModel?.inputPer1M != null) {
    pricing = { input: providerModel.inputPer1M, output: providerModel.outputPer1M ?? 0 };
  }

  // 3. Static pricingDefaults
  if (!pricing) pricing = findDefaultPricing(modelId);

  // 4. Model registry fallback
  if (!pricing) {
    const entry = suggestForModel(modelId);
    if (entry?.inputPer1M != null) {
      pricing = { input: entry.inputPer1M, output: entry.outputPer1M ?? 0 };
    }
  }

  if (!pricing) return 0;

  const inputCost  = (inputTokens  / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}
