/**
 * Public IDE Config Generator Page
 * Serves a standalone HTML page at /public/config that lets developers:
 * - See available models grouped by tier with cost badges
 * - Select models for their IDE config (model-prism always locked on)
 * - Download ready-to-use Continue.dev YAML or OpenCode JSON
 * - Get tier-based recommendations and cost warnings
 *
 * No authentication required — uses the default tenant's public model list.
 * For non-default tenants, pass ?tenant=slug&apiKey=omp-xxx.
 */
export function configPageHtml(baseOrigin) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IDE Setup — Model Prism</title>
  <style>
    :root {
      --bg: #0d1117; --bg-card: #161b22; --bg-input: #21262d; --border: #30363d;
      --text: #e6edf3; --text-dim: #8b949e; --text-muted: #6e7681;
      --accent: #58a6ff; --green: #3fb950; --yellow: #d29922; --orange: #db6d28;
      --red: #f85149; --purple: #bc8cff; --teal: #39d353; --pink: #f778ba;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg); color: var(--text); line-height: 1.5; padding: 2rem; max-width: 900px; margin: 0 auto; }
    h1 { font-size: 1.6rem; margin-bottom: 0.3rem; }
    h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; color: var(--text-dim); border-bottom: 1px solid var(--border); padding-bottom: 0.3rem; }
    p, .desc { color: var(--text-dim); font-size: 0.85rem; margin-bottom: 1rem; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    .logo { display: flex; align-items: center; gap: 0.8rem; margin-bottom: 1.5rem; }
    .logo svg { width: 36px; height: 36px; }
    .subtitle { color: var(--text-dim); font-size: 0.9rem; }

    .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
    .card.warn { border-color: var(--orange); background: #2d1b00; }
    .card.info { border-color: var(--accent); background: #0d1f3c; }
    .card.success { border-color: var(--green); background: #0d2818; }

    .badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; }
    .badge-micro { background: #2d1f5e; color: var(--purple); }
    .badge-minimal { background: #0d3028; color: var(--teal); }
    .badge-low { background: #0d2440; color: var(--accent); }
    .badge-medium { background: #2d2200; color: var(--yellow); }
    .badge-advanced { background: #0d2d3d; color: #56d4dd; }
    .badge-high { background: #3d0d0d; color: var(--red); }
    .badge-ultra { background: #2d0d2d; color: var(--pink); }
    .badge-critical { background: #2d1500; color: var(--orange); }
    .badge-auto { background: #0d2818; color: var(--green); }

    .setup { display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; margin-bottom: 1rem; }
    .setup input, .setup select { width: 100%; padding: 0.5rem; background: var(--bg-input); border: 1px solid var(--border);
      border-radius: 6px; color: var(--text); font-size: 0.85rem; }
    .setup label { font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.2rem; display: block; }

    .model-group { margin-bottom: 0.8rem; }
    .model-group h3 { font-size: 0.85rem; color: var(--text-dim); margin-bottom: 0.4rem; }
    .model-item { display: flex; align-items: center; gap: 0.6rem; padding: 0.35rem 0.5rem;
      border-radius: 4px; cursor: pointer; font-size: 0.82rem; }
    .model-item:hover { background: var(--bg-input); }
    .model-item input[type=checkbox] { accent-color: var(--accent); }
    .model-item .name { flex: 1; }
    .model-item .cost { color: var(--text-muted); font-size: 0.75rem; }
    .model-item.locked { opacity: 0.7; cursor: default; }
    .model-item.locked input { pointer-events: none; }

    .recs { display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; margin-bottom: 1.2rem; }
    .rec { padding: 0.8rem; border-radius: 6px; background: var(--bg-card); border: 1px solid var(--border); }
    .rec h4 { font-size: 0.8rem; margin-bottom: 0.3rem; }
    .rec p { font-size: 0.75rem; margin: 0; }
    .rec .models { color: var(--accent); font-size: 0.75rem; margin-top: 0.3rem; }

    .actions { display: flex; gap: 0.8rem; margin-top: 1.2rem; flex-wrap: wrap; }
    .btn { padding: 0.6rem 1.2rem; border: none; border-radius: 6px; font-size: 0.85rem; font-weight: 500;
      cursor: pointer; display: inline-flex; align-items: center; gap: 0.4rem; transition: opacity 0.15s; }
    .btn:hover { opacity: 0.85; }
    .btn-primary { background: var(--accent); color: #000; }
    .btn-secondary { background: var(--bg-input); color: var(--text); border: 1px solid var(--border); }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .preview { margin-top: 1rem; }
    .preview pre { background: var(--bg-input); border: 1px solid var(--border); border-radius: 6px;
      padding: 1rem; overflow-x: auto; font-size: 0.78rem; line-height: 1.6; max-height: 400px; overflow-y: auto; }

    .loading { text-align: center; padding: 3rem; color: var(--text-dim); }
    .error { color: var(--red); padding: 1rem; }

    @media (max-width: 600px) {
      .setup, .recs { grid-template-columns: 1fr; }
      body { padding: 1rem; }
    }
  </style>
</head>
<body>
  <div class="logo">
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="18" fill="#161b22"/>
      <path d="M50 15L85 35V65L50 85L15 65V35L50 15Z" stroke="#58a6ff" stroke-width="3" fill="none"/>
      <circle cx="50" cy="50" r="12" fill="#58a6ff" opacity="0.3"/>
      <circle cx="50" cy="50" r="6" fill="#58a6ff"/>
    </svg>
    <div>
      <h1>IDE Setup</h1>
      <div class="subtitle">Configure your IDE to use Model Prism</div>
    </div>
  </div>

  <div class="card info">
    <strong>Recommended:</strong> Use <code>model-prism</code> (Auto Router) as your primary model.
    It automatically classifies each prompt and routes to the optimal model — balancing quality and cost without any manual model selection.
  </div>

  <div class="setup">
    <div>
      <label for="tenant">Tenant</label>
      <input type="text" id="tenant" placeholder="default" value="">
    </div>
    <div>
      <label for="apiKey">API Key</label>
      <input type="password" id="apiKey" placeholder="omp-xxxx (optional for default tenant)">
    </div>
  </div>
  <button class="btn btn-secondary" onclick="loadModels()" id="loadBtn">Load Models</button>

  <div id="content" style="display:none">
    <h2>Recommendations</h2>
    <div class="recs" id="recs"></div>

    <h2>Select Models</h2>
    <p>Choose which models to include in your IDE config. <code>model-prism</code> is always included.</p>
    <div id="modelList"></div>

    <h2>Download Config</h2>
    <div class="actions">
      <button class="btn btn-primary" onclick="downloadConfig('continue')">&#11015; Continue.dev (YAML)</button>
      <button class="btn btn-primary" onclick="downloadConfig('opencode')">&#11015; OpenCode (JSON)</button>
      <button class="btn btn-secondary" onclick="togglePreview()">Preview</button>
    </div>
    <div class="preview" id="preview" style="display:none">
      <div style="margin-bottom:0.5rem">
        <button class="btn btn-secondary" onclick="showPreview('continue')" style="padding:0.3rem 0.8rem;font-size:0.8rem">YAML</button>
        <button class="btn btn-secondary" onclick="showPreview('opencode')" style="padding:0.3rem 0.8rem;font-size:0.8rem">JSON</button>
      </div>
      <pre id="previewCode"></pre>
    </div>
  </div>

  <div id="loadingMsg" class="loading" style="display:none">Loading models...</div>
  <div id="errorMsg" class="error" style="display:none"></div>

  <script>
    const BASE = '${baseOrigin}';
    let modelsData = null;
    let selectedModels = new Set();

    // Embedded demo data — used when the API is not reachable (demo mode, offline)
    const DEMO_DATA = {
      tenant: { slug: 'demo', name: 'Demo Tenant' },
      models: [
        { id: 'model-prism', name: 'Model Prism (Auto Router)', locked: true, selected: true, tier: 'auto',
          recommendedFor: 'all tasks', suggestion: 'Best default choice — auto-routes to the optimal model.' },
        { id: 'eu.amazon.nova-micro-v1:0', tier: 'minimal', cost: 'very low', recommendedFor: 'autocomplete' },
        { id: 'qwen.qwen3-32b-v1:0', tier: 'low', cost: 'low', recommendedFor: 'autocomplete, small tasks' },
        { id: 'eu.anthropic.claude-haiku-4-5', tier: 'low', cost: 'low', recommendedFor: 'autocomplete, small tasks' },
        { id: 'qwen.qwen3-coder-30b-a3b-v1:0', tier: 'medium', cost: 'moderate', recommendedFor: 'general coding, code review, debugging' },
        { id: 'cohere/command-r-plus-08-2025', tier: 'advanced', cost: 'moderate', recommendedFor: 'complex coding, architecture questions' },
        { id: 'gpt-5.2', tier: 'high', cost: 'high', recommendedFor: 'agentic SWE, complex refactoring' },
        { id: 'eu.anthropic.claude-sonnet-4-6', tier: 'high', cost: 'high', recommendedFor: 'agentic SWE, complex refactoring, security reviews' },
        { id: 'google/gemini-2.5-pro', tier: 'high', cost: 'high', recommendedFor: 'agentic SWE, long context' },
        { id: 'eu.anthropic.claude-opus-4-6-v1', tier: 'ultra', cost: 'very high',
          warning: 'Ultra-tier model with very high per-request costs. Use sparingly — recommended only for formal proofs, critical security reviews, or complex multi-step reasoning.',
          suggestion: 'For everyday coding, medium–high tier models deliver excellent results at a fraction of the cost.' },
        { id: 'gpt-5.3-codex', tier: 'ultra', cost: 'very high',
          warning: 'Ultra-tier model with very high per-request costs. Use sparingly.',
          suggestion: 'For everyday coding, medium–high tier models deliver excellent results at a fraction of the cost.' },
      ],
      recommendations: {
        autocomplete: { description: 'For tab-autocomplete / FIM, use cheap fast models:', models: ['eu.amazon.nova-micro-v1:0', 'qwen.qwen3-32b-v1:0', 'eu.anthropic.claude-haiku-4-5'], tiers: ['micro','minimal','low'] },
        smallTasks: { description: 'For quick questions, simple code — affordable and fast:', models: ['qwen.qwen3-32b-v1:0', 'qwen.qwen3-coder-30b-a3b-v1:0'], tiers: ['low','medium'] },
        recommended: { description: 'Best balance of quality and cost for everyday coding:', models: ['qwen.qwen3-coder-30b-a3b-v1:0', 'eu.anthropic.claude-sonnet-4-6', 'gpt-5.2'], tiers: ['medium','high'] },
        premium: { description: 'Ultra-tier models are very expensive. Use only for: formal proofs, critical security audits, or when cheaper models demonstrably fail.', models: ['eu.anthropic.claude-opus-4-6-v1', 'gpt-5.3-codex'], tiers: ['ultra','critical'] },
      },
      formats: ['continue', 'opencode'],
    };

    function getTenant() { return document.getElementById('tenant').value.trim() || 'api'; }
    function getApiKey() { return document.getElementById('apiKey').value.trim(); }

    async function loadModels() {
      const tenant = getTenant();
      const key = getApiKey();
      const qs = key ? '?apiKey=' + encodeURIComponent(key) : '';
      document.getElementById('loadingMsg').style.display = 'block';
      document.getElementById('content').style.display = 'none';
      document.getElementById('errorMsg').style.display = 'none';

      try {
        const resp = await fetch(BASE + '/api/' + tenant + '/v1/config/models' + qs);
        if (!resp.ok) throw new Error((await resp.json()).error?.message || resp.statusText);
        modelsData = await resp.json();
      } catch (e) {
        // Fallback: use embedded demo data so the page works in demo mode
        // and offline deployments where the API is not yet configured.
        modelsData = DEMO_DATA;
        console.warn('Config API unavailable, using demo data:', e.message);
      }
      selectedModels = new Set(['model-prism']);
      renderRecs();
      renderModels();
      document.getElementById('content').style.display = 'block';
      document.getElementById('loadingMsg').style.display = 'none';
    }

    function renderRecs() {
      const r = modelsData.recommendations;
      if (!r) return;
      const html = [
        rec('Autocomplete / FIM', r.autocomplete, 'low'),
        rec('Quick Tasks', r.smallTasks, 'medium'),
        rec('Recommended', r.recommended, 'green'),
        rec('Premium (use sparingly)', r.premium, 'orange'),
      ].join('');
      document.getElementById('recs').innerHTML = html;
    }

    function rec(title, data, color) {
      if (!data) return '';
      const models = (data.models || []).slice(0, 3).join(', ') || 'none available';
      return '<div class="rec"><h4 style="color:var(--' + color + ')">' + title + '</h4>'
        + '<p>' + data.description + '</p>'
        + '<div class="models">' + models + '</div></div>';
    }

    function renderModels() {
      const tiers = ['micro','minimal','low','medium','advanced','high','ultra','critical'];
      const tierLabels = { micro:'Micro', minimal:'Minimal', low:'Low', medium:'Medium',
        advanced:'Advanced', high:'High', ultra:'Ultra', critical:'Critical' };
      const byTier = {};
      for (const m of modelsData.models) {
        const t = m.tier || 'auto';
        if (!byTier[t]) byTier[t] = [];
        byTier[t].push(m);
      }

      let html = '';
      // Auto first
      if (byTier.auto) {
        html += '<div class="model-group">';
        for (const m of byTier.auto) {
          html += modelItem(m, true);
        }
        html += '</div>';
      }
      for (const tier of tiers) {
        if (!byTier[tier]?.length) continue;
        const warn = (tier === 'ultra' || tier === 'critical') ? ' — &#9888; high costs' : '';
        html += '<div class="model-group"><h3><span class="badge badge-' + tier + '">' + tierLabels[tier] + '</span>' + warn + '</h3>';
        for (const m of byTier[tier]) {
          html += modelItem(m, m.locked);
        }
        html += '</div>';
      }
      document.getElementById('modelList').innerHTML = html;
    }

    function modelItem(m, locked) {
      const checked = locked || selectedModels.has(m.id) ? 'checked' : '';
      const disabled = locked ? 'disabled' : '';
      const cls = locked ? 'model-item locked' : 'model-item';
      const cost = m.cost ? '<span class="cost">' + m.cost + '</span>' : '';
      const warn = m.warning ? '<span class="cost" style="color:var(--orange)" title="' + m.warning.replace(/"/g, '&quot;') + '">&#9888;</span>' : '';
      return '<label class="' + cls + '">'
        + '<input type="checkbox" ' + checked + ' ' + disabled
        + ' onchange="toggleModel(\\'' + m.id + '\\', this.checked)">'
        + '<span class="name">' + m.id + '</span>' + cost + warn + '</label>';
    }

    function toggleModel(id, on) {
      if (on) selectedModels.add(id); else selectedModels.delete(id);
    }

    function getSelectedParam() {
      const all = modelsData.models.filter(m => !m.locked).map(m => m.id);
      const sel = [...selectedModels].filter(id => id !== 'model-prism');
      if (sel.length === 0 || sel.length === all.length) return '';
      return '&models=' + sel.map(encodeURIComponent).join(',');
    }

    async function downloadConfig(format) {
      const tenant = getTenant();
      const key = getApiKey();
      let qs = key ? '?apiKey=' + encodeURIComponent(key) : '?';
      qs += getSelectedParam();
      if (qs === '?') qs = '';

      const resp = await fetch(BASE + '/api/' + tenant + '/v1/config/' + format + qs);
      const text = await resp.text();
      const ext = format === 'continue' ? 'yaml' : 'json';
      const blob = new Blob([text], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (format === 'continue' ? 'config.' : 'opencode.') + ext;
      a.click();
      URL.revokeObjectURL(a.href);
    }

    function togglePreview() {
      const el = document.getElementById('preview');
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
      if (el.style.display === 'block') showPreview('continue');
    }

    async function showPreview(format) {
      const tenant = getTenant();
      const key = getApiKey();
      let qs = key ? '?apiKey=' + encodeURIComponent(key) : '?';
      qs += getSelectedParam();
      if (qs === '?') qs = '';

      const resp = await fetch(BASE + '/api/' + tenant + '/v1/config/' + format + qs);
      document.getElementById('previewCode').textContent = await resp.text();
    }

    // Auto-load default tenant on page load
    window.addEventListener('DOMContentLoaded', () => {
      const params = new URLSearchParams(location.search);
      if (params.get('tenant')) document.getElementById('tenant').value = params.get('tenant');
      if (params.get('apiKey')) document.getElementById('apiKey').value = params.get('apiKey');
      loadModels();
    });
  </script>
</body>
</html>`;
}
