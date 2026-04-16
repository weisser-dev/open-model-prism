import { Router } from 'express';
import RoutingRuleSet from '../../models/RoutingRuleSet.js';
import RoutingCategory from '../../models/RoutingCategory.js';
import RequestLog from '../../models/RequestLog.js';
import Tenant from '../../models/Tenant.js';
import {
  invalidateRuleSetCache, applyOverrides, getCategories,
  buildClassifierPrompt,
} from '../../services/routerEngine.js';
import Provider from '../../models/Provider.js';
import { getProviderAdapter } from '../../providers/index.js';
import { extractSignals, applyRuleSet, buildClassifierContext } from '../../services/signalExtractor.js';
import { calcCost } from '../../services/pricingService.js';
import { logRequest } from '../../services/analyticsEngine.js';
import SyntheticTest, { TestRun } from '../../models/SyntheticTest.js';
import { adminOrMaint, canViewCosts } from '../../middleware/rbac.js';
import { logConfigChange } from '../../services/auditService.js';

const router = Router();

// ── GET /api/admin/routing/rule-sets ─────────────────────────────────────────
router.get('/rule-sets', canViewCosts, async (req, res) => {
  const sets = await RoutingRuleSet.find().sort({ isGlobalDefault: -1, createdAt: 1 }).lean();
  res.json(sets);
});

// ── GET /api/admin/routing/rule-sets/:id ─────────────────────────────────────
router.get('/rule-sets/:id', canViewCosts, async (req, res) => {
  const rs = await RoutingRuleSet.findById(req.params.id).lean();
  if (!rs) return res.status(404).json({ error: 'Rule set not found' });
  res.json(rs);
});

// ── POST /api/admin/routing/rule-sets ────────────────────────────────────────
router.post('/rule-sets', adminOrMaint, async (req, res) => {
  const { name, description, isGlobalDefault, tenantId, tokenThresholds, signalWeights,
          turnUpgrade, keywordRules, systemPromptRoles, classifier } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  // Unset any existing global default if this one claims it
  if (isGlobalDefault) {
    await RoutingRuleSet.updateMany({ isGlobalDefault: true }, { $set: { isGlobalDefault: false } });
  }

  const rs = await RoutingRuleSet.create({
    name, description, isGlobalDefault: !!isGlobalDefault,
    tenantId: tenantId || null,
    tokenThresholds, signalWeights, turnUpgrade,
    keywordRules: keywordRules || [],
    systemPromptRoles: systemPromptRoles || [],
    classifier,
  });
  invalidateRuleSetCache();
  logConfigChange({ user: req.user?.username, action: 'create', target: 'rule-set', targetId: rs._id, targetName: name });
  res.status(201).json(rs);
});

// ── PUT /api/admin/routing/rule-sets/:id ─────────────────────────────────────
router.put('/rule-sets/:id', adminOrMaint, async (req, res) => {
  const { name, description, isGlobalDefault, tenantId, tokenThresholds, signalWeights,
          turnUpgrade, keywordRules, systemPromptRoles, classifier, costMode, tierBoost } = req.body;

  const before = await RoutingRuleSet.findById(req.params.id).lean();

  if (isGlobalDefault) {
    await RoutingRuleSet.updateMany(
      { isGlobalDefault: true, _id: { $ne: req.params.id } },
      { $set: { isGlobalDefault: false } }
    );
  }

  const rs = await RoutingRuleSet.findByIdAndUpdate(
    req.params.id,
    { $set: { name, description, isGlobalDefault: !!isGlobalDefault,
              tenantId: tenantId || null, tokenThresholds, signalWeights,
              turnUpgrade, keywordRules, systemPromptRoles, classifier,
              costMode: costMode || 'balanced',
              tierBoost: tierBoost != null ? Math.max(-2, Math.min(2, Number(tierBoost) || 0)) : 0 } },
    { new: true, runValidators: true }
  );
  if (!rs) return res.status(404).json({ error: 'Rule set not found' });
  invalidateRuleSetCache();
  logConfigChange({ user: req.user?.username, action: 'update', target: 'rule-set', targetId: rs._id, targetName: rs.name, before, after: rs.toObject() });
  res.json(rs);
});

// ── DELETE /api/admin/routing/rule-sets/:id ───────────────────────────────────
router.delete('/rule-sets/:id', adminOrMaint, async (req, res) => {
  const rs = await RoutingRuleSet.findById(req.params.id);
  if (!rs) return res.status(404).json({ error: 'Rule set not found' });
  if (rs.isDefault) return res.status(403).json({ error: 'Cannot delete the default rule set' });
  await rs.deleteOne();
  invalidateRuleSetCache();
  res.json({ deleted: true });
});

// ── POST /api/admin/routing/rule-sets/:id/set-default ────────────────────────
router.post('/rule-sets/:id/set-default', adminOrMaint, async (req, res) => {
  await RoutingRuleSet.updateMany({ isGlobalDefault: true }, { $set: { isGlobalDefault: false } });
  const rs = await RoutingRuleSet.findByIdAndUpdate(
    req.params.id,
    { $set: { isGlobalDefault: true } },
    { new: true }
  );
  if (!rs) return res.status(404).json({ error: 'Rule set not found' });
  invalidateRuleSetCache();
  res.json(rs);
});

// ── POST /api/admin/routing/rule-sets/seed-defaults ──────────────────────────
// Creates a sensible default rule set if none exists
router.post('/rule-sets/seed-defaults', adminOrMaint, async (req, res) => {
  const existing = await RoutingRuleSet.findOne({ isGlobalDefault: true });
  if (existing) return res.json({ created: false, ruleSet: existing });

  const rs = await RoutingRuleSet.create({
    name:            'Default Rule Set',
    description:     'Sensible defaults — edit to match your workload',
    isGlobalDefault: true,
    tokenThresholds: { micro: 150, minimal: 500, low: 2000, medium: 15000, alwaysHigh: 50000 },
    signalWeights:   { tokenCount: 0.8, systemPromptRole: 0.9, contentKeywords: 0.85, codeLanguage: 0.7, conversationTurns: 0.4 },
    turnUpgrade:     { enabled: true, threshold: 4 },
    classifier:      { confidenceThreshold: 0.65, contextLimitTokens: 4000, contextStrategy: 'truncate' },
    keywordRules: [
      {
        name: 'Security Escalation', enabled: true, searchIn: 'all', match: 'any', minMatches: 2,
        keywords: ['private key', 'secret key', 'vulnerability', 'exploit', 'CVE-', 'sql injection', 'XSS', 'CSRF', 'cryptograph', 'jwt secret', 'authorization bypass'],
        effect: { category: 'code_security_review', tierMin: 'high', domain: '' },
      },
      {
        name: 'Legal Domain', enabled: true, searchIn: 'all', match: 'any', minMatches: 1,
        keywords: ['GDPR', 'NDA', 'non-disclosure', 'liability', 'compliance', 'regulation', 'contract clause', 'intellectual property', 'data processing agreement'],
        effect: { category: '', tierMin: 'medium', domain: 'legal' },
      },
      {
        name: 'Medical Domain', enabled: true, searchIn: 'all', match: 'any', minMatches: 1,
        keywords: ['diagnosis', 'ICD-', 'treatment protocol', 'medication', 'clinical trial', 'differential diagnosis', 'contraindication'],
        effect: { category: '', tierMin: 'medium', domain: 'medical' },
      },
      {
        name: 'Finance Domain', enabled: true, searchIn: 'all', match: 'any', minMatches: 1,
        keywords: ['balance sheet', 'income statement', 'EBITDA', 'cash flow statement', 'quarterly earnings', 'fiscal year'],
        effect: { category: '', tierMin: 'medium', domain: 'finance' },
      },
    ],
    systemPromptRoles: [
      {
        name: 'Security Auditor', enabled: true,
        pattern: 'security.*(audit|review|pentest|penetration)|vulnerability.*(scan|assessment)',
        effect: { category: 'code_security_review', tierMin: 'high', domain: '' },
      },
      {
        name: 'Customer Support', enabled: true,
        pattern: 'customer.*(support|service|helpdesk|care)|support.*(agent|representative)',
        effect: { category: 'customer_support', tierMin: 'low', domain: '' },
      },
      {
        name: 'Legal Advisor', enabled: true,
        pattern: 'legal.*(advisor|counsel|compliance)|compliance.*(officer|manager)',
        effect: { category: '', tierMin: 'medium', domain: 'legal' },
      },
      {
        name: 'Data Scientist', enabled: true,
        pattern: 'data.*(scientist|analyst|engineer)|machine.?learning|statistical.*(analysis|model)',
        effect: { category: 'data_analysis', tierMin: 'medium', domain: '' },
      },
    ],
  });
  invalidateRuleSetCache();
  res.status(201).json({ created: true, ruleSet: rs });
});

// ── POST /api/admin/routing/test-route ───────────────────────────────────────
// Dry-run a prompt through the full routing pipeline and return a step-by-step trace.
// When useClassifier=true, makes a real LLM call to the classifier — costs money.
router.post('/test-route', adminOrMaint, async (req, res) => {
  const { prompt, systemPrompt, tenantId, useClassifier = false } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });

  const tenant = await Tenant.findById(tenantId).lean();
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const startTime = Date.now();
  const trace = [];
  const TIERS = ['micro', 'minimal', 'low', 'medium', 'advanced', 'high', 'ultra', 'critical'];

  // Build synthetic chatRequest
  const chatRequest = {
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      { role: 'user', content: prompt },
    ],
  };

  // ── Step 1: Signal extraction ──────────────────────────────────────────────
  const signals = extractSignals(chatRequest);
  trace.push({
    step: 1, name: 'Signal Extraction',
    data: {
      totalTokens: signals.totalTokens,
      hasImages: signals.hasImages,
      hasToolCalls: signals.hasToolCalls,
      conversationTurns: signals.conversationTurns,
      detectedDomains: signals.detectedDomains,
      detectedLanguages: signals.detectedLanguages,
      isFimRequest: signals.isFimRequest,
      isToolAgentRequest: signals.isToolAgentRequest,
    },
  });

  // ── Step 2: Fast-path detection ────────────────────────────────────────────
  let preRouted = null;
  if (signals.isFimRequest) {
    preRouted = { tier: 'micro', category: 'coding_autocomplete', domain: 'tech', confidence: 0.99, source: 'fim_detection', preRouted: true };
    trace.push({ step: 2, name: 'FIM / Autocomplete Fast-Path', changed: true, data: preRouted });
  } else if (signals.isToolAgentRequest) {
    preRouted = { tier: 'low', category: 'tool_use', domain: 'tech', confidence: 0.90, source: 'tool_agent_detection', preRouted: true };
    trace.push({ step: 2, name: 'Tool-Agent Fast-Path', changed: true, data: preRouted });
  } else {
    trace.push({ step: 2, name: 'Fast-Path Detection', changed: false, data: { fim: false, toolAgent: false } });
  }

  // ── Step 3: Rule-set pre-routing ───────────────────────────────────────────
  let ruleSet = null;
  if (!preRouted) {
    ruleSet = await RoutingRuleSet.findOne({
      $or: [{ tenantId: tenant._id }, { isGlobalDefault: true }],
    }).sort({ tenantId: -1 }).lean();

    if (ruleSet) {
      preRouted = applyRuleSet(signals, ruleSet);
      trace.push({
        step: 3, name: 'Rule-Set Pre-Routing',
        changed: preRouted.confidence > 0,
        data: {
          ruleSetName: ruleSet.name,
          tier: preRouted.tier, category: preRouted.category, domain: preRouted.domain,
          confidence: preRouted.confidence, source: preRouted.source, preRouted: preRouted.preRouted,
        },
      });
    } else {
      trace.push({ step: 3, name: 'Rule-Set Pre-Routing', changed: false, data: { message: 'No rule set found' } });
    }
  }

  // ── Step 4: Classifier decision ────────────────────────────────────────────
  const classifierConfigured = !!(tenant.routing?.classifierProvider && tenant.routing?.classifierModel);
  const wouldUsePreRouted = preRouted?.preRouted || !classifierConfigured;
  const categories = await getCategories();

  let result;
  let classifierOutput = null;

  if (wouldUsePreRouted && preRouted) {
    result = {
      category: preRouted.category || 'unknown', confidence: preRouted.confidence,
      complexity: signals.totalTokens > 15000 ? 'complex' : signals.totalTokens > 2000 ? 'medium' : 'simple',
      costTier: preRouted.tier || 'medium', hasImage: signals.hasImages,
      language: 'en', estimatedOutputLength: 'medium', domain: preRouted.domain || 'general',
      conversationTurn: signals.conversationTurns, userFrustrationSignal: false,
      reason: `Pre-routed via ${preRouted.source}`, overrideApplied: '', preRouted: true, signals,
    };
    trace.push({
      step: 4, name: 'Classifier Decision', changed: false,
      data: {
        decision: 'skipped',
        reason: !classifierConfigured ? 'Classifier not configured' : `Pre-routed with confidence ${preRouted.confidence} >= threshold`,
      },
    });
  } else if (useClassifier && classifierConfigured) {
    // Actually call the classifier
    trace.push({ step: 4, name: 'Classifier Decision', changed: true, data: { decision: 'calling', reason: 'useClassifier=true, classifier configured' } });

    try {
      const providers = await Provider.find({ _id: { $in: tenant.providerIds } });
      const allAvailableModels = providers.flatMap(p =>
        (p.discoveredModels || []).filter(m => m.visible !== false && m.tier)
          .map(m => ({ id: m.id, tier: m.tier, inputPer1M: m.inputPer1M ?? null, outputPer1M: m.outputPer1M ?? null, providerId: p._id.toString(), priority: m.priority ?? 50, contextWindow: m.contextWindow ?? null }))
      );

      const clfProvider = await Provider.findById(tenant.routing.classifierProvider);
      if (!clfProvider) throw new Error('Classifier provider not found');

      const clfModelEntry = clfProvider.discoveredModels?.find(m => m.id === tenant.routing.classifierModel);
      const contextWindow = clfModelEntry?.contextWindow || ruleSet?.classifier?.contextLimitTokens || 128000;
      const limitTokens = Math.max(1000, contextWindow - 2000);
      const strategy = ruleSet?.classifier?.contextStrategy || 'truncate';
      const classifierSystemPrompt = buildClassifierPrompt(categories, allAvailableModels);
      const context = buildClassifierContext(chatRequest, signals, strategy, limitTokens);

      const adapter = getProviderAdapter(clfProvider);
      const clfResponse = await adapter.chat({
        model: tenant.routing.classifierModel,
        messages: [{ role: 'system', content: classifierSystemPrompt }, { role: 'user', content: context }],
        temperature: 0, max_tokens: 512,
      });

      const content = clfResponse.choices?.[0]?.message?.content || '';
      const usage = clfResponse.usage || {};
      const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(jsonStr);

      const recModelId = parsed.recommended_model && parsed.recommended_model !== 'null'
        ? allAvailableModels.find(m => m.id === parsed.recommended_model)?.id || null : null;

      const clfInputTok = usage.prompt_tokens || 0;
      const clfOutputTok = usage.completion_tokens || 0;
      classifierOutput = {
        category: parsed.category, confidence: parsed.confidence, complexity: parsed.complexity,
        costTier: parsed.cost_tier, domain: parsed.domain, language: parsed.language,
        estimatedOutputLength: parsed.estimated_output_length,
        recommendedModel: recModelId, reasoning: parsed.reasoning,
        classifierModel: tenant.routing.classifierModel,
        inputTokens: clfInputTok, outputTokens: clfOutputTok,
        routingCostUsd: calcCost(tenant.routing.classifierModel, clfInputTok, clfOutputTok, null),
      };
      trace.push({ step: 5, name: 'Classifier Output', changed: true, data: classifierOutput });

      // Log the test-route classifier call to RequestLog
      logRequest({
        tenantId: tenant._id, sessionId: `test-route-${Date.now()}`,
        userName: req.user?.username || 'admin', requestedModel: 'auto',
        routedModel: tenant.routing.classifierModel,
        providerId: tenant.routing.classifierProvider,
        isAutoRouted: true, routingResult: { category: parsed.category, costTier: parsed.cost_tier, confidence: parsed.confidence, reason: `test-route: ${parsed.reasoning || ''}`, overrideApplied: 'test_route', signals },
        inputTokens: clfInputTok, outputTokens: clfOutputTok,
        streaming: false, tenant, messages: chatRequest.messages,
      });

      result = {
        category: parsed.category || 'smalltalk_simple', confidence: parsed.confidence || 0.5,
        complexity: parsed.complexity || 'medium', costTier: parsed.cost_tier || 'medium',
        hasImage: parsed.has_image || signals.hasImages, language: parsed.language || 'en',
        estimatedOutputLength: parsed.estimated_output_length || 'medium',
        domain: parsed.domain || 'general', conversationTurn: parsed.conversation_turn || signals.conversationTurns,
        userFrustrationSignal: parsed.user_frustration_signal || false,
        reason: parsed.reasoning || '', overrideApplied: '', preRouted: false,
        recommendedModel: recModelId, signals,
        classifierModel: tenant.routing.classifierModel,
        routingCostUsd: classifierOutput.routingCostUsd,
      };
    } catch (err) {
      trace.push({ step: 5, name: 'Classifier Output', changed: false, data: { error: err.message } });
      // Fallback to token-based
      const fallbackTier = signals.totalTokens >= 50000 ? 'high' : signals.totalTokens >= 15000 ? 'advanced'
        : signals.totalTokens >= 8000 ? 'medium' : signals.totalTokens >= 2000 ? 'low'
        : signals.totalTokens >= 500 ? 'minimal' : 'micro';
      result = {
        category: null, confidence: 0.1, complexity: 'medium', costTier: fallbackTier,
        hasImage: signals.hasImages, language: 'en', estimatedOutputLength: 'medium',
        domain: 'general', conversationTurn: signals.conversationTurns, userFrustrationSignal: false,
        reason: `token_fallback (${err.message})`, overrideApplied: 'classifier_fallback',
        preRouted: false, signals, routingCostUsd: 0,
      };
    }
  } else {
    // Dry-run without classifier
    trace.push({
      step: 4, name: 'Classifier Decision', changed: false,
      data: { decision: 'dry-run', reason: useClassifier ? 'Classifier not configured' : 'Dry-run mode (useClassifier=false)' },
    });
    // Use pre-routed or token fallback
    if (preRouted) {
      result = {
        category: preRouted.category || 'unknown', confidence: preRouted.confidence,
        complexity: signals.totalTokens > 15000 ? 'complex' : signals.totalTokens > 2000 ? 'medium' : 'simple',
        costTier: preRouted.tier || 'medium', hasImage: signals.hasImages,
        language: 'en', estimatedOutputLength: 'medium', domain: preRouted.domain || 'general',
        conversationTurn: signals.conversationTurns, userFrustrationSignal: false,
        reason: `Pre-routed via ${preRouted.source}`, overrideApplied: '', preRouted: true, signals,
      };
    } else {
      const fallbackTier = signals.totalTokens >= 50000 ? 'high' : signals.totalTokens >= 15000 ? 'advanced'
        : signals.totalTokens >= 8000 ? 'medium' : signals.totalTokens >= 2000 ? 'low'
        : signals.totalTokens >= 500 ? 'minimal' : 'micro';
      result = {
        category: null, confidence: 0.1, complexity: 'medium', costTier: fallbackTier,
        hasImage: signals.hasImages, language: 'en', estimatedOutputLength: 'medium',
        domain: 'general', conversationTurn: signals.conversationTurns, userFrustrationSignal: false,
        reason: 'token_fallback (dry-run)', overrideApplied: '', preRouted: false, signals,
      };
    }
    trace.push({ step: 5, name: 'Classifier Output', changed: false, data: { skipped: true } });
  }

  // ── Step 6: Post-classifier tier enforcement ───────────────────────────────
  const tierBefore6 = result.costTier;
  if (!wouldUsePreRouted && preRouted?.tier) {
    const hintIdx = TIERS.indexOf(preRouted.tier);
    const curIdx = TIERS.indexOf(result.costTier);
    if (hintIdx > curIdx) {
      result.costTier = preRouted.tier;
      result.overrideApplied = (result.overrideApplied ? result.overrideApplied + '+' : '') + `rule_tiermin:${preRouted.source}`;
    }
    if (preRouted.category && !result.category) result.category = preRouted.category;
    if (preRouted.domain && !result.domain) result.domain = preRouted.domain;
  }
  trace.push({
    step: 6, name: 'Tier Enforcement (Rule-Set Floor)',
    changed: result.costTier !== tierBefore6,
    data: { tierBefore: tierBefore6, tierAfter: result.costTier, source: preRouted?.source || null },
  });

  // ── Step 7: Tenant override rules ──────────────────────────────────────────
  const tierBefore7 = result.costTier;
  const overrideBefore = result.overrideApplied;
  result = applyOverrides(result, tenant.routing?.overrides, categories);
  trace.push({
    step: 7, name: 'Tenant Override Rules',
    changed: result.costTier !== tierBefore7 || result.overrideApplied !== overrideBefore,
    data: {
      tierBefore: tierBefore7, tierAfter: result.costTier,
      overridesApplied: result.overrideApplied || 'none',
      activeOverrides: tenant.routing?.overrides || {},
    },
  });

  // ── Step 8: Cost mode ──────────────────────────────────────────────────────
  const tierBefore8 = result.costTier;
  const effectiveCostMode = ruleSet?.costMode || 'balanced';
  if (effectiveCostMode !== 'balanced') {
    const idx = TIERS.indexOf(result.costTier);
    if (effectiveCostMode === 'economy' && idx > 0) {
      result.costTier = TIERS[idx - 1];
      result.overrideApplied = (result.overrideApplied ? result.overrideApplied + '+' : '') + 'cost_economy';
    } else if (effectiveCostMode === 'quality' && idx < TIERS.length - 1) {
      result.costTier = TIERS[idx + 1];
      result.overrideApplied = (result.overrideApplied ? result.overrideApplied + '+' : '') + 'cost_quality';
    }
  }
  trace.push({
    step: 8, name: 'Cost Mode',
    changed: result.costTier !== tierBefore8,
    data: { mode: effectiveCostMode, tierBefore: tierBefore8, tierAfter: result.costTier },
  });

  // ── Step 9: Tier boost ─────────────────────────────────────────────────────
  const tierBefore9 = result.costTier;
  const tierBoost = ruleSet?.tierBoost || 0;
  if (tierBoost !== 0) {
    const curIdx = TIERS.indexOf(result.costTier);
    const newIdx = Math.max(0, Math.min(TIERS.length - 1, curIdx + tierBoost));
    if (newIdx !== curIdx) {
      result.costTier = TIERS[newIdx];
      result.overrideApplied = (result.overrideApplied ? result.overrideApplied + '+' : '') + `tier_boost:${tierBoost > 0 ? '+' : ''}${tierBoost}`;
    }
  }
  trace.push({
    step: 9, name: 'Tier Boost',
    changed: result.costTier !== tierBefore9,
    data: { boost: tierBoost, tierBefore: tierBefore9, tierAfter: result.costTier },
  });

  // ── Step 10: Model selection ───────────────────────────────────────────────
  let selectedModel = null;
  let selectionMethod = 'none';
  try {
    const providers = await Provider.find({ _id: { $in: tenant.providerIds } });
    const tierModels = providers.flatMap(p =>
      (p.discoveredModels || [])
        .filter(m => m.visible !== false && m.tier === result.costTier)
        .map(m => ({ id: m.id, tier: m.tier, providerId: p._id.toString(), priority: m.priority ?? 50, contextWindow: m.contextWindow }))
    );

    if (result.recommendedModel) {
      // Only use recommendation if model tier >= resolved tier
      const recEntry = providers.flatMap(p =>
        (p.discoveredModels || []).filter(m => m.id === result.recommendedModel && m.visible !== false)
          .map(m => ({ id: m.id, providerId: p._id.toString(), contextWindow: m.contextWindow, tier: m.tier }))
      ).find(Boolean);
      if (recEntry) {
        const recTierIdx = TIERS.indexOf(recEntry.tier);
        const resolvedIdx = TIERS.indexOf(result.costTier);
        if (recTierIdx >= resolvedIdx) {
          selectedModel = { id: recEntry.id, providerId: recEntry.providerId, tier: result.costTier };
          selectionMethod = 'classifier_recommendation';
        }
        // else: recommendation tier too low, fall through to tier-based selection
      }
    }
    if (!selectedModel && tierModels.length) {
      tierModels.sort((a, b) => (b.priority || 50) - (a.priority || 50));
      selectedModel = { id: tierModels[0].id, providerId: tierModels[0].providerId, tier: result.costTier };
      selectionMethod = 'tier_priority';
    }
    if (!selectedModel) {
      selectedModel = { id: tenant.routing?.defaultModel || 'unknown', providerId: null, tier: result.costTier };
      selectionMethod = 'tenant_default';
    }
  } catch { /* non-fatal */ }

  trace.push({
    step: 10, name: 'Model Selection',
    changed: true,
    data: { model: selectedModel?.id, providerId: selectedModel?.providerId, method: selectionMethod, tier: result.costTier },
  });

  res.json({
    trace,
    summary: {
      finalModel: selectedModel?.id,
      finalTier: result.costTier,
      category: result.category,
      confidence: result.confidence,
      domain: result.domain,
      complexity: result.complexity,
      overridesApplied: result.overrideApplied || null,
      routingMs: Date.now() - startTime,
      routingCostUsd: result.routingCostUsd || 0,
    },
  });
});

// ── POST /api/admin/routing/benchmark ────────────────────────────────────────
// Simulates a rule set against historical RequestLog data.
// Does NOT make any LLM calls — uses stored signals + token counts only.
//
// Optional: pass `simulateTenantId` to also simulate that tenant's override rules
// (visionUpgrade, frustrationUpgrade, conversationTurnUpgrade, etc.) on top of
// the rule set pre-routing. This gives a much more realistic dry-run result.
router.post('/benchmark', canViewCosts, async (req, res) => {
  const { ruleSetId, days = 30, tenantId, simulateTenantId, limit = 500 } = req.body;
  if (!ruleSetId) return res.status(400).json({ error: 'ruleSetId is required' });

  // Load tenant override config if requested
  let tenantOverrides = null;
  let tenantName = null;
  if (simulateTenantId) {
    const tenant = await Tenant.findById(simulateTenantId).lean();
    if (tenant) {
      tenantOverrides = tenant.routing?.overrides || null;
      tenantName = tenant.name || tenant.slug;
    }
  }

  const ruleSet = await RoutingRuleSet.findById(ruleSetId).lean();
  if (!ruleSet) return res.status(404).json({ error: 'Rule set not found' });

  const since = new Date(Date.now() - days * 86_400_000);
  const query = { timestamp: { $gte: since }, isAutoRouted: true };
  if (tenantId) query.tenantId = tenantId;

  const logs = await RequestLog.find(query)
    .sort({ timestamp: -1 })
    .limit(Math.min(limit, 2000))
    .lean();

  if (!logs.length) return res.json({ simulated: 0, message: 'No auto-routed requests found in this period' });

  const TIERS = ['micro', 'minimal', 'low', 'medium', 'advanced', 'high', 'ultra', 'critical'];
  // Approximate cost multipliers per tier (relative, for delta calculation)
  const TIER_COST_MULTIPLIER = { micro: 0.01, minimal: 0.05, low: 0.3, medium: 1.0, advanced: 2.5, high: 6.0, ultra: 15.0, critical: 18.0 };

  const currentDist   = { micro: 0, minimal: 0, low: 0, medium: 0, advanced: 0, high: 0, ultra: 0, critical: 0 };
  const proposedDist  = { micro: 0, minimal: 0, low: 0, medium: 0, advanced: 0, high: 0, ultra: 0, critical: 0 };
  let currentCost     = 0;
  let proposedCost    = 0;
  let tierShifts      = 0;
  let classifierBypasses = 0;
  let fullSignalCount = 0;
  const changes       = [];

  for (const log of logs) {
    const currentTier = log.costTier || 'medium';
    if (TIERS.includes(currentTier)) currentDist[currentTier]++;
    currentCost += (log.actualCostUsd || 0);

    // Build a synthetic signals object
    let syntheticSignals;
    if (log.routingSignals?.totalTokens != null) {
      // Full signals available
      fullSignalCount++;
      syntheticSignals = {
        totalTokens:       log.routingSignals.totalTokens,
        hasImages:         log.routingSignals.hasImages || false,
        hasToolCalls:      log.routingSignals.hasToolCalls || false,
        conversationTurns: log.routingSignals.conversationTurns || 1,
        detectedDomains:   log.routingSignals.detectedDomains || [],
        detectedLanguages: log.routingSignals.detectedLanguages || [],
        systemPromptText:  '',
        lastUserMessage:   '',
      };
    } else {
      // Partial — reconstruct from stored metadata
      syntheticSignals = {
        totalTokens:       log.inputTokens || 0,
        hasImages:         false,
        hasToolCalls:      false,
        conversationTurns: log.conversationTurn || 1,
        detectedDomains:   log.domain && log.domain !== 'general' ? [log.domain] : [],
        detectedLanguages: [],
        systemPromptText:  '',
        lastUserMessage:   '',
      };
    }

    const preRouted = applyRuleSet(syntheticSignals, ruleSet);
    let proposedTier = preRouted.tier || currentTier;
    let overrideApplied = null;

    // Simulate tenant override rules on top of pre-routing (if requested)
    if (tenantOverrides) {
      const turns = syntheticSignals.conversationTurns || log.conversationTurn || 1;
      const domain = syntheticSignals.detectedDomains?.[0] || log.domain || 'general';
      const conf = log.confidence || preRouted.confidence || 0;
      const hasImage = syntheticSignals.hasImages || false;

      if (tenantOverrides.visionUpgrade && hasImage) {
        const idx = TIERS.indexOf(proposedTier);
        const lowIdx = TIERS.indexOf('low');
        const medIdx = TIERS.indexOf('medium');
        if (idx < lowIdx) proposedTier = 'low';
        else if (idx < medIdx) proposedTier = 'medium';
        overrideApplied = 'vision_upgrade';
      }
      if (tenantOverrides.confidenceFallback && conf < (tenantOverrides.confidenceThreshold ?? 0.4)) {
        if (TIERS.indexOf(proposedTier) < TIERS.indexOf('medium')) {
          proposedTier = 'medium';
          overrideApplied = 'confidence_fallback';
        }
      }
      if (tenantOverrides.domainGate && ['legal', 'medical', 'finance'].includes(domain)) {
        if (TIERS.indexOf(proposedTier) < TIERS.indexOf('medium')) {
          proposedTier = 'medium';
          overrideApplied = 'domain_gate';
        }
      }
      if (tenantOverrides.conversationTurnUpgrade && turns >= 4) {
        const idx = TIERS.indexOf(proposedTier);
        if (idx >= 0 && idx < TIERS.length - 1) {
          proposedTier = TIERS[idx + 1];
          overrideApplied = 'conversation_turn_upgrade';
        }
      }
    }

    if (TIERS.includes(proposedTier)) proposedDist[proposedTier]++;
    if (preRouted.preRouted) classifierBypasses++;

    // Estimate proposed cost by scaling actual cost by tier multiplier ratio
    const costScale = (TIER_COST_MULTIPLIER[proposedTier] || 1) / (TIER_COST_MULTIPLIER[currentTier] || 1);
    const estimatedProposedCost = (log.actualCostUsd || 0) * costScale;
    proposedCost += estimatedProposedCost;

    if (proposedTier !== currentTier) {
      tierShifts++;
      if (changes.length < 100) {
        changes.push({
          requestId:    log._id,
          timestamp:    log.timestamp,
          inputTokens:  log.inputTokens,
          currentTier,
          proposedTier,
          signalSource: overrideApplied ? `override:${overrideApplied}` : preRouted.source,
          domain:       syntheticSignals.detectedDomains[0] || log.domain,
          routedModel:  log.routedModel,
          category:     log.category,
        });
      }
    }
  }

  const totalCurrent  = logs.length;
  const dataQuality   = fullSignalCount / totalCurrent > 0.5 ? 'full' : 'partial';

  res.json({
    simulated:    totalCurrent,
    dataQuality,
    simulateTenant: tenantOverrides ? { id: simulateTenantId, name: tenantName } : null,
    fullSignalRequests: fullSignalCount,
    partialSignalRequests: totalCurrent - fullSignalCount,
    current: {
      tierDistribution:   currentDist,
      classifierCallRate: 1.0,
      estimatedCost:      Math.round(currentCost * 10000) / 10000,
    },
    proposed: {
      tierDistribution:   proposedDist,
      classifierCallRate: Math.round((1 - classifierBypasses / totalCurrent) * 100) / 100,
      estimatedCost:      Math.round(proposedCost * 10000) / 10000,
    },
    diff: {
      tierShifts,
      costDelta:          Math.round((proposedCost - currentCost) * 10000) / 10000,
      classifierBypasses,
      classifierBypassRate: Math.round((classifierBypasses / totalCurrent) * 100) + '%',
    },
    changes: changes.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
  });
});

// ── Synthetic Test Suites ────────────────────────────────────────────────────

// List all test suites
router.get('/test-suites', canViewCosts, async (_req, res) => {
  const suites = await SyntheticTest.find().sort({ updatedAt: -1 }).lean();
  res.json(suites);
});

// Get single test suite
router.get('/test-suites/:id', canViewCosts, async (req, res) => {
  const suite = await SyntheticTest.findById(req.params.id).lean();
  if (!suite) return res.status(404).json({ error: 'Test suite not found' });
  res.json(suite);
});

// Create test suite (manual)
router.post('/test-suites', adminOrMaint, async (req, res) => {
  const { name, description, category, testCases } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const suite = await SyntheticTest.create({ name, description, category, testCases: testCases || [] });
  res.status(201).json(suite);
});

// Update test suite
router.put('/test-suites/:id', adminOrMaint, async (req, res) => {
  const { name, description, category, testCases } = req.body;
  const suite = await SyntheticTest.findByIdAndUpdate(
    req.params.id,
    { $set: { name, description, category, testCases, updatedAt: new Date() } },
    { new: true, runValidators: true }
  );
  if (!suite) return res.status(404).json({ error: 'Test suite not found' });
  res.json(suite);
});

// Delete test suite
router.delete('/test-suites/:id', adminOrMaint, async (req, res) => {
  const suite = await SyntheticTest.findById(req.params.id);
  if (!suite) return res.status(404).json({ error: 'Test suite not found' });
  await SyntheticTest.deleteOne({ _id: req.params.id });
  await TestRun.deleteMany({ testSuiteId: req.params.id });
  res.json({ deleted: true });
});

// ── Generate test cases using an LLM ─────────────────────────────────────────
router.post('/test-suites/:id/generate', adminOrMaint, async (req, res) => {
  const { tenantId, count = 10, category, providerId, modelId } = req.body;
  if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });

  const suite = await SyntheticTest.findById(req.params.id);
  if (!suite) return res.status(404).json({ error: 'Test suite not found' });

  const tenant = await Tenant.findById(tenantId).lean();
  // Use explicit provider/model if given, otherwise fall back to tenant's classifier
  const genProviderId = providerId || tenant?.routing?.classifierProvider;
  const genModelId = modelId || tenant?.routing?.classifierModel;
  if (!genProviderId || !genModelId) return res.status(400).json({ error: 'No model selected and tenant has no classifier configured' });

  const categories = await getCategories();
  const targetCategories = (category || suite.category || '').split(',').map(s => s.trim()).filter(Boolean);

  const categoryList = targetCategories.length
    ? categories.filter(c => targetCategories.includes(c.key)).map(c => `- ${c.key} [${c.costTier}]: ${c.description || c.name}`).join('\n')
    : categories.map(c => `- ${c.key} [${c.costTier}]: ${c.description || c.name}`).join('\n');

  const generatorPrompt = `Generate exactly ${count} synthetic test prompts for evaluating an LLM routing system.
${targetCategories.length ? `Focus on these categories: ${targetCategories.join(', ')}` : 'Cover a variety of categories.'}

Available categories:
${categoryList}

For each test case, output a JSON array. Each item:
{
  "prompt": "the user message",
  "systemPrompt": "optional system prompt or null",
  "expectedCategory": "category_key",
  "expectedTierMin": "micro|minimal|low|medium|advanced|high|ultra|critical",
  "expectedTierMax": "same tier options or null",
  "tags": ["tag1", "tag2"]
}

Rules:
- Prompts should be realistic, not synthetic-sounding
- Vary complexity from simple to complex
- Include edge cases (e.g. code with security keywords, multi-domain prompts)
- Expected tiers should match the category's default tier
- Return ONLY the JSON array, no markdown`;

  try {
    const genProvider = await Provider.findById(genProviderId);
    if (!genProvider) return res.status(400).json({ error: 'Provider not found' });

    const adapter = getProviderAdapter(genProvider);
    const response = await adapter.chat({
      model: genModelId,
      messages: [{ role: 'user', content: generatorPrompt }],
      temperature: 0.7,
      max_tokens: 4000,
    });

    const content = response.choices?.[0]?.message?.content || '';
    const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const generated = JSON.parse(jsonStr);

    if (!Array.isArray(generated)) return res.status(500).json({ error: 'LLM did not return an array' });

    const newCases = generated.map(g => ({
      prompt: g.prompt,
      systemPrompt: g.systemPrompt || undefined,
      expectedCategory: g.expectedCategory,
      expectedTierMin: g.expectedTierMin,
      expectedTierMax: g.expectedTierMax || undefined,
      tags: g.tags || [],
    }));

    suite.testCases.push(...newCases);
    suite.updatedAt = new Date();
    await suite.save();

    res.json({ generated: newCases.length, total: suite.testCases.length, suite });
  } catch (err) {
    res.status(500).json({ error: `Generation failed: ${err.message}` });
  }
});

// ── Run test suite against current routing config ────────────────────────────
router.post('/test-suites/:id/run', adminOrMaint, async (req, res) => {
  const { tenantId, useClassifier = false } = req.body;
  if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });

  const suite = await SyntheticTest.findById(req.params.id).lean();
  if (!suite) return res.status(404).json({ error: 'Test suite not found' });
  if (!suite.testCases?.length) return res.status(400).json({ error: 'Test suite has no test cases' });

  const tenant = await Tenant.findById(tenantId).lean();
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const categories = await getCategories();
  const TIERS = ['micro', 'minimal', 'low', 'medium', 'advanced', 'high', 'ultra', 'critical'];

  const ruleSet = await RoutingRuleSet.findOne({
    $or: [{ tenantId: tenant._id }, { isGlobalDefault: true }],
  }).sort({ tenantId: -1 }).lean();

  // Pre-load classifier and providers if needed
  let clfProvider = null, clfAdapter = null, allAvailableModels = [];
  const classifierConfigured = useClassifier && tenant.routing?.classifierProvider && tenant.routing?.classifierModel;
  if (classifierConfigured) {
    try {
      clfProvider = await Provider.findById(tenant.routing.classifierProvider);
      if (clfProvider) clfAdapter = getProviderAdapter(clfProvider);
      const providers = await Provider.find({ _id: { $in: tenant.providerIds } });
      allAvailableModels = providers.flatMap(p =>
        (p.discoveredModels || []).filter(m => m.visible !== false && m.tier)
          .map(m => ({ id: m.id, tier: m.tier, inputPer1M: m.inputPer1M ?? null, outputPer1M: m.outputPer1M ?? null, providerId: p._id.toString(), priority: m.priority ?? 50, contextWindow: m.contextWindow ?? null }))
      );
    } catch { /* non-fatal */ }
  }

  const results = [];
  let tierMatches = 0;
  let categoryMatches = 0;
  let totalConfidence = 0;
  let totalRoutingMs = 0;
  let totalRoutingCost = 0;
  const tierDist = {};

  for (const tc of suite.testCases) {
    const startMs = Date.now();
    const trace = [];
    const chatRequest = {
      messages: [
        ...(tc.systemPrompt ? [{ role: 'system', content: tc.systemPrompt }] : []),
        { role: 'user', content: tc.prompt },
      ],
    };

    const signals = extractSignals(chatRequest);
    trace.push({ step: '1', name: 'Signals', changed: false, detail: `${signals.totalTokens} tok` });

    let preRouted = null;
    if (signals.isFimRequest) {
      preRouted = { tier: 'micro', category: 'coding_autocomplete', confidence: 0.99, source: 'fim_detection', preRouted: true };
      trace.push({ step: '2', name: 'FIM Fast-Path', changed: true, detail: 'micro' });
    } else if (signals.isToolAgentRequest) {
      preRouted = { tier: 'low', category: 'tool_use', confidence: 0.90, source: 'tool_agent_detection', preRouted: true };
      trace.push({ step: '2', name: 'Tool-Agent', changed: true, detail: 'low' });
    }

    if (!preRouted && ruleSet) {
      preRouted = applyRuleSet(signals, ruleSet);
      if (preRouted.confidence > 0) {
        trace.push({ step: '3', name: 'Pre-Route', changed: true, detail: `${preRouted.source} → ${preRouted.tier || 'none'} (conf ${(preRouted.confidence * 100).toFixed(0)}%)` });
      }
    }

    let costTier, category, confidence, reasoning = '';
    const shouldUseClassifier = classifierConfigured && clfAdapter && !(preRouted?.preRouted);

    if (shouldUseClassifier) {
      // Call real classifier
      try {
        const strategy = ruleSet?.classifier?.contextStrategy || 'truncate';
        const classifierSystemPrompt = buildClassifierPrompt(categories, allAvailableModels);
        const clfModelEntry = clfProvider.discoveredModels?.find(m => m.id === tenant.routing.classifierModel);
        const contextWindow = clfModelEntry?.contextWindow || ruleSet?.classifier?.contextLimitTokens || 128000;
        const limitTokens = Math.max(1000, contextWindow - 2000);
        const context = buildClassifierContext(chatRequest, signals, strategy, limitTokens);

        const clfResponse = await clfAdapter.chat({
          model: tenant.routing.classifierModel,
          messages: [{ role: 'system', content: classifierSystemPrompt }, { role: 'user', content: context }],
          temperature: 0, max_tokens: 512,
        });
        const content = clfResponse.choices?.[0]?.message?.content || '';
        const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(jsonStr);
        const usage = clfResponse.usage || {};
        const synClfIn = usage.prompt_tokens || 0;
        const synClfOut = usage.completion_tokens || 0;
        totalRoutingCost += calcCost(tenant.routing.classifierModel, synClfIn, synClfOut, null);

        costTier = parsed.cost_tier || 'medium';
        category = parsed.category || null;
        confidence = parsed.confidence || 0.5;
        reasoning = parsed.reasoning || '';
        trace.push({ step: '4', name: 'Classifier', changed: true, detail: `${category} → ${costTier} (${(confidence * 100).toFixed(0)}%) — ${reasoning}` });

        // Log synthetic test classifier call to RequestLog
        logRequest({
          tenantId: tenant._id, sessionId: `synthetic-test-${suite._id}`,
          userName: req.user?.username || 'admin', requestedModel: 'auto',
          routedModel: tenant.routing.classifierModel,
          providerId: tenant.routing.classifierProvider,
          isAutoRouted: true, routingResult: { category, costTier, confidence, reason: `synthetic-test: ${reasoning}`, overrideApplied: 'synthetic_test', signals },
          inputTokens: synClfIn, outputTokens: synClfOut,
          streaming: false, tenant, messages: chatRequest.messages,
        });

        // Post-classifier tier enforcement
        if (preRouted?.tier) {
          const hintIdx = TIERS.indexOf(preRouted.tier);
          const curIdx = TIERS.indexOf(costTier);
          if (hintIdx > curIdx) {
            trace.push({ step: '5', name: 'Tier Floor', changed: true, detail: `${costTier} → ${preRouted.tier} (${preRouted.source})` });
            costTier = preRouted.tier;
          }
          if (preRouted.category && !category) category = preRouted.category;
        }
      } catch (err) {
        // Classifier failed — fall back to pre-routing
        costTier = preRouted?.tier || 'medium';
        category = preRouted?.category || null;
        confidence = preRouted?.confidence || 0;
        trace.push({ step: '4', name: 'Classifier', changed: false, detail: `Failed: ${err.message}` });
      }
    } else {
      costTier = preRouted?.tier || 'medium';
      category = preRouted?.category || null;
      confidence = preRouted?.confidence || 0;
      if (!shouldUseClassifier && !preRouted?.preRouted) {
        trace.push({ step: '4', name: 'Classifier', changed: false, detail: useClassifier ? 'Not configured' : 'Skipped (dry-run)' });
      }
    }

    // Track tier progression
    const classifierTier = costTier;

    let overridesApplied = '';
    // Apply overrides
    const tierBeforeOv = costTier;
    const fakeResult = {
      costTier, category, confidence, hasImage: signals.hasImages,
      domain: preRouted?.domain || 'general', conversationTurn: signals.conversationTurns,
      userFrustrationSignal: false, estimatedOutputLength: 'medium',
      signals, overrideApplied: '',
    };
    const overridden = applyOverrides(fakeResult, tenant.routing?.overrides, categories);
    costTier = overridden.costTier;
    overridesApplied = overridden.overrideApplied;
    if (costTier !== tierBeforeOv) {
      trace.push({ step: '6', name: 'Overrides', changed: true, detail: `${tierBeforeOv} → ${costTier} (${overridesApplied})` });
    }
    const afterOverrides = costTier;

    // Apply cost mode
    const tierBeforeCm = costTier;
    const costMode = ruleSet?.costMode || 'balanced';
    if (costMode !== 'balanced') {
      const idx = TIERS.indexOf(costTier);
      if (costMode === 'economy' && idx > 0) costTier = TIERS[idx - 1];
      else if (costMode === 'quality' && idx < TIERS.length - 1) costTier = TIERS[idx + 1];
    }
    if (costTier !== tierBeforeCm) {
      trace.push({ step: '7', name: 'Cost Mode', changed: true, detail: `${tierBeforeCm} → ${costTier} (${costMode})` });
    }
    const afterCostMode = costTier;

    // Apply tier boost
    const tierBeforeBst = costTier;
    const boost = ruleSet?.tierBoost || 0;
    if (boost !== 0) {
      const idx = TIERS.indexOf(costTier);
      costTier = TIERS[Math.max(0, Math.min(TIERS.length - 1, idx + boost))];
    }
    if (costTier !== tierBeforeBst) {
      trace.push({ step: '8', name: 'Tier Boost', changed: true, detail: `${tierBeforeBst} → ${costTier} (boost ${boost > 0 ? '+' : ''}${boost})` });
    }

    // Find models for classifier tier AND final tier
    let modelId = tenant.routing?.defaultModel || 'unknown';
    let classifierModelId = modelId;
    let selectionMethod = 'tenant_default';
    try {
      const providers = await Provider.find({ _id: { $in: tenant.providerIds } });

      // Model at classifier tier (for comparison)
      const clfTierModels = providers.flatMap(p =>
        (p.discoveredModels || []).filter(m => m.visible !== false && m.tier === classifierTier)
          .map(m => ({ id: m.id, priority: m.priority ?? 50 }))
      ).sort((a, b) => (b.priority || 50) - (a.priority || 50));
      if (clfTierModels.length) classifierModelId = clfTierModels[0].id;

      // Model at final tier
      const tierModels = providers.flatMap(p =>
        (p.discoveredModels || []).filter(m => m.visible !== false && m.tier === costTier)
          .map(m => ({ id: m.id, priority: m.priority ?? 50 }))
      ).sort((a, b) => (b.priority || 50) - (a.priority || 50));
      if (tierModels.length) {
        modelId = tierModels[0].id;
        selectionMethod = 'tier_priority';
      }
    } catch { /* non-fatal */ }

    const routingMs = Date.now() - startMs;
    totalRoutingMs += routingMs;

    // Check expectations
    const tierIdx = TIERS.indexOf(costTier);
    const minIdx = tc.expectedTierMin ? TIERS.indexOf(tc.expectedTierMin) : -1;
    const maxIdx = tc.expectedTierMax ? TIERS.indexOf(tc.expectedTierMax) : TIERS.length;
    const tierOk = tierIdx >= minIdx && tierIdx <= maxIdx;
    const catOk = !tc.expectedCategory || category === tc.expectedCategory;

    if (tierOk) tierMatches++;
    if (catOk) categoryMatches++;
    totalConfidence += confidence;
    tierDist[costTier] = (tierDist[costTier] || 0) + 1;

    results.push({
      testCaseId: tc._id,
      prompt: tc.prompt.slice(0, 120),
      routedModel: modelId,
      routedTier: costTier,
      category,
      confidence,
      overrides: overridesApplied || null,
      selectionMethod,
      routingMs,
      tierMatch: tierOk,
      categoryMatch: catOk,
      expectedTierMin: tc.expectedTierMin,
      expectedTierMax: tc.expectedTierMax,
      expectedCategory: tc.expectedCategory,
      reasoning,
      trace,
      // Tier progression
      classifierTier,
      classifierModel: classifierModelId,
      afterOverrides,
      afterCostMode,
      finalTier: costTier,
      finalModel: modelId,
    });
  }

  const run = await TestRun.create({
    testSuiteId: suite._id,
    tenantId,
    ruleSetName: ruleSet?.name || 'none',
    results,
    summary: {
      total: suite.testCases.length,
      tierMatches,
      categoryMatches,
      avgConfidence: totalConfidence / suite.testCases.length,
      avgRoutingMs: Math.round(totalRoutingMs / suite.testCases.length),
      tierDistribution: tierDist,
    },
  });

  res.json(run);
});

// ── List runs for a test suite ───────────────────────────────────────────────
router.get('/test-suites/:id/runs', canViewCosts, async (req, res) => {
  const runs = await TestRun.find({ testSuiteId: req.params.id }).sort({ createdAt: -1 }).limit(20).lean();
  res.json(runs);
});

// ── Evaluate a test run using an LLM ─────────────────────────────────────────
router.post('/test-runs/:id/evaluate', adminOrMaint, async (req, res) => {
  const { tenantId, providerId, modelId } = req.body;
  if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });

  const run = await TestRun.findById(req.params.id);
  if (!run) return res.status(404).json({ error: 'Test run not found' });

  const tenant = await Tenant.findById(tenantId).lean();
  const evalProviderId = providerId || tenant?.routing?.classifierProvider;
  const evalModelId = modelId || tenant?.routing?.classifierModel;
  if (!evalProviderId || !evalModelId) return res.status(400).json({ error: 'No model selected and tenant has no classifier configured' });

  const suite = await SyntheticTest.findById(run.testSuiteId).lean();

  const evalPrompt = `You are evaluating an LLM routing system's performance. Analyze these test results and provide actionable recommendations.

## Test Suite: ${suite?.name || 'Unknown'}
## Results Summary
- Total tests: ${run.summary.total}
- Tier matches: ${run.summary.tierMatches}/${run.summary.total} (${Math.round(run.summary.tierMatches / run.summary.total * 100)}%)
- Category matches: ${run.summary.categoryMatches}/${run.summary.total} (${Math.round(run.summary.categoryMatches / run.summary.total * 100)}%)
- Avg confidence: ${run.summary.avgConfidence.toFixed(2)}
- Tier distribution: ${JSON.stringify(Object.fromEntries(run.summary.tierDistribution))}

## Individual Results (mismatches highlighted)
${run.results.map((r, i) => {
  const mark = (!r.tierMatch || !r.categoryMatch) ? ' *** MISMATCH ***' : '';
  return `${i + 1}. "${r.prompt}" → tier=${r.routedTier}, cat=${r.category || 'none'}, conf=${r.confidence?.toFixed(2)}, model=${r.routedModel}${mark}`;
}).join('\n')}

## Expected vs Actual (mismatches only)
${run.results.filter(r => !r.tierMatch || !r.categoryMatch).map((r, i) => {
  const tc = suite?.testCases?.find(t => String(t._id) === String(r.testCaseId));
  return tc ? `- "${r.prompt}" expected: cat=${tc.expectedCategory}, tier=${tc.expectedTierMin}${tc.expectedTierMax ? '-' + tc.expectedTierMax : '+'} | got: cat=${r.category}, tier=${r.routedTier}` : null;
}).filter(Boolean).join('\n') || 'None — all matched!'}

Respond with JSON:
{
  "score": <0-100 routing quality score>,
  "analysis": "<2-3 paragraph analysis of routing quality>",
  "qualitySuggestions": ["suggestion 1 for better quality", ...],
  "costSuggestions": ["suggestion 1 for lower costs", ...]
}`;

  try {
    const evalProvider = await Provider.findById(evalProviderId);
    if (!evalProvider) return res.status(400).json({ error: 'Provider not found' });

    const adapter = getProviderAdapter(evalProvider);
    const response = await adapter.chat({
      model: evalModelId,
      messages: [{ role: 'user', content: evalPrompt }],
      temperature: 0.3,
      max_tokens: 2000,
    });

    const content = response.choices?.[0]?.message?.content || '';
    const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const evaluation = JSON.parse(jsonStr);

    run.evaluation = {
      model: evalModelId,
      analysis: evaluation.analysis,
      qualitySuggestions: evaluation.qualitySuggestions || [],
      costSuggestions: evaluation.costSuggestions || [],
      score: evaluation.score,
    };
    await run.save();

    res.json(run);
  } catch (err) {
    res.status(500).json({ error: `Evaluation failed: ${err.message}` });
  }
});

export default router;
