import { useEffect, useState, useMemo } from 'react';
import {
  Title, Paper, Stack, Group, Text, Badge, Code, Anchor, Tabs, Select,
  SegmentedControl, ScrollArea, Checkbox, Box, Button, Textarea,
  CopyButton, ActionIcon, Alert, Loader, Center,
} from '@mantine/core';
import {
  IconHeartbeat, IconExternalLink, IconCopy, IconCheck, IconCode,
  IconLayoutList, IconAlertTriangle,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import api from '../hooks/useApi';

// ── Config generators (same logic as Tenants.jsx) ─────────────────────────────

function buildContinueConfig(endpoint, models, tenantName) {
  const entries = (models.length ? models : ['your-model-id']).map(m =>
    [
      `  - name: "${m}"`,
      `    provider: openai`,
      `    model: ${m}`,
      `    env:`,
      `      useLegacyCompletionsEndpoint: false`,
      `    template: none`,
      `    requestOptions:`,
      `      verifySsl: false`,
      `      timeout: 60000`,
      `    apiBase: ${endpoint}`,
      `    apiKey: <YOUR_API_KEY>`,
      `    roles:`,
      `      - chat`,
      `      - edit`,
      `      - apply`,
    ].join('\n')
  );
  return [`name: Model Prism — ${tenantName}`, `version: 1.0.0`, `schema: v1`, ``, `models:`, ...entries, ``, `context:`, `  - provider: code`, `  - provider: docs`, `  - provider: diff`, `  - provider: terminal`].join('\n');
}

function buildOpenCodeConfig(endpoint, models, tenantName, defaultModel) {
  const modelEntries = {};
  (models.length ? models : ['your-model-id']).forEach(m => { modelEntries[m] = { name: m }; });
  const primary = defaultModel || 'model-prism';
  return JSON.stringify({ $schema: 'https://opencode.ai/config.json', provider: { custom: { options: { baseURL: endpoint, apiKey: '<YOUR_API_KEY>' }, models: modelEntries } }, model: `custom/${primary}`, compaction: { auto: true, prune: true } }, null, 2);
}

const TOOLS = [
  { value: 'continue',   label: 'Continue',    doc: 'https://docs.continue.dev/reference',     file: '~/.continue/config.yaml' },
  { value: 'opencode',   label: 'OpenCode',    doc: 'https://opencode.ai/docs/config/',         file: '~/.config/opencode/config.json' },
  { value: 'cursor',     label: 'Cursor',      doc: 'https://docs.cursor.com/settings/models', file: 'Cursor → Settings → Models' },
  { value: 'openwebui',  label: 'Open WebUI',  doc: 'https://docs.openwebui.com',              file: 'docker-compose.yml' },
  { value: 'python',     label: 'Python SDK',  doc: null, file: 'example.py' },
  { value: 'nodejs',     label: 'Node.js SDK', doc: null, file: 'example.mjs' },
];

function getConfig(tool, endpoint, models, tenantName, defaultModel) {
  const primary = defaultModel || 'model-prism';
  switch (tool) {
    case 'continue':  return buildContinueConfig(endpoint, models, tenantName);
    case 'opencode':  return buildOpenCodeConfig(endpoint, models, tenantName, primary);
    case 'cursor':
      return [`# Cursor — Settings → Models → OpenAI API Key`, ``, `API Key:           <YOUR_API_KEY>`, `Override Base URL: ${endpoint}`, `Default model:     ${primary}`, ``, models.length ? `Enable models: ${models.join(', ')}` : ''].join('\n');
    case 'openwebui':
      return [`# Open WebUI`, `environment:`, `  - OPENAI_API_KEY=<YOUR_API_KEY>`, `  - OPENAI_API_BASE_URL=${endpoint}`].join('\n');
    case 'python':
      return [`from openai import OpenAI`, ``, `client = OpenAI(`, `    api_key="<YOUR_API_KEY>",`, `    base_url="${endpoint}",`, `)`, ``, `response = client.chat.completions.create(`, `    model="${primary}",`, `    messages=[{"role": "user", "content": "Hello!"}]`, `)`, `print(response.choices[0].message.content)`].join('\n');
    case 'nodejs':
      return [`import OpenAI from "openai";`, ``, `const client = new OpenAI({`, `  apiKey: "<YOUR_API_KEY>",`, `  baseURL: "${endpoint}",`, `});`, ``, `const response = await client.chat.completions.create({`, `  model: "${primary}",`, `  messages: [{ role: "user", content: "Hello!" }],`, `});`, `console.log(response.choices[0].message.content);`].join('\n');
    default: return '';
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function MyTenant() {
  const [tenants, setTenants]           = useState([]);
  const [selectedId, setSelectedId]     = useState('');
  const [tenantModels, setTenantModels] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [modelMode, setModelMode]       = useState('all');
  const [modelList, setModelList]       = useState([]);
  const [configTool, setConfigTool]     = useState('continue');
  const [configModels, setConfigModels] = useState(null); // null = not yet initialized
  const [configDefaultModel, setConfigDefaultModel] = useState('model-prism');

  const origin = window.location.origin;

  useEffect(() => {
    api.get('/api/prism/tenant-portal/mine').then(r => {
      setTenants(r.data);
      if (r.data.length > 0) setSelectedId(r.data[0]._id);
    }).catch(() => {
      notifications.show({ message: 'Failed to load tenant info', color: 'red' });
    }).finally(() => setLoading(false));
  }, []);

  const tenant = useMemo(() => tenants.find(t => t._id === selectedId), [tenants, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    setModelMode(tenant?.modelConfig?.mode || 'all');
    setModelList(tenant?.modelConfig?.list || []);
    // Load models for this tenant
    api.get(`/api/prism/tenant-portal/${selectedId}/models`).then(r => setTenantModels(r.data)).catch(() => setTenantModels([]));
  }, [selectedId, tenant]);

  function toggleModel(id, checked) {
    setModelList(prev => checked ? [...prev, id] : prev.filter(x => x !== id));
  }

  async function saveModelConfig() {
    setSaving(true);
    try {
      const { data } = await api.put(`/api/prism/tenant-portal/${selectedId}/model-config`, { mode: modelMode, list: modelList });
      setTenants(prev => prev.map(t => t._id === selectedId ? { ...t, modelConfig: data.modelConfig } : t));
      notifications.show({ message: 'Model access saved', color: 'green' });
    } catch (err) {
      notifications.show({ message: err.response?.data?.error || 'Failed to save', color: 'red' });
    }
    setSaving(false);
  }

  if (loading) return <Center h="60vh"><Loader /></Center>;
  if (!tenants.length) {
    return (
      <Stack>
        <Title order={2}>My Tenant</Title>
        <Alert color="orange" icon={<IconAlertTriangle size={16} />}>
          No tenants are assigned to your account. Ask an admin to assign you to a tenant.
        </Alert>
      </Stack>
    );
  }

  const endpoint = tenant ? `${origin}/api/${tenant.slug}/v1` : '';

  // All available model IDs + model-prism (always present)
  const allConfigModelIds = useMemo(() => {
    const ids = tenantModels.map(m => m.id);
    if (!ids.includes('model-prism')) ids.unshift('model-prism');
    return ids;
  }, [tenantModels]);

  // Initialize configModels with all models on first load
  useEffect(() => {
    if (configModels === null && allConfigModelIds.length > 0) {
      setConfigModels(allConfigModelIds);
    }
  }, [allConfigModelIds, configModels]);

  const activeConfigModels = useMemo(() => {
    const list = configModels || allConfigModelIds;
    return list.includes('model-prism') ? list : ['model-prism', ...list];
  }, [configModels, allConfigModelIds]);

  const configDefaultOptions = useMemo(
    () => activeConfigModels.map(id => ({ value: id, label: id })),
    [activeConfigModels],
  );

  function handleConfigModelToggle(modelId) {
    if (modelId === 'model-prism') return;
    setConfigModels(prev => {
      const list = prev || allConfigModelIds;
      return list.includes(modelId) ? list.filter(id => id !== modelId) : [...list, modelId];
    });
  }

  const configText = getConfig(configTool, endpoint, activeConfigModels, tenant?.name || '', configDefaultModel);
  const toolMeta = TOOLS.find(t => t.value === configTool);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>My Tenant</Title>
        {tenants.length > 1 && (
          <Select
            value={selectedId}
            onChange={v => setSelectedId(v || '')}
            data={tenants.map(t => ({ value: t._id, label: t.name }))}
            w={{ base: '100%', xs: 200 }}
          />
        )}
      </Group>

      {tenant && (
        <Paper withBorder p="sm" radius="md">
          <Group gap="xl" wrap="wrap">
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Name</Text>
              <Text fw={600}>{tenant.name}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Endpoint</Text>
              <Code>{endpoint}</Code>
            </div>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Key prefix</Text>
              <Code>{tenant.apiKeyPrefix}…</Code>
            </div>
            <Group gap="xs">
              <Anchor href={`${endpoint}/health`} target="_blank" size="sm">
                <Group gap={4}><IconHeartbeat size={14} />Health</Group>
              </Anchor>
              <Anchor href={`${endpoint}/models/public`} target="_blank" size="sm">
                <Group gap={4}><IconExternalLink size={14} />Models</Group>
              </Anchor>
            </Group>
          </Group>
        </Paper>
      )}

      <Tabs defaultValue="models">
        <Tabs.List>
          <Tabs.Tab value="models" leftSection={<IconLayoutList size={14} />}>
            Model Access
          </Tabs.Tab>
          <Tabs.Tab value="config" leftSection={<IconCode size={14} />}>
            Generate Config
          </Tabs.Tab>
        </Tabs.List>

        {/* ── Models tab ──────────────────────────────────────────────── */}
        <Tabs.Panel value="models" pt="md">
          <Stack>
            <div>
              <Text size="sm" fw={500} mb={6}>Access Mode</Text>
              <SegmentedControl
                value={modelMode}
                onChange={setModelMode}
                data={[
                  { value: 'all',       label: 'All Models' },
                  { value: 'whitelist', label: 'Whitelist (allow only)' },
                  { value: 'blacklist', label: 'Blacklist (block selected)' },
                ]}
                size="sm"
                fullWidth
              />
            </div>

            {modelMode === 'all' && (
              <Text size="sm" c="dimmed">All models from your assigned providers are available.</Text>
            )}

            {modelMode !== 'all' && (
              <>
                <Text size="sm" c="dimmed">
                  {modelMode === 'whitelist'
                    ? 'Only checked models will be accessible.'
                    : 'Checked models will be blocked.'}
                  {modelList.length > 0 && <> · <strong>{modelList.length} selected</strong></>}
                </Text>
                {tenantModels.length === 0 ? (
                  <Text size="sm" c="dimmed" ta="center" py="lg">
                    No models available — ask an admin to discover models for your providers.
                  </Text>
                ) : (
                  <ScrollArea h={340} type="auto">
                    <Stack gap={4}>
                      {Array.from(new Set(tenantModels.map(m => m.providerName || 'Unknown'))).map(pName => (
                        <Box key={pName}>
                          <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4} mt={8}>{pName}</Text>
                          <Stack gap={2}>
                            {tenantModels.filter(m => (m.providerName || 'Unknown') === pName).map(m => (
                              <Checkbox
                                key={m.id}
                                label={
                                  <Group gap={6} wrap="nowrap">
                                    <Text size="sm" ff="monospace">{m.id}</Text>
                                    {m.tier && (
                                      <Badge size="xs" color={{ high: 'red', medium: 'yellow', low: 'blue', minimal: 'teal' }[m.tier] || 'gray'}>
                                        {m.tier}
                                      </Badge>
                                    )}
                                  </Group>
                                }
                                checked={modelList.includes(m.id)}
                                onChange={e => toggleModel(m.id, e.currentTarget.checked)}
                                size="sm"
                              />
                            ))}
                          </Stack>
                        </Box>
                      ))}
                    </Stack>
                  </ScrollArea>
                )}
              </>
            )}

            <Group>
              <Button onClick={saveModelConfig} loading={saving}>Save Model Access</Button>
            </Group>
          </Stack>
        </Tabs.Panel>

        {/* ── Config tab ──────────────────────────────────────────────── */}
        <Tabs.Panel value="config" pt="md">
          <Stack>
            <Alert color="blue" p="xs">
              <Text size="xs">Endpoint: <Code>{endpoint}</Code> · Replace <Code>&lt;YOUR_API_KEY&gt;</Code> with your actual key.</Text>
            </Alert>

            <SegmentedControl
              value={configTool}
              onChange={setConfigTool}
              data={TOOLS.map(t => ({ value: t.value, label: t.label }))}
              size="xs"
              fullWidth
            />

            {!['openwebui'].includes(configTool) && allConfigModelIds.length > 0 && (
              <Stack gap={4}>
                <Text size="sm" fw={500}>Models to include</Text>
                <ScrollArea.Autosize mah={180} offsetScrollbars>
                  <Stack gap={4} pr="xs">
                    {allConfigModelIds.map(id => (
                      <Checkbox
                        key={id}
                        label={
                          <Group gap={6}>
                            <Text size="xs" style={{ fontFamily: 'monospace' }}>{id}</Text>
                            {id === 'model-prism' && (
                              <Badge size="xs" variant="light" color="violet">auto-routing</Badge>
                            )}
                          </Group>
                        }
                        checked={(configModels || allConfigModelIds).includes(id)}
                        disabled={id === 'model-prism'}
                        onChange={() => handleConfigModelToggle(id)}
                        size="xs"
                      />
                    ))}
                  </Stack>
                </ScrollArea.Autosize>
              </Stack>
            )}

            {!['openwebui'].includes(configTool) && (
              <Select
                label="Default model"
                description="Used as the primary/default model in the generated config"
                data={configDefaultOptions}
                value={configDefaultModel}
                onChange={setConfigDefaultModel}
                size="sm"
              />
            )}

            <Box>
              <Group justify="space-between" mb={4}>
                <Group gap={6}>
                  <Text size="xs" c="dimmed">{toolMeta?.file}</Text>
                  {toolMeta?.doc && (
                    <Anchor href={toolMeta.doc} target="_blank" size="xs">
                      <Group gap={3}><IconExternalLink size={11} />docs</Group>
                    </Anchor>
                  )}
                </Group>
                <CopyButton value={configText}>
                  {({ copied, copy }) => (
                    <Button size="compact-xs" variant="light" color={copied ? 'green' : 'blue'}
                      leftSection={copied ? <IconCheck size={12} /> : <IconCopy size={12} />} onClick={copy}>
                      {copied ? 'Copied!' : 'Copy'}
                    </Button>
                  )}
                </CopyButton>
              </Group>
              <Textarea value={configText} readOnly autosize minRows={8} maxRows={18}
                styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }} />
            </Box>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
