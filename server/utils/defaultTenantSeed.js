/**
 * Seeds the system default tenant ("api") and default routing rule set.
 *
 * The default tenant:
 *  - slug: "api"  → accessible at /api/v1/* (special shorthand route in gateway)
 *  - name: "Default (api)"
 *  - API key: "model-prism"  (displayed as a warning — users should rotate this)
 *  - routing enabled by default
 *  - isDefault: true  → cannot be deleted via admin API
 *
 * The default rule set:
 *  - name: "Default Rule Set"
 *  - isGlobalDefault: true, isDefault: true → cannot be deleted
 *  - Ships with 4 keyword rules + 4 system-prompt roles (same as seed-defaults endpoint)
 *
 * Both are idempotent — safe to call on every startup.
 */

import crypto from 'crypto';
import Tenant from '../models/Tenant.js';
import RoutingRuleSet from '../models/RoutingRuleSet.js';
import logger from './logger.js';

const DEFAULT_API_KEY = 'model-prism';

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export async function seedDefaultTenant() {
  // ── Default Tenant ─────────────────────────────────────────────────────────
  const existing = await Tenant.findOne({ isDefault: true });
  if (!existing) {
    await Tenant.create({
      slug:         'api',
      name:         'Default (api)',
      isDefault:    true,
      apiKeyHash:   hashKey(DEFAULT_API_KEY),
      apiKeyPrefix: DEFAULT_API_KEY.slice(0, 12),
      customApiKey: true,
      active:       true,
      keyEnabled:   true,
      keyLifetimeDays: 0,
      routing: {
        enabled:        true,
        forceAutoRoute: false,
        overrides: {
          visionUpgrade:           true,
          toolCallUpgrade:         true,
          confidenceFallback:      true,
          confidenceThreshold:     0.4,
          domainGate:              true,
          conversationTurnUpgrade: false,
          frustrationUpgrade:      true,
          outputLengthUpgrade:     true,
        },
      },
    });
    logger.info('[seed] Default tenant "api" created — API key: model-prism (change this!)');
  }

  // ── Default Rule Set ───────────────────────────────────────────────────────
  const existingRS = await RoutingRuleSet.findOne({ isDefault: true });
  if (!existingRS) {
    await RoutingRuleSet.create({
      name:            'Default Rule Set',
      description:     'System default — cannot be deleted. Edit to tune routing behaviour.',
      isGlobalDefault: true,
      isDefault:       true,
      tokenThresholds: { micro: 150, minimal: 500, low: 2000, medium: 15000, alwaysHigh: 50000 },
      signalWeights: {
        tokenCount: 0.8, systemPromptRole: 0.9, contentKeywords: 0.62,
        codeLanguage: 0.7, conversationTurns: 0.4,
      },
      turnUpgrade: { enabled: false, threshold: 4 }, // tenant-level conversationTurnUpgrade handles this — rule set level causes double-upgrade for pre-routed requests
      classifier: {
        confidenceThreshold: 0.65,
        contextLimitTokens:  6000,  // 4000 was too tight for agentic sessions; raised to capture more context
        contextStrategy:     'truncate',
      },
      keywordRules: [
        {
          name: 'Security Escalation', enabled: true,
          keywords: ['vulnerability', 'CVE', 'exploit', 'penetration test', 'OWASP',
                     'private key', 'injection', 'XSS', 'CSRF', 'authentication bypass'],
          match: 'any', minMatches: 2, searchIn: 'user',
          effect: { category: 'code_security_review', tierMin: 'high', domain: 'security' },
        },
        {
          name: 'Legal / Compliance', enabled: true,
          keywords: ['GDPR', 'lawsuit', 'legal advice', 'NDA', 'intellectual property',
                     'liability clause', 'compliance audit', 'terms of service', 'regulation'],
          match: 'any', minMatches: 2, searchIn: 'user',  // user-only to avoid system prompt false positives; require 2 matches
          effect: { category: 'legal_analysis', tierMin: 'advanced', domain: 'legal' },
        },
        {
          name: 'Medical / Clinical', enabled: true,
          keywords: ['diagnosis', 'clinical trial', 'symptoms', 'patient history',
                     'prescription', 'ICD-', 'drug interaction', 'pathology', 'dosage'],
          match: 'any', minMatches: 2, searchIn: 'user',  // user-only; require 2 matches to avoid false positives from code tokens
          effect: { category: 'medical_analysis', tierMin: 'critical', domain: 'medical' },
        },
        {
          name: 'Finance / Investment', enabled: true,
          keywords: ['portfolio', 'investment strategy', 'stock valuation', 'financial model',
                     'derivative', 'hedge fund', 'risk assessment', 'earnings report', 'P&L statement'],
          match: 'any', minMatches: 2, searchIn: 'user',  // user-only; more specific keywords, require 2
          effect: { category: 'financial_analysis', tierMin: 'advanced', domain: 'finance' },
        },
        {
          // Prevent over-routing when the task is just generating a short title/label
          name: 'Chat Title Generation', enabled: true,
          keywords: ['reply with a title', 'title for this chat', 'title for the chat',
                     'generate a title', 'name this conversation', 'chat title'],
          match: 'any', minMatches: 1, searchIn: 'user',
          effect: { category: 'chat_title_generation', tierMax: 'micro' },
        },
      ],
      systemPromptRoles: [
        {
          name: 'Security Auditor', enabled: true,
          pattern: 'security.*(auditor|analyst|engineer|researcher)|penetration.?test|red.?team',
          effect: { category: 'code_security_review', tierMin: 'high', domain: 'security' },
        },
        {
          name: 'Customer Support', enabled: true,
          pattern: 'customer.*(support|service|success)|help.?desk|support.?agent',
          effect: { category: 'smalltalk_simple', tierMin: 'minimal', domain: '' },
        },
        {
          name: 'Legal Advisor', enabled: true,
          pattern: 'legal.*(advisor|counsel|assistant)|lawyer|attorney|paralegal',
          effect: { category: 'legal_analysis', tierMin: 'advanced', domain: 'legal' },
        },
        {
          name: 'Data Scientist', enabled: true,
          pattern: 'data.*(scientist|analyst|engineer)|machine.?learning|ml.?engineer',
          effect: { category: 'data_analysis', tierMin: 'low', domain: '' },
        },
        {
          // OpenCode, Claude Code, Cursor, Windsurf, and similar agentic coding tools
          name: 'Coding Agent / SWE', enabled: true,
          pattern: 'opencode|open.?code|coding.?agent|software.?engineer.*agent|you are.*coding.*assistant|interactive.*cli.*tool.*software|best coding agent',
          effect: { category: 'swe_agentic', tierMin: 'medium', domain: 'tech' },
        },
        {
          name: 'DevOps / Infrastructure Agent', enabled: true,
          pattern: 'devops.*(agent|engineer|assistant)|infrastructure.*(agent|engineer)|ansible|terraform.*(agent|engineer)',
          effect: { category: 'devops_infrastructure', tierMin: 'low', domain: 'tech' },
        },
      ],
    });
    logger.info('[seed] Default routing rule set created');
  }
}

/**
 * Seed two additional rule sets:
 * - "Economy First" — minimize costs, accept lower quality
 * - "Balanced" — best price-performance ratio
 * These complement the default "Quality First" rule set.
 */
export async function seedEnterpriseRuleSets() {
  const sharedKeywordRules = [
    { name: 'Security Escalation', enabled: true, keywords: ['vulnerability', 'CVE', 'exploit', 'OWASP', 'injection', 'XSS'], match: 'any', minMatches: 2, searchIn: 'user', effect: { category: 'code_security_review', tierMin: 'high', domain: 'security' } },
    { name: 'Chat Title Generation', enabled: true, keywords: ['reply with a title', 'title for this chat', 'generate a title'], match: 'any', minMatches: 1, searchIn: 'user', effect: { category: 'chat_title_generation', tierMax: 'micro' } },
  ];
  const sharedRoles = [
    { name: 'Coding Agent / SWE', enabled: true, pattern: 'opencode|open.?code|coding.?agent|software.?engineer.*agent|you are.*coding.*assistant', effect: { category: 'swe_agentic', tierMin: 'low', domain: 'tech' } },
    { name: 'Customer Support', enabled: true, pattern: 'customer.*(support|service|success)|help.?desk', effect: { category: 'smalltalk_simple', tierMin: 'minimal', domain: '' } },
  ];

  const created = [];

  // Economy First
  if (!await RoutingRuleSet.findOne({ name: 'Economy First' })) {
    await RoutingRuleSet.create({
      name: 'Economy First',
      description: 'Minimize costs — routes to the cheapest capable model. Use for high-volume, cost-sensitive workloads where output quality is secondary. Steps DOWN one tier and prefers the cheapest model within each tier.',
      isGlobalDefault: false,
      costMode: 'economy',
      tierBoost: 0,
      tokenThresholds: { micro: 200, minimal: 800, low: 3000, medium: 20000, alwaysHigh: 80000 },
      signalWeights: { tokenCount: 0.9, systemPromptRole: 0.8, contentKeywords: 0.7, codeLanguage: 0.6, conversationTurns: 0.3 },
      turnUpgrade: { enabled: false, threshold: 6 },
      classifier: { confidenceThreshold: 0.55, contextLimitTokens: 4000, contextStrategy: 'metadata_only' },
      keywordRules: sharedKeywordRules,
      systemPromptRoles: [
        ...sharedRoles.map(r => ({ ...r, effect: { ...r.effect, tierMin: r.effect.tierMin === 'low' ? 'low' : r.effect.tierMin } })),
      ],
    });
    created.push('Economy First');
  }

  // Balanced
  if (!await RoutingRuleSet.findOne({ name: 'Balanced' })) {
    await RoutingRuleSet.create({
      name: 'Balanced',
      description: 'Best price-performance ratio — no tier adjustment. Picks the optimal model for each task type based on benchmark scores. Good default for teams that want quality without overspending.',
      isGlobalDefault: false,
      costMode: 'balanced',
      tierBoost: 0,
      tokenThresholds: { micro: 150, minimal: 500, low: 2000, medium: 15000, alwaysHigh: 50000 },
      signalWeights: { tokenCount: 0.8, systemPromptRole: 0.9, contentKeywords: 0.62, codeLanguage: 0.7, conversationTurns: 0.4 },
      turnUpgrade: { enabled: true, threshold: 4 },
      classifier: { confidenceThreshold: 0.65, contextLimitTokens: 6000, contextStrategy: 'truncate' },
      keywordRules: [
        ...sharedKeywordRules,
        { name: 'Legal / Compliance', enabled: true, keywords: ['GDPR', 'lawsuit', 'legal advice', 'NDA', 'compliance'], match: 'any', minMatches: 2, searchIn: 'user', effect: { category: 'legal_analysis', tierMin: 'advanced', domain: 'legal' } },
      ],
      systemPromptRoles: [
        { name: 'Coding Agent / SWE', enabled: true, pattern: 'opencode|open.?code|coding.?agent|software.?engineer.*agent|you are.*coding.*assistant', effect: { category: 'swe_agentic', tierMin: 'medium', domain: 'tech' } },
        { name: 'Security Auditor', enabled: true, pattern: 'security.*(auditor|analyst|engineer)', effect: { category: 'code_security_review', tierMin: 'high', domain: 'security' } },
        { name: 'Customer Support', enabled: true, pattern: 'customer.*(support|service|success)|help.?desk', effect: { category: 'smalltalk_simple', tierMin: 'minimal', domain: '' } },
      ],
    });
    created.push('Balanced');
  }

  return created;
}
