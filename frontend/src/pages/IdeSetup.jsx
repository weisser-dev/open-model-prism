import { useEffect, useState } from 'react';
import {
  Title, Stack, Paper, Text, Badge, Group, Button, Checkbox, Divider,
  Alert, Code, SegmentedControl, PasswordInput, SimpleGrid, Card,
  Tooltip, Loader, ThemeIcon, Accordion, Select, Switch, MultiSelect,
  Center, ActionIcon, Modal, Anchor,
} from '@mantine/core';
import {
  IconDownload, IconAlertTriangle, IconTerminal2, IconEye, IconRocket,
  IconBolt, IconCode, IconCrown, IconShieldCheck, IconCheck, IconSettings,
  IconExternalLink, IconCopy,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import api from '../hooks/useApi';

const DEMO = import.meta.env.VITE_DEMO_MODE === 'true';

const TIER_COLORS = {
  auto: 'green', micro: 'grape', minimal: 'teal', low: 'blue', medium: 'yellow',
  advanced: 'cyan', high: 'red', ultra: 'pink', critical: 'orange',
};
const TIER_ORDER = ['auto', 'micro', 'minimal', 'low', 'medium', 'advanced', 'high', 'ultra', 'critical'];

const TOOL_INFO = {
  continue:  { name: 'Continue.dev',  file: 'config.yaml',      icon: IconCode,          color: 'violet', desc: 'AI code assistant for VS Code and JetBrains',  path: '~/.continue/config.yaml' },
  opencode:  { name: 'OpenCode',      file: 'opencode.json',    icon: IconTerminal2,     color: 'teal',   desc: 'AI coding agent for the terminal',             path: 'opencode.json (project root)' },
  openwebui: { name: 'Open WebUI',    file: 'openwebui-connection.json', icon: IconRocket, color: 'green', desc: 'Self-hosted chat UI for LLMs',                 path: 'Admin → Connections → OpenAI' },
};

export default function IdeSetup({ isPublic = false }) {
  const [loading, setLoading]       = useState(true);
  const [data, setData]             = useState(null);
  const [selected, setSelected]     = useState(new Set(['model-prism']));
  const [preview, setPreview]       = useState(null);
  const [previewContent, setPC]     = useState('');
  const [apiKey, setApiKey]         = useState('');
  const [activeTool, setActiveTool] = useState(null);

  // Tenant selection
  const [tenants, setTenants]       = useState([]);
  const [tenantId, setTenantId]     = useState(null);

  // Admin settings (only shown when !isPublic)
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings]     = useState({ publicEnabled: false, publicTenantIds: [] });
  const [allTenants, setAllTenants] = useState([]); // for settings multi-select

  const apiBase = isPublic ? '/api/prism/public/ide-config' : '/api/prism/ide-config';

  useEffect(() => { loadTenants(); }, []);

  async function loadTenants() {
    try {
      const { data: t } = await api.get(`${apiBase}/tenants`);
      setTenants(t);
      if (t.length > 0) setTenantId(t[0]._id || t[0].slug);
    } catch { /* non-fatal */ }
    if (!isPublic) {
      try {
        const { data: s } = await api.get(`${apiBase}/settings`);
        setSettings(s);
        const { data: at } = await api.get(`${apiBase}/tenants`);
        setAllTenants(at);
      } catch { /* settings may not exist yet */ }
    }
  }

  useEffect(() => { if (tenantId) loadModels(); }, [tenantId]);

  async function loadModels() {
    setLoading(true);
    try {
      const { data: d } = await api.get(`${apiBase}/models`, { params: { tenant: tenantId } });
      setData(d);
      setSelected(new Set(['model-prism']));
    } catch {
      notifications.show({ message: 'Failed to load models', color: 'red' });
    }
    setLoading(false);
  }

  function toggle(id) {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function selectTier(tier) {
    const models = (data?.models || []).filter(m => m.tier === tier && !m.locked);
    setSelected(prev => {
      const n = new Set(prev);
      const all = models.every(m => n.has(m.id));
      for (const m of models) { if (all) n.delete(m.id); else n.add(m.id); }
      return n;
    });
  }

  async function generateAndDownload(format) {
    try {
      const models = [...selected].filter(id => id !== 'model-prism');
      const { data: content } = await api.post(`${apiBase}/generate`, {
        format, models: models.length ? models : undefined,
        apiKey: apiKey || undefined, tenant: tenantId,
      });
      const tool = TOOL_INFO[format];
      const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
      const blob = new Blob([text], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = tool.file;
      a.click();
      URL.revokeObjectURL(a.href);
      notifications.show({ message: `${tool.name} config downloaded — place at ${tool.path}`, color: 'green', icon: <IconCheck size={14} /> });
    } catch (err) {
      notifications.show({ message: err.response?.data?.error || 'Download failed', color: 'red' });
    }
  }

  async function showPreview(format) {
    try {
      const models = [...selected].filter(id => id !== 'model-prism');
      const { data: content } = await api.post(`${apiBase}/generate`, {
        format, models: models.length ? models : undefined,
        apiKey: apiKey || undefined, tenant: tenantId,
      });
      setPC(typeof content === 'string' ? content : JSON.stringify(content, null, 2));
      setPreview(format);
    } catch { /* ignore */ }
  }

  async function saveSettings(patch) {
    try {
      const { data: s } = await api.put(`${apiBase}/settings`, { ...settings, ...patch });
      setSettings(s);
      notifications.show({ message: 'Settings saved', color: 'green' });
    } catch (err) {
      notifications.show({ message: err.response?.data?.error || 'Failed to save', color: 'red' });
    }
  }

  if (loading && !data) return <Center h={300}><Loader size="lg" /></Center>;

  // ── Public mode: show nothing if disabled ──
  if (isPublic && tenants.length === 0 && !loading) {
    return (
      <Center h="100vh">
        <Paper p="xl" radius="md" shadow="lg" w={400} withBorder>
          <Text ta="center" size="lg" fw={600}>IDE Config Generator</Text>
          <Text ta="center" size="sm" c="dimmed" mt="xs">The public config page is currently disabled. Contact your administrator to enable it.</Text>
        </Paper>
      </Center>
    );
  }

  if (!data) return <Alert color="red">Failed to load model data</Alert>;

  const byTier = {};
  for (const m of data.models || []) { const t = m.tier || 'auto'; if (!byTier[t]) byTier[t] = []; byTier[t].push(m); }
  const recs = data.recommendations || {};
  const selectedCount = selected.size - 1;

  // Wrapper for public mode — centered layout, uses theme colors
  const Wrapper = isPublic
    ? ({ children }) => (
        <div style={{ minHeight: '100vh', padding: '2rem', maxWidth: 960, margin: '0 auto' }}>
          <Group mb="lg" gap="sm">
            <ThemeIcon size="xl" radius="md" variant="gradient" gradient={{ from: 'blue', to: 'cyan' }}>
              <IconTerminal2 size={24} />
            </ThemeIcon>
            <div>
              <Title order={2}>IDE Setup</Title>
              <Text size="sm" c="dimmed">Model Prism — Configure your IDE</Text>
            </div>
          </Group>
          {children}
        </div>
      )
    : ({ children }) => <>{children}</>;

  return (
    <Wrapper>
      <Stack gap="lg">
        {/* ── Header (admin only) ──────────────────────────────── */}
        {!isPublic && (
          <Group justify="space-between">
            <Group gap="sm">
              <ThemeIcon size="xl" radius="md" variant="gradient" gradient={{ from: 'blue', to: 'cyan' }}>
                <IconTerminal2 size={24} />
              </ThemeIcon>
              <div>
                <Title order={2}>IDE Setup</Title>
                <Text size="sm" c="dimmed">Generate ready-to-use configs for your developers</Text>
              </div>
            </Group>
            <Group gap="xs">
              {settings.publicEnabled && !DEMO && (
                <Anchor href="/public/config" target="_blank" size="sm">
                  <Group gap={4}><IconExternalLink size={14} /> Public Page</Group>
                </Anchor>
              )}
              <ActionIcon variant="subtle" onClick={() => setSettingsOpen(true)}><IconSettings size={18} /></ActionIcon>
            </Group>
          </Group>
        )}

        {/* ── Tenant selector ──────────────────────────────────── */}
        {tenants.length > 1 && (
          <Select
            label="Tenant"
            description="Select which tenant's models to configure"
            data={tenants.map(t => ({ value: t._id || t.slug, label: t.name || t.slug }))}
            value={tenantId}
            onChange={v => setTenantId(v)}
            w={300}
            size="sm"
          />
        )}

        {/* ── Tool Selection Cards ─────────────────────────────── */}
        <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="sm">
          {Object.entries(TOOL_INFO).map(([key, tool]) => {
            const Icon = tool.icon;
            const isActive = activeTool === key;
            return (
              <Card key={key} withBorder p="md" style={{
                cursor: 'pointer', transition: 'all 0.15s ease',
                borderColor: isActive ? `var(--mantine-color-${tool.color}-5)` : undefined,
                borderWidth: isActive ? 2 : 1,
                background: isActive ? `var(--mantine-color-${tool.color}-light)` : undefined,
              }} onClick={() => setActiveTool(key)}>
                <Group gap="sm">
                  <ThemeIcon size="lg" variant="light" color={tool.color} radius="md"><Icon size={20} /></ThemeIcon>
                  <div style={{ flex: 1 }}>
                    <Text fw={600} size="sm">{tool.name}</Text>
                    <Text size="xs" c="dimmed">{tool.desc}</Text>
                  </div>
                  {isActive && <Badge color={tool.color} size="sm">selected</Badge>}
                </Group>
                {isActive && (
                  <Group mt="sm" gap="xs">
                    <Button size="xs" color={tool.color} leftSection={<IconDownload size={12} />}
                      onClick={e => { e.stopPropagation(); generateAndDownload(key); }}>Download {tool.file}</Button>
                    <Button size="xs" variant="light" color={tool.color} leftSection={<IconEye size={12} />}
                      onClick={e => { e.stopPropagation(); showPreview(key); }}>Preview</Button>
                  </Group>
                )}
              </Card>
            );
          })}
        </SimpleGrid>

        {/* ── Preview ──────────────────────────────────────────── */}
        {preview && (
          <Paper withBorder p="sm" radius="md">
            <Group justify="space-between" mb="xs">
              <SegmentedControl size="xs" value={preview} onChange={v => showPreview(v)}
                data={Object.entries(TOOL_INFO).map(([k, v]) => ({ value: k, label: v.name }))} />
              <Group gap="xs">
                <Text size="xs" c="dimmed">Place at: <Code size="xs">{TOOL_INFO[preview]?.path}</Code></Text>
                <Tooltip label="Copy to clipboard">
                  <ActionIcon variant="subtle" size="sm" onClick={() => {
                    navigator.clipboard.writeText(previewContent);
                    notifications.show({ message: 'Copied to clipboard', color: 'green', icon: <IconCheck size={14} /> });
                  }}><IconCopy size={14} /></ActionIcon>
                </Tooltip>
              </Group>
            </Group>
            <Code block style={{ maxHeight: 350, overflow: 'auto', fontSize: '0.78rem', lineHeight: 1.6 }}>{previewContent}</Code>
          </Paper>
        )}

        {/* ── Auto-Router info ─────────────────────────────────── */}
        <Alert color="blue" variant="light" radius="md" icon={<IconRocket size={18} />}>
          <Text size="sm">
            <strong>model-prism</strong> (Auto Router) is always included. It classifies each prompt and routes to the optimal model automatically.
          </Text>
        </Alert>

        {/* ── Recommendations ──────────────────────────────────── */}
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="sm">
          {recs.autocomplete && <RecCard title="Autocomplete" icon={IconBolt} color="blue" data={recs.autocomplete} />}
          {recs.smallTasks && <RecCard title="Quick Tasks" icon={IconCode} color="yellow" data={recs.smallTasks} />}
          {recs.recommended && <RecCard title="Recommended" icon={IconShieldCheck} color="green" data={recs.recommended} />}
          {recs.premium && <RecCard title="Premium" icon={IconCrown} color="orange" data={recs.premium} />}
        </SimpleGrid>

        {/* ── Model Selection ──────────────────────────────────── */}
        <Paper withBorder p="md" radius="md">
          <Group justify="space-between" mb="sm">
            <div>
              <Text fw={600} size="sm">Select Models</Text>
              <Text size="xs" c="dimmed">{selectedCount} model{selectedCount !== 1 ? 's' : ''} selected (+ Auto Router)</Text>
            </div>
            <PasswordInput placeholder="omp-xxxx" description="API Key" value={apiKey}
              onChange={e => setApiKey(e.currentTarget.value)} w={220} size="xs" />
          </Group>
          <Accordion variant="separated" radius="md" multiple defaultValue={['low', 'medium', 'high']}>
            {TIER_ORDER.map(tier => {
              if (!byTier[tier]?.length) return null;
              const tierModels = byTier[tier];
              const selectable = tierModels.filter(m => !m.locked);
              const selectedInTier = selectable.filter(m => selected.has(m.id)).length;
              return (
                <Accordion.Item key={tier} value={tier}>
                  <Accordion.Control>
                    <Group gap="sm">
                      <Badge size="sm" color={TIER_COLORS[tier] || 'gray'} variant="filled">{tier}</Badge>
                      <Text size="sm" fw={500}>{tierModels.length} model{tierModels.length !== 1 ? 's' : ''}</Text>
                      {selectedInTier > 0 && <Badge size="xs" variant="light" color="blue">{selectedInTier} selected</Badge>}
                      {(tier === 'ultra' || tier === 'critical') && <Badge size="xs" color="orange" variant="light" leftSection={<IconAlertTriangle size={10} />}>high costs</Badge>}
                      {selectable.length > 0 && (
                        <Button size="compact-xs" variant="subtle" color="gray"
                          onClick={e => { e.stopPropagation(); selectTier(tier); }}>
                          {selectedInTier === selectable.length ? 'Deselect all' : 'Select all'}
                        </Button>
                      )}
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap={2}>
                      {tierModels.map(m => (
                        <Group key={m.id} gap="sm" py={3} px="xs" style={{ borderRadius: 4, cursor: m.locked ? 'default' : 'pointer' }}
                          onClick={() => !m.locked && toggle(m.id)}>
                          <Checkbox checked={m.locked || selected.has(m.id)} disabled={m.locked}
                            onChange={() => !m.locked && toggle(m.id)} size="xs" />
                          <Text size="sm" style={{ flex: 1 }} fw={m.locked ? 600 : 400}>
                            {m.id}{m.locked && <Text span size="xs" c="dimmed" ml={6}>(always included)</Text>}
                          </Text>
                          {m.provider && <Text size="xs" c="dimmed">{m.provider}</Text>}
                          {m.cost && <Badge size="xs" variant="light" color="gray">{m.cost}</Badge>}
                          {m.warning && <Tooltip label={m.warning} multiline w={300}><IconAlertTriangle size={14} color="var(--mantine-color-orange-5)" /></Tooltip>}
                        </Group>
                      ))}
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              );
            })}
          </Accordion>
        </Paper>

        {/* ── Sticky bottom bar ────────────────────────────────── */}
        <Paper withBorder p="sm" radius="md" style={{ position: 'sticky', bottom: 8, zIndex: 100 }}>
          <Group justify="space-between">
            <Text size="sm" fw={500}>{selectedCount + 1} models in config</Text>
            <Group gap="xs">
              {Object.entries(TOOL_INFO).map(([key, tool]) => (
                <Button key={key} size="sm" color={tool.color} variant={activeTool === key ? 'filled' : 'light'}
                  leftSection={<IconDownload size={14} />} onClick={() => generateAndDownload(key)}>{tool.name}</Button>
              ))}
              <Button size="sm" variant="subtle" leftSection={<IconEye size={14} />}
                onClick={() => showPreview(activeTool || 'continue')}>Preview</Button>
            </Group>
          </Group>
        </Paper>
      </Stack>

      {/* ── Admin Settings Modal ───────────────────────────────── */}
      {!isPublic && (
        <Modal opened={settingsOpen} onClose={() => setSettingsOpen(false)} title="IDE Config — Public Page Settings" centered>
          <Stack>
            <Switch
              label="Config page publicly available"
              description="When enabled, developers can access the IDE config page without logging in"
              checked={settings.publicEnabled}
              onChange={e => saveSettings({ publicEnabled: e.currentTarget.checked })}
            />
            {settings.publicEnabled && (
              <MultiSelect
                label="Public tenants"
                description="Select which tenants appear on the public page. If none selected, only the default tenant is shown."
                data={allTenants.map(t => ({ value: String(t._id), label: t.name || t.slug }))}
                value={settings.publicTenantIds}
                onChange={v => saveSettings({ publicTenantIds: v })}
                clearable
                searchable
              />
            )}
            {settings.publicEnabled && !DEMO && (
              <Alert color="blue" variant="light" p="xs">
                <Text size="xs">Public URL: <Code>/public/config</Code></Text>
              </Alert>
            )}
          </Stack>
        </Modal>
      )}
    </Wrapper>
  );
}

function RecCard({ title, icon: Icon, color, data }) {
  return (
    <Card withBorder p="xs" radius="md" style={color === 'orange' ? { borderColor: `var(--mantine-color-orange-3)` } : undefined}>
      <Group gap={6} mb={4}><Icon size={14} color={`var(--mantine-color-${color}-5)`} /><Text size="xs" fw={600} c={color}>{title}</Text></Group>
      <Text size="xs" c="dimmed" lh={1.4}>{data.description}</Text>
      <Text size="xs" c={color} mt={4} fw={500}>{(data.models || []).join(', ')}</Text>
    </Card>
  );
}
