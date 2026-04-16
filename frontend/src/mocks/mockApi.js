// ── Mock API client for demo mode ─────────────────────────────────────────────
// Mimics an axios instance. All calls return Promise<{ data: ... }>.
// In-memory state supports CRUD so UI interactions "work" during the demo.
// Mutable settings state is persisted to localStorage so changes survive refresh.

import * as source from './mockData.js';

// Deep-clone all mutable state so mutations never affect the source module.
function clone(v) { return JSON.parse(JSON.stringify(v)); }

// ── localStorage persistence for settings ─────────────────────────────────────
const LS_KEY = 'prism_demo_state';
function loadLS() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}
function saveLS(patch) {
  const s = { ...loadLS(), ...patch };
  localStorage.setItem(LS_KEY, JSON.stringify(s));
  return s;
}

// ── Settings state — seeded from localStorage, saved on mutation ──────────────
const _saved = loadLS();

// ── In-memory state (ephemeral per session) ───────────────────────────────────
let providers       = clone(source.providers);
let tenants         = clone(source.tenants);
let categories      = clone(source.categories);
let users           = clone(source.users);
let routingRuleSets = clone(source.ruleSets);
let chatCfg         = _saved.chatCfg || clone(source.chatConfig);
let ldapConfig      = { enabled: false, url: '', baseDN: '', bindDN: '', groupFilter: '', userFilter: '' };

let logConfig = _saved.logConfig || {
  promptLogging: true, promptLogLevel: 'last_user',
  pathCapture: { enabled: true }, trackUsersByIp: true,
  fileLogging: { enabled: false },
  promptRetentionEnabled: false, promptRetentionHours: 48,
};

let appearanceSettings = (() => {
  // Sync: prefer prism_appearance (what App.jsx writes) over demo_state
  try {
    const appAppearance = JSON.parse(localStorage.getItem('prism_appearance') || 'null');
    if (appAppearance?.theme) return appAppearance;
  } catch {}
  return _saved.appearanceSettings || {
    theme: 'dark', brandName: '', pageTitle: '',
    custom: { primaryColor: '#228be6', navBg: '#1a1b1e', bodyBg: '#141517', cardBg: '#1a1b1e', borderColor: '#2c2e33', accentColor: '#228be6' },
  };
})();



let nextId = 100;
function genId() { return `demo-${++nextId}`; }

// Simulate realistic latency
function delay(min = 100, max = 280) {
  return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min)) + min));
}

function ok(data) { return { data }; }

// ── Route dispatcher ──────────────────────────────────────────────────────────
async function dispatch(method, url, body) {
  console.log(`[DEMO] ${method.toUpperCase()} ${url}`);
  await delay();

  const M = method.toUpperCase();
  const [base, qs] = url.split('?');
  const u = base; // path without query string
  const queryParams = new URLSearchParams(qs || '');

  // ── Auth ────────────────────────────────────────────────────────────────────
  if (u === '/api/prism/auth/login') {
    return ok({ token: 'demo-jwt-token', user: { id: 'demo', username: 'demo-admin', role: 'admin' } });
  }
  if (u === '/api/prism/auth/me') {
    return ok({ id: 'demo', username: 'demo-admin', role: 'admin' });
  }

  // ── Setup ───────────────────────────────────────────────────────────────────
  if (u === '/api/prism/setup/status') {
    return ok({ setupComplete: true });
  }
  if (u.startsWith('/api/prism/setup/')) {
    return ok({ ok: true });
  }

  // ── Dashboard ───────────────────────────────────────────────────────────────
  if (u === '/api/prism/admin/dashboard/summary') {
    return ok(clone(source.dashboardSummary));
  }
  if (u === '/api/prism/admin/dashboard/models') {
    return ok(clone(source.modelUsage));
  }
  if (u === '/api/prism/admin/dashboard/daily') {
    const hours = queryParams.get('hours');
    if (hours) {
      // Generate hourly buckets for the requested period
      const h = parseInt(hours);
      const hourly = Array.from({ length: h }, (_, i) => {
        const d = new Date(Date.now() - (h - 1 - i) * 3600_000);
        const isWork = d.getHours() >= 8 && d.getHours() <= 18;
        const reqs = isWork ? 80 + Math.floor(Math.random() * 60) : 5 + Math.floor(Math.random() * 15);
        const cost = reqs * 0.008 + Math.random() * 0.5;
        return {
          _id: d.toISOString().slice(0, 13) + ':00',
          requests: reqs,
          actualCost: Math.round(cost * 100) / 100,
          baselineCost: Math.round(cost * 2.6 * 100) / 100,
          saved: Math.round(cost * 1.6 * 100) / 100,
          inputTokens: reqs * 5000 + Math.floor(Math.random() * 20000),
          outputTokens: reqs * 400 + Math.floor(Math.random() * 3000),
          activeUsers: isWork ? Math.round(3 + Math.random() * 10) : Math.round(1 + Math.random() * 2),
        };
      });
      return ok(hourly);
    }
    return ok(clone(source.dailyStats));
  }
  if (u === '/api/prism/admin/dashboard/tenants-list') {
    return ok(tenants.map(t => ({ _id: t._id, name: t.name })));
  }
  if (u === '/api/prism/admin/dashboard/requests') {
    const statusFilter = queryParams.get('status');
    const errorCategoryFilter = queryParams.get('errorCategory');
    const all = clone(source.requestLogs);
    let filtered = statusFilter ? all.filter(r => r.status === statusFilter) : all;
    if (errorCategoryFilter) filtered = filtered.filter(r => r.errorCategory === errorCategoryFilter || (!r.errorCategory && errorCategoryFilter === 'unknown'));
    const page = parseInt(queryParams.get('page') || '1', 10);
    const limit = parseInt(queryParams.get('limit') || '25', 10);
    const start = (page - 1) * limit;
    const pageItems = filtered.slice(start, start + limit);
    return ok({ requests: pageItems, total: filtered.length, page, pages: Math.ceil(filtered.length / limit) });
  }
  if (u === '/api/prism/admin/dashboard/categories') {
    return ok([
      { _id: { category: 'coding_autocomplete', costTier: 'micro' }, requests: 5254, actualCost: 0.42 },
      { _id: { category: 'coding_autocomplete', costTier: 'low' }, requests: 3053, actualCost: 2.15 },
      { _id: { category: 'tool_use_agentic', costTier: 'medium' }, requests: 1931, actualCost: 18.40 },
      { _id: { category: 'code_explanation', costTier: 'low' }, requests: 1133, actualCost: 3.80 },
      { _id: { category: 'swe_agentic', costTier: 'high' }, requests: 669, actualCost: 98.50 },
      { _id: { category: 'coding_medium', costTier: 'medium' }, requests: 353, actualCost: 5.20 },
      { _id: { category: 'coding_complex', costTier: 'advanced' }, requests: 251, actualCost: 12.70 },
      { _id: { category: 'error_debugging', costTier: 'medium' }, requests: 198, actualCost: 2.85 },
      { _id: { category: 'system_design', costTier: 'advanced' }, requests: 142, actualCost: 8.90 },
      { _id: { category: 'qa_testing', costTier: 'medium' }, requests: 118, actualCost: 1.95 },
      { _id: { category: 'smalltalk_simple', costTier: 'minimal' }, requests: 95, actualCost: 0.08 },
      { _id: { category: 'translation', costTier: 'minimal' }, requests: 67, actualCost: 0.05 },
      { _id: { category: 'devops_infrastructure', costTier: 'medium' }, requests: 54, actualCost: 0.92 },
    ]);
  }
  if (u === '/api/prism/admin/dashboard/top-paths') {
    return ok([
      { _id: 'src/services/routerEngine.js', count: 42 },
      { _id: 'src/routes/gateway/index.js', count: 38 },
      { _id: 'src/pages/RoutingConfig.jsx', count: 25 },
    ]);
  }
  if (u === '/api/prism/admin/dashboard/rpm') {
    return ok({ rpm: 12 });
  }
  if (u === '/api/prism/admin/dashboard/users') {
    return ok([{ _id: 'admin', requests: 15000 }, { _id: 'dev-team', requests: 8000 }]);
  }

  // ── Providers ───────────────────────────────────────────────────────────────
  if (u === '/api/prism/admin/providers') {
    if (M === 'GET') return ok(clone(providers));
    if (M === 'POST') {
      const item = { ...body, _id: genId(), createdAt: new Date().toISOString() };
      providers.push(item);
      return ok(clone(item));
    }
  }
  // Provider sub-resources
  const providerMatch = u.match(/^\/api\/prism\/admin\/providers\/([^/]+)(.*)$/);
  if (providerMatch) {
    const [, pid, rest] = providerMatch;

    if (rest === '' || rest === '/') {
      if (M === 'PUT') {
        providers = providers.map(p => p._id === pid ? { ...p, ...body } : p);
        return ok(providers.find(p => p._id === pid) || {});
      }
      if (M === 'DELETE') {
        providers = providers.filter(p => p._id !== pid);
        return ok({ ok: true });
      }
    }
    if (rest === '/test') return ok({ ok: true, latencyMs: 145 });
    if (rest === '/check') return ok({ ok: true, latencyMs: 145 });
    if (rest === '/discover') {
      return ok({ discovered: clone(source.models).filter(m => m.providerId === pid) });
    }
    if (rest === '/chat') {
      const msgs = body?.messages || [];
      const lastUser = [...msgs].reverse().find(m => m.role === 'user')?.content || '';
      const q = lastUser.toLowerCase();
      let content;
      if (/sort|filter|map|reduce|array|list/.test(q)) {
        content = `Demo generated answer - no llm used:\n\nHere's a clean approach using method chaining:\n\n\`\`\`javascript\nconst result = data\n  .filter(item => item.active)\n  .map(item => item.value * 2)\n  .reduce((sum, val) => sum + val, 0);\n\`\`\`\n\nThis keeps the logic readable and avoids intermediate variables. Each step transforms the array without side effects.`;
      } else if (/error|bug|fix|fail|exception|crash/.test(q)) {
        content = `Demo generated answer - no llm used:\n\nThe issue is likely a null reference in the async path. Try adding an early guard:\n\n\`\`\`typescript\nif (!data || !data.items?.length) {\n  return { result: [], total: 0 };\n}\n\`\`\`\n\nAlso confirm the upstream call is awaited properly — missing \`await\` is a common cause of this pattern.`;
      } else if (/explain|what is|how does|why/.test(q)) {
        content = `Demo generated answer - no llm used:\n\nModel Prism sits between your application and any LLM provider. When a request comes in, the router classifies the task type (coding, analysis, summarization, etc.) and selects the most cost-effective model that meets the quality threshold.\n\nThis means a simple autocomplete uses a cheap micro model, while a complex architecture review gets routed to an advanced model — automatically, without changing your API calls.`;
      } else if (/cost|token|cheap|expensive|price/.test(q)) {
        content = `Demo generated answer - no llm used:\n\nThe biggest token waste patterns are:\n\n1. **Oversized system prompts** — injecting full documentation on every request\n2. **Long sessions** — carrying irrelevant earlier turns in context\n3. **Over-specified models** — using GPT-4 tier for tasks a smaller model handles equally well\n\nModel Prism's routing cuts avg cost 40–60% by matching task complexity to model tier automatically.`;
      } else {
        content = `Demo generated answer - no llm used:\n\nThat's a great question. Here's what I'd recommend:\n\nStart by breaking the problem into three parts — data ingestion, transformation, and output validation. Each layer should have a single responsibility and be independently testable.\n\nFor the transformation step specifically, a functional pipeline tends to be easier to reason about than imperative loops:\n\n\`\`\`javascript\nconst pipeline = [normalize, deduplicate, enrich, validate];\nconst result = pipeline.reduce((data, fn) => fn(data), rawInput);\n\`\`\`\n\nThis makes it trivial to add, remove, or reorder steps without touching the core logic.`;
      }
      return ok({ choices: [{ message: { role: 'assistant', content } }] });
    }
    if (rest === '/models/all' || u === '/api/prism/admin/providers/models/all') {
      return ok(clone(source.models));
    }
    if (rest === '/models/suggest' || u.startsWith('/api/prism/admin/providers/models/suggest')) {
      return ok({ tier: 'standard', inputPer1M: 1.00, outputPer1M: 4.00 });
    }
    if (rest === '/models/reorder-tier' || u === '/api/prism/admin/providers/models/reorder-tier') {
      return ok({ ok: true });
    }

    // PATCH a specific model: /api/prism/admin/providers/:pid/models/:modelId
    const modelPatch = rest.match(/^\/models\/(.+)$/);
    if (modelPatch && M === 'PATCH') {
      return ok({ ok: true });
    }
  }

  // models/all (alternate path without provider prefix)
  if (u === '/api/prism/admin/providers/models/all') {
    return ok(clone(source.models));
  }
  if (u.startsWith('/api/prism/admin/providers/models/suggest')) {
    return ok({ tier: 'standard', inputPer1M: 1.00, outputPer1M: 4.00 });
  }
  if (u === '/api/prism/admin/providers/models/reorder-tier') {
    return ok({ ok: true });
  }
  if (u === '/api/prism/admin/models/available') {
    return ok(clone(source.models));
  }

  // ── Tenants ─────────────────────────────────────────────────────────────────
  if (u === '/api/prism/admin/tenants') {
    if (M === 'GET') return ok(clone(tenants));
    if (M === 'POST') {
      const item = { ...body, _id: genId(), currentMonthCost: 0, keyEnabled: true, apiKey: `omp-demo-${body.slug || genId()}` };
      tenants.push(item);
      return ok(clone(item));
    }
  }
  const tenantMatch = u.match(/^\/api\/prism\/admin\/tenants\/([^/]+)(.*)$/);
  if (tenantMatch) {
    const [, tid, rest] = tenantMatch;

    if (rest === '' || rest === '/') {
      if (M === 'PUT') {
        tenants = tenants.map(t => t._id === tid ? { ...t, ...body } : t);
        return ok(tenants.find(t => t._id === tid) || {});
      }
      if (M === 'DELETE') {
        tenants = tenants.filter(t => t._id !== tid);
        return ok({ ok: true });
      }
    }
    if (rest === '/rotate-key') {
      const newKey = `omp-demo-rotated-${genId()}`;
      tenants = tenants.map(t => t._id === tid ? { ...t, apiKey: newKey } : t);
      return ok({ apiKey: newKey });
    }
    if (rest === '/set-key') {
      tenants = tenants.map(t => t._id === tid ? { ...t, apiKey: body?.key } : t);
      return ok({ ok: true });
    }
    if (rest === '/test-request') {
      return ok({ success: true, model: 'gpt-4o-mini', latencyMs: 312, content: 'Demo test response.' });
    }
    if (rest === '/add-provider') {
      return ok({ ok: true });
    }
  }
  if (u === '/api/prism/admin/tenants/default/add-provider') {
    return ok({ ok: true });
  }

  // ── Categories ──────────────────────────────────────────────────────────────
  if (u === '/api/prism/admin/categories') {
    if (M === 'GET') return ok(clone(categories));
    if (M === 'POST') {
      const item = { ...body, _id: genId() };
      categories.push(item);
      return ok(clone(item));
    }
  }
  if (u === '/api/prism/admin/categories/presets') {
    return ok([
      { id: 'coding', name: 'Coding & DevOps', description: 'Optimize for coding tasks', icon: 'code', categories: ['coding_simple','coding_medium','coding_complex','swe_agentic','devops_infrastructure','qa_testing'] },
      { id: 'general', name: 'General Purpose', description: 'Balanced for all task types', icon: 'star', categories: ['smalltalk_simple','translation','summarization_long','analysis_complex'] },
    ]);
  }
  if (u === '/api/prism/admin/categories/apply-preset') {
    return ok({ applied: true, categories: clone(categories) });
  }
  if (u === '/api/prism/admin/categories/reset-defaults') {
    categories = clone(source.categories);
    return ok(clone(categories));
  }
  const categoryMatch = u.match(/^\/api\/prism\/admin\/categories\/([^/]+)(.*)$/);
  if (categoryMatch) {
    const [, cid, rest] = categoryMatch;
    if (rest === '' || rest === '/') {
      if (M === 'PUT') {
        categories = categories.map(c => c._id === cid ? { ...c, ...body } : c);
        return ok(categories.find(c => c._id === cid) || {});
      }
      if (M === 'DELETE') {
        categories = categories.filter(c => c._id !== cid);
        return ok({ ok: true });
      }
    }
  }

  // ── Users ───────────────────────────────────────────────────────────────────
  if (u === '/api/prism/admin/users') {
    if (M === 'GET') return ok(clone(users));
    if (M === 'POST') {
      const item = { ...body, _id: genId(), createdAt: new Date().toISOString() };
      // Don't store passwords
      delete item.password;
      users.push(item);
      return ok(clone(item));
    }
  }
  const userMatch = u.match(/^\/api\/prism\/admin\/users\/([^/]+)(.*)$/);
  if (userMatch) {
    const [, uid, rest] = userMatch;
    if (rest === '' || rest === '/') {
      if (M === 'PUT') {
        users = users.map(u => u._id === uid ? { ...u, ...body } : u);
        return ok(users.find(u => u._id === uid) || {});
      }
      if (M === 'DELETE') {
        users = users.filter(u => u._id !== uid);
        return ok({ ok: true });
      }
    }
    if (rest === '/password') {
      return ok({ ok: true });
    }
  }

  // ── LDAP ─────────────────────────────────────────────────────────────────────
  if (u === '/api/prism/admin/ldap') {
    if (M === 'GET') return ok(clone(ldapConfig));
    if (M === 'PUT') {
      ldapConfig = { ...ldapConfig, ...body };
      return ok(clone(ldapConfig));
    }
  }
  if (u === '/api/prism/admin/ldap/test') {
    return ok({ success: true, user: { dn: 'cn=testuser,ou=users,dc=demo,dc=local', groups: ['ai-team'] } });
  }

  // ── System ──────────────────────────────────────────────────────────────────
  if (u === '/api/prism/admin/system/overview') {
    const overview = clone(source.systemOverview);
    return ok(overview);
  }
  if (u === '/api/prism/admin/system/log-config') {
    if (M === 'GET') return ok(clone(logConfig));
    if (M === 'PUT') {
      logConfig = { ...logConfig, ...body };
      saveLS({ logConfig });
      return ok(clone(logConfig));
    }
  }
  if (u === '/api/prism/admin/system/circuit-breaker') {
    return ok([
      { providerId: 'p1', providerName: 'aws-aic', providerSlug: 'aws-aic', state: 'CLOSED', failures: 0, errorRate: 0.2 },
      { providerId: 'p2', providerName: 'azure-llm', providerSlug: 'az-azure-llm', state: 'CLOSED', failures: 0, errorRate: 0.0 },
    ]);
  }
  if (u.startsWith('/api/prism/admin/system/pods/')) {
    if (M === 'DELETE') return ok({ ok: true });
  }

  // ── Chat config ──────────────────────────────────────────────────────────────
  if (u === '/api/prism/admin/chat/config') {
    if (M === 'GET') return ok(clone(chatCfg));
    if (M === 'PUT') { chatCfg = { ...chatCfg, ...body }; saveLS({ chatCfg }); return ok(clone(chatCfg)); }
  }
  if (u === '/api/prism/admin/chat/public/config') {
    if (chatCfg.visibility === 'admin') return { data: null, status: 403 };
    return ok({ visibility: chatCfg.visibility, allowedModels: chatCfg.allowedModels, defaultModel: chatCfg.defaultModel });
  }
  if (u === '/api/prism/admin/chat/tokens') {
    return ok({ token: 'demo-' + Math.random().toString(36).slice(2, 18), label: body?.label, expiresAt: new Date(Date.now() + 86400000).toISOString() });
  }

  // ── Test suites ─────────────────────────────────────────────────────────────
  if (u === '/api/prism/admin/routing/test-suites') {
    if (M === 'GET') return ok([]);
    if (M === 'POST') return ok({ _id: genId(), ...body, testCases: [], createdAt: new Date().toISOString() });
  }
  if (u === '/api/prism/admin/routing/test-route') {
    return ok({ trace: [{ step: 1, name: 'Signal Extraction', changed: false, data: { totalTokens: 150 } }], summary: { finalModel: 'qwen.qwen3-coder-30b-a3b-v1:0', finalTier: 'medium', category: 'coding_medium', confidence: 0.92, routingMs: 45 } });
  }

  // ── Routing rule sets ────────────────────────────────────────────────────────
  if (u === '/api/prism/admin/routing/rule-sets') {
    if (M === 'GET') return ok(clone(routingRuleSets));
    if (M === 'POST') {
      const item = { ...body, _id: genId(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      routingRuleSets.push(item);
      return ok(clone(item));
    }
  }
  if (u === '/api/prism/admin/routing/rule-sets/seed-defaults') {
    if (routingRuleSets.length === 0) {
      routingRuleSets = clone(source.ruleSets);
      return ok({ created: true });
    }
    return ok({ created: false });
  }
  if (u === '/api/prism/admin/routing/benchmark') {
    return ok({
      simulated: body?.limit || 500, dataQuality: 'full', fullSignalRequests: 450, partialSignalRequests: 50,
      current: { tierDistribution: { micro: 120, minimal: 80, low: 150, medium: 100, advanced: 30, high: 15, ultra: 5 }, classifierCallRate: 1.0, estimatedCost: 45.20 },
      proposed: { tierDistribution: { micro: 130, minimal: 90, low: 140, medium: 95, advanced: 25, high: 15, ultra: 5 }, classifierCallRate: 0.82, estimatedCost: 41.35 },
      diff: { tierShifts: 45, costDelta: -3.85, classifierBypasses: 90, classifierBypassRate: '18%' },
      changes: [],
    });
  }
  const ruleSetMatch = u.match(/^\/api\/prism\/admin\/routing\/rule-sets\/([^/]+)(.*)$/);
  if (ruleSetMatch) {
    const [, rsid, rest] = ruleSetMatch;
    if (rest === '' || rest === '/') {
      if (M === 'PUT') {
        routingRuleSets = routingRuleSets.map(r => r._id === rsid ? { ...r, ...body, updatedAt: new Date().toISOString() } : r);
        return ok(routingRuleSets.find(r => r._id === rsid) || {});
      }
      if (M === 'DELETE') {
        routingRuleSets = routingRuleSets.filter(r => r._id !== rsid);
        return ok({ ok: true });
      }
    }
    if (rest === '/set-default') {
      routingRuleSets = routingRuleSets.map(r => ({ ...r, isGlobalDefault: r._id === rsid }));
      return ok({ ok: true });
    }
  }

  // ── Tenant portal (my-tenant page) ──────────────────────────────────────────
  if (u === '/api/prism/tenant-portal/mine') {
    return ok(clone(tenants[0]));
  }
  const tenantPortalMatch = u.match(/^\/api\/prism\/tenant-portal\/([^/]+)(.*)$/);
  if (tenantPortalMatch) {
    const [, , rest] = tenantPortalMatch;
    if (rest === '/models') return ok(clone(source.models));
    if (rest === '/model-config' && M === 'PUT') return ok({ modelConfig: body });
  }

  // ── Failed requests ──────────────────────────────────────────────────────────
  if (u === '/api/prism/admin/failed-requests') {
    if (M === 'DELETE') return ok({ ok: true, deleted: 0 });
  }

  // ── Prompt Analyses ─────────────────────────────────────────────────────────
  if (u === '/api/prism/admin/prompt-engineer/settings') {
    if (M === 'GET') return ok({ enabled: true, providerId: '', model: 'gpt-4o-mini', maxPrompts: 20, ignoredCategories: ['code_completion'] });
    if (M === 'PUT') return ok(body);
  }
  if (u === '/api/prism/admin/prompt-engineer/results') {
    return ok({ createdAt: new Date(Date.now() - 3600_000).toISOString(), model: 'gpt-4o-mini', analyzed: 12, failed: 1, results: [] });
  }
  if (u === '/api/prism/admin/prompt-engineer/progress') {
    return ok({ running: false, total: 0, done: 0, failed: 0, skipped: 0 });
  }
  if (u === '/api/prism/admin/prompt-engineer/analyze') {
    if (M === 'POST') return ok({ ok: true, message: 'Analysis queued' });
  }

  // ── Appearance ──────────────────────────────────────────────────────────────
  if (u === '/api/prism/admin/appearance') {
    if (M === 'GET') return ok(clone(appearanceSettings));
    if (M === 'PUT') {
      if (body.custom) appearanceSettings.custom = { ...appearanceSettings.custom, ...body.custom };
      const { custom: _, ...rest } = body;
      appearanceSettings = { ...appearanceSettings, ...rest };
      if (body.custom) appearanceSettings.custom = { ...appearanceSettings.custom, ...body.custom };
      saveLS({ appearanceSettings });
      // Also sync to prism_appearance (what App.jsx reads on boot)
      localStorage.setItem('prism_appearance', JSON.stringify(appearanceSettings));
      return ok(clone(appearanceSettings));
    }
  }

  // ── Shrink logs (data maintenance) ──────────────────────────────────────────
  if (u === '/api/prism/admin/system/shrink-logs') {
    return ok({ shrunk: 42 });
  }
  if (u === '/api/prism/admin/dashboard/recalc-costs') {
    return ok({ scanned: 1200, updated: 85, totalCostDelta: -0.42, dailyStatsRebuilt: 7 });
  }
  if (u === '/api/prism/admin/dashboard/reclassify-fim') {
    return ok({ scanned: 500, updated: 23 });
  }

  // ── IDE Config ─────────────────────────────────────────────────────────────
  if (u === '/api/prism/ide-config/tenants' || u === '/api/prism/public/ide-config/tenants') {
    return ok(tenants.map(t => ({ _id: t._id, slug: t.slug, name: t.name, isDefault: t._id === 't1' })));
  }
  if (u === '/api/prism/ide-config/settings') {
    if (M === 'put') return ok({ publicEnabled: body?.publicEnabled ?? true, publicTenantIds: body?.publicTenantIds ?? [] });
    return ok({ publicEnabled: true, publicTenantIds: [] });
  }
  if (u === '/api/prism/ide-config/models' || u === '/api/prism/public/ide-config/models') {
    const allModels = providers.flatMap(p =>
      (p.discoveredModels || []).filter(m => m.visible !== false).map(m => ({
        id: m.id, name: m.id, provider: p.name, tier: m.tier, cost: m.tier === 'ultra' || m.tier === 'critical' ? 'very high' : m.tier === 'high' ? 'high' : m.tier === 'advanced' ? 'moderate' : m.tier === 'medium' ? 'moderate' : 'low',
        ...(m.tier === 'ultra' || m.tier === 'critical' ? { warning: 'Ultra/critical-tier model — very high costs. Use sparingly.', suggestion: 'For everyday coding, medium-high tier models are recommended.' } : {}),
      }))
    );
    const low = allModels.filter(m => ['micro','minimal','low'].includes(m.tier)).slice(0, 3).map(m => m.id);
    const med = allModels.filter(m => ['low','medium'].includes(m.tier)).slice(0, 3).map(m => m.id);
    const rec = allModels.filter(m => ['medium','high'].includes(m.tier)).slice(0, 3).map(m => m.id);
    const prem = allModels.filter(m => ['ultra','critical'].includes(m.tier)).map(m => m.id);
    return ok({
      tenant: { slug: 'dev-alpha', name: 'Dev Team Alpha' },
      models: [
        { id: 'model-prism', name: 'Model Prism (Auto Router)', locked: true, selected: true, tier: 'auto', recommendedFor: 'all tasks', suggestion: 'Best default — auto-routes to optimal model.' },
        ...allModels.map(m => ({ ...m, selected: false })),
      ],
      recommendations: {
        autocomplete: { description: 'For tab-autocomplete / FIM, use cheap fast models:', models: low, tiers: ['micro','minimal','low'] },
        smallTasks: { description: 'For quick questions, simple code — affordable and fast:', models: med, tiers: ['low','medium'] },
        recommended: { description: 'Best balance of quality and cost for everyday coding:', models: rec, tiers: ['medium','high'] },
        premium: { description: 'Ultra-tier: use only for formal proofs, critical security audits, or when cheaper models fail.', models: prem, tiers: ['ultra','critical'] },
      },
      formats: ['continue', 'opencode'],
    });
  }
  if (u === '/api/prism/ide-config/generate' || u === '/api/prism/public/ide-config/generate') {
    const fmt = body?.format || 'opencode';
    const key = body?.apiKey || 'omp-demo-key';
    const base = window.location.origin + '/api/dev-alpha/v1';
    const sel = body?.models?.length ? body.models : providers.flatMap(p => (p.discoveredModels||[]).filter(m=>m.visible!==false).map(m=>m.id));
    if (fmt === 'continue') {
      const lines = [`# Continue.dev config — generated by Model Prism (demo)`, `models:`,
        `  - title: "Model Prism (Auto Router)"`, `    provider: openai`, `    model: auto-prism`, `    apiBase: "${base}"`, `    apiKey: "${key}"`,
        ...sel.map(id => [`  - title: "${id}"`, `    provider: openai`, `    model: "${id}"`, `    apiBase: "${base}"`, `    apiKey: "${key}"`].join('\n')),
        ``, `tabAutocompleteModel:`, `  title: "Model Prism (FIM)"`, `  provider: openai`, `  model: auto-prism`, `  apiBase: "${base}"`, `  apiKey: "${key}"`,
      ];
      return ok(lines.join('\n'));
    }
    return ok({ $schema: 'https://opencode.ai/config.json', provider: { 'model-prism': { options: { baseURL: base, apiKey: key }, models: { 'model-prism': { name: 'Model Prism (Auto Router)' }, ...Object.fromEntries(sel.map(id => [id, { name: id }])) } } }, model: 'model-prism/model-prism' });
  }

  // ── Default: return empty success ────────────────────────────────────────────
  console.warn(`[DEMO] Unmatched route: ${M} ${url} — returning empty object`);
  return ok({});
}

// ── Exported mock API (axios-compatible interface) ────────────────────────────
export function createMockApi() {
  return {
    get:    (url, config)       => dispatch('get',    url, null,    config),
    post:   (url, data, config) => dispatch('post',   url, data,    config),
    put:    (url, data, config) => dispatch('put',    url, data,    config),
    patch:  (url, data, config) => dispatch('patch',  url, data,    config),
    delete: (url, config)       => dispatch('delete', url, null,    config),

    // axios interceptors stub — no-ops so callers that reference them don't throw
    interceptors: {
      request:  { use: () => {} },
      response: { use: () => {} },
    },
  };
}
