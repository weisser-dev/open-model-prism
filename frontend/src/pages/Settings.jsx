import { useEffect, useState } from 'react';
import {
  Title, Stack, Accordion, Loader, Text, Switch, Select, NumberInput,
  Button, Alert, Group, TextInput, Textarea, Code, Badge, Divider,
  MultiSelect, ActionIcon, Modal, ColorInput, Paper, SegmentedControl, FileInput, Image,
  PasswordInput, FileButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconSettings, IconMessageChatbot, IconFileText, IconRocket,
  IconDatabase, IconTrash, IconRefresh, IconKey, IconMail, IconBrain,
  IconPalette, IconDeviceFloppy, IconSun, IconMoon, IconDeviceDesktop,
  IconAlertTriangle, IconDownload, IconUpload,
} from '@tabler/icons-react';
import api from '../hooks/useApi';

// ── Appearance Panel ─────────────────────────────────────────────────────────
const DARK_COLORS = {
  primaryColor: '#228be6', accentColor: '#38bdf8',
  bodyBg: '#141517', navBg: '#1a1b1e', headerBg: '#1a1b1e', cardBg: '#1a1b1e',
  inputBg: '#25262b', hoverBg: '#2c2e33', codeBg: '#0d0d14',
  textColor: '#e6e6e6', textDimmed: '#868e96', textMuted: '#5c5f66',
  navText: 'rgba(255,255,255,0.7)', navActive: '#228be6', navHoverBg: 'rgba(255,255,255,0.05)',
  btnText: '#ffffff', scrollbar: '#3a3a3a',
  borderColor: '#2c2e33',
  successColor: '#40c057', warningColor: '#fab005', errorColor: '#fa5252', infoColor: '#4c6ef5',
  chartGrid: '#333333', tooltipBg: '#1a1b1e',
};

const LIGHT_COLORS = {
  primaryColor: '#228be6', accentColor: '#1c7ed6',
  bodyBg: '#ffffff', navBg: '#f8f9fa', headerBg: '#f8f9fa', cardBg: '#ffffff',
  inputBg: '#f1f3f5', hoverBg: '#e9ecef', codeBg: '#f1f3f5',
  textColor: '#1a1b1e', textDimmed: '#868e96', textMuted: '#adb5bd',
  navText: '#495057', navActive: '#228be6', navHoverBg: 'rgba(0,0,0,0.04)',
  btnText: '#ffffff', scrollbar: '#c1c1c1',
  borderColor: '#dee2e6',
  successColor: '#2f9e44', warningColor: '#e67700', errorColor: '#e03131', infoColor: '#4c6ef5',
  chartGrid: '#dee2e6', tooltipBg: '#ffffff',
};

const APPEARANCE_DEFAULTS = {
  theme: 'dark', brandName: '', pageTitle: '', logoUrl: '',
  custom: { ...DARK_COLORS },
};

function AppearancePanel({ isAdmin }) {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    // Load from localStorage first (instant, no flash), then from API
    const cached = localStorage.getItem('prism_appearance');
    if (cached) try { setCfg(JSON.parse(cached)); } catch {}

    api.get('/api/prism/admin/appearance').then(r => {
      setCfg(r.data);
      localStorage.setItem('prism_appearance', JSON.stringify(r.data));
    }).catch(() => { if (!cached) setCfg(APPEARANCE_DEFAULTS); });
  }, []);

  function update(patch) {
    const next = { ...cfg, ...patch };
    if (patch.custom) next.custom = { ...cfg.custom, ...patch.custom };
    setCfg(next);
    // Always persist to localStorage (works in demo too)
    localStorage.setItem('prism_appearance', JSON.stringify(next));
  }

  async function save() {
    setSaving(true);
    try {
      const { data } = await api.put('/api/prism/admin/appearance', cfg);
      setCfg(data);
      localStorage.setItem('prism_appearance', JSON.stringify(data));
      notifications.show({ message: 'Appearance saved — reloading...', color: 'green' });
      setTimeout(() => window.location.reload(), 800);
    } catch {
      notifications.show({ message: 'Saved locally — reloading...', color: 'yellow' });
      setTimeout(() => window.location.reload(), 800);
    }
    setSaving(false);
  }

  if (!cfg) return <Loader size="sm" />;

  const themeOptions = [
    { value: 'system', label: 'System Default' },
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'custom', label: 'Custom' },
  ];

  return (
    <Stack gap="md">
      <Select
        label="Theme"
        description="Choose the UI color scheme"
        data={themeOptions}
        value={cfg.theme || 'dark'}
        onChange={v => {
          // When switching to Custom, seed with the right defaults
          if (v === 'custom') {
            const prev = cfg.theme;
            const base = (prev === 'light') ? LIGHT_COLORS : DARK_COLORS;
            // Only seed if custom colors are still at defaults (user hasn't customized yet)
            const isDefault = cfg.custom?.bodyBg === DARK_COLORS.bodyBg || cfg.custom?.bodyBg === LIGHT_COLORS.bodyBg || !cfg.custom?.bodyBg;
            update({ theme: v, ...(isDefault ? { custom: { ...base, ...(cfg.custom || {}) } } : { theme: v }) });
          } else {
            update({ theme: v });
          }
        }}
        disabled={!isAdmin}
        allowDeselect={false}
        size="sm"
        w={220}
      />

      {cfg.theme === 'custom' && (
        <>
          <Divider label="Core Colors" labelPosition="center" />
          <Group gap="sm" wrap="wrap">
            <ColorInput label="Primary (Buttons, Links)" value={cfg.custom?.primaryColor || '#228be6'}
              onChange={v => update({ custom: { primaryColor: v } })} size="xs" w={170} disabled={!isAdmin} />
            <ColorInput label="Accent (Badges, Highlights)" value={cfg.custom?.accentColor || '#228be6'}
              onChange={v => update({ custom: { accentColor: v } })} size="xs" w={170} disabled={!isAdmin} />
          </Group>

          <Divider label="Backgrounds" labelPosition="center" />
          <Group gap="sm" wrap="wrap">
            <ColorInput label="Body" value={cfg.custom?.bodyBg || DARK_COLORS.bodyBg}
              onChange={v => update({ custom: { bodyBg: v } })} size="xs" w={130} disabled={!isAdmin} />
            <ColorInput label="Sidebar" value={cfg.custom?.navBg || DARK_COLORS.navBg}
              onChange={v => update({ custom: { navBg: v } })} size="xs" w={130} disabled={!isAdmin} />
            <ColorInput label="Header" value={cfg.custom?.headerBg || DARK_COLORS.headerBg}
              onChange={v => update({ custom: { headerBg: v } })} size="xs" w={130} disabled={!isAdmin} />
            <ColorInput label="Cards / Panels" value={cfg.custom?.cardBg || DARK_COLORS.cardBg}
              onChange={v => update({ custom: { cardBg: v } })} size="xs" w={130} disabled={!isAdmin} />
            <ColorInput label="Inputs" value={cfg.custom?.inputBg || DARK_COLORS.inputBg}
              onChange={v => update({ custom: { inputBg: v } })} size="xs" w={130} disabled={!isAdmin} />
            <ColorInput label="Hover" value={cfg.custom?.hoverBg || DARK_COLORS.hoverBg}
              onChange={v => update({ custom: { hoverBg: v } })} size="xs" w={130} disabled={!isAdmin} />
            <ColorInput label="Code Blocks" value={cfg.custom?.codeBg || DARK_COLORS.codeBg}
              onChange={v => update({ custom: { codeBg: v } })} size="xs" w={130} disabled={!isAdmin} />
          </Group>

          <Divider label="Text" labelPosition="center" />
          <Group gap="sm" wrap="wrap">
            <ColorInput label="Primary Text" value={cfg.custom?.textColor || DARK_COLORS.textColor}
              onChange={v => update({ custom: { textColor: v } })} size="xs" w={150} disabled={!isAdmin} />
            <ColorInput label="Dimmed Text" value={cfg.custom?.textDimmed || DARK_COLORS.textDimmed}
              onChange={v => update({ custom: { textDimmed: v } })} size="xs" w={150} disabled={!isAdmin} />
            <ColorInput label="Muted Text" value={cfg.custom?.textMuted || DARK_COLORS.textMuted}
              onChange={v => update({ custom: { textMuted: v } })} size="xs" w={150} disabled={!isAdmin} />
          </Group>

          <Divider label="Borders" labelPosition="center" />
          <Group gap="sm" wrap="wrap">
            <ColorInput label="Borders & Dividers" value={cfg.custom?.borderColor || DARK_COLORS.borderColor}
              onChange={v => update({ custom: { borderColor: v } })} size="xs" w={170} disabled={!isAdmin} />
          </Group>

          <Divider label="Status Colors" labelPosition="center" />
          <Group gap="sm" wrap="wrap">
            <ColorInput label="Success" value={cfg.custom?.successColor || DARK_COLORS.successColor}
              onChange={v => update({ custom: { successColor: v } })} size="xs" w={130} disabled={!isAdmin} />
            <ColorInput label="Warning" value={cfg.custom?.warningColor || DARK_COLORS.warningColor}
              onChange={v => update({ custom: { warningColor: v } })} size="xs" w={130} disabled={!isAdmin} />
            <ColorInput label="Error" value={cfg.custom?.errorColor || DARK_COLORS.errorColor}
              onChange={v => update({ custom: { errorColor: v } })} size="xs" w={130} disabled={!isAdmin} />
            <ColorInput label="Info" value={cfg.custom?.infoColor || DARK_COLORS.infoColor}
              onChange={v => update({ custom: { infoColor: v } })} size="xs" w={130} disabled={!isAdmin} />
          </Group>

          <Divider label="Navigation" labelPosition="center" />
          <Group gap="sm" wrap="wrap">
            <ColorInput label="Sidebar Text" value={cfg.custom?.navText || DARK_COLORS.navText}
              onChange={v => update({ custom: { navText: v } })} size="xs" w={140} disabled={!isAdmin} />
            <ColorInput label="Active Item" value={cfg.custom?.navActive || DARK_COLORS.navActive}
              onChange={v => update({ custom: { navActive: v } })} size="xs" w={140} disabled={!isAdmin} />
            <ColorInput label="Hover Background" value={cfg.custom?.navHoverBg || DARK_COLORS.navHoverBg}
              onChange={v => update({ custom: { navHoverBg: v } })} size="xs" w={140} disabled={!isAdmin} />
          </Group>

          <Divider label="Buttons" labelPosition="center" />
          <Group gap="sm" wrap="wrap">
            <ColorInput label="Button Text" value={cfg.custom?.btnText || DARK_COLORS.btnText}
              onChange={v => update({ custom: { btnText: v } })} size="xs" w={140} disabled={!isAdmin} />
          </Group>

          <Divider label="Charts & Tooltips" labelPosition="center" />
          <Group gap="sm" wrap="wrap">
            <ColorInput label="Chart Grid" value={cfg.custom?.chartGrid || DARK_COLORS.chartGrid}
              onChange={v => update({ custom: { chartGrid: v } })} size="xs" w={150} disabled={!isAdmin} />
            <ColorInput label="Tooltip Background" value={cfg.custom?.tooltipBg || DARK_COLORS.tooltipBg}
              onChange={v => update({ custom: { tooltipBg: v } })} size="xs" w={150} disabled={!isAdmin} />
          </Group>

          <Divider label="Scrollbar" labelPosition="center" />
          <Group gap="sm" wrap="wrap">
            <ColorInput label="Scrollbar" value={cfg.custom?.scrollbar || DARK_COLORS.scrollbar}
              onChange={v => update({ custom: { scrollbar: v } })} size="xs" w={150} disabled={!isAdmin} />
          </Group>

          <Divider label="Branding" labelPosition="center" />
          <TextInput label="Brand Name" description="Shown next to the logo and in the browser tab"
            placeholder="e.g. Acme Corp" value={cfg.brandName}
            onChange={e => update({ brandName: e.currentTarget.value })} disabled={!isAdmin} />
          <TextInput label="Page Title" description="Custom browser tab title. Use {brand} as placeholder."
            placeholder="{brand} — Model Prism" value={cfg.pageTitle}
            onChange={e => update({ pageTitle: e.currentTarget.value })} disabled={!isAdmin} />
          <TextInput label="Logo URL" description="External logo URL (leave empty for default)"
            placeholder="https://example.com/logo.svg" value={cfg.logoUrl || ''}
            onChange={e => update({ logoUrl: e.currentTarget.value })} disabled={!isAdmin} />
          <Text size="xs" c="dimmed" mt={-8}>or upload an SVG file:</Text>
          <FileInput
            label="Upload Logo (SVG)"
            description="Max 100KB. Stored in database."
            accept="image/svg+xml"
            placeholder="Choose SVG file..."
            disabled={!isAdmin}
            size="sm"
            onChange={async (file) => {
              if (!file) return;
              if (file.size > 100 * 1024) { notifications.show({ message: 'Logo must be under 100KB', color: 'red' }); return; }
              const reader = new FileReader();
              reader.onload = () => {
                const base64 = reader.result;
                update({ logoData: base64 });
                notifications.show({ message: 'Logo loaded — click Save to apply', color: 'blue' });
              };
              reader.readAsDataURL(file);
            }}
          />
          {(cfg.logoUrl || cfg.logoData) && (
            <Group gap="md" align="center">
              <Paper p="sm" withBorder radius="sm" style={{ background: 'var(--prism-bg-input, #25262b)' }}>
                <Image src={cfg.logoData || cfg.logoUrl} alt="Logo preview" h={40} w="auto" fit="contain" />
              </Paper>
              <Button variant="subtle" color="red" size="xs" onClick={() => update({ logoUrl: '', logoData: '' })}>
                Remove Logo
              </Button>
            </Group>
          )}

          <TextInput label="Chat Name" description="Title for the public chat page. Leave empty for default."
            placeholder="e.g. Acme Corp — AI Chat" value={cfg.chatTitle || ''}
            onChange={e => update({ chatTitle: e.currentTarget.value })} disabled={!isAdmin} />

          {cfg.brandName && (
            <Paper p="xs" withBorder radius="sm">
              <Text size="xs" c="dimmed">
                Sidebar: <strong>{cfg.brandName}</strong> | Tab: <strong>{(cfg.pageTitle || '{brand} — Model Prism').replace('{brand}', cfg.brandName)}</strong> | Chat: <strong>{cfg.chatTitle || `${cfg.brandName} — Chat`}</strong>
              </Text>
            </Paper>
          )}
        </>
      )}

      {/* Contrast warnings */}
      {cfg.theme === 'custom' && cfg.custom && (() => {
        const hex2lum = (hex) => { if (!hex || hex.length < 7) return 0.5; const r=parseInt(hex.slice(1,3),16)/255, g=parseInt(hex.slice(3,5),16)/255, b=parseInt(hex.slice(5,7),16)/255; return 0.299*r+0.587*g+0.114*b; };
        const contrast = (a, b) => { const la = hex2lum(a), lb = hex2lum(b); const L1 = Math.max(la,lb)+0.05, L2 = Math.min(la,lb)+0.05; return L1/L2; };
        const warnings = [];
        const c = cfg.custom;
        if (c.textColor && c.bodyBg && contrast(c.textColor, c.bodyBg) < 3) warnings.push('Text on Body background has very low contrast');
        if (c.textColor && c.cardBg && contrast(c.textColor, c.cardBg) < 3) warnings.push('Text on Card background has low contrast');
        if (c.navText && c.navBg && contrast(c.navText, c.navBg) < 3) warnings.push('Sidebar text on sidebar background has low contrast');
        if (c.borderColor && c.bodyBg && contrast(c.borderColor, c.bodyBg) < 1.3) warnings.push('Borders are barely visible on the body background');
        if (c.borderColor && c.cardBg && contrast(c.borderColor, c.cardBg) < 1.3) warnings.push('Borders are barely visible on card backgrounds');
        if (c.btnText && c.primaryColor && contrast(c.btnText, c.primaryColor) < 3) warnings.push('Button text on primary color has low contrast');
        return warnings.length > 0 ? (
          <Alert color="yellow" variant="light" p="xs" title="Contrast warnings">
            {warnings.map((w, i) => <Text key={i} size="xs">{w}</Text>)}
          </Alert>
        ) : null;
      })()}

      {isAdmin && (
        <Group justify="space-between">
          <Group gap="xs">
            <Button size="xs" variant="subtle" color="gray" onClick={() => {
              const json = JSON.stringify({ theme: cfg.theme, brandName: cfg.brandName, pageTitle: cfg.pageTitle, chatTitle: cfg.chatTitle, logoUrl: cfg.logoUrl, custom: cfg.custom }, null, 2);
              const blob = new Blob([json], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a'); a.href = url; a.download = 'model-prism-theme.json'; a.click();
              URL.revokeObjectURL(url);
            }}>Export Theme</Button>
            <Button size="xs" variant="subtle" color="gray" component="label">
              Import Theme
              <input type="file" accept=".json" hidden onChange={e => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    const imported = JSON.parse(reader.result);
                    if (imported.custom) update({ ...imported });
                    else update({ custom: imported });
                    notifications.show({ message: 'Theme imported — click Save to apply', color: 'blue' });
                  } catch { notifications.show({ message: 'Invalid JSON', color: 'red' }); }
                };
                reader.readAsText(file);
                e.target.value = '';
              }} />
            </Button>
          </Group>
          <Button size="sm" onClick={save} loading={saving} leftSection={<IconDeviceFloppy size={14} />}>
            Save
          </Button>
        </Group>
      )}
    </Stack>
  );
}

// ── Log Config Panel ─────────────────────────────────────────────────────────
function LogConfigPanel({ isAdmin }) {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/api/prism/admin/system/log-config').then(r => setCfg(r.data)).catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try { await api.put('/api/prism/admin/system/log-config', cfg); notifications.show({ message: 'Log settings saved', color: 'green' }); } catch {}
    setSaving(false);
  }

  if (!cfg) return <Loader size="sm" />;

  return (
    <Stack gap="sm">
      <Group gap="md" wrap="wrap" align="flex-end">
        <Select label="Log Level" data={['debug', 'info', 'warn', 'error']}
          value={cfg.logLevel || 'info'} onChange={v => setCfg(p => ({ ...p, logLevel: v }))}
          size="sm" w={140} disabled={!isAdmin} />
      </Group>
      <Switch label="Prompt logging" description="Store prompt snapshots in request logs (for debugging and quality analysis)"
        checked={cfg.promptLogging} onChange={e => setCfg(p => ({ ...p, promptLogging: e.currentTarget.checked }))} disabled={!isAdmin} />
      {cfg.promptLogging && (
        <Select label="Prompt log level" value={cfg.promptLogLevel || 'last_user'}
          onChange={v => setCfg(p => ({ ...p, promptLogLevel: v }))}
          data={[{ value: 'last_user', label: 'Last user message only' }, { value: 'full', label: 'Full conversation' }]}
          size="sm" disabled={!isAdmin} />
      )}
      <Switch label="Path capture" description="Extract and store file paths referenced in prompts"
        checked={cfg.pathCapture?.enabled} onChange={e => setCfg(p => ({ ...p, pathCapture: { ...p.pathCapture, enabled: e.currentTarget.checked } }))} disabled={!isAdmin} />
      <Switch label="Routing decision logging" description="Store routing signals and classifier output per request"
        checked={cfg.routingDecisionLogging} onChange={e => setCfg(p => ({ ...p, routingDecisionLogging: e.currentTarget.checked }))} disabled={!isAdmin} />
      <Switch label="Track unique users by IP" description="Count unique users by anonymized IP hash (SHA-256, not reversible). Shown on Dashboard as 'Unique Users'. Works behind proxies via X-Forwarded-For."
        checked={cfg.trackUsersByIp} onChange={e => setCfg(p => ({ ...p, trackUsersByIp: e.currentTarget.checked }))} disabled={!isAdmin} />
      <Divider label="File Logging" labelPosition="center" />
      <Switch label="Enable file logging" description="Write request logs to JSONL files on disk"
        checked={cfg.fileLogging?.enabled} onChange={e => setCfg(p => ({ ...p, fileLogging: { ...p.fileLogging, enabled: e.currentTarget.checked } }))} disabled={!isAdmin} />
      {cfg.fileLogging?.enabled && (<>
        <TextInput label="Log directory" value={cfg.fileLogging?.directory || ''} onChange={e => setCfg(p => ({ ...p, fileLogging: { ...p.fileLogging, directory: e.target.value } }))} size="sm" disabled={!isAdmin} />
        <Switch label="Include prompts in file logs" checked={cfg.fileLogging?.includePrompts} onChange={e => setCfg(p => ({ ...p, fileLogging: { ...p.fileLogging, includePrompts: e.currentTarget.checked } }))} disabled={!isAdmin} />
        <Group gap="md">
          <NumberInput label="Max file size (MB)" value={cfg.fileLogging?.maxSizeMb ?? 100}
            onChange={v => setCfg(p => ({ ...p, fileLogging: { ...p.fileLogging, maxSizeMb: v } }))}
            min={10} max={1000} size="sm" w={160} disabled={!isAdmin} />
          <NumberInput label="Max files (rotation)" value={cfg.fileLogging?.maxFiles ?? 7}
            onChange={v => setCfg(p => ({ ...p, fileLogging: { ...p.fileLogging, maxFiles: v } }))}
            min={1} max={30} size="sm" w={140} disabled={!isAdmin} />
        </Group>
      </>)}
      {isAdmin && <Button size="sm" onClick={save} loading={saving} w={120}>Save</Button>}
    </Stack>
  );
}

// ── Chat Config Panel (reused from SystemDashboard) ──────────────────────────
function ChatConfigPanel({ isAdmin, onSettingsChanged }) {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const [tokenLabel, setTokenLabel] = useState('');
  const [tokenHours, setTokenHours] = useState(24);
  const [newToken, setNewToken] = useState(null);

  async function generateToken() {
    try {
      const { data } = await api.post('/api/prism/admin/chat/tokens', { label: tokenLabel || 'unnamed', expiresInHours: tokenHours });
      setNewToken(data);
      setTokenLabel('');
      const { data: updated } = await api.get('/api/prism/admin/chat/config');
      setCfg(updated);
    } catch { /* ignore */ }
  }

  async function revokeToken(token) {
    try {
      await api.delete(`/api/prism/admin/chat/tokens/${token}`);
      const { data } = await api.get('/api/prism/admin/chat/config');
      setCfg(data);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    api.get('/api/prism/admin/chat/config').then(r => setCfg(r.data)).catch(() => {});
    api.get('/api/prism/admin/providers').then(r => {
      const m = (r.data || []).flatMap(p => (p.discoveredModels || []).filter(m => m.visible !== false).map(m => ({ value: m.id, label: `${m.id}${m.tier ? ` [${m.tier}]` : ''}` })));
      const seen = new Set();
      setAvailableModels(m.filter(x => { if (seen.has(x.value)) return false; seen.add(x.value); return true; }).sort((a, b) => a.label.localeCompare(b.label)));
    }).catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try { const { data } = await api.put('/api/prism/admin/chat/config', cfg); setCfg(data); notifications.show({ message: 'Chat settings saved', color: 'green' }); if (onSettingsChanged) onSettingsChanged(); } catch {}
    setSaving(false);
  }

  if (!cfg) return <Loader size="sm" />;

  const chatEnabled = cfg.enabled ?? false;

  return (
    <Stack gap="sm">
      <Switch label="Enable built-in chat" description="Allow users to chat with models directly from the Model Prism UI"
        checked={chatEnabled} onChange={e => { const v = e.currentTarget.checked; setCfg(p => ({ ...p, enabled: v })); }} disabled={!isAdmin} />
      <Alert color="blue" variant="light" p="xs">
        <Text size="xs">
          The built-in chat uses models from the default tenant (<Code>api</Code>).
          The default model is <Code>{cfg.defaultModel || 'auto'}</Code> (auto-routing).
          To add more models, assign additional providers to the <Code>api</Code> tenant on the Tenants page.
        </Text>
      </Alert>
      {chatEnabled && (<>
        <Divider />
        <Select label="Visibility" value={cfg.visibility || 'admin'} onChange={v => setCfg(p => ({ ...p, visibility: v }))}
          data={[{ value: 'admin', label: 'Admin only' }, { value: 'public', label: 'Public (rate-limited)' }, { value: 'token', label: 'Token-based' }]} size="sm" disabled={!isAdmin} />
        <Select label="Default model" value={cfg.defaultModel || 'auto'} onChange={v => setCfg(p => ({ ...p, defaultModel: v }))}
          data={[{ value: 'auto', label: 'auto (Routing)' }, ...availableModels]} size="sm" searchable disabled={!isAdmin} />
        <MultiSelect label="Allowed models" description="Empty = all" value={cfg.allowedModels || []} onChange={v => setCfg(p => ({ ...p, allowedModels: v }))}
          data={availableModels} size="sm" searchable clearable disabled={!isAdmin} />
        <Textarea label="System prompt" value={cfg.systemPrompt || ''} onChange={e => setCfg(p => ({ ...p, systemPrompt: e.target.value }))} minRows={2} autosize size="sm" disabled={!isAdmin} />
        <Group>
          <NumberInput label="Rate limit (req/min)" value={cfg.rateLimit?.requestsPerMinute || 10} onChange={v => setCfg(p => ({ ...p, rateLimit: { ...p.rateLimit, requestsPerMinute: v } }))} min={1} max={100} size="sm" w={150} disabled={!isAdmin} />
          <NumberInput label="Max tokens/req" value={cfg.rateLimit?.maxTokensPerRequest || 4000} onChange={v => setCfg(p => ({ ...p, rateLimit: { ...p.rateLimit, maxTokensPerRequest: v } }))} min={100} max={32000} size="sm" w={150} disabled={!isAdmin} />
        </Group>
        {cfg.visibility !== 'admin' && (
          <Alert color="blue" p="xs"><Text size="xs">Public chat URL: <Code>/public/chat</Code></Text></Alert>
        )}
        {cfg.visibility === 'token' && isAdmin && (<>
          <Divider label="Access Tokens" labelPosition="center" />
          <Group gap="sm" wrap="wrap" align="flex-end">
            <TextInput placeholder="Label (e.g. demo-user)" value={tokenLabel}
              onChange={e => setTokenLabel(e.target.value)} size="sm" style={{ flex: 1 }} />
            <NumberInput value={tokenHours} onChange={v => setTokenHours(v)}
              min={1} max={720} size="sm" w={100} label="Hours" />
            <Button size="sm" onClick={generateToken} mt="xl">Generate Token</Button>
          </Group>
          {newToken && (
            <Alert color="green" title="New token created" withCloseButton onClose={() => setNewToken(null)}>
              <Code block>{newToken.token}</Code>
              <Text size="xs" c="dimmed" mt={4}>Expires: {new Date(newToken.expiresAt).toLocaleString()}</Text>
            </Alert>
          )}
          {cfg.accessTokens?.length > 0 && (
            <Stack gap={4}>
              {cfg.accessTokens.map(t => (
                <Group key={t.token} gap="xs">
                  <Code fz={10}>{t.token.slice(0, 8)}…</Code>
                  <Badge size="xs" variant="light">{t.label}</Badge>
                  {t.used && <Badge size="xs" color="green">Used</Badge>}
                  {t.expiresAt && new Date(t.expiresAt) < new Date() && <Badge size="xs" color="red">Expired</Badge>}
                  <ActionIcon size="xs" color="red" variant="subtle" onClick={() => revokeToken(t.token)}>
                    <IconTrash size={12} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>
          )}
        </>)}
      </>)}
      {isAdmin && <Button size="sm" onClick={save} loading={saving} w={120}>Save</Button>}
    </Stack>
  );
}

// ── Prompt Analyses Settings Panel ───────────────────────────────────────────
function PromptAnalysesPanel({ isAdmin, onSettingsChanged }) {
  const [cfg, setCfg]           = useState(null);
  const [saving, setSaving]     = useState(false);
  const [providers, setProviders] = useState([]);
  const [models, setModels]     = useState([]);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    api.get('/api/prism/admin/prompt-engineer/settings').then(r => setCfg(r.data)).catch(() => {});
    api.get('/api/prism/admin/providers').then(r => {
      const list = (r.data || []).filter(p => p.status === 'connected' || p.discoveredModels?.length > 0);
      setProviders(list);
    }).catch(() => {});
    api.get('/api/prism/admin/categories').then(r => {
      setCategories((r.data || []).map(c => ({ value: c.key, label: c.name || c.key })));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!cfg?.providerId || !providers.length) { setModels([]); return; }
    const p = providers.find(p => p._id === cfg.providerId);
    setModels((p?.discoveredModels || []).filter(m => m.visible !== false).map(m => ({ value: m.id, label: m.name || m.id })));
  }, [cfg?.providerId, providers]);

  async function save(patch) {
    const next = { ...cfg, ...patch };
    setCfg(next);
    setSaving(true);
    try {
      const { data } = await api.put('/api/prism/admin/prompt-engineer/settings', next);
      setCfg(data);
      notifications.show({ message: 'Prompt Analyses settings saved', color: 'green' });
      if (onSettingsChanged) onSettingsChanged();
    } catch {
      notifications.show({ message: 'Failed to save settings', color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  if (!cfg) return <Loader size="sm" />;

  const providerOptions = providers.map(p => ({ value: p._id, label: p.name }));

  return (
    <Stack gap="sm">
      <Text size="xs" c="dimmed" mb="xs">
        Scores recent user prompts across five quality dimensions using an LLM. Identifies which prompts inflate costs or degrade response quality.
      </Text>
      <Switch label="Enable Prompt Analyses" description="Makes the page accessible and enables the analysis endpoint"
        checked={cfg.enabled ?? false} onChange={e => { const v = e.currentTarget.checked; save({ enabled: v }); }} disabled={!isAdmin} />
      {cfg.enabled && (<>
        <Divider label="LLM Evaluation Engine" labelPosition="left" />
        <Text size="xs" c="dimmed">Select a configured provider and model to run the evaluation. Only user messages are analyzed.</Text>
        <Group gap="md" wrap="wrap" align="flex-end">
          <Select label="Provider" placeholder="Select a provider…" size="sm" w={220}
            data={providerOptions} value={cfg.providerId || null}
            onChange={v => save({ providerId: v || '', model: '' })} clearable disabled={!isAdmin} />
          <Select label="Model" placeholder={cfg.providerId ? (models.length ? 'Select model…' : 'No models discovered') : 'Select provider first'}
            size="sm" w={260} data={models} value={cfg.model || null}
            onChange={v => save({ model: v || '' })} searchable disabled={!isAdmin || !cfg.providerId || models.length === 0} />
        </Group>
        {!cfg.providerId && (
          <Text size="xs" c="dimmed" fs="italic">No provider selected — connect a provider first in the Providers page and discover its models.</Text>
        )}
        <Divider label="Analysis Scope" labelPosition="left" />
        <Group gap="md" wrap="wrap" align="flex-end">
          <NumberInput label="Max prompts per analysis" description="0 = analyze all available prompts. Sorted by cost (highest first)."
            size="sm" w={220} value={cfg.maxPrompts ?? 100} onChange={v => save({ maxPrompts: v })} min={0} max={2000} step={10} disabled={!isAdmin} />
          <MultiSelect label="Ignore categories" description="Skip prompts from these task categories" placeholder="Select categories…"
            size="sm" w={300} data={categories} value={cfg.ignoredCategories || []} onChange={v => save({ ignoredCategories: v })} searchable clearable disabled={!isAdmin} />
        </Group>
      </>)}
    </Stack>
  );
}

// ── Data Maintenance Panel ────────────────────────────────────────────────────
const FLATTEN_OPTIONS = [
  { value: '6',   label: '6 hours' },
  { value: '12',  label: '12 hours' },
  { value: '24',  label: '24 hours' },
  { value: '48',  label: '48 hours' },
  { value: '168', label: '7 days' },
];

function DataMaintenancePanel({ isAdmin }) {
  const [hours, setHours]         = useState('48');
  const [loading, setLoading]     = useState(false);
  const [result, setResult]       = useState(null);
  const [rcDays, setRcDays]       = useState(30);
  const [rcRunning, setRcRunning] = useState(false);
  const [bfDays, setBfDays]       = useState(30);
  const [bfRunning, setBfRunning] = useState(false);
  const [bfResult, setBfResult]   = useState(null);
  const [rcResult, setRcResult]   = useState(null);
  const [rcConfirm, setRcConfirm] = useState(false);
  const [clRunning, setClRunning] = useState(false);
  const [clResult, setClResult]   = useState(null);

  async function recalcCosts() {
    setRcConfirm(false);
    setRcRunning(true);
    setRcResult(null);
    try {
      const { data } = await api.post('/api/prism/admin/dashboard/recalc-costs', { days: rcDays });
      setRcResult(data);
    } catch (err) {
      setRcResult({ error: err.response?.data?.error || err.message });
    }
    setRcRunning(false);
  }

  async function flattenLogs() {
    setLoading(true);
    setResult(null);
    try {
      const { data } = await api.post('/api/prism/admin/system/shrink-logs', { olderThanHours: Number(hours) });
      setResult(data);
      notifications.show({ message: `Flattened ${data.shrunk ?? data.modified ?? 0} log entries`, color: 'green' });
    } catch {
      notifications.show({ message: 'Failed to flatten logs', color: 'red' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack gap="sm">
      <Alert color="blue" variant="light" p="xs">
        <Text size="xs">
          <strong>Flatten Logs</strong> strips prompt content and file paths from request logs older than the selected threshold.
          All metadata required for the Dashboard and Request Log views is preserved —
          tokens, cost, model, latency, tenant, session, status, and anonymized user IP are not affected.
          <br /><br />
          <strong>Removed fields:</strong> <code>promptSnapshot</code>, <code>responseSnapshot</code>, <code>capturedPaths</code>
        </Text>
      </Alert>

      <Group align="flex-end" gap="md">
        <Select
          label="Flatten logs older than"
          data={FLATTEN_OPTIONS}
          value={hours}
          onChange={v => { setHours(v); setResult(null); }}
          size="sm" w={160}
          disabled={!isAdmin}
        />
        <Button
          size="sm"
          color="orange"
          variant="light"
          loading={loading}
          onClick={flattenLogs}
          disabled={!isAdmin}
        >
          Flatten Logs
        </Button>
      </Group>

      {result && (
        <Text size="xs" c="dimmed">
          Done — {result.shrunk ?? result.modified ?? 0} log entries flattened (older than {hours === '168' ? '7 days' : `${hours} hours`}).
        </Text>
      )}

      <Divider label="Recalculate Costs" labelPosition="center" mt="xs" />
      <Text size="xs" c="dimmed">
        Recalculates <code>actualCostUsd</code>, <code>baselineCostUsd</code>, and <code>savedUsd</code> for all requests in the
        selected period using current provider pricing. Also rebuilds DailyStat aggregates. Use after changing model pricing or fixing cost bugs.
      </Text>
      <Group align="flex-end" gap="md">
        <NumberInput label="Days to recalculate" value={rcDays} onChange={v => setRcDays(v)}
          min={1} max={90} size="sm" w={180} disabled={!isAdmin} />
        <Button size="sm" color="orange" variant="light" loading={rcRunning}
          leftSection={<IconRefresh size={14} />} onClick={() => setRcConfirm(true)} disabled={!isAdmin}>
          Recalculate Costs
        </Button>
      </Group>
      {rcResult && !rcResult.error && (
        <Alert color="green" title="Recalculation complete" p="sm">
          <Text size="xs">Scanned: <strong>{rcResult.scanned?.toLocaleString()}</strong> · Updated: <strong>{rcResult.updated?.toLocaleString()}</strong> · Delta: <strong>${rcResult.totalCostDelta?.toFixed(4)}</strong> · Daily stats: <strong>{rcResult.dailyStatsRebuilt}</strong> days rebuilt</Text>
        </Alert>
      )}
      {rcResult?.error && <Alert color="red" title="Error" p="sm"><Text size="xs">{rcResult.error}</Text></Alert>}

      <Modal opened={rcConfirm} onClose={() => setRcConfirm(false)} title="Recalculate Costs?" centered size="sm">
        <Stack>
          <Text size="sm">This will overwrite cost data for the last <strong>{rcDays} days</strong> using current pricing. This cannot be undone.</Text>
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setRcConfirm(false)}>Cancel</Button>
            <Button color="orange" onClick={recalcCosts}>Yes, recalculate</Button>
          </Group>
        </Stack>
      </Modal>

      <Divider label="Backfill Source Signals" labelPosition="center" mt="xs" />
      <Text size="xs" c="dimmed">
        Re-runs signal detection on existing requests to backfill <code>isToolOutputContinuation</code>, <code>isFimRequest</code>,
        and <code>isToolAgentRequest</code>. Required after upgrading to get accurate Human/Auto source filtering on historical data.
      </Text>
      <Group gap="sm" align="flex-end">
        <NumberInput label="Days" value={bfDays} onChange={setBfDays}
          min={1} max={90} size="sm" w={180} disabled={!isAdmin} />
        <Button size="sm" color="violet" variant="light" loading={bfRunning}
          leftSection={<IconRefresh size={14} />}
          disabled={!isAdmin}
          onClick={async () => {
            setBfRunning(true); setBfResult(null);
            try {
              const { data } = await api.post('/api/prism/admin/dashboard/reclassify-fim', { days: bfDays, mode: 'all' });
              setBfResult(data);
            } catch (err) { setBfResult({ error: err.response?.data?.error || err.message }); }
            finally { setBfRunning(false); }
          }}>
          Backfill Signals
        </Button>
      </Group>
      {bfResult && !bfResult.error && (
        <Alert color="green" p="sm"><Text size="xs">Scanned {bfResult.scanned?.toLocaleString()} requests, updated {bfResult.updated?.toLocaleString()} source signals.</Text></Alert>
      )}
      {bfResult?.error && <Alert color="red" title="Error" p="sm"><Text size="xs">{bfResult.error}</Text></Alert>}

      <Divider label="Cleanup Legacy Data" labelPosition="center" mt="xs" />
      <Text size="xs" c="dimmed">
        Finds and removes orphaned data left behind by deleted providers or tenants:
        dangling provider references in tenant configs, request logs / daily stats / quotas for
        deleted tenants. Safe to run repeatedly — idempotent.
      </Text>
      <Group gap="sm">
        <Button size="sm" color="red" variant="light" loading={clRunning}
          disabled={!isAdmin}
          onClick={async () => {
            setClRunning(true); setClResult(null);
            try {
              const { data } = await api.post('/api/prism/admin/system/cleanup-legacy');
              setClResult(data);
              const total = Object.values(data).reduce((a, b) => a + b, 0);
              notifications.show({ message: total > 0 ? `Cleaned up ${total} orphaned items` : 'No orphaned data found — everything is clean', color: total > 0 ? 'orange' : 'green' });
            } catch (err) { setClResult({ error: err.response?.data?.error || err.message }); }
            finally { setClRunning(false); }
          }}>
          Cleanup Legacy Data
        </Button>
      </Group>
      {clResult && !clResult.error && (
        <Alert color={Object.values(clResult).reduce((a, b) => a + b, 0) > 0 ? 'orange' : 'green'} p="sm">
          <Text size="xs">
            {clResult.danglingProviders > 0 && <>Dangling provider refs removed: <strong>{clResult.danglingProviders}</strong><br /></>}
            {clResult.orphanedLogs > 0 && <>Orphaned request logs deleted: <strong>{clResult.orphanedLogs.toLocaleString()}</strong><br /></>}
            {clResult.orphanedStats > 0 && <>Orphaned daily stats deleted: <strong>{clResult.orphanedStats}</strong><br /></>}
            {clResult.orphanedQuotas > 0 && <>Orphaned quotas deleted: <strong>{clResult.orphanedQuotas}</strong><br /></>}
            {clResult.orphanedRuleSets > 0 && <>Orphaned rule sets deleted: <strong>{clResult.orphanedRuleSets}</strong><br /></>}
            {Object.values(clResult).reduce((a, b) => a + b, 0) === 0 && <>No orphaned data found — all cross-references are clean.</>}
          </Text>
        </Alert>
      )}
      {clResult?.error && <Alert color="red" title="Error" p="sm"><Text size="xs">{clResult.error}</Text></Alert>}
    </Stack>
  );
}

// ── Danger Zone Panel ────────────────────────────────────────────────────────
function DangerZonePanel() {
  const [verified, setVerified]       = useState(false);
  const [password, setPassword]       = useState('');
  const [verifying, setVerifying]     = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [exporting, setExporting]     = useState(false);
  const [importing, setImporting]     = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [confirmImport, setConfirmImport] = useState(null); // holds parsed JSON

  async function verifyPassword() {
    setVerifying(true); setVerifyError('');
    try {
      await api.post('/api/prism/admin/system/verify-password', { password });
      setVerified(true);
      setPassword('');
    } catch (err) {
      setVerifyError(err.response?.data?.error || 'Verification failed');
    }
    setVerifying(false);
  }

  async function exportSettings() {
    setExporting(true);
    try {
      const { data } = await api.get('/api/prism/admin/system/export-settings');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `model-prism-settings-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      notifications.show({ message: 'Settings exported', color: 'green' });
    } catch (err) {
      notifications.show({ message: err.response?.data?.error || 'Export failed', color: 'red' });
    }
    setExporting(false);
  }

  function handleFileSelect(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (parsed?._meta?.type !== 'model-prism-settings-export') {
          notifications.show({ message: 'Invalid export file — wrong format', color: 'red' });
          return;
        }
        setConfirmImport(parsed);
      } catch {
        notifications.show({ message: 'Invalid JSON file', color: 'red' });
      }
    };
    reader.readAsText(file);
  }

  async function doImport() {
    if (!confirmImport) return;
    setImporting(true); setImportResult(null);
    try {
      const { data } = await api.post('/api/prism/admin/system/import-settings', confirmImport);
      setImportResult(data);
      notifications.show({ message: 'Settings imported successfully', color: 'green' });
    } catch (err) {
      setImportResult({ error: err.response?.data?.error || 'Import failed' });
    }
    setImporting(false);
    setConfirmImport(null);
  }

  if (!verified) {
    return (
      <Stack gap="sm">
        <Alert color="red" variant="light" p="xs">
          <Text size="xs">
            <strong>This section contains destructive operations.</strong> Re-enter your password to confirm your identity before proceeding.
          </Text>
        </Alert>
        <Group align="flex-end" gap="sm">
          <PasswordInput
            label="Admin Password"
            placeholder="Re-enter your password"
            value={password}
            onChange={e => setPassword(e.currentTarget.value)}
            onKeyDown={e => e.key === 'Enter' && verifyPassword()}
            w={250}
            error={verifyError || undefined}
          />
          <Button size="sm" color="red" variant="light" loading={verifying} onClick={verifyPassword}
            disabled={!password}>
            Verify
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack gap="sm">
      <Alert color="red" variant="light" p="xs" icon={<IconAlertTriangle size={14} />}>
        <Text size="xs">
          <strong>Settings Export / Import</strong> — Export saves all providers, tenants, categories, routing rules,
          and configuration as a JSON file. Import restores from a previously exported file (upsert logic — existing
          items are updated, new ones created). Analytics data (request logs, daily stats) is not affected.
        </Text>
      </Alert>

      <Group gap="md">
        <Button size="sm" color="blue" variant="light" loading={exporting} onClick={exportSettings}
          leftSection={<IconDownload size={14} />}>
          Export Settings
        </Button>

        <FileButton onChange={handleFileSelect} accept="application/json">
          {(props) => (
            <Button {...props} size="sm" color="red" variant="light"
              leftSection={<IconUpload size={14} />}>
              Import Settings
            </Button>
          )}
        </FileButton>
      </Group>

      {importResult && !importResult.error && (
        <Alert color="green" p="sm">
          <Text size="xs">
            Import complete — Providers: <strong>{importResult.imported?.providers || 0}</strong>,
            Tenants: <strong>{importResult.imported?.tenants || 0}</strong>,
            Categories: <strong>{importResult.imported?.categories || 0}</strong>,
            Rule Sets: <strong>{importResult.imported?.ruleSets || 0}</strong>,
            Other: <strong>{importResult.imported?.other || 0}</strong>
          </Text>
        </Alert>
      )}
      {importResult?.error && <Alert color="red" p="sm"><Text size="xs">{importResult.error}</Text></Alert>}

      <Modal opened={!!confirmImport} onClose={() => setConfirmImport(null)} title="Import Settings?" centered size="sm">
        <Stack>
          <Alert color="orange" variant="light" p="xs">
            <Text size="xs">
              This will overwrite existing configuration with the imported data. Exported on{' '}
              <strong>{confirmImport?._meta?.exportedAt?.slice(0, 10) || 'unknown'}</strong>{' '}
              (version {confirmImport?._meta?.version || 'unknown'}).
            </Text>
          </Alert>
          <Text size="sm">
            Contains: {confirmImport?.providers?.length || 0} providers, {confirmImport?.tenants?.length || 0} tenants,{' '}
            {confirmImport?.routingCategories?.length || 0} categories, {confirmImport?.routingRuleSets?.length || 0} rule sets.
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setConfirmImport(null)}>Cancel</Button>
            <Button color="red" onClick={doImport} loading={importing}>Yes, import</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

// ── Main Settings Page ───────────────────────────────────────────────────────
export default function Settings({ currentUser, onSettingsChanged }) {
  const isAdmin = currentUser?.role === 'admin';
  const isMaint = ['admin', 'maintainer'].includes(currentUser?.role);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Settings</Title>
      </Group>

      <Accordion variant="separated" defaultValue="appearance">
        <Accordion.Item value="appearance">
          <Accordion.Control icon={<IconPalette size={16} />}>
            Appearance
          </Accordion.Control>
          <Accordion.Panel>
            <AppearancePanel isAdmin={isAdmin} />
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="log-settings">
          <Accordion.Control icon={<IconFileText size={16} />}>
            Log & Observability
            {!isAdmin && <Badge size="xs" color="gray" variant="light" ml="xs">read-only</Badge>}
          </Accordion.Control>
          <Accordion.Panel>
            <LogConfigPanel isAdmin={isAdmin} />
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="chat-settings">
          <Accordion.Control icon={<IconMessageChatbot size={16} />}>
            Chat Settings
          </Accordion.Control>
          <Accordion.Panel>
            <ChatConfigPanel isAdmin={isAdmin} onSettingsChanged={onSettingsChanged} />
          </Accordion.Panel>
        </Accordion.Item>

        {isMaint && (
          <Accordion.Item value="prompt-analyses">
            <Accordion.Control icon={<IconBrain size={16} />}>
              Prompt Analyses
            </Accordion.Control>
            <Accordion.Panel>
              <PromptAnalysesPanel isAdmin={isAdmin} onSettingsChanged={onSettingsChanged} />
            </Accordion.Panel>
          </Accordion.Item>
        )}

        {isAdmin && (
          <Accordion.Item value="ldap">
            <Accordion.Control icon={<IconKey size={16} />}>
              LDAP / Active Directory
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                <Alert color="blue" variant="light" p="xs">
                  <Text size="xs">Configure LDAP or Active Directory for single sign-on and centralized user management.</Text>
                </Alert>
                <Button component="a" href="/ldap" variant="light" color="blue" size="sm" w={200}>
                  Open LDAP Settings
                </Button>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        )}

        {isMaint && (
          <Accordion.Item value="data-maintenance">
            <Accordion.Control icon={<IconDatabase size={16} />}>
              Data Maintenance
            </Accordion.Control>
            <Accordion.Panel>
              <DataMaintenancePanel isAdmin={isAdmin} />
            </Accordion.Panel>
          </Accordion.Item>
        )}

        {isAdmin && (
          <Accordion.Item value="danger-zone">
            <Accordion.Control icon={<IconAlertTriangle size={16} color="var(--mantine-color-red-6)" />}>
              <Text c="red" fw={600}>Danger Zone</Text>
            </Accordion.Control>
            <Accordion.Panel>
              <DangerZonePanel />
            </Accordion.Panel>
          </Accordion.Item>
        )}
      </Accordion>
    </Stack>
  );
}
