// ── Mock data for demo mode ───────────────────────────────────────────────────
// Realistic but fully anonymized. Based on production traffic patterns.

export const providers = [
  { _id: 'p1', name: 'AWS Bedrock (EU)', type: 'bedrock', endpoint: 'https://bedrock-proxy.internal:8443/v1', enabled: true, createdAt: '2026-03-01T10:00:00Z',
    discoveredModels: [
      { id: 'eu.anthropic.claude-sonnet-4-6', tier: 'high', inputPer1M: 3, outputPer1M: 15, contextWindow: 200000, visible: true, priority: 80 },
      { id: 'eu.anthropic.claude-opus-4-6-v1', tier: 'ultra', inputPer1M: 15, outputPer1M: 75, contextWindow: 200000, visible: true, priority: 70 },
      { id: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', tier: 'low', inputPer1M: 0.8, outputPer1M: 4, contextWindow: 200000, visible: true, priority: 60 },
      { id: 'eu.amazon.nova-micro-v1:0', tier: 'minimal', inputPer1M: 0.04, outputPer1M: 0.14, contextWindow: 128000, visible: true, priority: 90 },
      { id: 'eu.amazon.nova-2-lite-v1:0', tier: 'low', inputPer1M: 0.42, outputPer1M: 3.59, contextWindow: 1000000, visible: true, priority: 50 },
      { id: 'qwen.qwen3-32b-v1:0', tier: 'low', inputPer1M: 0.13, outputPer1M: 0.50, contextWindow: 131072, visible: true, priority: 95 },
      { id: 'qwen.qwen3-coder-30b-a3b-v1:0', tier: 'medium', inputPer1M: 0.20, outputPer1M: 0.79, contextWindow: 131072, visible: true, priority: 85 },
      { id: 'qwen.qwen3-235b-a22b-2507-v1:0', tier: 'advanced', inputPer1M: 0.27, outputPer1M: 2.16, contextWindow: 131072, visible: true, priority: 75 },
      { id: 'openai.gpt-oss-120b-1:0', tier: 'low', inputPer1M: 0.10, outputPer1M: 0.30, contextWindow: 131072, visible: true, priority: 40 },
    ],
  },
  { _id: 'p2', name: 'OpenAI', type: 'openai', endpoint: 'https://api.openai.com/v1', enabled: true, createdAt: '2026-03-15T10:00:00Z',
    discoveredModels: [
      { id: 'gpt-4o', tier: 'high', inputPer1M: 2.50, outputPer1M: 10, contextWindow: 128000, visible: true, priority: 70 },
      { id: 'gpt-4o-mini', tier: 'low', inputPer1M: 0.15, outputPer1M: 0.60, contextWindow: 128000, visible: true, priority: 85 },
      { id: 'gpt-5', tier: 'ultra', inputPer1M: 5, outputPer1M: 15, contextWindow: 1000000, visible: true, priority: 60 },
    ],
  },
  { _id: 'p3', name: 'Ollama (local)', type: 'ollama', endpoint: 'http://gpu-server.internal:11434', enabled: true, createdAt: '2026-03-20T10:00:00Z',
    discoveredModels: [
      { id: 'llama3.3:70b', tier: 'medium', inputPer1M: 0, outputPer1M: 0, contextWindow: 131072, visible: true, priority: 50 },
      { id: 'qwen2.5-coder:32b', tier: 'medium', inputPer1M: 0, outputPer1M: 0, contextWindow: 131072, visible: true, priority: 45 },
      { id: 'deepseek-r1:14b', tier: 'low', inputPer1M: 0, outputPer1M: 0, contextWindow: 65536, visible: true, priority: 30 },
      { id: 'kimi-k2-thinking', tier: 'advanced', inputPer1M: 0, outputPer1M: 0, contextWindow: 262144, visible: true, priority: 55 },
    ],
  },
  { _id: 'p4', name: 'OpenRouter', type: 'openrouter', endpoint: 'https://openrouter.ai/api/v1', enabled: true, createdAt: '2026-04-01T09:00:00Z',
    discoveredModels: [
      { id: 'moonshotai/kimi-k2.5-1T', tier: 'ultra', inputPer1M: 2.00, outputPer1M: 8.00, contextWindow: 262144, visible: true, priority: 65 },
      { id: 'moonshotai/kimi-k2-thinking', tier: 'advanced', inputPer1M: 0.60, outputPer1M: 2.50, contextWindow: 262144, visible: true, priority: 70 },
      { id: 'cohere/command-r-plus-08-2025', tier: 'advanced', inputPer1M: 2.50, outputPer1M: 10, contextWindow: 128000, visible: true, priority: 55 },
      { id: 'cohere/command-r7b-12-2024', tier: 'low', inputPer1M: 0.0375, outputPer1M: 0.15, contextWindow: 128000, visible: true, priority: 80 },
      { id: 'deepseek/deepseek-v3.2', tier: 'high', inputPer1M: 0.27, outputPer1M: 1.10, contextWindow: 128000, visible: true, priority: 75 },
      { id: 'mistralai/mistral-large-3', tier: 'advanced', inputPer1M: 2.00, outputPer1M: 6.00, contextWindow: 128000, visible: true, priority: 60 },
      { id: 'google/gemini-2.5-pro', tier: 'high', inputPer1M: 1.25, outputPer1M: 5.00, contextWindow: 2000000, visible: true, priority: 72 },
      { id: 'meta-llama/llama-4-scout-17b', tier: 'medium', inputPer1M: 0.18, outputPer1M: 0.60, contextWindow: 10000000, visible: true, priority: 50 },
    ],
  },
];

export const tenants = [
  { _id: 't1', name: 'Dev Team Alpha', slug: 'dev-alpha', enabled: true, budgetLimit: 2000, currentMonthCost: 291.23, apiKeyPrefix: 'omp-****', keyEnabled: true, providerIds: ['p1', 'p2'],
    routing: { enabled: true, forceAutoRoute: true, defaultModel: 'eu.anthropic.claude-sonnet-4-6', classifierProvider: 'p1', classifierModel: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
      overrides: { visionUpgrade: true, toolCallUpgrade: true, toolCallMinTier: 'medium', confidenceFallback: true, confidenceThreshold: 0.3, domainGate: false, conversationTurnUpgrade: true, frustrationUpgrade: true, outputLengthUpgrade: true } },
  },
  { _id: 't2', name: 'Marketing', slug: 'marketing', enabled: true, budgetLimit: 500, currentMonthCost: 42.15, apiKeyPrefix: 'omp-****', keyEnabled: true, providerIds: ['p1'] },
  { _id: 't3', name: 'Abteilung 12', slug: 'abt-12', enabled: true, budgetLimit: 800, currentMonthCost: 156.80, apiKeyPrefix: 'omp-****', keyEnabled: true, providerIds: ['p1', 'p2'] },
  { _id: 't4', name: 'Data Science Lab', slug: 'ds-lab', enabled: false, budgetLimit: 1500, currentMonthCost: 0, apiKeyPrefix: 'omp-****', keyEnabled: false, providerIds: ['p1'] },
];

export const categories = [
  { _id: 'c1', key: 'coding_autocomplete', name: 'Code Autocomplete / FIM', costTier: 'micro', description: 'FIM code completions, inline suggestions', isBuiltIn: true, order: 1 },
  { _id: 'c2', key: 'coding_simple', name: 'Simple Coding', costTier: 'low', isBuiltIn: true, order: 25 },
  { _id: 'c3', key: 'coding_medium', name: 'Medium Coding', costTier: 'medium', isBuiltIn: true, order: 26 },
  { _id: 'c4', key: 'coding_complex', name: 'Complex Coding', costTier: 'advanced', isBuiltIn: true, order: 61 },
  { _id: 'c5', key: 'swe_agentic', name: 'Agentic Software Engineering', costTier: 'high', isBuiltIn: true, order: 70 },
  { _id: 'c6', key: 'tool_use_agentic', name: 'Tool Use & Agentic', costTier: 'medium', isBuiltIn: true, order: 41 },
  { _id: 'c7', key: 'code_explanation', name: 'Code Explanation', costTier: 'low', isBuiltIn: true, order: 33 },
  { _id: 'c8', key: 'error_debugging', name: 'Error & Debug Analysis', costTier: 'medium', isBuiltIn: true, order: 34 },
  { _id: 'c9', key: 'qa_testing', name: 'QA & Test Writing', costTier: 'medium', isBuiltIn: true, order: 32 },
  { _id: 'c10', key: 'system_design', name: 'System Design', costTier: 'advanced', isBuiltIn: true, order: 65 },
  { _id: 'c11', key: 'smalltalk_simple', name: 'Smalltalk & Simple Questions', costTier: 'minimal', isBuiltIn: true, order: 10 },
  { _id: 'c12', key: 'translation', name: 'Translation', costTier: 'minimal', isBuiltIn: true, order: 11 },
  { _id: 'c13', key: 'devops_infrastructure', name: 'DevOps & Infrastructure', costTier: 'medium', isBuiltIn: true, order: 31 },
];

export const users = [
  { _id: 'u1', username: 'admin', role: 'admin', createdAt: '2026-03-01T08:00:00Z' },
  { _id: 'u2', username: 'maintainer', role: 'maintainer', createdAt: '2026-03-05T10:00:00Z' },
  { _id: 'u3', username: 'finops', role: 'finops', createdAt: '2026-03-10T14:00:00Z' },
];

export const models = [
  { id: 'eu.anthropic.claude-sonnet-4-6', name: 'Claude Sonnet 4.6', vendor: 'Anthropic', providerName: 'AWS Bedrock (EU)', providerId: 'p1', tier: 'high', inputPer1M: 3, outputPer1M: 15, contextWindow: 200000, visible: true },
  { id: 'eu.anthropic.claude-opus-4-6-v1', name: 'Claude Opus 4.6', vendor: 'Anthropic', providerName: 'AWS Bedrock (EU)', providerId: 'p1', tier: 'ultra', inputPer1M: 15, outputPer1M: 75, contextWindow: 200000, visible: true },
  { id: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', name: 'Claude Haiku 4.5', vendor: 'Anthropic', providerName: 'AWS Bedrock (EU)', providerId: 'p1', tier: 'low', inputPer1M: 0.8, outputPer1M: 4, contextWindow: 200000, visible: true },
  { id: 'eu.amazon.nova-micro-v1:0', name: 'Amazon Nova Micro', vendor: 'Amazon', providerName: 'AWS Bedrock (EU)', providerId: 'p1', tier: 'minimal', inputPer1M: 0.04, outputPer1M: 0.14, contextWindow: 128000, visible: true },
  { id: 'qwen.qwen3-32b-v1:0', name: 'Qwen3 32B', vendor: 'Alibaba', providerName: 'AWS Bedrock (EU)', providerId: 'p1', tier: 'low', inputPer1M: 0.13, outputPer1M: 0.50, contextWindow: 131072, visible: true },
  { id: 'qwen.qwen3-coder-30b-a3b-v1:0', name: 'Qwen3 Coder 30B', vendor: 'Alibaba', providerName: 'AWS Bedrock (EU)', providerId: 'p1', tier: 'medium', inputPer1M: 0.20, outputPer1M: 0.79, contextWindow: 131072, visible: true },
  { id: 'qwen.qwen3-235b-a22b-2507-v1:0', name: 'Qwen3 235B', vendor: 'Alibaba', providerName: 'AWS Bedrock (EU)', providerId: 'p1', tier: 'advanced', inputPer1M: 0.27, outputPer1M: 2.16, contextWindow: 131072, visible: true },
  { id: 'gpt-4o', name: 'GPT-5.2', vendor: 'OpenAI', providerName: 'OpenAI', providerId: 'p2', tier: 'high', inputPer1M: 1.75, outputPer1M: 14, contextWindow: 1000000, visible: true },
  { id: 'gpt-5', name: 'GPT-5', vendor: 'OpenAI', providerName: 'OpenAI', providerId: 'p2', tier: 'ultra', inputPer1M: 3, outputPer1M: 12, contextWindow: 1000000, visible: true },
  { id: 'openai.gpt-oss-120b-1:0', name: 'GPT OSS 120B', vendor: 'OpenAI', providerName: 'AWS Bedrock (EU)', providerId: 'p1', tier: 'low', inputPer1M: 0.10, outputPer1M: 0.30, contextWindow: 131072, visible: true },
  { id: 'llama3.3:70b', name: 'Llama 3.3 70B', vendor: 'Meta', providerName: 'Ollama (local)', providerId: 'p3', tier: 'medium', inputPer1M: 0, outputPer1M: 0, contextWindow: 131072, visible: true },
  { id: 'qwen2.5-coder:32b', name: 'Qwen 2.5 Coder 32B', vendor: 'Alibaba', providerName: 'Ollama (local)', providerId: 'p3', tier: 'medium', inputPer1M: 0, outputPer1M: 0, contextWindow: 131072, visible: true },
  { id: 'deepseek-r1:14b', name: 'DeepSeek R1 14B', vendor: 'DeepSeek', providerName: 'Ollama (local)', providerId: 'p3', tier: 'low', inputPer1M: 0, outputPer1M: 0, contextWindow: 65536, visible: true },
  { id: 'moonshotai/kimi-k2.5-1T', name: 'Kimi K2.5 1T', vendor: 'Moonshot', providerName: 'OpenRouter', providerId: 'p4', tier: 'ultra', inputPer1M: 2.00, outputPer1M: 8.00, contextWindow: 262144, visible: true },
  { id: 'moonshotai/kimi-k2-thinking', name: 'Kimi K2 Thinking', vendor: 'Moonshot', providerName: 'OpenRouter', providerId: 'p4', tier: 'advanced', inputPer1M: 0.60, outputPer1M: 2.50, contextWindow: 262144, visible: true },
  { id: 'cohere/command-r-plus-08-2025', name: 'Command R+ 08-2025', vendor: 'Cohere', providerName: 'OpenRouter', providerId: 'p4', tier: 'advanced', inputPer1M: 2.50, outputPer1M: 10, contextWindow: 128000, visible: true },
  { id: 'cohere/command-r7b-12-2024', name: 'Command R 7B', vendor: 'Cohere', providerName: 'OpenRouter', providerId: 'p4', tier: 'low', inputPer1M: 0.0375, outputPer1M: 0.15, contextWindow: 128000, visible: true },
  { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', vendor: 'DeepSeek', providerName: 'OpenRouter', providerId: 'p4', tier: 'high', inputPer1M: 0.27, outputPer1M: 1.10, contextWindow: 128000, visible: true },
  { id: 'mistralai/mistral-large-3', name: 'Mistral Large 3', vendor: 'Mistral', providerName: 'OpenRouter', providerId: 'p4', tier: 'advanced', inputPer1M: 2.00, outputPer1M: 6.00, contextWindow: 128000, visible: true },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', vendor: 'Google', providerName: 'OpenRouter', providerId: 'p4', tier: 'high', inputPer1M: 1.25, outputPer1M: 5.00, contextWindow: 2000000, visible: true },
  { id: 'meta-llama/llama-4-scout-17b', name: 'Llama 4 Scout 17B', vendor: 'Meta', providerName: 'OpenRouter', providerId: 'p4', tier: 'medium', inputPer1M: 0.18, outputPer1M: 0.60, contextWindow: 10000000, visible: true },
];

export const dashboardSummary = {
  periodDays: 30,
  uniqueUsers: 47,
  usersViaProxy: 31,
  usersDirect: 16,
  summary: {
    totalRequests: 29297,
    totalInputTokens: 200204228,
    totalOutputTokens: 7610527,
    totalActualCost: 291.23,
    totalBaselineCost: 776.71,
    totalSaved: 485.48,
    autoRoutedCount: 28048,
    totalRoutingCost: 12.47,
    errorCount: 365,
    unknownErrorCount: 3,
    avgDurationMs: 2840,
  },
};

// Generate 30 days of daily stats matching production patterns
export const dailyStats = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000);
  const isWeekday = d.getDay() >= 1 && d.getDay() <= 5;
  const base = isWeekday ? 900 + Math.random() * 300 : 200 + Math.random() * 100;
  const inputTokens = Math.round(base * 7000);
  const outputTokens = Math.round(base * 260);
  const actualCost = base * 0.01 + Math.random() * 2;
  const baselineCost = actualCost * 2.5 + Math.random() * 3;
  return {
    _id: d.toISOString().slice(0, 10),
    date: d.toISOString().slice(0, 10),
    requests: Math.round(base),
    inputTokens,
    outputTokens,
    actualCostUsd: Math.round(actualCost * 100) / 100,
    actualCost: Math.round(actualCost * 100) / 100,
    baselineCostUsd: Math.round(baselineCost * 100) / 100,
    baselineCost: Math.round(baselineCost * 100) / 100,
    savedUsd: Math.round((baselineCost - actualCost) * 100) / 100,
    activeUsers: isWeekday ? Math.round(8 + Math.random() * 12) : Math.round(2 + Math.random() * 4),
  };
});

// Model usage distribution matching production
export const modelUsage = [
  { _id: 'qwen.qwen3-32b-v1:0', requests: 10060, inputTokens: 48000000, outputTokens: 1200000, actualCost: 4.19 },
  { _id: 'eu.amazon.nova-micro-v1:0', requests: 9096, inputTokens: 12000000, outputTokens: 800000, actualCost: 0.79 },
  { _id: 'qwen.qwen3-coder-30b-a3b-v1:0', requests: 3703, inputTokens: 42000000, outputTokens: 1800000, actualCost: 17.10 },
  { _id: 'openai.gpt-oss-120b-1:0', requests: 2259, inputTokens: 18000000, outputTokens: 600000, actualCost: 1.44 },
  { _id: 'eu.anthropic.claude-sonnet-4-6', requests: 1969, inputTokens: 38000000, outputTokens: 1500000, actualCost: 111.65 },
  { _id: 'qwen.qwen3-235b-a22b-2507-v1:0', requests: 1192, inputTokens: 15000000, outputTokens: 800000, actualCost: 7.35 },
  { _id: 'eu.anthropic.claude-opus-4-6-v1', requests: 381, inputTokens: 8000000, outputTokens: 600000, actualCost: 85.35 },
  { _id: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', requests: 188, inputTokens: 5000000, outputTokens: 200000, actualCost: 3.53 },
  { _id: 'gpt-4o', requests: 121, inputTokens: 6000000, outputTokens: 400000, actualCost: 59.23 },
];

// Anonymized request logs (100 entries) with realistic routing patterns
const CATEGORIES = ['coding_autocomplete', 'coding_simple', 'coding_medium', 'coding_complex', 'swe_agentic', 'tool_use_agentic', 'code_explanation', 'error_debugging', 'qa_testing', 'system_design', 'smalltalk_simple'];
const MODELS = [
  'qwen.qwen3-32b-v1:0',
  'eu.amazon.nova-micro-v1:0',
  'qwen.qwen3-coder-30b-a3b-v1:0',
  'eu.anthropic.claude-sonnet-4-6',
  'qwen.qwen3-235b-a22b-2507-v1:0',
  'eu.anthropic.claude-opus-4-6-v1',
  'openai.gpt-oss-120b-1:0',
  'moonshotai/kimi-k2.5-1T',
  'cohere/command-r-plus-08-2025',
  'deepseek/deepseek-v3.2',
  'google/gemini-2.5-pro',
];
const TIERS = ['micro', 'minimal', 'low', 'medium', 'advanced', 'high', 'ultra'];
const COMPLEXITIES = ['simple', 'medium', 'complex'];

// Generate fresh pseudo-random hex session IDs on every module load so demo
// sessions never reuse the same static placeholder.
function genSessionId() {
  // 16 hex chars ≈ 64 bits — plenty for demo uniqueness
  let s = '';
  for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
const SESSIONS = Array.from({ length: 12 }, genSessionId);

function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export const requestLogs = Array.from({ length: 100 }, (_, i) => {
  const catIdx = Math.random() < 0.4 ? 0 : Math.random() < 0.6 ? Math.floor(Math.random() * 5) + 1 : Math.floor(Math.random() * CATEGORIES.length);
  const cat = CATEGORIES[catIdx];
  const tier = cat === 'coding_autocomplete' ? (Math.random() < 0.7 ? 'micro' : 'low')
    : cat === 'swe_agentic' ? 'high'
    : cat === 'coding_complex' ? 'advanced'
    : cat === 'coding_medium' ? 'medium'
    : TIERS[Math.floor(Math.random() * 4) + 1];
  const modelIdx = tier === 'micro' || tier === 'minimal' ? 1 : tier === 'low' ? (Math.random() < 0.5 ? 0 : 6)
    : tier === 'medium' ? 2 : tier === 'advanced' ? 4 : tier === 'high' ? 3 : 5;
  const inputTok = cat === 'coding_autocomplete' ? Math.round(500 + Math.random() * 2000) : Math.round(2000 + Math.random() * 50000);
  const outputTok = cat === 'coding_autocomplete' ? Math.round(50 + Math.random() * 200) : Math.round(100 + Math.random() * 5000);
  const cost = inputTok * 0.000001 * (modelIdx >= 3 ? 5 : 0.5) + outputTok * 0.000001 * (modelIdx >= 3 ? 20 : 1);
  return {
    _id: `log${i}`,
    timestamp: new Date(Date.now() - (99 - i) * 600000).toISOString(),
    tenantId: i % 5 === 0 ? { _id: 't3', slug: 'abt-12', name: 'Abteilung 12' } : i % 7 === 0 ? { _id: 't2', slug: 'marketing', name: 'Marketing' } : { _id: 't1', slug: 'dev-alpha', name: 'Dev Team Alpha' },
    sessionId: randomChoice(SESSIONS),
    routedModel: MODELS[modelIdx],
    requestedModel: Math.random() < 0.3 ? MODELS[modelIdx] : 'auto',
    category: cat,
    costTier: tier,
    complexity: randomChoice(COMPLEXITIES),
    confidence: 0.85 + Math.random() * 0.14,
    inputTokens: inputTok,
    outputTokens: outputTok,
    actualCostUsd: Math.round(cost * 1e6) / 1e6,
    baselineCostUsd: Math.round(cost * 2.5 * 1e6) / 1e6,
    savedUsd: Math.round(cost * 1.5 * 1e6) / 1e6,
    isAutoRouted: true,
    streaming: true,
    status: Math.random() < 0.95 ? 'success' : 'error',
    routingMs: Math.round(50 + Math.random() * 3000),
    overrideApplied: Math.random() < 0.15 ? 'cost_quality' : Math.random() < 0.1 ? 'conversation_turn_upgrade+cost_quality' : '',
    domain: cat.includes('coding') || cat === 'swe_agentic' ? 'tech' : 'general',
    routingSignals: {
      totalTokens: inputTok,
      hasImages: false,
      hasToolCalls: cat === 'tool_use_agentic' || cat === 'swe_agentic',
      conversationTurns: Math.floor(Math.random() * 8) + 1,
      detectedDomains: cat.includes('coding') ? ['tech'] : [],
      detectedLanguages: cat.includes('coding') ? ['python', 'javascript'].slice(0, Math.floor(Math.random() * 2) + 1) : [],
      preRouted: cat === 'coding_autocomplete',
      isFimRequest: cat === 'coding_autocomplete',
      isToolAgentRequest: cat === 'swe_agentic',
      signalSource: cat === 'coding_autocomplete' ? 'fim_detection' : null,
    },
  };
});

// Add error classification to error entries
const ERROR_TYPES = [
  { errorCategory: 'fixed', errorFixedIn: 'v1.10.12', errorDescription: 'Orphaned tool calls', errorMessage: '[502] provider_error: tool_use ids without tool_result blocks' },
  { errorCategory: 'fixed', errorFixedIn: 'v1.10.15', errorDescription: 'Azure cache_control stripped', errorMessage: '[400] provider_error: Unknown parameter: cache_control' },
  { errorCategory: 'fixed', errorFixedIn: 'v1.10.12', errorDescription: 'Azure content type mapping', errorMessage: '[400] provider_error: Invalid value: input_text' },
  { errorCategory: 'provider', errorDescription: 'Rate limit — wait and retry', errorMessage: '[400] provider_error: Too many connections, please wait' },
  { errorCategory: 'provider', errorDescription: 'Context window exceeded', errorMessage: '[502] context_length_exceeded: prompt is too long: 212069 tokens' },
  { errorCategory: 'provider', errorDescription: 'Stream terminated', errorMessage: '[502] provider_error: terminated' },
  { errorCategory: 'proxy', errorDescription: 'Proxy blocking target URL', errorMessage: '[400] provider_error: Tunnel connection failed: 403 URLBlocked' },
  { errorCategory: 'unknown', errorDescription: 'Unclassified error', errorMessage: '[502] provider_error: Internal server error' },
];
requestLogs.filter(r => r.status === 'error').forEach((r, i) => {
  const errType = ERROR_TYPES[i % ERROR_TYPES.length];
  Object.assign(r, errType);
});

// System overview mock
export const systemOverview = {
  thisPod: { id: 'model-prism-worker-1', role: 'worker', uptime: 259200, nodeVersion: 'v22.22.2', version: '1.8.8', updatedAt: new Date().toISOString(),
    memory: { rss: 184 * 1024 * 1024, heapUsed: 112 * 1024 * 1024, heapTotal: 160 * 1024 * 1024 },
    cpu: { user: 42500000, system: 8200000 },
  },
  pods: [
    { id: 'model-prism-control-0', role: 'control', status: 'running', uptime: 432000, requests: 0,
      memory: { rss: 145 * 1024 * 1024, heapUsed: 88 * 1024 * 1024, heapTotal: 128 * 1024 * 1024 },
      cpu: { user: 12000000, system: 3100000 },
      updatedAt: new Date(Date.now() - 5000).toISOString() },
    { id: 'model-prism-worker-1', role: 'worker', status: 'running', uptime: 259200, requests: 16842,
      memory: { rss: 184 * 1024 * 1024, heapUsed: 112 * 1024 * 1024, heapTotal: 160 * 1024 * 1024 },
      cpu: { user: 42500000, system: 8200000 },
      updatedAt: new Date(Date.now() - 2000).toISOString() },
    { id: 'model-prism-worker-2', role: 'worker', status: 'running', uptime: 259180, requests: 12455,
      memory: { rss: 172 * 1024 * 1024, heapUsed: 105 * 1024 * 1024, heapTotal: 160 * 1024 * 1024 },
      cpu: { user: 38700000, system: 7400000 },
      updatedAt: new Date(Date.now() - 3000).toISOString() },
  ],
  counters: { totalRequests: 29297, autoRouted: 28048, errors: 170, classifierCalls: 8500, avgRoutingMs: 1850 },
  providerStats: [
    { name: 'AWS Bedrock (EU)', type: 'bedrock', requests: 25000, errors: 45, avgLatencyMs: 1200, models: 9, status: 'healthy' },
    { name: 'OpenAI', type: 'openai', requests: 3200, errors: 12, avgLatencyMs: 800, models: 3, status: 'healthy' },
    { name: 'Ollama (local)', type: 'ollama', requests: 1097, errors: 3, avgLatencyMs: 2500, models: 3, status: 'healthy' },
  ],
  trafficBuckets: Array.from({ length: 24 }, (_, i) => ({ hour: i, requests: Math.round(i >= 8 && i <= 18 ? 800 + Math.random() * 400 : 50 + Math.random() * 100) })),
  mongodb: { status: 'connected', version: '7.0.15' },
  mode: 'scaled',
};

// Rule sets mock
export const ruleSets = [{
  _id: 'rs1', name: 'Default Rule Set', isGlobalDefault: true, isDefault: true,
  description: 'System default -- edit to tune routing behaviour.',
  tokenThresholds: { micro: 150, minimal: 500, low: 2000, medium: 15000, alwaysHigh: 50000 },
  signalWeights: { tokenCount: 0.8, systemPromptRole: 0.9, contentKeywords: 0.62, codeLanguage: 0.7, conversationTurns: 0.4 },
  turnUpgrade: { enabled: false, threshold: 4 },
  classifier: { confidenceThreshold: 0.65, contextLimitTokens: 6000, contextStrategy: 'truncate' },
  costMode: 'quality', tierBoost: 0,
  keywordRules: [
    { _id: 'kr1', name: 'Security Escalation', enabled: true, keywords: ['vulnerability', 'CVE', 'exploit', 'OWASP'], match: 'any', minMatches: 2, searchIn: 'user', effect: { category: 'code_security_review', tierMin: 'high', domain: 'security' } },
    { _id: 'kr2', name: 'Chat Title Generation', enabled: true, keywords: ['reply with a title', 'title for this chat'], match: 'any', minMatches: 1, searchIn: 'user', effect: { category: 'chat_title_generation', tierMax: 'micro' } },
  ],
  systemPromptRoles: [
    { _id: 'sr1', name: 'Coding Agent / SWE', enabled: true, pattern: 'opencode|coding.?agent|software.?engineer', effect: { category: 'swe_agentic', tierMin: 'medium', domain: 'tech' } },
    { _id: 'sr2', name: 'Security Auditor', enabled: true, pattern: 'security.*(auditor|analyst)', effect: { category: 'code_security_review', tierMin: 'high', domain: 'security' } },
  ],
}];

export const chatConfig = {
  enabled: true, visibility: 'admin', allowedModels: [], defaultModel: 'auto', systemPrompt: '', rateLimit: { requestsPerMinute: 10, maxTokensPerRequest: 4000 }, accessTokens: [],
};
