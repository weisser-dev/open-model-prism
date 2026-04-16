import { useEffect, useState, useMemo, useRef } from 'react';
import {
  Title, Paper, Table, Button, Group, Modal, TextInput, Stack, Badge,
  ActionIcon, Text, Code, CopyButton, MultiSelect, Select, Switch,
  Divider, Alert, Tooltip, Anchor, Tabs, NumberInput, Accordion,
  Checkbox, ScrollArea, SegmentedControl, Textarea, Box, Drawer, Collapse, PasswordInput,
} from '@mantine/core';
import {
  IconPlus, IconTrash, IconKey, IconCopy, IconCheck, IconEdit,
  IconAlertTriangle, IconExternalLink, IconRefresh, IconSettings,
  IconHeartbeat, IconRoute, IconAdjustments, IconCode, IconLayoutList,
  IconPlayerPlay, IconSend, IconRoute2, IconChevronDown, IconChevronRight,
  IconMessageCircle, IconCoin, IconShieldCheck, IconArrowRight,
} from '@tabler/icons-react';
import { Loader } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import api from '../hooks/useApi';

// ── Circuit Breaker Status Component ──────────────────────────────────────────
function CircuitBreakerStatus({ providerIds, providers }) {
  const [cbData, setCbData] = useState(null);
  useEffect(() => {
    api.get('/api/prism/admin/system/circuit-breaker').then(r => setCbData(r.data)).catch(() => setCbData([]));
  }, []);

  if (!cbData) return <Loader size="xs" />;

  const relevant = cbData.filter(cb => providerIds.includes(cb.providerId));
  if (!relevant.length) return <Text size="xs" c="dimmed">All providers healthy — no circuit breaker activity.</Text>;

  const stateColor = { CLOSED: 'green', HALF_OPEN: 'yellow', OPEN: 'red' };

  return (
    <Stack gap="xs">
      {relevant.map(cb => (
        <Group key={cb.providerId} gap="sm">
          <Badge size="sm" color={stateColor[cb.state] || 'gray'} variant="dot">
            {cb.providerName || cb.providerSlug}
          </Badge>
          <Text size="xs" c="dimmed">{cb.state}</Text>
          <Text size="xs" c="dimmed">{cb.failures} failures</Text>
          <Text size="xs" c="dimmed">err: {cb.errorRate}%</Text>
        </Group>
      ))}
    </Stack>
  );
}

const LIFETIME_OPTIONS = [
  { value: '0',   label: 'Unlimited' },
  { value: '7',   label: '7 days' },
  { value: '14',  label: '14 days' },
  { value: '30',  label: '30 days' },
  { value: '60',  label: '60 days' },
  { value: '90',  label: '90 days' },
  { value: '365', label: '1 year' },
];

const EMPTY_ROUTING = {
  enabled: false,
  classifierProvider: '',
  classifierModel: '',
  classifierFallbacks: [],
  defaultModel: '',
  baselineModel: '',
  forceAutoRoute: false,
  forceAutoRouteMode: 'off',
  overrides: {
    visionUpgrade: true,
    toolCallUpgrade: true,
    toolCallMinTier: 'medium',
    confidenceFallback: true,
    confidenceThreshold: 0.4,
    domainGate: true,
    conversationTurnUpgrade: true,
    frustrationUpgrade: true,
    outputLengthUpgrade: true,
  },
};

const EMPTY_FORM = {
  name: '', slug: '', providerIds: [],
  keyLifetimeDays: '0',
  routing: { ...EMPTY_ROUTING, overrides: { ...EMPTY_ROUTING.overrides } },
  modelConfig: { mode: 'all', list: [] },
  rateLimit: { requestsPerMinute: 0, tokensPerMinute: 0 },
  budgetLimits: { dailyUsd: 0, weeklyUsd: 0, monthlyUsd: 0 },
  budgetGuard: { enabled: false, thresholdPct: 80, blockTiers: ['high', 'premium'], guardCostMode: 'economy' },
  defaultSystemPrompt: 'Always respond in the same language the user writes in, unless explicitly asked otherwise.',
  fallbackChains: [],
  modelFallbacks: [],
};

// ── Generate Config helpers ────────────────────────────────────────────────────

/** Continue — YAML format (schema v1) */
function buildContinueConfig(endpoint, models, tenantName, apiKey, defaultModel) {
  const modelEntries = (models.length ? models : ['your-model-id']).map(m =>
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
      `    apiKey: ${apiKey}`,
      `    roles:`,
      `      - chat`,
      `      - edit`,
      `      - apply`,
    ].join('\n')
  );
  return [
    `name: Model Prism — ${tenantName || 'tenant'}`,
    `version: 1.0.0`,
    `schema: v1`,
    ``,
    `models:`,
    modelEntries.join('\n\n'),
    ``,
    `context:`,
    `  - provider: code`,
    `  - provider: docs`,
    `  - provider: diff`,
    `  - provider: terminal`,
    `  - provider: problems`,
    `  - provider: folder`,
    `  - provider: codebase`,
  ].join('\n');
}

/** OpenCode — JSON format (opencode.ai config schema) */
function buildOpenCodeConfig(endpoint, models, tenantName, apiKey, defaultModel) {
  const modelEntries = {};
  (models.length ? models : ['your-model-id']).forEach(m => {
    modelEntries[m] = { name: m };
  });
  const primary = defaultModel || 'model-prism';
  return JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    provider: {
      'model-prism': {
        options: {
          baseURL: endpoint,
          apiKey,
        },
        models: modelEntries,
      },
    },
    model: `model-prism/${primary}`,
    compaction: { auto: true, prune: true },
  }, null, 2);
}

function buildOpenWebUIConfig(endpoint, _models, _name, apiKey) {
  return [
    '# Open WebUI — Docker compose environment variables:',
    '',
    'environment:',
    `  - OPENAI_API_KEY=${apiKey}`,
    `  - OPENAI_API_BASE_URL=${endpoint}`,
    '',
    '# Or as shell env:',
    `export OPENAI_API_KEY="${apiKey}"`,
    `export OPENAI_API_BASE_URL="${endpoint}"`,
  ].join('\n');
}

const CONFIG_TOOLS = [
  { value: 'continue',   label: 'Continue' },
  { value: 'opencode',   label: 'OpenCode' },
  { value: 'openwebui',  label: 'Open WebUI' },
];

const CONFIG_DOCS = {
  continue:   'https://docs.continue.dev/reference',
  opencode:   'https://opencode.ai/docs/config/',
  openwebui:  'https://docs.openwebui.com',
};

function GenerateConfigModal({ tenant, allModels, onClose }) {
  const [tool, setTool] = useState('continue');
  const [selectedModels, setSelectedModels] = useState(null); // null = not yet initialized
  const [defaultModel, setDefaultModel] = useState('model-prism');
  const [apiKeyOverride, setApiKeyOverride] = useState('');

  // Default tenant (slug='api') uses the /api/v1 shorthand to avoid /api/api/v1
  const endpoint = tenant?.slug === 'api'
    ? `${window.location.origin}/api/v1`
    : `${window.location.origin}/api/${tenant?.slug}/v1`;

  const tenantModels = useMemo(() => {
    if (!tenant || !allModels.length) return [];
    const pids = (tenant.providerIds || []).map(String);
    const models = allModels
      .filter(m => pids.includes(String(m.providerId)))
      .filter(m => m.visible !== false); // exclude hidden models
    if (tenant.modelConfig?.mode === 'whitelist' && tenant.modelConfig.list?.length) {
      return models.filter(m => tenant.modelConfig.list.includes(m.id));
    }
    if (tenant.modelConfig?.mode === 'blacklist' && tenant.modelConfig.list?.length) {
      return models.filter(m => !tenant.modelConfig.list.includes(m.id));
    }
    return models;
  }, [tenant, allModels]);

  // All available model IDs + model-prism (always present)
  const allModelIds = useMemo(() => {
    const ids = tenantModels.map(m => m.id);
    const classifier = tenant?.classifierModel;
    if (classifier && !ids.includes(classifier)) ids.push(classifier);
    if (!ids.includes('model-prism')) ids.unshift('model-prism');
    return ids;
  }, [tenantModels, tenant]);

  // Initialize selectedModels with all models on first render
  useEffect(() => {
    if (selectedModels === null && allModelIds.length > 0) {
      setSelectedModels(allModelIds);
    }
  }, [allModelIds, selectedModels]);

  const active = selectedModels || allModelIds;

  // Ensure model-prism is always in the active list
  const activeWithPrism = useMemo(() => {
    const list = [...active];
    if (!list.includes('model-prism')) list.unshift('model-prism');
    return list;
  }, [active]);

  // Models available as default (only checked models)
  const defaultModelOptions = useMemo(
    () => activeWithPrism.map(id => ({ value: id, label: id })),
    [activeWithPrism],
  );

  function handleModelToggle(modelId) {
    if (modelId === 'model-prism') return; // can't uncheck
    setSelectedModels(prev => {
      const list = prev || allModelIds;
      return list.includes(modelId) ? list.filter(id => id !== modelId) : [...list, modelId];
    });
  }

  // Use actual key if available (set after create/rotate), else manual override, else placeholder
  const apiKey = apiKeyOverride || tenant?.apiKeyPlaintext || '<YOUR_API_KEY>';

  function getConfig() {
    switch (tool) {
      case 'continue':   return buildContinueConfig(endpoint, activeWithPrism, tenant?.name, apiKey, defaultModel);
      case 'opencode':   return buildOpenCodeConfig(endpoint, activeWithPrism, tenant?.name, apiKey, defaultModel);
      case 'openwebui':  return buildOpenWebUIConfig(endpoint, activeWithPrism, tenant?.name, apiKey);
      default: return '';
    }
  }

  const config = getConfig();
  const fileHint = {
    continue:   '~/.continue/config.yaml',
    opencode:   '~/.config/opencode/config.json',
    openwebui:  'docker-compose.yml (environment)',
  }[tool];
  const docUrl = CONFIG_DOCS[tool];

  return (
    <Modal
      opened={!!tenant}
      onClose={onClose}
      title={
        <Group gap="sm">
          <IconCode size={18} />
          <Text fw={600}>Generate Config — {tenant?.name}</Text>
        </Group>
      }
      size="lg"
    >
      <Stack gap="sm">
        <Alert color="blue" p="xs">
          <Text size="xs">
            Endpoint: <Code>{endpoint}</Code>
            {tenant?.apiKeyPlaintext && <> · API Key: <Code>{tenant.apiKeyPlaintext}</Code></>}
          </Text>
        </Alert>

        {!tenant?.apiKeyPlaintext && (
          <PasswordInput
            label="API Key"
            description={tenant?.apiKeyPrefix
              ? `Key prefix: ${tenant.apiKeyPrefix}… — paste your full key to include it in the config`
              : 'Paste your tenant API key to include it in the generated config'
            }
            placeholder="omp-…"
            value={apiKeyOverride}
            onChange={e => setApiKeyOverride(e.target.value)}
            size="sm"
          />
        )}

        <SegmentedControl
          value={tool}
          onChange={setTool}
          data={CONFIG_TOOLS}
          size="xs"
          fullWidth
        />

        {!['claudecode', 'openwebui'].includes(tool) && allModelIds.length > 0 && (
          <Stack gap={4}>
            <Text size="sm" fw={500}>Models to include</Text>
            <ScrollArea.Autosize mah={180} offsetScrollbars>
              <Stack gap={4} pr="xs">
                {allModelIds.map(id => (
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
                    checked={(selectedModels || allModelIds).includes(id)}
                    disabled={id === 'model-prism'}
                    onChange={() => handleModelToggle(id)}
                    size="xs"
                  />
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </Stack>
        )}

        {!['claudecode', 'openwebui'].includes(tool) && (
          <Select
            label="Default model"
            description="Used as the primary/default model in the generated config"
            data={defaultModelOptions}
            value={defaultModel}
            onChange={setDefaultModel}
            size="sm"
          />
        )}

        <Box>
          <Group justify="space-between" mb={4}>
            <Group gap={6}>
              <Text size="xs" c="dimmed">{fileHint}</Text>
              {docUrl && (
                <Anchor href={docUrl} target="_blank" size="xs" c="blue">
                  <Group gap={3}><IconExternalLink size={11} />docs</Group>
                </Anchor>
              )}
            </Group>
            <CopyButton value={config}>
              {({ copied, copy }) => (
                <Button
                  size="compact-xs"
                  variant="light"
                  color={copied ? 'green' : 'blue'}
                  leftSection={copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                  onClick={copy}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              )}
            </CopyButton>
          </Group>
          <Textarea
            value={config}
            readOnly
            autosize
            minRows={8}
            maxRows={18}
            styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
          />
        </Box>
      </Stack>
    </Modal>
  );
}

// ── Routing info shown below an assistant message ────────────────────────────
function RoutingInfo({ routing, model, inputTokens, outputTokens, costUsd, routingCostUsd }) {
  const [open, setOpen] = useState(false);
  return (
    <Box mt={6}>
      <Group gap={4} wrap="wrap">
        <Badge size="xs" color="blue" variant="light">{model}</Badge>
        {routing ? (
          <>
            <Badge size="xs" color="orange" variant="light">{routing.costTier}</Badge>
            <Badge size="xs" color="grape" variant="light">{routing.category}</Badge>
            {routing.domain && routing.domain !== 'general' && (
              <Badge size="xs" color="pink" variant="light">{routing.domain}</Badge>
            )}
            <Badge size="xs" color="gray" variant="light">
              {routing.preRouted ? 'signal' : 'classifier'} {(routing.confidence * 100).toFixed(0)}%
            </Badge>
          </>
        ) : null}
        <Badge size="xs" variant="outline">{inputTokens}↑ {outputTokens}↓</Badge>
        {costUsd != null && <Badge size="xs" variant="outline" color="teal">${costUsd.toFixed(6)}</Badge>}
        {routingCostUsd != null && routingCostUsd > 0 && (
          <Badge size="xs" variant="outline" color="violet">+${routingCostUsd.toFixed(6)} routing</Badge>
        )}
        {routing && (
          <ActionIcon size="xs" variant="subtle" onClick={() => setOpen(o => !o)}>
            {open ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}
          </ActionIcon>
        )}
      </Group>
      {routing && (
        <Collapse in={open}>
          <Box mt={4} pl={4}>
            {routing.reason && (
              <Text size="xs" c="dimmed" fs="italic" mb={4}>{routing.reason}</Text>
            )}
            {routing.signals && (
              <Group gap={4} wrap="wrap">
                <Text size="xs" c="dimmed">signals:</Text>
                <Badge size="xs" variant="outline">{routing.signals.totalTokens} tok</Badge>
                {routing.signals.detectedDomains?.map(d => (
                  <Badge key={d} size="xs" variant="outline" color="pink">{d}</Badge>
                ))}
                {routing.signals.detectedLanguages?.map(l => (
                  <Badge key={l} size="xs" variant="outline" color="cyan">{l}</Badge>
                ))}
                {routing.signals.hasImages && <Badge size="xs" variant="outline" color="yellow">image</Badge>}
                {routing.signals.hasToolCalls && <Badge size="xs" variant="outline" color="orange">tools</Badge>}
                {routing.signals.conversationTurns > 1 && (
                  <Badge size="xs" variant="outline">{routing.signals.conversationTurns} turns</Badge>
                )}
                <Badge size="xs" variant="outline" color="gray">{routing.analysisMs}ms</Badge>
              </Group>
            )}
          </Box>
        </Collapse>
      )}
    </Box>
  );
}

// ── Try Chat Drawer ───────────────────────────────────────────────────────────
function TryChatDrawer({ tenant, allModels, onClose }) {
  const tenantModels = useMemo(() => {
    if (!tenant || !allModels.length) return [];
    const pids = new Set((tenant.providerIds || []).map(String));
    return allModels.filter(m => pids.has(String(m.providerId)));
  }, [tenant, allModels]);

  // Mantine v7 requires { group, items } grouped format.
  // Deduplicate by value across all groups — Mantine throws on any duplicates.
  const modelOptions = useMemo(() => {
    const seen = new Set(['auto-prism']); // reserve sentinel value
    const byProvider = {};
    tenantModels.forEach(m => {
      if (!m.id || seen.has(m.id)) return; // skip missing ids and duplicates
      seen.add(m.id);
      const key = m.providerName || 'Models';
      (byProvider[key] = byProvider[key] || []).push({ value: m.id, label: m.id });
    });
    const groups = [
      { group: 'Routing', items: [{ value: 'auto-prism', label: 'auto-prism — uses routing engine' }] },
      ...Object.entries(byProvider).map(([grp, items]) => ({ group: grp, items })),
    ];
    return groups;
  }, [tenantModels]);

  const [model, setModel]       = useState(tenant?.routing?.enabled ? 'auto-prism' : (tenantModels[0]?.id || ''));
  const [systemPrompt, setSystem] = useState('');
  const [messages, setMessages] = useState([]); // { role, content, model?, routing?, inputTokens?, outputTokens?, costUsd?, error? }
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const bottomRef               = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setLoading(true);

    try {
      const { data } = await api.post(`/api/prism/admin/tenants/${tenant._id}/test-request`, {
        model,
        messages: history.map(m => ({ role: m.role, content: m.content })),
        systemPrompt: systemPrompt || undefined,
      });
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.content,
        model: data.model,
        routing: data.routing,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        costUsd: data.costUsd,
        routingCostUsd: data.routingCostUsd,
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err.response?.data?.error || err.message}`,
        error: true,
      }]);
    }
    setLoading(false);
  }

  return (
    <Drawer
      opened
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconMessageCircle size={16} />
          <Text fw={600}>Try — {tenant?.name}</Text>
          {tenant?.routing?.enabled && (
            <Badge size="xs" color="teal" variant="light" leftSection={<IconRoute2 size={10} />}>routing on</Badge>
          )}
        </Group>
      }
      position="right"
      size={480}
    >
      <Stack h="calc(100vh - 100px)" style={{ display: 'flex', flexDirection: 'column' }}>
        {/* Settings */}
        <Group gap="sm" align="flex-end" wrap="wrap">
          <Select
            label="Model"
            data={modelOptions}
            value={model}
            onChange={v => setModel(v || 'auto-prism')}
            searchable
            maw={280}
          />
          <Textarea
            label="System prompt (optional)"
            placeholder="You are a helpful assistant…"
            value={systemPrompt}
            onChange={e => setSystem(e.target.value)}
            autosize minRows={1} maxRows={3}
            style={{ flex: 1 }}
          />
        </Group>

        <Divider />

        {/* Messages */}
        <ScrollArea style={{ flex: 1 }}>
          <Stack gap="xs" p="xs">
            {messages.length === 0 && (
              <Text c="dimmed" ta="center" size="sm" mt="xl">
                Send a message to test this tenant's gateway
              </Text>
            )}
            {messages.map((m, i) => (
              <Box
                key={i}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '88%',
                }}
              >
                <Paper
                  p="sm"
                  radius="md"
                  bg={m.role === 'user' ? 'indigo.9' : m.error ? 'red.9' : 'dark.6'}
                >
                  <Text size="xs" c="dimmed" mb={4}>{m.role}</Text>
                  <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{m.content}</Text>
                </Paper>
                {m.role === 'assistant' && !m.error && (
                  <RoutingInfo
                    routing={m.routing}
                    model={m.model}
                    inputTokens={m.inputTokens}
                    outputTokens={m.outputTokens}
                    costUsd={m.costUsd}
                  />
                )}
              </Box>
            ))}
            {loading && (
              <Group gap="xs" pl="xs">
                <Loader size="xs" />
                <Text size="sm" c="dimmed">Thinking…</Text>
              </Group>
            )}
            <div ref={bottomRef} />
          </Stack>
        </ScrollArea>

        {/* Input */}
        <Group gap="xs" align="flex-end">
          <Textarea
            style={{ flex: 1 }}
            placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            autosize
            minRows={1}
            maxRows={5}
          />
          <ActionIcon size="lg" variant="filled" onClick={send} disabled={!input.trim() || loading}>
            <IconSend size={16} />
          </ActionIcon>
        </Group>
      </Stack>
    </Drawer>
  );
}

// ── Expiry badge ───────────────────────────────────────────────────────────────

function expiryBadge(tenant) {
  if (!tenant.keyExpiresAt) return null;
  const diff = new Date(tenant.keyExpiresAt) - Date.now();
  const days = Math.ceil(diff / 86400000);
  if (diff < 0) return <Badge color="red" size="xs">Expired</Badge>;
  if (days <= 7) return <Badge color="orange" size="xs">Expires in {days}d</Badge>;
  return <Badge color="gray" size="xs" variant="outline">{new Date(tenant.keyExpiresAt).toLocaleDateString()}</Badge>;
}

// ── Main component ─────────────────────────────────────────────────────────────

// ── Quota Add Form (inline) ────────────────────────────────────────────────
function QuotaAddForm({ tenantId, existingTypes, onCreated }) {
  const QUOTA_TYPES = [
    { value: 'tokens_monthly',   label: 'Tokens / month' },
    { value: 'requests_daily',   label: 'Requests / day' },
    { value: 'requests_monthly', label: 'Requests / month' },
    { value: 'cost_monthly',     label: 'Cost / month (USD)' },
  ];
  const available = QUOTA_TYPES.filter(t => !existingTypes.includes(t.value));
  const [type, setType] = useState('');
  const [limit, setLimit] = useState(0);
  const [enforcement, setEnforcement] = useState('hard_block');
  const [saving, setSaving] = useState(false);

  if (!available.length) return <Text size="xs" c="dimmed">All quota types are already configured.</Text>;

  return (
    <Group align="end" gap="sm" wrap="wrap">
      <Select
        label="Type"
        data={available}
        value={type}
        onChange={v => setType(v || '')}
        placeholder="Select..."
        w={180}
        size="sm"
      />
      <NumberInput
        label="Limit"
        value={limit}
        onChange={v => setLimit(v || 0)}
        min={1}
        step={type === 'cost_monthly' ? 10 : type?.includes('tokens') ? 100000 : 100}
        w={140}
        size="sm"
        prefix={type === 'cost_monthly' ? '$' : ''}
      />
      <Select
        label="Enforcement"
        data={[
          { value: 'hard_block',   label: 'Hard block' },
          { value: 'soft_warning', label: 'Soft warning' },
          { value: 'auto_economy', label: 'Auto economy' },
        ]}
        value={enforcement}
        onChange={v => setEnforcement(v || 'hard_block')}
        w={160}
        size="sm"
      />
      <Button
        size="sm"
        disabled={!type || !limit}
        loading={saving}
        leftSection={<IconPlus size={14} />}
        onClick={async () => {
          setSaving(true);
          try {
            const period = type.includes('daily') ? 'daily' : 'monthly';
            await api.post('/api/prism/admin/quotas', { tenantId, quotaType: type, limit, enforcement, period });
            setType(''); setLimit(0);
            onCreated();
          } catch {}
          setSaving(false);
        }}
      >
        Add
      </Button>
    </Group>
  );
}

export default function Tenants() {
  const [tenants, setTenants]       = useState([]);
  const [providers, setProviders]   = useState([]);
  const [allModels, setAllModels]   = useState([]);
  const [modalOpen, setModalOpen]   = useState(false);
  const [editTenant, setEditTenant] = useState(null);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [loading, setLoading]       = useState(false);

  // New key modal
  const [newKeyModal, setNewKeyModal] = useState(null);
  // Custom key modal
  const [customKeyModal, setCustomKeyModal] = useState(null);
  const [customKeyValue, setCustomKeyValue] = useState('');
  const [customKeyLifetime, setCustomKeyLifetime] = useState('0');
  // Disable key warning modal
  const [disableModal, setDisableModal] = useState(null);
  // Models tab search + shift-click
  const [modelSearch, setModelSearch] = useState('');
  const lastCheckedModel = useRef(null);
  // Generate Config modal
  const [configTenant, setConfigTenant] = useState(null);
  // Try modal
  const [tryTenant, setTryTenant] = useState(null);
  // Multi-key management drawer
  const [keysDrawer, setKeysDrawer] = useState(null); // tenant object
  const [tenantKeys, setTenantKeys] = useState([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [addKeyForm, setAddKeyForm] = useState({ mode: null, label: '', apiKey: '', lifetime: '0' }); // mode: 'auto' | 'custom' | 'setcustom' | null
  const [mfForm, setMfForm] = useState({ open: false, type: 'specific', sourcePattern: '', fallbacks: [{ model: '', providerId: '' }] });
  const [newlyCreatedKey, setNewlyCreatedKey] = useState(null); // { apiKey, prefix }
  // Quotas state (per tenant, loaded on edit)
  const [quotas, setQuotas] = useState([]);
  const [quotasLoading, setQuotasLoading] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const [t, p, mo] = await Promise.all([
      api.get('/api/prism/admin/tenants'),
      api.get('/api/prism/admin/providers'),
      api.get('/api/prism/admin/providers/models/all').catch(() => ({ data: [] })),
    ]);
    setTenants(t.data);
    setProviders(p.data);
    setAllModels(mo.data);
  }

  function openCreate() {
    setEditTenant(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(t) {
    setEditTenant(t);
    const r = t.routing || {};
    setForm({
      name: t.name,
      slug: t.slug,
      providerIds: t.providerIds?.map(String) || [],
      keyLifetimeDays: String(t.keyLifetimeDays ?? 0),
      routing: {
        enabled:            r.enabled ?? false,
        classifierProvider: r.classifierProvider ? String(r.classifierProvider) : '',
        classifierModel:    r.classifierModel || '',
        classifierFallbacks: (r.classifierFallbacks || []).map(f => ({
          provider: f.provider ? String(f.provider) : '',
          model:    f.model || '',
        })),
        defaultModel:       r.defaultModel || '',
        baselineModel:      r.baselineModel || '',
        forceAutoRoute:     r.forceAutoRoute ?? false,
        forceAutoRouteMode: r.forceAutoRouteMode || (r.forceAutoRoute ? 'all' : 'off'),
        overrides: {
          visionUpgrade:           r.overrides?.visionUpgrade ?? true,
          toolCallUpgrade:         r.overrides?.toolCallUpgrade ?? true,
          toolCallMinTier:         r.overrides?.toolCallMinTier || 'medium',
          confidenceFallback:      r.overrides?.confidenceFallback ?? true,
          confidenceThreshold:     r.overrides?.confidenceThreshold ?? 0.4,
          domainGate:              r.overrides?.domainGate ?? true,
          conversationTurnUpgrade: r.overrides?.conversationTurnUpgrade ?? true,
          frustrationUpgrade:      r.overrides?.frustrationUpgrade ?? true,
          outputLengthUpgrade:     r.overrides?.outputLengthUpgrade ?? true,
        },
      },
      modelConfig: {
        mode: t.modelConfig?.mode || 'all',
        list: t.modelConfig?.list || [],
      },
      rateLimit: {
        requestsPerMinute: t.rateLimit?.requestsPerMinute ?? 0,
        tokensPerMinute:   t.rateLimit?.tokensPerMinute   ?? 0,
      },
      budgetLimits: {
        dailyUsd:   t.budgetLimits?.dailyUsd   ?? 0,
        weeklyUsd:  t.budgetLimits?.weeklyUsd  ?? 0,
        monthlyUsd: t.budgetLimits?.monthlyUsd ?? 0,
      },
      budgetGuard: {
        enabled:      t.budgetGuard?.enabled      ?? false,
        thresholdPct: t.budgetGuard?.thresholdPct ?? 80,
        blockTiers:   t.budgetGuard?.blockTiers   ?? ['high', 'premium'],
        guardCostMode: t.budgetGuard?.guardCostMode ?? 'economy',
      },
      defaultSystemPrompt: t.defaultSystemPrompt ?? 'Always respond in the same language the user writes in, unless explicitly asked otherwise.',
      printRoutedModel: t.printRoutedModel ?? false,
      fallbackChains: (t.fallbackChains || []).map(c => ({
        modelPattern: c.modelPattern || '*',
        providers: (c.providers || []).map(String),
        maxRetries: c.maxRetries ?? 2,
      })),
      modelFallbacks: (t.modelFallbacks || []).map(r => ({
        type: r.type || 'specific',
        sourcePattern: r.sourcePattern || '',
        fallbacks: (r.fallbacks || []).map(f => ({ model: f.model, providerId: f.providerId ? String(f.providerId) : '' })),
      })),
    });
    setModalOpen(true);
    // Load quotas for this tenant
    if (t._id) {
      setQuotasLoading(true);
      api.get(`/api/prism/admin/quotas/tenant/${t._id}`).then(r => {
        setQuotas(r.data?.quotas || []);
      }).catch(() => setQuotas([])).finally(() => setQuotasLoading(false));
    }
  }

  function setRouting(field, value) {
    setForm(f => ({ ...f, routing: { ...f.routing, [field]: value } }));
  }

  function setOverride(field, value) {
    setForm(f => ({
      ...f,
      routing: {
        ...f.routing,
        overrides: { ...f.routing.overrides, [field]: value },
      },
    }));
  }

  function setModelConfig(field, value) {
    setForm(f => ({ ...f, modelConfig: { ...f.modelConfig, [field]: value } }));
  }

  function toggleModelInList(modelId, checked) {
    setForm(f => {
      const list = checked
        ? [...f.modelConfig.list, modelId]
        : f.modelConfig.list.filter(x => x !== modelId);
      return { ...f, modelConfig: { ...f.modelConfig, list } };
    });
  }

  async function saveTenant() {
    setLoading(true);
    try {
      const routingPayload = {
        ...form.routing,
        classifierProvider: form.routing.classifierProvider || null,
        classifierFallbacks: (form.routing.classifierFallbacks || [])
          .filter(f => f.model && f.provider)
          .map(f => ({ model: f.model, provider: f.provider || null })),
        overrides: { ...form.routing.overrides },
      };
      const payload = {
        name: form.name,
        providerIds: form.providerIds,
        keyLifetimeDays: parseInt(form.keyLifetimeDays) || 0,
        routing: routingPayload,
        modelConfig: form.modelConfig,
        rateLimit: {
          requestsPerMinute: parseInt(form.rateLimit.requestsPerMinute) || 0,
          tokensPerMinute:   parseInt(form.rateLimit.tokensPerMinute)   || 0,
        },
        budgetLimits: {
          dailyUsd:   parseFloat(form.budgetLimits.dailyUsd)   || 0,
          weeklyUsd:  parseFloat(form.budgetLimits.weeklyUsd)  || 0,
          monthlyUsd: parseFloat(form.budgetLimits.monthlyUsd) || 0,
        },
        budgetGuard: {
          enabled:      form.budgetGuard.enabled,
          thresholdPct: parseFloat(form.budgetGuard.thresholdPct) || 80,
          blockTiers:   form.budgetGuard.blockTiers,
          guardCostMode: form.budgetGuard.guardCostMode || 'economy',
        },
        defaultSystemPrompt: form.defaultSystemPrompt,
        printRoutedModel: form.printRoutedModel,
        fallbackChains: (form.fallbackChains || []).filter(c => c.providers?.length > 0),
        modelFallbacks: (form.modelFallbacks || []).filter(r => r.sourcePattern),
      };
      if (editTenant) {
        await api.put(`/api/prism/admin/tenants/${editTenant._id}`, payload);
        notifications.show({ title: 'Saved', message: 'Tenant updated', color: 'green' });
        setModalOpen(false);
        load();
      } else {
        const { data } = await api.post('/api/prism/admin/tenants', { ...payload, slug: form.slug });
        setModalOpen(false);
        setNewKeyModal({ key: data.apiKey, expiresAt: data.keyExpiresAt });
        await load();
        // Auto-open config modal with key pre-filled so user can generate client configs immediately
        setTenants(prev => prev.map(t =>
          t.slug === form.slug ? { ...t, apiKeyPlaintext: data.apiKey } : t
        ));
      }
    } catch (err) {
      notifications.show({ title: 'Error', message: err.response?.data?.error || 'Failed', color: 'red' });
    }
    setLoading(false);
  }

  async function rotateKey(t) {
    if (!confirm(`Rotate API key for "${t.name}"? The old key stops working immediately.`)) return;
    try {
      const { data } = await api.post(`/api/prism/admin/tenants/${t._id}/rotate-key`);
      setNewKeyModal({ key: data.apiKey, expiresAt: data.expiresAt });
      await load();
      // Attach plaintext key so Generate Config modal shows the real key
      setTenants(prev => prev.map(x =>
        x._id === t._id ? { ...x, apiKeyPlaintext: data.apiKey } : x
      ));
    } catch (err) {
      notifications.show({ title: 'Error', message: err.response?.data?.error || 'Failed', color: 'red' });
    }
  }

  async function saveCustomKey(tenant) {
    if (!customKeyValue || customKeyValue.length < 1) {
      notifications.show({ title: 'Too short', message: 'Custom key must be at least 1 character', color: 'red' });
      return;
    }
    try {
      const { data } = await api.post(`/api/prism/admin/tenants/${tenant._id}/set-key`, {
        apiKey: customKeyValue,
        keyLifetimeDays: parseInt(customKeyLifetime) || 0,
      });
      notifications.show({ title: 'Key saved', message: `Prefix: ${data.prefix}…`, color: 'green' });
      setCustomKeyModal(null);
      setCustomKeyValue('');
      setCustomKeyLifetime('0');
      load();
    } catch (err) {
      notifications.show({ title: 'Error', message: err.response?.data?.error || 'Failed', color: 'red' });
    }
  }

  async function toggleKeyEnabled(tenant, enabled) {
    if (!enabled) { setDisableModal(tenant); return; }
    await api.put(`/api/prism/admin/tenants/${tenant._id}`, { keyEnabled: true });
    notifications.show({ title: 'Key enabled', message: `${tenant.name} key is now active`, color: 'green' });
    load();
  }

  async function confirmDisable(tenant) {
    await api.put(`/api/prism/admin/tenants/${tenant._id}`, { keyEnabled: false });
    notifications.show({ title: 'Key disabled', message: `${tenant.name} key is now disabled`, color: 'orange' });
    setDisableModal(null);
    load();
  }

  // ── Multi-key management ────────────────────────────────────────────────────
  async function loadKeys(tenantId) {
    setKeysLoading(true);
    try {
      const { data } = await api.get(`/api/prism/admin/tenants/${tenantId}/keys`);
      setTenantKeys(data.keys || []);
    } catch (err) {
      notifications.show({ title: 'Failed to load keys', message: err.response?.data?.error || err.message, color: 'red' });
    }
    setKeysLoading(false);
  }

  async function addKey(tenantId) {
    try {
      const isCustom = addKeyForm.mode === 'custom';
      const endpoint = isCustom
        ? `/api/prism/admin/tenants/${tenantId}/keys/custom`
        : `/api/prism/admin/tenants/${tenantId}/keys`;
      const body = {
        label: addKeyForm.label || undefined,
        keyLifetimeDays: Number(addKeyForm.lifetime) || undefined,
      };
      if (isCustom) body.apiKey = addKeyForm.apiKey;
      const { data } = await api.post(endpoint, body);
      setNewlyCreatedKey({ apiKey: data.apiKey, prefix: data.prefix || data.apiKey?.slice(0, 8) });
      setAddKeyForm({ mode: null, label: '', apiKey: '', lifetime: '0' });
      await loadKeys(tenantId);
      notifications.show({ title: 'Key created', message: 'New API key added', color: 'green' });
    } catch (err) {
      notifications.show({ title: 'Failed to add key', message: err.response?.data?.error || err.message, color: 'red' });
    }
  }

  async function toggleKeyMulti(tenantId, keyId, enabled) {
    try {
      await api.patch(`/api/prism/admin/tenants/${tenantId}/keys/${keyId}`, { enabled });
      setTenantKeys(prev => prev.map(k => k._id === keyId ? { ...k, enabled } : k));
    } catch (err) {
      notifications.show({ title: 'Update failed', message: err.response?.data?.error || err.message, color: 'red' });
    }
  }

  async function updateKeyLabel(tenantId, keyId, label) {
    try {
      await api.patch(`/api/prism/admin/tenants/${tenantId}/keys/${keyId}`, { label });
      setTenantKeys(prev => prev.map(k => k._id === keyId ? { ...k, label } : k));
    } catch (err) {
      notifications.show({ title: 'Update failed', message: err.response?.data?.error || err.message, color: 'red' });
    }
  }

  async function deleteKeyMulti(tenantId, keyId) {
    if (!confirm('Revoke this API key? Any clients using it will immediately lose access.')) return;
    try {
      await api.delete(`/api/prism/admin/tenants/${tenantId}/keys/${keyId}`);
      setTenantKeys(prev => prev.filter(k => k._id !== keyId));
      notifications.show({ title: 'Revoked', message: 'API key deleted', color: 'orange' });
    } catch (err) {
      notifications.show({ title: 'Delete failed', message: err.response?.data?.error || err.message, color: 'red' });
    }
  }

  async function deleteTenant(id) {
    if (!confirm('Delete this tenant? All associated analytics data is retained.')) return;
    try {
      await api.delete(`/api/prism/admin/tenants/${id}`);
      load();
    } catch (err) {
      notifications.show({ title: 'Delete failed', message: err.response?.data?.error || err.message, color: 'red' });
    }
  }

  // Filter model IDs through tenant whitelist/blacklist
  function isModelAllowed(modelId) {
    const { mode, list } = form.modelConfig || {};
    if (mode === 'whitelist' && list?.length) return list.includes(modelId);
    if (mode === 'blacklist' && list?.length) return !list.includes(modelId);
    return true; // mode 'all' or no list
  }

  // Models for classifier model select — include context window in label, exclude hidden
  function getProviderModelsWithCtx(providerId, includeHidden = false) {
    const prov = providers.find(p => p._id === providerId);
    if (!prov?.discoveredModels) return [];
    return prov.discoveredModels
      .filter(m => (includeHidden || m.visible !== false) && isModelAllowed(m.id))
      .map(m => {
        const ctx = m.contextWindow ? ` (${(m.contextWindow / 1000).toFixed(0)}k ctx)` : '';
        return { value: m.id, label: `${m.id}${ctx}` };
      });
  }
  const classifierProviderModels = getProviderModelsWithCtx(form.routing?.classifierProvider);

  // All models from selected providers (unfiltered — for Models tab configuration)
  const allModelsForSelectedProviders = useMemo(() => {
    const pids = new Set(form.providerIds);
    return allModels.filter(m => pids.has(String(m.providerId)));
  }, [allModels, form.providerIds]);

  // Models from selected providers (for routing selects — respects whitelist/blacklist)
  const modelsForSelectedProviders = useMemo(() => {
    return allModelsForSelectedProviders.filter(m => m.visible !== false && isModelAllowed(m.id));
  }, [allModelsForSelectedProviders, form.modelConfig]);

  // Deduplicated model options for Select/MultiSelect components (Mantine crashes on duplicate values)
  const uniqueModelOptions = useMemo(() => {
    const seen = new Set();
    return modelsForSelectedProviders
      .filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; })
      .map(m => ({ value: m.id, label: `${m.id} (${m.providerName})` }));
  }, [modelsForSelectedProviders]);

  const origin = window.location.origin;
  // Build endpoint URL — default tenant (slug='api') uses /api/v1 shorthand
  function tenantEndpoint(slug) {
    return slug === 'api' ? `${origin}/api/v1` : `${origin}/api/${slug}/v1`;
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Tenants / Endpoints</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>Add Tenant</Button>
      </Group>

      <Paper withBorder radius="md" style={{ overflowX: 'auto' }}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Slug</Table.Th>
              <Table.Th>API Key</Table.Th>
              <Table.Th>Providers</Table.Th>
              <Table.Th>Models</Table.Th>
              <Table.Th>Routing</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {tenants.map(t => {
              const modelMode = t.modelConfig?.mode || 'all';
              const modelCount = t.modelConfig?.list?.length || 0;
              return (
                <Table.Tr key={t._id}>
                  <Table.Td>
                    <Group gap={4}>
                      <Text fw={500}>{t.name}</Text>
                      {t.isDefault && <Badge size="xs" color="teal" variant="light">default</Badge>}
                    </Group>
                    <Group gap={4} mt={2}>
                      <Tooltip label={`${tenantEndpoint(t.slug)}/health`}>
                        <Anchor href={`${tenantEndpoint(t.slug)}/health`} target="_blank" size="xs" c="dimmed">
                          <Group gap={3}><IconHeartbeat size={11} />health</Group>
                        </Anchor>
                      </Tooltip>
                      <Text size="xs" c="dimmed">·</Text>
                      <Tooltip label={`${tenantEndpoint(t.slug)}/models/public`}>
                        <Anchor href={`${tenantEndpoint(t.slug)}/models/public`} target="_blank" size="xs" c="dimmed">
                          <Group gap={3}><IconExternalLink size={11} />models</Group>
                        </Anchor>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      <Code>{t.slug}</Code>
                      <CopyButton value={tenantEndpoint(t.slug)}>
                        {({ copied, copy }) => (
                          <Tooltip label={copied ? 'Copied!' : tenantEndpoint(t.slug)}>
                            <ActionIcon size="xs" variant="subtle" onClick={copy}>
                              {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </CopyButton>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Switch
                        size="xs"
                        checked={t.keyEnabled !== false}
                        onChange={e => toggleKeyEnabled(t, e.currentTarget.checked)}
                      />
                      <Text size="xs" ff="monospace" c="dimmed">
                        {(t.apiKeyPrefix || '???').slice(0, 3)}…
                      </Text>
                      {t.customApiKey && <Badge size="xs" variant="outline" color="violet">custom</Badge>}
                      {expiryBadge(t)}
                      {/* Inline copy button — copies full key if admin has it, else prefix */}
                      <CopyButton value={t.apiKeyPlaintext || t.apiKeyPrefix || ''} timeout={2000}>
                        {({ copied, copy }) => (
                          <Tooltip label={copied ? 'Copied!' : `Copy API key (${t.apiKeyPlaintext ? 'full' : 'prefix only'})`}>
                            <ActionIcon size="xs" variant="subtle" color={copied ? 'teal' : 'gray'} onClick={copy}>
                              {copied ? <IconCheck size={11} /> : <IconCopy size={11} />}
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </CopyButton>
                    </Group>
                  </Table.Td>
                  <Table.Td>{t.providerIds?.length || 0}</Table.Td>
                  <Table.Td>
                    {modelMode === 'all'
                      ? <Badge color="gray" size="sm" variant="light">all</Badge>
                      : <Badge color={modelMode === 'whitelist' ? 'blue' : 'orange'} size="sm" variant="light">
                          {modelMode} · {modelCount}
                        </Badge>
                    }
                  </Table.Td>
                  <Table.Td>
                    <Badge color={t.routing?.enabled ? 'green' : 'gray'} size="sm">
                      {t.routing?.enabled ? 'auto' : 'off'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Tooltip label="Edit tenant"><ActionIcon variant="subtle" onClick={() => openEdit(t)}><IconSettings size={16} /></ActionIcon></Tooltip>
                      <Tooltip label="Open chat — test this tenant's gateway"><ActionIcon variant="subtle" color="teal" onClick={() => setTryTenant(t)}><IconMessageCircle size={16} /></ActionIcon></Tooltip>
                      <Tooltip label="Generate client config"><ActionIcon variant="subtle" color="blue" onClick={() => setConfigTenant(t)}><IconCode size={16} /></ActionIcon></Tooltip>
                      <Tooltip label="Manage API keys"><ActionIcon variant="subtle" color="indigo" onClick={() => { setKeysDrawer(t); loadKeys(t._id); }}><IconKey size={16} /></ActionIcon></Tooltip>
                      {t.isDefault
                        ? <Tooltip label="Default tenant — cannot be deleted"><ActionIcon variant="subtle" color="red" disabled><IconTrash size={16} /></ActionIcon></Tooltip>
                        : <Tooltip label="Delete tenant"><ActionIcon variant="subtle" color="red" onClick={() => deleteTenant(t._id)}><IconTrash size={16} /></ActionIcon></Tooltip>
                      }
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
            {tenants.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={7}><Text c="dimmed" ta="center">No tenants configured</Text></Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Paper>

      {/* ── Create / Edit Modal ─────────────────────────────────────────────── */}
      <Modal
        opened={modalOpen}
        onClose={() => { setModalOpen(false); setEditTenant(null); setForm(EMPTY_FORM); }}
        title={editTenant ? `Edit: ${editTenant.name}` : 'Add Tenant'}
        size="xl"
      >
        <Tabs defaultValue="general">
          <Tabs.List mb="md">
            <Tabs.Tab value="general" leftSection={<IconSettings size={14} />}>General</Tabs.Tab>
            <Tabs.Tab value="models" leftSection={<IconLayoutList size={14} />}>
              Models
              {form.modelConfig.mode !== 'all' && (
                <Badge size="xs" color="blue" ml={6}>{form.modelConfig.mode}</Badge>
              )}
            </Tabs.Tab>
            <Tabs.Tab value="routing" leftSection={<IconRoute size={14} />}>
              Auto-Routing
              {form.routing?.enabled && <Badge size="xs" color="green" ml={6}>on</Badge>}
            </Tabs.Tab>
            <Tabs.Tab value="resilience" leftSection={<IconShieldCheck size={14} />}>
              Resilience
              {form.fallbackChains?.length > 0 && <Badge size="xs" color="teal" ml={6}>{form.fallbackChains.length} chains</Badge>}
            </Tabs.Tab>
            <Tabs.Tab value="limits" leftSection={<IconAdjustments size={14} />}>Limits &amp; Quotas</Tabs.Tab>
            <Tabs.Tab value="budget" leftSection={<IconCoin size={14} />}>
              Budget
              {(form.budgetLimits.dailyUsd > 0 || form.budgetLimits.weeklyUsd > 0 || form.budgetLimits.monthlyUsd > 0) && (
                <Badge size="xs" color="orange" ml={6}>limits</Badge>
              )}
            </Tabs.Tab>
          </Tabs.List>

          {/* ── General tab ──────────────────────────────────────────────── */}
          <Tabs.Panel value="general">
            <Stack>
              <TextInput
                label="Name"
                placeholder="Team Alpha"
                value={form.name}
                onChange={e => { const v = e.target.value; setForm(f => ({ ...f, name: v })); }}
              />
              {!editTenant && (
                <TextInput
                  label="Slug"
                  description="URL-safe identifier — cannot be changed later"
                  placeholder="team-alpha"
                  value={form.slug}
                  onChange={e => { const v = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); setForm(f => ({ ...f, slug: v })); }}
                />
              )}
              <MultiSelect
                label="Providers"
                data={providers.map(p => ({ value: p._id, label: p.name }))}
                value={form.providerIds}
                onChange={v => setForm(f => ({ ...f, providerIds: v }))}
              />
              {(() => {
                // Duplicate model detection across selected providers
                const selected = providers.filter(p => form.providerIds.includes(p._id));
                if (selected.length < 2) return null;
                const modelMap = new Map();
                for (const p of selected) {
                  for (const m of (p.discoveredModels || [])) {
                    if (m.visible === false) continue;
                    if (!modelMap.has(m.id)) modelMap.set(m.id, []);
                    modelMap.get(m.id).push({ id: p._id, name: p.name, slug: p.slug });
                  }
                }
                const dupes = [...modelMap.entries()].filter(([, ps]) => ps.length > 1);
                if (!dupes.length) return null;

                // defaultProviderMap: modelId → providerId (for overriding first-wins behavior)
                const dpm = form.defaultProviderMap || {};

                return (
                  <Alert color="yellow" title={`${dupes.length} duplicate model${dupes.length > 1 ? 's' : ''} detected`} p="xs">
                    <Text size="xs" mb={8}>Select which provider should be the default for each duplicate. Use <Code fz={10}>provider-slug/model-id</Code> in API calls to override.</Text>
                    <div style={{ maxHeight: 200, overflow: 'auto' }}>
                      <Table size="xs" striped>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Model</Table.Th>
                            <Table.Th>Default Provider</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {dupes.slice(0, 20).map(([modelId, provs]) => (
                            <Table.Tr key={modelId}>
                              <Table.Td><Code fz={10}>{modelId}</Code></Table.Td>
                              <Table.Td>
                                <Select size="xs" w={200}
                                  value={dpm[modelId] || provs[0].id}
                                  data={provs.map(p => ({ value: p.id, label: `${p.name} (${p.slug})` }))}
                                  onChange={v => {
                                    const newMap = { ...dpm, [modelId]: v };
                                    setForm(f => ({ ...f, defaultProviderMap: newMap }));
                                    // Reorder providerIds so selected default comes first for this model
                                    const currentIds = [...form.providerIds];
                                    const defaultIdx = currentIds.indexOf(v);
                                    if (defaultIdx > 0) {
                                      currentIds.splice(defaultIdx, 1);
                                      currentIds.unshift(v);
                                      setForm(f => ({ ...f, providerIds: currentIds }));
                                    }
                                  }}
                                />
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </div>
                    {dupes.length > 20 && <Text size="xs" c="dimmed" mt={4}>+{dupes.length - 20} more duplicates</Text>}
                  </Alert>
                );
              })()}
              <Select
                label="API Key Lifetime"
                description="Key expires after this period and must be rotated"
                value={form.keyLifetimeDays}
                onChange={v => setForm(f => ({ ...f, keyLifetimeDays: v }))}
                data={LIFETIME_OPTIONS}
              />
            </Stack>
          </Tabs.Panel>

          {/* ── Models tab ───────────────────────────────────────────────── */}
          <Tabs.Panel value="models">
            <Stack>
              <div>
                <Text size="sm" fw={500} mb={6}>Model Access Mode</Text>
                <SegmentedControl
                  value={form.modelConfig.mode}
                  onChange={v => setModelConfig('mode', v)}
                  data={[
                    { value: 'all', label: 'All Models' },
                    { value: 'whitelist', label: 'Whitelist (allow only)' },
                    { value: 'blacklist', label: 'Blacklist (block selected)' },
                  ]}
                  size="sm"
                  fullWidth
                />
              </div>

              {form.modelConfig.mode === 'all' && (
                <Text size="sm" c="dimmed">
                  All models from assigned providers are available to this tenant.
                </Text>
              )}

              {form.modelConfig.mode !== 'all' && (
                <>
                  <Text size="sm" c="dimmed">
                    {form.modelConfig.mode === 'whitelist'
                      ? 'Only checked models are accessible. Models from other providers are blocked.'
                      : 'Checked models are blocked. All other models remain accessible.'}
                    {form.modelConfig.list.length > 0 && (
                      <> · <strong>{form.modelConfig.list.length} selected</strong></>
                    )}
                  </Text>

                  {form.providerIds.length === 0 ? (
                    <Text size="sm" c="dimmed" ta="center" py="md">
                      Assign providers in the General tab first.
                    </Text>
                  ) : allModelsForSelectedProviders.length === 0 ? (
                    <Text size="sm" c="dimmed" ta="center" py="md">
                      No models discovered yet — go to Providers → Discover Models.
                    </Text>
                  ) : (
                    <>
                      <TextInput
                        placeholder="Search models… (e.g. opus, global, gpt-4)"
                        value={modelSearch}
                        onChange={e => setModelSearch(e.currentTarget.value)}
                        size="sm"
                      />
                      {(() => {
                        const q = modelSearch.toLowerCase().trim();
                        const filtered = q
                          ? allModelsForSelectedProviders.filter(m => m.id.toLowerCase().includes(q))
                          : allModelsForSelectedProviders;
                        const filteredIds = filtered.map(m => m.id);
                        const allChecked = filteredIds.length > 0 && filteredIds.every(id => form.modelConfig.list.includes(id));
                        const noneChecked = filteredIds.every(id => !form.modelConfig.list.includes(id));
                        return (
                          <>
                            <Group gap="xs">
                              <Button
                                size="compact-xs" variant="light" color="blue"
                                disabled={allChecked}
                                onClick={() => {
                                  setForm(f => {
                                    const merged = new Set([...f.modelConfig.list, ...filteredIds]);
                                    return { ...f, modelConfig: { ...f.modelConfig, list: [...merged] } };
                                  });
                                }}
                              >
                                Select all{q ? ` (${filteredIds.length})` : ''}
                              </Button>
                              <Button
                                size="compact-xs" variant="light" color="gray"
                                disabled={noneChecked}
                                onClick={() => {
                                  setForm(f => {
                                    const remove = new Set(filteredIds);
                                    return { ...f, modelConfig: { ...f.modelConfig, list: f.modelConfig.list.filter(id => !remove.has(id)) } };
                                  });
                                }}
                              >
                                Deselect all{q ? ` (${filteredIds.length})` : ''}
                              </Button>
                              {q && (
                                <Text size="xs" c="dimmed">
                                  {filteredIds.length} of {allModelsForSelectedProviders.length} models
                                </Text>
                              )}
                            </Group>
                            <ScrollArea h={320} type="auto">
                              <Stack gap={4}>
                                {Array.from(new Set(filtered.map(m => m.providerName))).map(pName => {
                                  const pModels = filtered.filter(m => m.providerName === pName);
                                  return (
                                    <Box key={pName}>
                                      <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4} mt={8}>{pName}</Text>
                                      <Stack gap={2}>
                                        {pModels.map(m => (
                                          <Checkbox
                                            key={`${m.providerId}:${m.id}`}
                                            label={
                                              <Group gap={6} wrap="nowrap">
                                                <Text size="sm" ff="monospace">{m.id}</Text>
                                                {m.visible === false && (
                                                  <Badge size="xs" color="gray" variant="outline">hidden</Badge>
                                                )}
                                                {m.tier && (
                                                  <Badge size="xs" color={{ high: 'red', medium: 'yellow', low: 'blue', minimal: 'teal' }[m.tier] || 'gray'}>
                                                    {m.tier}
                                                  </Badge>
                                                )}
                                              </Group>
                                            }
                                            checked={form.modelConfig.list.includes(m.id)}
                                            onChange={e => {
                                              const checked = e.currentTarget.checked;
                                              if (e.nativeEvent.shiftKey && lastCheckedModel.current) {
                                                // Shift-click: select/deselect range
                                                const allIds = filtered.map(x => x.id);
                                                const from = allIds.indexOf(lastCheckedModel.current);
                                                const to = allIds.indexOf(m.id);
                                                if (from !== -1 && to !== -1) {
                                                  const start = Math.min(from, to);
                                                  const end = Math.max(from, to);
                                                  const rangeIds = allIds.slice(start, end + 1);
                                                  setForm(f => {
                                                    let list = [...f.modelConfig.list];
                                                    if (checked) {
                                                      const set = new Set(list);
                                                      rangeIds.forEach(id => set.add(id));
                                                      list = [...set];
                                                    } else {
                                                      const remove = new Set(rangeIds);
                                                      list = list.filter(id => !remove.has(id));
                                                    }
                                                    return { ...f, modelConfig: { ...f.modelConfig, list } };
                                                  });
                                                }
                                              } else {
                                                toggleModelInList(m.id, checked);
                                              }
                                              lastCheckedModel.current = m.id;
                                            }}
                                            size="sm"
                                          />
                                        ))}
                                      </Stack>
                                    </Box>
                                  );
                                })}
                              </Stack>
                            </ScrollArea>
                          </>
                        );
                      })()}
                    </>
                  )}
                </>
              )}
            </Stack>
          </Tabs.Panel>

          {/* ── Routing tab ──────────────────────────────────────────────── */}
          <Tabs.Panel value="routing">
            <ScrollArea h="60vh" offsetScrollbars>
            <Stack pr="xs">
              <Switch
                label="Enable Auto-Routing"
                description='Clients can set model="auto-prism" to let the system classify and route requests'
                checked={form.routing.enabled}
                onChange={e => setRouting('enabled', e.currentTarget.checked)}
              />

              {form.routing.enabled && (
                <>
                  <Divider label="Classifier" labelPosition="left" />
                  <Select
                    label="Classifier Provider"
                    description="Provider used to run the classification model"
                    placeholder="Select provider…"
                    data={providers.map(p => ({ value: p._id, label: p.name }))}
                    value={form.routing.classifierProvider}
                    onChange={v => setRouting('classifierProvider', v || '')}
                    clearable
                  />
                  {classifierProviderModels.length > 0 ? (
                    <Select
                      label="Classifier Model"
                      description="Fast model for classifying requests (e.g. gpt-4o-mini)"
                      data={classifierProviderModels}
                      value={form.routing.classifierModel}
                      onChange={v => setRouting('classifierModel', v || '')}
                      placeholder="Select model…"
                      searchable
                      clearable
                    />
                  ) : (
                    <TextInput
                      label="Classifier Model"
                      description="Model ID for classification (e.g. gpt-4o-mini)"
                      placeholder="gpt-4o-mini"
                      value={form.routing.classifierModel}
                      onChange={e => setRouting('classifierModel', e.target.value)}
                    />
                  )}

                  {/* Classifier fallbacks (up to 2) */}
                  <Divider label="Classifier Fallbacks" labelPosition="left" />
                  <Text size="xs" c="dimmed" mb={-4}>
                    If the primary classifier fails (e.g. context too large), these models are tried in order.
                    Choose models with larger context windows as fallbacks.
                  </Text>
                  {[0, 1].map(idx => {
                    const fb = form.routing.classifierFallbacks?.[idx] || { provider: '', model: '' };
                    const fbModels = getProviderModelsWithCtx(fb.provider);
                    return (
                      <Group key={idx} grow align="flex-end">
                        <Select
                          label={`Fallback ${idx + 1} — Provider`}
                          placeholder="Select provider…"
                          data={providers.map(p => ({ value: p._id, label: p.name }))}
                          value={fb.provider}
                          onChange={v => {
                            const fbs = [...(form.routing.classifierFallbacks || [])];
                            fbs[idx] = { ...fbs[idx], provider: v || '', model: '' };
                            setRouting('classifierFallbacks', fbs);
                          }}
                          clearable size="sm"
                        />
                        {fbModels.length > 0 ? (
                          <Select
                            label={`Fallback ${idx + 1} — Model`}
                            data={fbModels}
                            value={fb.model}
                            onChange={v => {
                              const fbs = [...(form.routing.classifierFallbacks || [])];
                              fbs[idx] = { ...fbs[idx], model: v || '' };
                              setRouting('classifierFallbacks', fbs);
                            }}
                            placeholder="Select model…" searchable clearable size="sm"
                          />
                        ) : (
                          <TextInput
                            label={`Fallback ${idx + 1} — Model`}
                            placeholder="model-id"
                            value={fb.model}
                            onChange={e => {
                              const fbs = [...(form.routing.classifierFallbacks || [])];
                              fbs[idx] = { ...fbs[idx], model: e.target.value };
                              setRouting('classifierFallbacks', fbs);
                            }}
                            size="sm"
                          />
                        )}
                      </Group>
                    );
                  })}

                  <Divider label="Routing Targets" labelPosition="left" />
                  {modelsForSelectedProviders.length > 0 ? (
                    <Select
                      label="Default / Fallback Model"
                      description="Used when no tier-matching model is found or routing fails"
                      data={uniqueModelOptions}
                      value={form.routing.defaultModel}
                      onChange={v => setRouting('defaultModel', v || '')}
                      placeholder="Select model…"
                      searchable clearable
                    />
                  ) : (
                    <TextInput
                      label="Default / Fallback Model"
                      description="Used when no category match is found or routing fails"
                      placeholder="gpt-4o"
                      value={form.routing.defaultModel}
                      onChange={e => setRouting('defaultModel', e.target.value)}
                    />
                  )}
                  {modelsForSelectedProviders.length > 0 ? (
                    <Select
                      label="Baseline Model (cost comparison)"
                      description="Model cost to compare against for savings calculation"
                      data={uniqueModelOptions}
                      value={form.routing.baselineModel}
                      onChange={v => setRouting('baselineModel', v || '')}
                      placeholder="Select model…"
                      searchable clearable
                    />
                  ) : (
                    <TextInput
                      label="Baseline Model (cost comparison)"
                      description="Model cost to compare against for savings calculation"
                      placeholder="gpt-4o"
                      value={form.routing.baselineModel}
                      onChange={e => setRouting('baselineModel', e.target.value)}
                    />
                  )}
                  <Stack gap="xs">
                    <Text size="sm" fw={500}>Force Auto-Route Mode</Text>
                    <SegmentedControl
                      fullWidth
                      value={form.routing.forceAutoRouteMode || (form.routing.forceAutoRoute ? 'all' : 'off')}
                      onChange={val => {
                        setRouting('forceAutoRouteMode', val);
                        // Keep the legacy boolean in sync for older gateway builds.
                        setRouting('forceAutoRoute', val === 'all');
                      }}
                      data={[
                        { value: 'off',      label: 'Off' },
                        { value: 'fim_only', label: 'FIM only' },
                        { value: 'smart',    label: 'Smart' },
                        { value: 'all',      label: 'All (strict)' },
                      ]}
                    />
                    <Text size="xs" c="dimmed">
                      <b>Off</b> — user's model choice is always respected.{' '}
                      <b>FIM only</b> — only syntactic autocomplete gets routed to a cheap coder model; all other requests keep the user's model.{' '}
                      <b>Smart</b> — router classifies every request, but keeps the user's model whenever the category is substantial (coding / reasoning / analysis / …); trivial categories (smalltalk, chat title) still get re-routed.{' '}
                      <b>All</b> — classic behaviour: every request is routed to the router's optimal pick.
                    </Text>
                  </Stack>

                  <Textarea
                    label="Default System Prompt"
                    description="Injected into every non-FIM request. Leave empty to disable."
                    placeholder="Always respond in the same language the user writes in, unless explicitly asked otherwise."
                    value={form.defaultSystemPrompt}
                    onChange={e => setForm(f => ({ ...f, defaultSystemPrompt: e.target.value }))}
                    minRows={2}
                    maxRows={5}
                    autosize
                  />

                  <Switch
                    size="sm"
                    label="Print routed model in response"
                    description="Appends 'Model-Routing: <model> selected' to every response so users can see which model handled their request"
                    checked={form.printRoutedModel ?? false}
                    onChange={e => setForm(f => ({ ...f, printRoutedModel: e.currentTarget.checked }))}
                  />

                  <Divider label="Routing Overrides" labelPosition="left" />
                  <Accordion variant="separated">
                    <Accordion.Item value="overrides">
                      <Accordion.Control icon={<IconAdjustments size={16} />}>
                        Override Rules
                      </Accordion.Control>
                      <Accordion.Panel>
                        <Stack gap="xs">
                          <Switch
                            size="sm"
                            label="Vision Upgrade"
                            description="Requests with images get at least low/medium tier — prevents routing to text-only models"
                            checked={form.routing.overrides.visionUpgrade}
                            onChange={e => setOverride('visionUpgrade', e.currentTarget.checked)}
                          />
                          <Switch
                            size="sm"
                            label="Tool Call Upgrade"
                            description="Requests with tool/function definitions get at least the configured minimum tier (coding agents, MCP tools)"
                            checked={form.routing.overrides.toolCallUpgrade ?? true}
                            onChange={e => setOverride('toolCallUpgrade', e.currentTarget.checked)}
                          />
                          {(form.routing.overrides.toolCallUpgrade ?? true) && (
                            <Select
                              size="xs"
                              label="Tool call minimum tier"
                              description="Minimum tier for requests containing tool/function definitions"
                              value={form.routing.overrides.toolCallMinTier || 'medium'}
                              onChange={v => setOverride('toolCallMinTier', v)}
                              data={['low', 'medium', 'advanced', 'high', 'ultra'].map(t => ({ value: t, label: t }))}
                              w={{ base: '100%', xs: 160 }}
                            />
                          )}
                          <Switch
                            size="sm"
                            label="Confidence Fallback"
                            description="When classifier confidence is below threshold, fall back to medium tier as a safety net"
                            checked={form.routing.overrides.confidenceFallback}
                            onChange={e => setOverride('confidenceFallback', e.currentTarget.checked)}
                          />
                          {form.routing.overrides.confidenceFallback && (
                            <NumberInput
                              size="xs"
                              label="Confidence threshold"
                              description="Below this value → fallback to medium tier"
                              value={form.routing.overrides.confidenceThreshold}
                              onChange={v => setOverride('confidenceThreshold', v)}
                              min={0} max={1} step={0.05} decimalScale={2}
                              w={{ base: '100%', xs: 160 }}
                            />
                          )}
                          <Switch
                            size="sm"
                            label="Domain Gate"
                            description="Legal/medical/finance domain requests get at least medium tier — prevents sensitive content going to cheap models"
                            checked={form.routing.overrides.domainGate}
                            onChange={e => setOverride('domainGate', e.currentTarget.checked)}
                          />
                          <Switch
                            size="sm"
                            label="Conversation Turn Upgrade"
                            description="After 4+ turns in a conversation, step up one tier — longer dialogues need better context handling"
                            checked={form.routing.overrides.conversationTurnUpgrade}
                            onChange={e => setOverride('conversationTurnUpgrade', e.currentTarget.checked)}
                          />
                          <Switch
                            size="sm"
                            label="Frustration Upgrade"
                            description="When user frustration is detected (repeated questions, complaints), step up one tier for a better response"
                            checked={form.routing.overrides.frustrationUpgrade}
                            onChange={e => setOverride('frustrationUpgrade', e.currentTarget.checked)}
                          />
                          <Switch
                            size="sm"
                            label="Output Length Upgrade"
                            description="When long output is expected, upgrade micro/minimal to at least low — tiny models can't produce verbose responses"
                            checked={form.routing.overrides.outputLengthUpgrade}
                            onChange={e => setOverride('outputLengthUpgrade', e.currentTarget.checked)}
                          />
                        </Stack>
                      </Accordion.Panel>
                    </Accordion.Item>
                  </Accordion>
                </>
              )}
            </Stack>
            </ScrollArea>
          </Tabs.Panel>

          {/* ── Resilience & Fallback tab ─────────────────────────────── */}
          <Tabs.Panel value="resilience">
            <Stack>
              <Alert color="teal" p="xs" icon={<IconShieldCheck size={16} />}>
                <Text size="xs">
                  Configure provider fallback chains for automatic failover. When a provider fails,
                  the next provider in the chain is tried automatically. The built-in circuit breaker
                  temporarily disables providers after repeated failures.
                </Text>
              </Alert>

              <Divider label="Default Fallback Chain" labelPosition="left" />
              <Text size="xs" c="dimmed">
                Default chain applies to all models. Drag providers to set priority order.
                The first provider is tried first; if it fails, the next is used.
              </Text>

              {(() => {
                const defaultChain = form.fallbackChains?.find(c => c.modelPattern === '*') || { modelPattern: '*', providers: [], maxRetries: 2 };
                const chainProviders = defaultChain.providers || [];
                const availableForChain = providers.filter(p => form.providerIds.includes(String(p._id)));

                function updateDefaultChain(providers) {
                  const chains = (form.fallbackChains || []).filter(c => c.modelPattern !== '*');
                  if (providers.length > 0) chains.unshift({ modelPattern: '*', providers, maxRetries: defaultChain.maxRetries });
                  setForm(f => ({ ...f, fallbackChains: chains }));
                }

                return (
                  <Stack gap="xs">
                    <Group gap="xs" wrap="wrap">
                      {chainProviders.map((pid, idx) => {
                        const p = providers.find(pr => String(pr._id) === pid);
                        return (
                          <Group key={pid} gap={4}>
                            {idx > 0 && <IconArrowRight size={12} style={{ opacity: 0.3 }} />}
                            <Badge
                              size="lg" variant="light" color={idx === 0 ? 'blue' : 'gray'}
                              rightSection={
                                <ActionIcon size="xs" variant="transparent" color="red"
                                  onClick={() => updateDefaultChain(chainProviders.filter((_, i) => i !== idx))}>
                                  <IconTrash size={10} />
                                </ActionIcon>
                              }
                            >
                              {p?.name || pid}
                            </Badge>
                          </Group>
                        );
                      })}
                      {availableForChain.filter(p => !chainProviders.includes(String(p._id))).length > 0 && (
                        <Select
                          placeholder="+ Add provider"
                          data={availableForChain
                            .filter(p => !chainProviders.includes(String(p._id)))
                            .map(p => ({ value: String(p._id), label: p.name }))
                          }
                          size="xs" w={160} clearable
                          onChange={v => { if (v) updateDefaultChain([...chainProviders, v]); }}
                          value={null}
                        />
                      )}
                    </Group>
                    {chainProviders.length === 0 && (
                      <Text size="xs" c="dimmed" fs="italic">
                        No chain configured — requests will use whichever provider has the model (no ordered failover).
                      </Text>
                    )}
                  </Stack>
                );
              })()}

              <Divider label="Model-Specific Chains" labelPosition="left" mt="md" />
              <Text size="xs" c="dimmed">Override the default chain for specific models or model patterns.</Text>

              {(form.fallbackChains || []).filter(c => c.modelPattern !== '*').map((chain, idx) => (
                <Paper key={idx} withBorder p="xs" radius="sm">
                  <Group justify="space-between">
                    <Group gap="xs">
                      <Code>{chain.modelPattern}</Code>
                      <IconArrowRight size={12} style={{ opacity: 0.3 }} />
                      {chain.providers.map(pid => {
                        const p = providers.find(pr => String(pr._id) === pid);
                        return <Badge key={pid} size="sm" variant="light">{p?.name || pid}</Badge>;
                      })}
                    </Group>
                    <ActionIcon size="xs" color="red" variant="subtle"
                      onClick={() => setForm(f => ({ ...f, fallbackChains: f.fallbackChains.filter((_, i) => i !== idx || f.fallbackChains[i].modelPattern === '*') }))}>
                      <IconTrash size={12} />
                    </ActionIcon>
                  </Group>
                </Paper>
              ))}

              <Divider label="Model Fallbacks" labelPosition="left" mt="md" />
              <Text size="xs" c="dimmed">
                When a specific model fails (context overflow, model unavailable), automatically try an alternative model.
                This is in addition to provider-level failover — use this to step down from opus to sonnet within the same provider.
              </Text>

              {(form.modelFallbacks || []).map((rule, rIdx) => (
                <Paper key={rIdx} withBorder p="sm" radius="sm">
                  <Group justify="space-between" mb={6}>
                    <Group gap="xs">
                      <Badge size="xs" color={rule.type === 'next-tier' ? 'teal' : 'blue'}>
                        {rule.type === 'next-tier' ? 'Next Tier' : 'Specific'}
                      </Badge>
                      <Code fz="xs">{rule.sourcePattern || '*'}</Code>
                      {rule.type === 'specific' && rule.fallbacks?.length > 0 && (
                        <>
                          <IconArrowRight size={10} style={{ opacity: 0.4 }} />
                          {rule.fallbacks.map((fb, fi) => (
                            <Badge key={fi} size="xs" variant="light">{fb.model}</Badge>
                          ))}
                        </>
                      )}
                      {rule.type === 'next-tier' && (
                        <Text size="xs" c="dimmed">auto step-down to next lower tier</Text>
                      )}
                    </Group>
                    <ActionIcon size="xs" color="red" variant="subtle"
                      onClick={() => setForm(f => ({ ...f, modelFallbacks: f.modelFallbacks.filter((_, i) => i !== rIdx) }))}>
                      <IconTrash size={12} />
                    </ActionIcon>
                  </Group>
                </Paper>
              ))}

              {mfForm.open ? (
                <Paper withBorder p="sm" radius="sm">
                  <Stack gap="xs">
                    <Text size="sm" fw={500}>Add Model Fallback Rule</Text>
                    <SegmentedControl size="xs"
                      value={mfForm.type}
                      onChange={v => setMfForm(f => ({ ...f, type: v }))}
                      data={[{ value: 'specific', label: 'Specific Models' }, { value: 'next-tier', label: 'Next Tier Within Provider' }]}
                    />
                    {uniqueModelOptions.length > 0 ? (
                      <Select size="xs" label="Source model (fails → trigger fallback)"
                        data={[{ value: '*', label: '* (any model)' }, ...uniqueModelOptions]}
                        value={mfForm.sourcePattern}
                        onChange={v => setMfForm(f => ({ ...f, sourcePattern: v || '' }))}
                        searchable placeholder="Select model…"
                      />
                    ) : (
                      <TextInput size="xs" label="Source model (fails → trigger fallback)"
                        placeholder="eu.anthropic.claude-opus-4-6-v1"
                        value={mfForm.sourcePattern}
                        onChange={e => setMfForm(f => ({ ...f, sourcePattern: e.target.value }))}
                      />
                    )}
                    {mfForm.type === 'specific' && (
                      <Stack gap={4}>
                        <Text size="xs" c="dimmed">Fallback models (tried in order, up to 4):</Text>
                        {mfForm.fallbacks.map((fb, fi) => (
                          <Group key={fi} gap="xs" grow>
                            {uniqueModelOptions.length > 0 ? (
                              <Select size="xs" placeholder={`Fallback ${fi + 1} — model`}
                                data={uniqueModelOptions}
                                value={fb.model}
                                onChange={v => setMfForm(f => { const fbs = [...f.fallbacks]; fbs[fi] = { ...fbs[fi], model: v || '' }; return { ...f, fallbacks: fbs }; })}
                                searchable clearable
                              />
                            ) : (
                              <TextInput size="xs" placeholder={`Fallback ${fi + 1} — model ID`}
                                value={fb.model}
                                onChange={e => setMfForm(f => { const fbs = [...f.fallbacks]; fbs[fi] = { ...fbs[fi], model: e.target.value }; return { ...f, fallbacks: fbs }; })}
                              />
                            )}
                            <Select size="xs" placeholder="Provider (optional)"
                              data={[{ value: '', label: 'Any provider' }, ...providers.filter(p => form.providerIds.includes(String(p._id))).map(p => ({ value: String(p._id), label: p.name }))]}
                              value={fb.providerId}
                              onChange={v => setMfForm(f => { const fbs = [...f.fallbacks]; fbs[fi] = { ...fbs[fi], providerId: v || '' }; return { ...f, fallbacks: fbs }; })}
                              clearable
                            />
                            {mfForm.fallbacks.length > 1 && (
                              <ActionIcon size="xs" color="red" variant="subtle"
                                onClick={() => setMfForm(f => ({ ...f, fallbacks: f.fallbacks.filter((_, i) => i !== fi) }))}>
                                <IconTrash size={12} />
                              </ActionIcon>
                            )}
                          </Group>
                        ))}
                        {mfForm.fallbacks.length < 4 && (
                          <Button size="xs" variant="subtle"
                            onClick={() => setMfForm(f => ({ ...f, fallbacks: [...f.fallbacks, { model: '', providerId: '' }] }))}>
                            + Add another fallback
                          </Button>
                        )}
                      </Stack>
                    )}
                    {mfForm.type === 'next-tier' && (
                      <Text size="xs" c="dimmed">
                        When the source model fails, automatically tries the next lower tier model available on the same provider.
                        No explicit fallback list needed.
                      </Text>
                    )}
                    <Group gap="xs">
                      <Button size="xs"
                        disabled={!mfForm.sourcePattern || (mfForm.type === 'specific' && !mfForm.fallbacks.some(f => f.model))}
                        onClick={() => {
                          const rule = { type: mfForm.type, sourcePattern: mfForm.sourcePattern,
                            fallbacks: mfForm.type === 'specific' ? mfForm.fallbacks.filter(f => f.model) : [] };
                          setForm(f => ({ ...f, modelFallbacks: [...(f.modelFallbacks || []), rule] }));
                          setMfForm({ open: false, type: 'specific', sourcePattern: '', fallbacks: [{ model: '', providerId: '' }] });
                        }}>
                        Add Rule
                      </Button>
                      <Button size="xs" variant="subtle"
                        onClick={() => setMfForm({ open: false, type: 'specific', sourcePattern: '', fallbacks: [{ model: '', providerId: '' }] })}>
                        Cancel
                      </Button>
                    </Group>
                  </Stack>
                </Paper>
              ) : (
                <Button size="xs" variant="light" color="teal"
                  onClick={() => setMfForm(f => ({ ...f, open: true }))}>
                  + Add Model Fallback Rule
                </Button>
              )}

              <Divider label="Circuit Breaker Status" labelPosition="left" mt="md" />
              <CircuitBreakerStatus providerIds={form.providerIds} providers={providers} />
            </Stack>
          </Tabs.Panel>

          {/* ── Limits & Quotas tab ─────────────────────────────────────── */}
          <Tabs.Panel value="limits">
            <Stack>
              <Alert color="blue" icon={<IconAdjustments size={16} />}>
                Rate limits and usage quotas control how much traffic a tenant can send per minute and per billing period.
              </Alert>

              <Divider label="Rate Limits" labelPosition="left" />
              <Group grow>
                <NumberInput
                  label="Requests / minute"
                  description="0 = unlimited"
                  value={form.rateLimit.requestsPerMinute}
                  onChange={v => setForm(f => ({ ...f, rateLimit: { ...f.rateLimit, requestsPerMinute: v || 0 } }))}
                  min={0}
                  step={10}
                />
                <NumberInput
                  label="Tokens / minute"
                  description="0 = unlimited"
                  value={form.rateLimit.tokensPerMinute}
                  onChange={v => setForm(f => ({ ...f, rateLimit: { ...f.rateLimit, tokensPerMinute: v || 0 } }))}
                  min={0}
                  step={10000}
                />
              </Group>

              {editTenant && (
                <>
                  <Divider label="Usage Quotas" labelPosition="left" />
                  {quotasLoading ? (
                    <Loader size="sm" />
                  ) : (
                    <>
                      {quotas.length === 0 && (
                        <Text size="sm" c="dimmed">No quotas configured for this tenant.</Text>
                      )}
                      {quotas.map(q => (
                        <Paper key={q._id} p="sm" radius="md" withBorder>
                          <Group justify="space-between" wrap="nowrap">
                            <Stack gap={2}>
                              <Group gap="xs">
                                <Badge size="sm" variant="light" color={q.enabled ? 'blue' : 'gray'}>
                                  {q.quotaType.replace(/_/g, ' ')}
                                </Badge>
                                <Badge size="xs" variant="outline" color="gray">{q.period}</Badge>
                                <Badge size="xs" variant="outline" color={
                                  q.enforcement === 'hard_block' ? 'red' : q.enforcement === 'soft_warning' ? 'yellow' : 'blue'
                                }>{q.enforcement.replace(/_/g, ' ')}</Badge>
                              </Group>
                              <Text size="xs" c="dimmed">
                                Usage: {(q.currentUsage || 0).toLocaleString()} / {q.limit.toLocaleString()}
                                {q.limit > 0 && ` (${Math.round((q.currentUsage || 0) / q.limit * 100)}%)`}
                              </Text>
                            </Stack>
                            <Group gap={4}>
                              <Switch
                                size="xs"
                                checked={q.enabled}
                                onChange={async e => {
                                  try {
                                    await api.patch(`/api/prism/admin/quotas/${q._id}`, { enabled: e.currentTarget.checked });
                                    const r = await api.get(`/api/prism/admin/quotas/tenant/${editTenant._id}`);
                                    setQuotas(r.data?.quotas || []);
                                  } catch {}
                                }}
                              />
                              <ActionIcon
                                variant="subtle"
                                color="red"
                                size="sm"
                                onClick={async () => {
                                  try {
                                    await api.delete(`/api/prism/admin/quotas/${q._id}`);
                                    setQuotas(prev => prev.filter(x => x._id !== q._id));
                                  } catch {}
                                }}
                              >
                                <IconTrash size={14} />
                              </ActionIcon>
                            </Group>
                          </Group>
                        </Paper>
                      ))}

                      <Divider label="Add Quota" labelPosition="left" />
                      <QuotaAddForm
                        tenantId={editTenant._id}
                        existingTypes={quotas.map(q => q.quotaType)}
                        onCreated={async () => {
                          const r = await api.get(`/api/prism/admin/quotas/tenant/${editTenant._id}`);
                          setQuotas(r.data?.quotas || []);
                        }}
                      />
                    </>
                  )}
                </>
              )}
              {!editTenant && (
                <Text size="sm" c="dimmed">Save the tenant first, then edit to configure quotas.</Text>
              )}
            </Stack>
          </Tabs.Panel>

          {/* ── Budget tab ───────────────────────────────────────────────── */}
          <Tabs.Panel value="budget">
            <Stack>
              <Alert color="blue" icon={<IconCoin size={16} />}>
                Set spending limits per tenant. When spend reaches the guard threshold % of any limit,
                selected model tiers are blocked. Hard limits block all requests until the window resets.
                Set a limit to 0 to disable it.
              </Alert>

              <>
              <Divider label="Spending Limits (USD)" labelPosition="left" />
              <Group grow>
                <NumberInput
                  label="Daily Limit (USD)"
                  description="0 = unlimited"
                  value={form.budgetLimits.dailyUsd}
                  onChange={v => setForm(f => ({ ...f, budgetLimits: { ...f.budgetLimits, dailyUsd: v || 0 } }))}
                  min={0}
                  step={1}
                  decimalScale={2}
                  prefix="$"
                />
                <NumberInput
                  label="Weekly Limit (USD)"
                  description="0 = unlimited"
                  value={form.budgetLimits.weeklyUsd}
                  onChange={v => setForm(f => ({ ...f, budgetLimits: { ...f.budgetLimits, weeklyUsd: v || 0 } }))}
                  min={0}
                  step={1}
                  decimalScale={2}
                  prefix="$"
                />
                <NumberInput
                  label="Monthly Limit (USD)"
                  description="0 = unlimited"
                  value={form.budgetLimits.monthlyUsd}
                  onChange={v => setForm(f => ({ ...f, budgetLimits: { ...f.budgetLimits, monthlyUsd: v || 0 } }))}
                  min={0}
                  step={1}
                  decimalScale={2}
                  prefix="$"
                />
              </Group>

              <Divider label="Budget Guard" labelPosition="left" />
              <Switch
                label="Enable Budget Guard"
                description="Block high-cost model tiers when spend approaches a limit threshold"
                checked={form.budgetGuard.enabled}
                onChange={e => setForm(f => ({ ...f, budgetGuard: { ...f.budgetGuard, enabled: e.currentTarget.checked } }))}
              />

              {form.budgetGuard.enabled && (
                <>
                  <NumberInput
                    label="Threshold (%)"
                    description="Block selected tiers when spend reaches this percentage of any active limit"
                    value={form.budgetGuard.thresholdPct}
                    onChange={v => setForm(f => ({ ...f, budgetGuard: { ...f.budgetGuard, thresholdPct: v || 80 } }))}
                    min={1}
                    max={99}
                    step={5}
                    suffix="%"
                    w={180}
                  />
                  <MultiSelect
                    label="Block Tiers at Threshold"
                    description="Model tiers to block for explicit model requests when the guard activates"
                    data={[
                      { value: 'minimal', label: 'Minimal' },
                      { value: 'low',     label: 'Low' },
                      { value: 'medium',  label: 'Medium' },
                      { value: 'high',    label: 'High' },
                      { value: 'premium', label: 'Premium' },
                    ]}
                    value={form.budgetGuard.blockTiers}
                    onChange={v => setForm(f => ({ ...f, budgetGuard: { ...f.budgetGuard, blockTiers: v } }))}
                  />
                  <Select
                    label="Auto-Route Cost Mode Override"
                    description="When the guard activates, override the cost mode for auto-routed requests to prefer cheaper models within each tier"
                    data={[
                      { value: 'economy',  label: 'Economy — force cheap model preference (default)' },
                      { value: 'balanced', label: 'Balanced — no override, keep normal cost mode' },
                    ]}
                    value={form.budgetGuard.guardCostMode}
                    onChange={v => setForm(f => ({ ...f, budgetGuard: { ...f.budgetGuard, guardCostMode: v } }))}
                  />
                </>
              )}
              </>
            </Stack>
          </Tabs.Panel>
        </Tabs>

        <Divider my="md" />
        <Button
          fullWidth
          onClick={saveTenant}
          loading={loading}
          disabled={!form.name || (!editTenant && !form.slug)}
        >
          {editTenant ? 'Save Changes' : 'Create Tenant'}
        </Button>
      </Modal>

      {/* ── Generate Config Modal ───────────────────────────────────────────── */}
      <GenerateConfigModal
        tenant={configTenant}
        allModels={allModels}
        onClose={() => setConfigTenant(null)}
      />

      {/* ── Try Chat Drawer ────────────────────────────────────────────────── */}
      {tryTenant && (
        <TryChatDrawer
          tenant={tryTenant}
          allModels={allModels}
          onClose={() => setTryTenant(null)}
        />
      )}

      {/* New key reveal modal */}
      <Modal opened={!!newKeyModal} onClose={() => setNewKeyModal(null)} title="API Key">
        <Stack>
          <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
            Save this key now — it will <strong>not</strong> be shown again.
          </Alert>
          <Group wrap="nowrap">
            <Code block style={{ flex: 1, wordBreak: 'break-all' }}>{newKeyModal?.key}</Code>
            <CopyButton value={newKeyModal?.key || ''}>
              {({ copied, copy }) => (
                <ActionIcon color={copied ? 'green' : 'gray'} onClick={copy} variant="light">
                  {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                </ActionIcon>
              )}
            </CopyButton>
          </Group>
          {newKeyModal?.expiresAt && (
            <Text size="sm" c="dimmed">Expires: {new Date(newKeyModal.expiresAt).toLocaleString()}</Text>
          )}
        </Stack>
      </Modal>

      {/* Custom key modal */}
      <Modal opened={!!customKeyModal} onClose={() => { setCustomKeyModal(null); setCustomKeyValue(''); setCustomKeyLifetime('0'); }} title={`Custom API Key — ${customKeyModal?.name}`}>
        <Stack>
          <Alert color="blue" icon={<IconSettings size={16} />}>
            Enter your own key value (min 6 chars). This replaces the auto-generated key.
          </Alert>
          <TextInput
            label="Custom API Key"
            placeholder="my-custom-key-value"
            value={customKeyValue}
            onChange={e => setCustomKeyValue(e.target.value)}
            description={`${customKeyValue.length} characters`}
            error={customKeyValue && customKeyValue.length < 1 ? 'Key required' : null}
          />
          <Select
            label="Expiration"
            description="How long until this key expires"
            value={customKeyLifetime}
            onChange={v => setCustomKeyLifetime(v || '0')}
            data={[
              { value: '0',   label: 'Never expires' },
              { value: '7',   label: '7 days' },
              { value: '14',  label: '14 days' },
              { value: '30',  label: '30 days' },
              { value: '60',  label: '60 days' },
              { value: '90',  label: '90 days' },
              { value: '365', label: '1 year' },
            ]}
          />
          <Group>
            <Button onClick={() => saveCustomKey(customKeyModal)} disabled={customKeyValue.length < 1}>Save Custom Key</Button>
            <Button variant="subtle" onClick={() => { setCustomKeyModal(null); setCustomKeyValue(''); setCustomKeyLifetime('0'); }}>Cancel</Button>
          </Group>
        </Stack>
      </Modal>

      {/* Disable key warning modal */}
      <Modal opened={!!disableModal} onClose={() => setDisableModal(null)} title="Disable API Key?">
        <Stack>
          <Alert color="orange" icon={<IconAlertTriangle size={16} />} title="Warning">
            Disabling the API key for <strong>{disableModal?.name}</strong> will immediately
            reject all requests using this key with a 401 error.
          </Alert>
          <Group>
            <Button color="orange" onClick={() => confirmDisable(disableModal)}>Disable anyway</Button>
            <Button variant="subtle" onClick={() => setDisableModal(null)}>Cancel</Button>
          </Group>
        </Stack>
      </Modal>

      {/* Multi-key management drawer */}
      <Drawer
        opened={!!keysDrawer}
        onClose={() => { setKeysDrawer(null); setTenantKeys([]); setAddKeyForm({ mode: null, label: '', apiKey: '', lifetime: '0' }); setNewlyCreatedKey(null); }}
        title={<Text fw={600}>API Keys — {keysDrawer?.name}</Text>}
        position="right"
        size={450}
        padding="md"
      >
        <Stack gap="md">
          {/* Newly created key alert */}
          {newlyCreatedKey && (
            <Alert color="green" icon={<IconCheck size={16} />} title="Key created" withCloseButton onClose={() => setNewlyCreatedKey(null)}>
              <Stack gap="xs">
                <Text size="sm">Copy this key now — it will not be shown again.</Text>
                <Group gap="xs">
                  <Code style={{ flex: 1, fontSize: 12, wordBreak: 'break-all' }}>{newlyCreatedKey.apiKey}</Code>
                  <CopyButton value={newlyCreatedKey.apiKey}>
                    {({ copied, copy }) => (
                      <ActionIcon color={copied ? 'teal' : 'gray'} onClick={copy} variant="subtle">
                        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                      </ActionIcon>
                    )}
                  </CopyButton>
                </Group>
              </Stack>
            </Alert>
          )}

          {/* Keys list */}
          {keysLoading ? (
            <Group justify="center" py="lg"><Loader size="sm" /></Group>
          ) : tenantKeys.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="lg">No API keys found for this tenant.</Text>
          ) : (
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Key</Table.Th>
                  <Table.Th>Label</Table.Th>
                  <Table.Th style={{ width: 50 }}>On</Table.Th>
                  <Table.Th style={{ width: 40 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {tenantKeys.map(k => (
                  <Table.Tr key={k._id}>
                    <Table.Td>
                      <Stack gap={2}>
                        <Code style={{ fontSize: 11 }}>{k.prefix || k.apiKeyPrefix || '???'}</Code>
                        <Group gap={4}>
                          {k.isCustom && <Badge size="xs" variant="light" color="violet">custom</Badge>}
                          {k.isLegacy && <Badge size="xs" variant="light" color="gray">legacy</Badge>}
                          {k.expiresAt && (
                            <Tooltip label={`Expires: ${new Date(k.expiresAt).toLocaleDateString()}`}>
                              <Badge size="xs" variant="light" color={new Date(k.expiresAt) < new Date() ? 'red' : 'blue'}>
                                {new Date(k.expiresAt) < new Date() ? 'expired' : `exp ${new Date(k.expiresAt).toLocaleDateString()}`}
                              </Badge>
                            </Tooltip>
                          )}
                        </Group>
                        {k.lastUsedAt && (
                          <Text size="xs" c="dimmed">Used: {new Date(k.lastUsedAt).toLocaleDateString()}</Text>
                        )}
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      <TextInput
                        size="xs"
                        variant="unstyled"
                        placeholder="(no label)"
                        defaultValue={k.label || ''}
                        onBlur={e => {
                          const newLabel = e.target.value.trim();
                          if (newLabel !== (k.label || '')) updateKeyLabel(keysDrawer._id, k._id, newLabel);
                        }}
                        styles={{ input: { fontSize: 12 } }}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Switch
                        size="xs"
                        checked={k.enabled !== false}
                        onChange={e => toggleKeyMulti(keysDrawer._id, k._id, e.currentTarget.checked)}
                      />
                    </Table.Td>
                    <Table.Td>
                      <ActionIcon
                        size="xs"
                        variant="subtle"
                        color="red"
                        onClick={() => deleteKeyMulti(keysDrawer._id, k._id)}
                      >
                        <IconTrash size={13} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}

          <Divider />

          {/* Add key forms */}
          {addKeyForm.mode === null && (
            <Stack gap="xs">
              <Group gap="sm" wrap="wrap">
                <Button size="xs" variant="light" leftSection={<IconPlus size={13} />} onClick={() => setAddKeyForm(f => ({ ...f, mode: 'auto' }))}>
                  Add Key
                </Button>
                <Button size="xs" variant="light" color="violet" leftSection={<IconPlus size={13} />} onClick={() => setAddKeyForm(f => ({ ...f, mode: 'custom' }))}>
                  Add Custom Key
                </Button>
                {!keysDrawer?.customApiKey && (
                  <Button size="xs" variant="light" color="orange" leftSection={<IconRefresh size={13} />}
                    onClick={() => { if (keysDrawer) rotateKey(keysDrawer); }}>
                    Rotate Main Key
                  </Button>
                )}
                <Button size="xs" variant="light" color="grape" leftSection={<IconKey size={13} />}
                  onClick={() => setAddKeyForm(f => ({ ...f, mode: 'setcustom' }))}>
                  Set Custom Key
                </Button>
              </Group>
            </Stack>
          )}
          {addKeyForm.mode === 'setcustom' && (
            <Paper withBorder p="sm" radius="md">
              <Stack gap="xs">
                <Text size="sm" fw={500}>Set custom API key</Text>
                <PasswordInput size="xs" label="Custom key value" placeholder="your-custom-key" value={customKeyValue} onChange={e => setCustomKeyValue(e.target.value)} />
                <Select size="xs" label="Lifetime" data={LIFETIME_OPTIONS} value={customKeyLifetime} onChange={v => setCustomKeyLifetime(v || '0')} />
                <Group gap="xs">
                  <Button size="xs" onClick={() => { saveCustomKey(keysDrawer); setAddKeyForm({ mode: null, label: '', apiKey: '', lifetime: '0' }); }} disabled={customKeyValue.length < 1}>Save</Button>
                  <Button size="xs" variant="subtle" onClick={() => setAddKeyForm({ mode: null, label: '', apiKey: '', lifetime: '0' })}>Cancel</Button>
                </Group>
              </Stack>
            </Paper>
          )}

          {addKeyForm.mode === 'auto' && (
            <Paper withBorder p="sm" radius="md">
              <Stack gap="xs">
                <Text size="sm" fw={500}>Generate new key</Text>
                <TextInput size="xs" label="Label (optional)" placeholder="e.g. CI pipeline" value={addKeyForm.label} onChange={e => setAddKeyForm(f => ({ ...f, label: e.target.value }))} />
                <Select size="xs" label="Lifetime" data={LIFETIME_OPTIONS} value={addKeyForm.lifetime} onChange={v => setAddKeyForm(f => ({ ...f, lifetime: v || '0' }))} />
                <Group gap="xs">
                  <Button size="xs" onClick={() => addKey(keysDrawer._id)}>Generate</Button>
                  <Button size="xs" variant="subtle" onClick={() => setAddKeyForm({ mode: null, label: '', apiKey: '', lifetime: '0' })}>Cancel</Button>
                </Group>
              </Stack>
            </Paper>
          )}

          {addKeyForm.mode === 'custom' && (
            <Paper withBorder p="sm" radius="md">
              <Stack gap="xs">
                <Text size="sm" fw={500}>Add custom key</Text>
                <TextInput size="xs" label="Label (optional)" placeholder="e.g. Shared team key" value={addKeyForm.label} onChange={e => setAddKeyForm(f => ({ ...f, label: e.target.value }))} />
                <TextInput size="xs" label="API Key value" placeholder="my-custom-key-value" value={addKeyForm.apiKey} onChange={e => setAddKeyForm(f => ({ ...f, apiKey: e.target.value }))} required />
                <Select size="xs" label="Lifetime" data={LIFETIME_OPTIONS} value={addKeyForm.lifetime} onChange={v => setAddKeyForm(f => ({ ...f, lifetime: v || '0' }))} />
                <Group gap="xs">
                  <Button size="xs" onClick={() => addKey(keysDrawer._id)} disabled={addKeyForm.apiKey.length < 1}>Save</Button>
                  <Button size="xs" variant="subtle" onClick={() => setAddKeyForm({ mode: null, label: '', apiKey: '', lifetime: '0' })}>Cancel</Button>
                </Group>
              </Stack>
            </Paper>
          )}
        </Stack>
      </Drawer>
    </Stack>
  );
}
