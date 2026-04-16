import { useEffect, useState, useCallback } from 'react';
import {
  Title, Stack, Group, Button, Paper, Tabs, Text, Badge, ActionIcon,
  TextInput, Textarea, Select, NumberInput, Switch, Slider, Table,
  Modal, Loader, Center, Alert, Code, SimpleGrid, Divider, ScrollArea,
  MultiSelect, SegmentedControl, Tooltip, Box,
} from '@mantine/core';
import {
  IconPlus, IconTrash, IconEdit, IconCheck, IconAlertTriangle,
  IconWand, IconChartBar, IconSettings, IconKey, IconBolt,
  IconRefresh, IconPlayerPlay, IconArrowUp, IconArrowDown,
  IconChevronDown, IconChevronRight,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import api from '../hooks/useApi';

const TIERS       = ['micro', 'minimal', 'low', 'medium', 'advanced', 'high', 'ultra', 'critical'];
const TIER_COLORS = { micro: 'grape', minimal: 'teal', low: 'blue', medium: 'violet', advanced: 'cyan', high: 'red', ultra: 'pink', critical: 'orange' };
const STRATEGIES  = [
  { value: 'truncate',      label: 'Truncate — include partial context up to limit' },
  { value: 'metadata_only', label: 'Metadata only — inject signals only, no message content' },
  { value: 'summary',       label: 'Summary — falls back to truncate (future)' },
];

// ── Keyword Rule Modal ────────────────────────────────────────────────────────

function KeywordRuleModal({ opened, onClose, initial, onSave }) {
  const empty = { name: '', enabled: true, keywords: [], match: 'any', minMatches: 1, searchIn: 'all',
                  effect: { category: '', tierMin: '', tierMax: '', domain: '' } };
  const [form, setForm] = useState(initial || empty);
  const [kwInput, setKwInput] = useState('');

  useEffect(() => { setForm(initial || empty); setKwInput(''); }, [opened]);

  function addKw() {
    const kw = kwInput.trim();
    if (kw && !form.keywords.includes(kw)) {
      setForm(f => ({ ...f, keywords: [...f.keywords, kw] }));
    }
    setKwInput('');
  }

  function removeKw(kw) { setForm(f => ({ ...f, keywords: f.keywords.filter(k => k !== kw) })); }
  function setEffect(k, v) { setForm(f => ({ ...f, effect: { ...f.effect, [k]: v } })); }

  return (
    <Modal opened={opened} onClose={onClose} title={initial ? 'Edit Keyword Rule' : 'Add Keyword Rule'} size="lg">
      <Stack>
        <Group>
          <TextInput label="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ flex: 1 }} />
          <Switch label="Enabled" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.currentTarget.checked }))} mt="xl" />
        </Group>

        <div>
          <Text size="sm" fw={500} mb={4}>Keywords</Text>
          <Group gap="xs" mb={6} wrap="wrap">
            {form.keywords.map(kw => (
              <Badge key={kw} rightSection={
                <ActionIcon size={12} variant="transparent" onClick={() => removeKw(kw)}>×</ActionIcon>
              }>{kw}</Badge>
            ))}
          </Group>
          <Group gap="xs">
            <TextInput style={{ flex: 1 }} size="xs" placeholder="Add keyword…" value={kwInput}
              onChange={e => setKwInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addKw()} />
            <Button size="xs" onClick={addKw}>Add</Button>
          </Group>
        </div>

        <Group grow>
          <Select label="Match" value={form.match} onChange={v => setForm(f => ({ ...f, match: v }))}
            data={[{ value: 'any', label: 'Any keyword' }, { value: 'all', label: 'All keywords' }]} size="sm" />
          <NumberInput label="Min matches" value={form.minMatches} min={1}
            onChange={v => setForm(f => ({ ...f, minMatches: v }))} size="sm" />
          <Select label="Search in" value={form.searchIn} onChange={v => setForm(f => ({ ...f, searchIn: v }))}
            data={[{ value: 'all', label: 'All messages' }, { value: 'user', label: 'User messages' }, { value: 'system', label: 'System prompt' }]}
            size="sm" />
        </Group>

        <Divider label="Effect when matched" labelPosition="center" />
        <Group grow>
          <TextInput label="Override category" placeholder="e.g. code_security_review"
            value={form.effect.category} onChange={e => setEffect('category', e.target.value)} size="sm" />
          <Select label="Minimum tier" value={form.effect.tierMin || ''}
            onChange={v => setEffect('tierMin', v || '')} clearable
            data={TIERS.map(t => ({ value: t, label: t }))} size="sm" />
          <Select label="Maximum tier" value={form.effect.tierMax || ''}
            onChange={v => setEffect('tierMax', v || '')} clearable
            data={TIERS.map(t => ({ value: t, label: t }))} size="sm" />
          <TextInput label="Set domain" placeholder="e.g. security, legal"
            value={form.effect.domain} onChange={e => setEffect('domain', e.target.value)} size="sm" />
        </Group>

        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(form)} disabled={!form.name || !form.keywords.length}>Save Rule</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ── System Prompt Role Modal ──────────────────────────────────────────────────

function RoleModal({ opened, onClose, initial, onSave }) {
  const empty = { name: '', enabled: true, pattern: '', effect: { category: '', tierMin: '', domain: '' } };
  const [form, setForm] = useState(initial || empty);

  useEffect(() => { setForm(initial || empty); }, [opened]);
  function setEffect(k, v) { setForm(f => ({ ...f, effect: { ...f.effect, [k]: v } })); }

  return (
    <Modal opened={opened} onClose={onClose} title={initial ? 'Edit System Prompt Role' : 'Add System Prompt Role'} size="md">
      <Stack>
        <Group>
          <TextInput label="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ flex: 1 }} />
          <Switch label="Enabled" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.currentTarget.checked }))} mt="xl" />
        </Group>
        <TextInput label="Pattern (regex, case-insensitive)" placeholder="security.*(audit|review)|vulnerability"
          value={form.pattern} onChange={e => setForm(f => ({ ...f, pattern: e.target.value }))} />
        <Text size="xs" c="dimmed">Matched against the system prompt. Example: <Code>customer.*(support|service)</Code></Text>
        <Divider label="Effect when matched" labelPosition="center" />
        <Group grow>
          <TextInput label="Override category" placeholder="e.g. customer_support"
            value={form.effect.category} onChange={e => setEffect('category', e.target.value)} size="sm" />
          <Select label="Minimum tier" value={form.effect.tierMin || ''} onChange={v => setEffect('tierMin', v || '')} clearable
            data={TIERS.map(t => ({ value: t, label: t }))} size="sm" />
          <TextInput label="Set domain" value={form.effect.domain} onChange={e => setEffect('domain', e.target.value)} size="sm" />
        </Group>
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(form)} disabled={!form.name || !form.pattern}>Save Role</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function RoutingConfig() {
  const [ruleSets, setRuleSets] = useState([]);
  const [selected, setSelected] = useState(null);  // active rule set being edited
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [seeding, setSeeding]   = useState(false);

  // Modals
  const [kwModal, setKwModal]     = useState({ open: false, idx: null });
  const [roleModal, setRoleModal] = useState({ open: false, idx: null });

  // Benchmark state
  const [benchDays, setBenchDays]       = useState('30');
  const [benchLimit, setBenchLimit]     = useState(500);
  const [benchRunning, setBenchRunning] = useState(false);
  const [benchResult, setBenchResult]   = useState(null);

  // Test Route state
  const [testPrompt, setTestPrompt]             = useState('');
  const [testSystemPrompt, setTestSystemPrompt] = useState('');
  const [testTenantId, setTestTenantId]         = useState('');
  const [testUseClassifier, setTestUseClassifier] = useState(false);
  const [testRunning, setTestRunning]           = useState(false);
  const [testResult, setTestResult]             = useState(null);
  const [tenants, setTenants]                   = useState([]);

  // Synthetic test state
  const [testSuites, setTestSuites]             = useState([]);
  const [selectedSuite, setSelectedSuite]       = useState(null);
  const [synRunning, setSynRunning]             = useState('');  // 'generate' | 'run' | 'evaluate' | ''
  const [synTenantId, setSynTenantId]           = useState('');
  const [synCategory, setSynCategory]           = useState([]);
  const [synCount, setSynCount]                 = useState(10);
  const [synNewName, setSynNewName]             = useState('');
  const [testRuns, setTestRuns]                 = useState([]);
  const [selectedRun, setSelectedRun]           = useState(null);
  const [categories, setCategories]             = useState([]);
  const [synUseClassifier, setSynUseClassifier] = useState(true);
  const [expandedResult, setExpandedResult]     = useState(null);
  const [providerModels, setProviderModels]     = useState([]);  // { value: 'providerId|modelId', label: 'model (provider)' }
  const [synGenModel, setSynGenModel]           = useState('');
  const [synEvalModel, setSynEvalModel]         = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/prism/admin/routing/rule-sets');
      setRuleSets(data);
      if (data.length && !selected) setSelected(JSON.parse(JSON.stringify(data[0])));
    } catch { notifications.show({ message: 'Failed to load rule sets', color: 'red' }); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/api/prism/admin/tenants').then(r => {
      setTenants((r.data || []).map(t => ({ value: t._id, label: t.name || t.slug })));
      if (r.data?.length) { setTestTenantId(r.data[0]._id); setSynTenantId(r.data[0]._id); }
    }).catch(() => {});
    api.get('/api/prism/admin/categories').then(r => {
      setCategories((r.data || []).map(c => ({ value: c.key, label: `${c.key} [${c.costTier}]` })));
    }).catch(() => {});
    api.get('/api/prism/admin/providers').then(r => {
      const models = (r.data || []).flatMap(p =>
        (p.discoveredModels || []).filter(m => m.visible !== false && m.tier)
          .map(m => ({ value: `${p._id}|${m.id}`, label: `${m.id} [${m.tier}] (${p.name || p.type})` }))
      );
      setProviderModels(models);
      if (models.length) { setSynGenModel(models[0].value); setSynEvalModel(models[0].value); }
    }).catch(() => {});
    api.get('/api/prism/admin/routing/test-suites').then(r => setTestSuites(r.data || [])).catch(() => {});
  }, []);

  async function runTestRoute() {
    if (!testPrompt || !testTenantId) return;
    setTestRunning(true); setTestResult(null);
    try {
      const { data } = await api.post('/api/prism/admin/routing/test-route', {
        prompt: testPrompt,
        systemPrompt: testSystemPrompt || undefined,
        tenantId: testTenantId,
        useClassifier: testUseClassifier,
      });
      setTestResult(data);
    } catch (err) {
      notifications.show({ message: err.response?.data?.error || 'Test route failed', color: 'red' });
    }
    setTestRunning(false);
  }

  async function createSuite() {
    if (!synNewName) return;
    try {
      const { data } = await api.post('/api/prism/admin/routing/test-suites', { name: synNewName, category: synCategory || undefined });
      setTestSuites(prev => [data, ...prev]);
      setSelectedSuite(data);
      setSynNewName('');
    } catch (err) { notifications.show({ message: err.response?.data?.error || 'Failed to create suite', color: 'red' }); }
  }

  async function generateTests() {
    if (!selectedSuite || !synTenantId) return;
    setSynRunning('generate');
    try {
      const [gProv, gModel] = synGenModel ? synGenModel.split('|') : [undefined, undefined];
      const { data } = await api.post(`/api/prism/admin/routing/test-suites/${selectedSuite._id}/generate`, {
        tenantId: synTenantId, count: synCount,
        category: synCategory.length === 1 ? synCategory[0] : synCategory.length > 1 ? synCategory.join(',') : undefined,
        providerId: gProv, modelId: gModel,
      });
      setSelectedSuite(data.suite);
      setTestSuites(prev => prev.map(s => s._id === data.suite._id ? data.suite : s));
      notifications.show({ message: `${data.generated} test cases generated`, color: 'green' });
    } catch (err) { notifications.show({ message: err.response?.data?.error || 'Generation failed', color: 'red' }); }
    setSynRunning('');
  }

  async function runSuite() {
    if (!selectedSuite || !synTenantId) return;
    setSynRunning('run');
    try {
      const { data } = await api.post(`/api/prism/admin/routing/test-suites/${selectedSuite._id}/run`, { tenantId: synTenantId, useClassifier: synUseClassifier });
      setSelectedRun(data);
      setTestRuns(prev => [data, ...prev]);
      notifications.show({ message: `Run complete: ${data.summary.tierMatches}/${data.summary.total} tier matches`, color: 'green' });
    } catch (err) { notifications.show({ message: err.response?.data?.error || 'Run failed', color: 'red' }); }
    setSynRunning('');
  }

  async function evaluateRun() {
    if (!selectedRun || !synTenantId) return;
    setSynRunning('evaluate');
    try {
      const [eProv, eModel] = synEvalModel ? synEvalModel.split('|') : [undefined, undefined];
      const { data } = await api.post(`/api/prism/admin/routing/test-runs/${selectedRun._id}/evaluate`, {
        tenantId: synTenantId, providerId: eProv, modelId: eModel,
      });
      setSelectedRun(data);
      setTestRuns(prev => prev.map(r => r._id === data._id ? data : r));
    } catch (err) { notifications.show({ message: err.response?.data?.error || 'Evaluation failed', color: 'red' }); }
    setSynRunning('');
  }

  async function loadRuns(suiteId) {
    try {
      const { data } = await api.get(`/api/prism/admin/routing/test-suites/${suiteId}/runs`);
      setTestRuns(data || []);
      if (data?.length) setSelectedRun(data[0]);
    } catch { setTestRuns([]); }
  }

  async function deleteSuite(id) {
    try {
      await api.delete(`/api/prism/admin/routing/test-suites/${id}`);
      setTestSuites(prev => prev.filter(s => s._id !== id));
      if (selectedSuite?._id === id) { setSelectedSuite(null); setTestRuns([]); setSelectedRun(null); }
    } catch (err) { notifications.show({ message: 'Failed to delete', color: 'red' }); }
  }

  function selectRuleSet(rs) { setSelected(JSON.parse(JSON.stringify(rs))); setBenchResult(null); }

  function updateSelected(path, value) {
    setSelected(prev => {
      const next = { ...prev };
      const keys = path.split('.');
      let obj = next;
      for (let i = 0; i < keys.length - 1; i++) {
        obj[keys[i]] = { ...obj[keys[i]] };
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return next;
    });
  }

  async function save() {
    if (!selected) return;
    setSaving(true);
    try {
      const url = selected._id
        ? `/api/prism/admin/routing/rule-sets/${selected._id}`
        : '/api/prism/admin/routing/rule-sets';
      const method = selected._id ? 'put' : 'post';
      const { data } = await api[method](url, selected);
      notifications.show({ message: 'Rule set saved', color: 'green' });
      await load();
      setSelected(JSON.parse(JSON.stringify(data)));
    } catch (err) {
      notifications.show({ message: err.response?.data?.error || 'Save failed', color: 'red' });
    }
    setSaving(false);
  }

  async function setDefault(id) {
    await api.post(`/api/prism/admin/routing/rule-sets/${id}/set-default`);
    await load();
    notifications.show({ message: 'Global default updated', color: 'green' });
  }

  async function deleteRuleSet(id) {
    await api.delete(`/api/prism/admin/routing/rule-sets/${id}`);
    setSelected(null);
    await load();
  }

  async function seedDefaults() {
    setSeeding(true);
    try {
      const { data } = await api.post('/api/prism/admin/routing/rule-sets/seed-defaults');
      if (data.created) {
        notifications.show({ message: 'Default rule set created', color: 'green' });
        await load();
      } else {
        notifications.show({ message: 'Global default already exists', color: 'blue' });
      }
    } catch { notifications.show({ message: 'Seed failed', color: 'red' }); }
    setSeeding(false);
  }

  async function runBenchmark() {
    if (!selected?._id) { notifications.show({ message: 'Save the rule set first', color: 'orange' }); return; }
    setBenchRunning(true);
    setBenchResult(null);
    try {
      const { data } = await api.post('/api/prism/admin/routing/benchmark', {
        ruleSetId: selected._id,
        days: parseInt(benchDays),
        limit: benchLimit,
      });
      setBenchResult(data);
    } catch (err) {
      notifications.show({ message: err.response?.data?.error || 'Benchmark failed', color: 'red' });
    }
    setBenchRunning(false);
  }

  // ── Keyword rule helpers ──────────────────────────────────────────────────
  function saveKwRule(form) {
    if (kwModal.idx === null) {
      updateSelected('keywordRules', [...(selected.keywordRules || []), form]);
    } else {
      const next = [...(selected.keywordRules || [])];
      next[kwModal.idx] = form;
      updateSelected('keywordRules', next);
    }
    setKwModal({ open: false, idx: null });
  }

  function removeKwRule(idx) {
    updateSelected('keywordRules', selected.keywordRules.filter((_, i) => i !== idx));
  }

  function saveRoleRule(form) {
    if (roleModal.idx === null) {
      updateSelected('systemPromptRoles', [...(selected.systemPromptRoles || []), form]);
    } else {
      const next = [...(selected.systemPromptRoles || [])];
      next[roleModal.idx] = form;
      updateSelected('systemPromptRoles', next);
    }
    setRoleModal({ open: false, idx: null });
  }

  function removeRoleRule(idx) {
    updateSelected('systemPromptRoles', selected.systemPromptRoles.filter((_, i) => i !== idx));
  }

  if (loading) return <Center h="60vh"><Loader /></Center>;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Routing Configuration</Title>
        <Group gap="xs">
          <Button size="xs" variant="light" leftSection={<IconWand size={14} />} onClick={seedDefaults} loading={seeding}>
            Create Default Rule Set
          </Button>
          <Button size="xs" leftSection={<IconPlus size={14} />}
            onClick={() => setSelected({ name: 'New Rule Set', description: '', isGlobalDefault: false,
              tokenThresholds: { minimal: 500, low: 2000, medium: 15000, alwaysHigh: 50000 },
              signalWeights: { tokenCount: 0.8, systemPromptRole: 0.9, contentKeywords: 0.85, codeLanguage: 0.7, conversationTurns: 0.4 },
              turnUpgrade: { enabled: true, threshold: 4 },
              classifier: { confidenceThreshold: 0.65, contextLimitTokens: 4000, contextStrategy: 'truncate' },
              keywordRules: [], systemPromptRoles: [] })}>
            New Rule Set
          </Button>
        </Group>
      </Group>

      {ruleSets.length === 0 && !selected && (
        <Alert color="blue" icon={<IconAlertTriangle size={16} />}>
          No routing rule sets configured. Click <strong>Create Default Rule Set</strong> to get started with sensible defaults,
          or <strong>New Rule Set</strong> to build from scratch.
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, md: 4 }} spacing="sm">
        {/* ── Rule set list ─────────────────────────────────────────────── */}
        <Stack gap="xs">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Rule Sets</Text>
          {ruleSets.map(rs => (
            <Paper key={rs._id} withBorder p="xs" radius="sm"
              style={{ cursor: 'pointer', borderColor: selected?._id === rs._id ? 'var(--mantine-color-blue-6)' : undefined }}
              onClick={() => selectRuleSet(rs)}>
              <Group justify="space-between" wrap="nowrap">
                <div style={{ overflow: 'hidden' }}>
                  <Text size="sm" fw={500} truncate>{rs.name}</Text>
                  <Group gap={4}>
                    {rs.isGlobalDefault && <Badge size="xs" color="green">Global Default</Badge>}
                    {rs.isDefault && <Badge size="xs" color="teal" variant="light">system</Badge>}
                  </Group>
                </div>
              </Group>
            </Paper>
          ))}
        </Stack>

        {/* ── Editor ───────────────────────────────────────────────────── */}
        <div style={{ gridColumn: 'span 3' }}>
          {selected ? (
            <Paper withBorder p="md" radius="md">
              <Group justify="space-between" mb="md">
                <Group gap="sm">
                  <TextInput value={selected.name} onChange={e => updateSelected('name', e.target.value)}
                    placeholder="Rule set name" fw={600} size="sm" style={{ width: 280 }} />
                  {selected.isGlobalDefault && <Badge color="green" size="xs">Global Default</Badge>}
                </Group>
                <TextInput value={selected.description || ''} onChange={e => updateSelected('description', e.target.value)}
                  placeholder="Description — e.g. 'Maximize quality, cost is secondary (+1 tier)'"
                  size="xs" style={{ width: '100%' }} />
                <Group gap="xs">
                  {selected._id && !selected.isGlobalDefault && (
                    <Button size="xs" variant="light" color="green" onClick={() => setDefault(selected._id)}>
                      Set as Default
                    </Button>
                  )}
                  {selected._id && (
                    <Tooltip label={selected.isDefault ? 'Default rule set — cannot be deleted' : 'Delete rule set'}>
                      <ActionIcon color="red" variant="light" size="sm" disabled={selected.isDefault}
                        onClick={() => { if (!selected.isDefault && confirm('Delete this rule set?')) deleteRuleSet(selected._id); }}>
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                  <Button size="xs" onClick={save} loading={saving} leftSection={<IconCheck size={14} />}>
                    Save
                  </Button>
                </Group>
              </Group>

              <Tabs defaultValue="thresholds">
                <Tabs.List>
                  <Tabs.Tab value="thresholds"  leftSection={<IconSettings size={14} />}>Thresholds</Tabs.Tab>
                  <Tabs.Tab value="keywords"    leftSection={<IconKey size={14} />}>
                    Keyword Rules {selected.keywordRules?.length > 0 && <Badge size="xs" ml={4}>{selected.keywordRules.length}</Badge>}
                  </Tabs.Tab>
                  <Tabs.Tab value="roles"       leftSection={<IconBolt size={14} />}>
                    Prompt Roles {selected.systemPromptRoles?.length > 0 && <Badge size="xs" ml={4}>{selected.systemPromptRoles.length}</Badge>}
                  </Tabs.Tab>
                  <Tabs.Tab value="classifier"  leftSection={<IconSettings size={14} />}>Classifier</Tabs.Tab>
                  <Tabs.Tab value="benchmark"   leftSection={<IconChartBar size={14} />}>Benchmark</Tabs.Tab>
                  <Tabs.Tab value="test-route"  leftSection={<IconPlayerPlay size={14} />}>Test Route</Tabs.Tab>
                  <Tabs.Tab value="synthetic"   leftSection={<IconWand size={14} />}>Synthetic Tests <Badge size="xs" color="grape" variant="light" ml={4}>AI</Badge></Tabs.Tab>
                </Tabs.List>

                {/* ── Thresholds tab ───────────────────────────────────── */}
                <Tabs.Panel value="thresholds" pt="md">
                  <Stack>
                    <Alert color="blue" p="xs">
                      <Text size="xs">
                        Token thresholds provide hints to the routing engine but <strong>do not bypass the LLM classifier</strong>.
                        The classifier is the primary decision maker — these thresholds only influence pre-routing confidence for keyword/role rules.
                      </Text>
                    </Alert>

                    <Divider label="Signal Weights" labelPosition="center" />
                    <Text size="sm" c="dimmed">
                      Weights determine how much each signal type contributes to pre-routing confidence.
                      Only keyword rules and system prompt roles can bypass the classifier (when their weighted confidence exceeds the threshold).
                    </Text>
                    {Object.entries({
                      systemPromptRole:  { label: 'System Prompt Role', desc: 'How strongly system prompt regex matches (e.g. "Coding Agent") influence pre-routing confidence. High = bypass classifier when matched.' },
                      contentKeywords:   { label: 'Keyword Rules', desc: 'How strongly keyword matches (e.g. security, legal terms) contribute to confidence. Keep below classifier threshold (0.65) for hint-only mode.' },
                      codeLanguage:      { label: 'Code Language Detection', desc: 'Confidence boost when programming languages are detected in the prompt. Helps route coding tasks to code-optimized models.' },
                      conversationTurns: { label: 'Conversation Turns', desc: 'Modifier for multi-turn conversations. Higher values make long conversations more likely to escalate tier.' },
                    }).map(([key, { label, desc }]) => (
                      <div key={key}>
                        <Group justify="space-between" mb={2}>
                          <Text size="sm">{label}</Text>
                          <Text size="sm" fw={600}>{((selected.signalWeights?.[key] ?? 0) * 100).toFixed(0)}%</Text>
                        </Group>
                        <Text size="xs" c="dimmed" mb={4}>{desc}</Text>
                        <Slider
                          value={(selected.signalWeights?.[key] ?? 0.5) * 100}
                          onChange={v => updateSelected(`signalWeights.${key}`, v / 100)}
                          min={0} max={100} step={5}
                          color={key === 'systemPromptRole' ? 'violet' : key === 'contentKeywords' ? 'orange' : 'blue'}
                        />
                      </div>
                    ))}

                    <Divider label="Conversation Turn Upgrade" labelPosition="center" />
                    <Group>
                      <Switch label="Enable turn-count tier upgrade"
                        checked={selected.turnUpgrade?.enabled ?? true}
                        onChange={e => updateSelected('turnUpgrade.enabled', e.currentTarget.checked)} />
                      <NumberInput label="Upgrade tier after N turns" size="sm"
                        value={selected.turnUpgrade?.threshold ?? 4}
                        onChange={v => updateSelected('turnUpgrade.threshold', v)} min={2} max={20} w={180} />
                    </Group>
                  </Stack>
                </Tabs.Panel>

                {/* ── Keyword Rules tab ────────────────────────────────── */}
                <Tabs.Panel value="keywords" pt="md">
                  <Stack>
                    <Group justify="space-between">
                      <Text size="sm" c="dimmed">
                        Rules scan message content for keyword patterns. The highest-weighted matching rule determines the routing effect.
                      </Text>
                      <Button size="xs" leftSection={<IconPlus size={12} />}
                        onClick={() => setKwModal({ open: true, idx: null })}>
                        Add Rule
                      </Button>
                    </Group>
                    {!selected.keywordRules?.length && (
                      <Text size="sm" c="dimmed" ta="center" py="lg">No keyword rules. Add one to start pre-routing based on content patterns.</Text>
                    )}
                    <Stack gap="xs">
                      {(selected.keywordRules || []).map((rule, idx) => (
                        <Paper key={idx} withBorder p="sm" radius="sm"
                          style={{ opacity: rule.enabled ? 1 : 0.5 }}>
                          <Group justify="space-between" wrap="nowrap">
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <Group gap="xs" mb={2}>
                                <Text size="sm" fw={600}>{rule.name}</Text>
                                {!rule.enabled && <Badge size="xs" color="gray">Disabled</Badge>}
                                {rule.effect.tierMin && <Badge size="xs" color={TIER_COLORS[rule.effect.tierMin]}>min: {rule.effect.tierMin}</Badge>}
                                {rule.effect.tierMax && <Badge size="xs" color={TIER_COLORS[rule.effect.tierMax]} variant="outline">max: {rule.effect.tierMax}</Badge>}
                                {rule.effect.category && <Badge size="xs" color="grape">{rule.effect.category}</Badge>}
                                {rule.effect.domain && <Badge size="xs" color="cyan">{rule.effect.domain}</Badge>}
                              </Group>
                              <Group gap={4} wrap="wrap">
                                {rule.keywords.slice(0, 6).map(kw => <Code key={kw} style={{ fontSize: 11 }}>{kw}</Code>)}
                                {rule.keywords.length > 6 && <Text size="xs" c="dimmed">+{rule.keywords.length - 6} more</Text>}
                              </Group>
                            </div>
                            <Group gap="xs">
                              <ActionIcon size="sm" variant="subtle"
                                onClick={() => setKwModal({ open: true, idx })}>
                                <IconEdit size={14} />
                              </ActionIcon>
                              <ActionIcon size="sm" variant="subtle" color="red"
                                onClick={() => removeKwRule(idx)}>
                                <IconTrash size={14} />
                              </ActionIcon>
                            </Group>
                          </Group>
                        </Paper>
                      ))}
                    </Stack>
                  </Stack>
                </Tabs.Panel>

                {/* ── System Prompt Roles tab ──────────────────────────── */}
                <Tabs.Panel value="roles" pt="md">
                  <Stack>
                    <Group justify="space-between">
                      <Text size="sm" c="dimmed">
                        Regex patterns matched against the system prompt. High-confidence signal — bypasses the LLM classifier when matched.
                      </Text>
                      <Button size="xs" leftSection={<IconPlus size={12} />}
                        onClick={() => setRoleModal({ open: true, idx: null })}>
                        Add Role
                      </Button>
                    </Group>
                    {!selected.systemPromptRoles?.length && (
                      <Text size="sm" c="dimmed" ta="center" py="lg">No roles defined. Add patterns to detect system prompt roles and route without classifier.</Text>
                    )}
                    <Stack gap="xs">
                      {(selected.systemPromptRoles || []).map((role, idx) => (
                        <Paper key={idx} withBorder p="sm" radius="sm"
                          style={{ opacity: role.enabled ? 1 : 0.5 }}>
                          <Group justify="space-between" wrap="nowrap">
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <Group gap="xs" mb={2}>
                                <Text size="sm" fw={600}>{role.name}</Text>
                                {!role.enabled && <Badge size="xs" color="gray">Disabled</Badge>}
                                {role.effect.tierMin && <Badge size="xs" color={TIER_COLORS[role.effect.tierMin]}>min: {role.effect.tierMin}</Badge>}
                                {role.effect.category && <Badge size="xs" color="grape">{role.effect.category}</Badge>}
                              </Group>
                              <Code style={{ fontSize: 11 }}>{role.pattern}</Code>
                            </div>
                            <Group gap="xs">
                              <ActionIcon size="sm" variant="subtle"
                                onClick={() => setRoleModal({ open: true, idx })}>
                                <IconEdit size={14} />
                              </ActionIcon>
                              <ActionIcon size="sm" variant="subtle" color="red"
                                onClick={() => removeRoleRule(idx)}>
                                <IconTrash size={14} />
                              </ActionIcon>
                            </Group>
                          </Group>
                        </Paper>
                      ))}
                    </Stack>
                  </Stack>
                </Tabs.Panel>

                {/* ── Classifier tab ───────────────────────────────────── */}
                <Tabs.Panel value="classifier" pt="md">
                  <Stack>
                    <Alert color="blue" p="xs">
                      <Text size="xs">
                        The LLM classifier is the heart of routing. It is called for every request unless a keyword rule or
                        system prompt role pre-routes with sufficient confidence. The classifier model, fallback models, and
                        baseline model are configured <strong>per tenant</strong> (Tenants → Edit → Routing).
                      </Text>
                    </Alert>
                    <Alert color="gray" variant="light" p="xs">
                      <Text size="xs">
                        Context window sizes are read automatically from each classifier model's provider configuration.
                        Fallback classifiers with larger context windows are tried when the primary classifier fails.
                        Within a cost tier, the <strong>cheapest active model</strong> is selected automatically in balanced mode.
                      </Text>
                    </Alert>
                    <div>
                      <Group justify="space-between" mb={2}>
                        <Text size="sm">Confidence threshold to bypass classifier</Text>
                        <Text size="sm" fw={600}>{((selected.classifier?.confidenceThreshold ?? 0.65) * 100).toFixed(0)}%</Text>
                      </Group>
                      <Text size="xs" c="dimmed" mb={4}>Pre-routing signals (keyword rules, system prompt roles) must reach this confidence to skip the LLM classifier. Lower = more pre-routing (faster, cheaper). Higher = more classifier calls (more accurate).</Text>
                      <Slider
                        value={(selected.classifier?.confidenceThreshold ?? 0.65) * 100}
                        onChange={v => updateSelected('classifier.confidenceThreshold', v / 100)}
                        min={0} max={100} step={5} color="violet"
                        marks={[{ value: 50, label: '50%' }, { value: 65, label: '65%' }, { value: 80, label: '80%' }]}
                      />
                    </div>
                    <Select label="Context strategy" description="How request content is prepared for the classifier"
                      value={selected.classifier?.contextStrategy ?? 'truncate'}
                      onChange={v => updateSelected('classifier.contextStrategy', v)}
                      data={STRATEGIES} size="sm" />
                    <Text size="xs" c="dimmed">
                      <strong>truncate</strong> — include partial message content up to the model's context window (recommended)<br />
                      <strong>metadata_only</strong> — send only extracted signals, no message content — use for very small-context classifiers<br />
                      <strong>summary</strong> — falls back to truncate in the current version
                    </Text>

                    <Divider label="Cost Optimization Mode" labelPosition="center" />
                    <Select
                      label="Cost mode"
                      description="Controls the balance between cost savings and output quality — affects both tier selection and model ranking within tiers"
                      value={selected.costMode ?? 'balanced'}
                      onChange={v => updateSelected('costMode', v)}
                      size="sm"
                      data={[
                        { value: 'economy',  label: 'Economy — maximize savings, prefer cheapest models (-1 tier)' },
                        { value: 'balanced', label: 'Balanced — best price-performance ratio (default)' },
                        { value: 'quality',  label: 'Quality — maximize output quality, cost is secondary (+1 tier)' },
                      ]}
                    />
                    <NumberInput
                      label="Tier boost"
                      description="Additional tier offset applied after cost mode. Stacks with cost mode: e.g. Quality (+1) with Tier boost +1 = total +2 tiers."
                      value={selected.tierBoost ?? 0}
                      onChange={v => updateSelected('tierBoost', v)}
                      min={-2} max={2} step={1} size="sm"
                      styles={{ input: { width: 80 } }}
                    />
                  </Stack>
                </Tabs.Panel>

                {/* ── Benchmark tab ────────────────────────────────────── */}
                <Tabs.Panel value="benchmark" pt="md">
                  <Stack>
                    <Text size="sm" c="dimmed">
                      Simulates this rule set against historical auto-routed requests. No LLM calls are made —
                      simulation uses stored routing signals and token counts. Shows how tier distribution,
                      classifier call rate, and estimated costs would change.
                    </Text>
                    {!selected._id && (
                      <Alert color="orange" p="xs">Save the rule set before running a benchmark.</Alert>
                    )}
                    <Group>
                      <Select label="History window" value={benchDays} onChange={setBenchDays}
                        data={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }]}
                        size="sm" w={{ base: '100%', xs: 160 }} />
                      <NumberInput label="Max requests" value={benchLimit}
                        onChange={setBenchLimit} min={50} max={2000} step={100} size="sm" w={{ base: '100%', xs: 160 }} />
                      <Button mt="xl" onClick={runBenchmark} loading={benchRunning}
                        disabled={!selected._id} leftSection={<IconPlayerPlay size={14} />}>
                        Run Simulation
                      </Button>
                    </Group>

                    {benchResult && (
                      <Stack>
                        {benchResult.simulated === 0 ? (
                          <Alert color="blue" p="xs">{benchResult.message || 'No auto-routed requests found in this period. Route some requests with model=auto first.'}</Alert>
                        ) : (<>
                        <Group gap="xs">
                          <Badge size="sm" color="blue">{benchResult.simulated} requests simulated</Badge>
                          <Badge size="sm" color={benchResult.dataQuality === 'full' ? 'green' : 'yellow'}>
                            {benchResult.dataQuality === 'full' ? 'Full signal data' : 'Partial signal data'}
                          </Badge>
                          {benchResult.dataQuality === 'partial' && (
                            <Text size="xs" c="dimmed">
                              {benchResult.fullSignalRequests} with full signals, {benchResult.partialSignalRequests} token-only
                            </Text>
                          )}
                        </Group>

                        <SimpleGrid cols={2} spacing="sm">
                          {['current', 'proposed'].map(mode => (
                            <Paper key={mode} withBorder p="sm" radius="sm">
                              <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb="xs">
                                {mode === 'current' ? 'Current (baseline)' : 'Proposed (this rule set)'}
                              </Text>
                              <Stack gap={4}>
                                {TIERS.map(t => {
                                  const count = benchResult[mode]?.tierDistribution?.[t] || 0;
                                  const pct   = benchResult.simulated > 0 ? ((count / benchResult.simulated) * 100).toFixed(1) : '0';
                                  const diff  = mode === 'proposed'
                                    ? count - (benchResult.current?.tierDistribution?.[t] || 0) : 0;
                                  return (
                                    <Group key={t} justify="space-between">
                                      <Badge size="xs" color={TIER_COLORS[t]} w={70}>{t}</Badge>
                                      <Text size="xs">{count} ({pct}%)</Text>
                                      {mode === 'proposed' && diff !== 0 && (
                                        <Text size="xs" c={diff > 0 ? 'red' : 'green'} fw={600}>
                                          {diff > 0 ? '+' : ''}{diff}
                                        </Text>
                                      )}
                                    </Group>
                                  );
                                })}
                                <Divider />
                                <Group justify="space-between">
                                  <Text size="xs" c="dimmed">Classifier calls</Text>
                                  <Text size="xs">{(benchResult[mode]?.classifierCallRate * 100).toFixed(0)}%</Text>
                                </Group>
                                <Group justify="space-between">
                                  <Text size="xs" c="dimmed">Est. cost</Text>
                                  <Text size="xs">${benchResult[mode]?.estimatedCost?.toFixed(4)}</Text>
                                </Group>
                              </Stack>
                            </Paper>
                          ))}
                        </SimpleGrid>

                        <Paper withBorder p="sm" radius="sm" bg="dark.8">
                          <SimpleGrid cols={3} spacing="xs">
                            <div>
                              <Text size="xs" c="dimmed">Tier shifts</Text>
                              <Text fw={700}>{benchResult.diff.tierShifts}</Text>
                            </div>
                            <div>
                              <Text size="xs" c="dimmed">Classifier bypasses</Text>
                              <Text fw={700}>{benchResult.diff.classifierBypasses} ({benchResult.diff.classifierBypassRate})</Text>
                            </div>
                            <div>
                              <Text size="xs" c="dimmed">Cost delta</Text>
                              <Text fw={700} c={benchResult.diff.costDelta < 0 ? 'green' : 'red'}>
                                {benchResult.diff.costDelta >= 0 ? '+' : ''}${benchResult.diff.costDelta?.toFixed(4)}
                              </Text>
                            </div>
                          </SimpleGrid>
                        </Paper>

                        {benchResult.changes?.length > 0 && (
                          <div>
                            <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb="xs">
                              Changed Routing Decisions ({benchResult.changes.length})
                            </Text>
                            <ScrollArea h={280}>
                              <Table striped fz="xs">
                                <Table.Thead>
                                  <Table.Tr>
                                    <Table.Th>Tokens</Table.Th>
                                    <Table.Th>Category</Table.Th>
                                    <Table.Th>Current tier</Table.Th>
                                    <Table.Th>Proposed tier</Table.Th>
                                    <Table.Th>Signal</Table.Th>
                                    <Table.Th>Domain</Table.Th>
                                  </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                  {benchResult.changes.map((c, i) => (
                                    <Table.Tr key={i}>
                                      <Table.Td>{c.inputTokens?.toLocaleString()}</Table.Td>
                                      <Table.Td><Code style={{ fontSize: 10 }}>{c.category || '—'}</Code></Table.Td>
                                      <Table.Td><Badge size="xs" color={TIER_COLORS[c.currentTier]}>{c.currentTier}</Badge></Table.Td>
                                      <Table.Td><Badge size="xs" color={TIER_COLORS[c.proposedTier]}>{c.proposedTier}</Badge></Table.Td>
                                      <Table.Td><Text size="xs" c="dimmed">{c.signalSource || '—'}</Text></Table.Td>
                                      <Table.Td>{c.domain || '—'}</Table.Td>
                                    </Table.Tr>
                                  ))}
                                </Table.Tbody>
                              </Table>
                            </ScrollArea>
                          </div>
                        )}
                        </>)}
                      </Stack>
                    )}
                  </Stack>
                </Tabs.Panel>

                {/* ── Synthetic Tests tab ─────────────────────────────── */}
                <Tabs.Panel value="synthetic" pt="md">
                  <Stack>
                    <Text size="sm" c="dimmed">
                      Generate synthetic test prompts, run them through the routing pipeline, and evaluate the results
                      with AI-powered analysis and suggestions.
                    </Text>

                    {/* Create / select suite */}
                    <Group>
                      <TextInput placeholder="New test suite name…" value={synNewName} onChange={e => setSynNewName(e.target.value)}
                        size="sm" style={{ flex: 1 }} />
                      <Button size="sm" onClick={createSuite} disabled={!synNewName}>Create Suite</Button>
                    </Group>
                    {testSuites.length > 0 && (
                      <Group gap="xs" wrap="wrap">
                        {testSuites.map(s => (
                          <Paper key={s._id} p="xs" withBorder radius="sm"
                            style={{ cursor: 'pointer', borderColor: selectedSuite?._id === s._id ? 'var(--mantine-color-blue-6)' : undefined }}
                            onClick={() => { setSelectedSuite(s); setSelectedRun(null); loadRuns(s._id); }}>
                            <Group gap="xs">
                              <Text size="sm" fw={500}>{s.name}</Text>
                              <Badge size="xs">{s.testCases?.length || 0} tests</Badge>
                              <ActionIcon size="xs" color="red" variant="subtle" onClick={e => { e.stopPropagation(); deleteSuite(s._id); }}>
                                <IconTrash size={12} />
                              </ActionIcon>
                            </Group>
                          </Paper>
                        ))}
                      </Group>
                    )}

                    {selectedSuite && (<>
                      <Divider label={`Suite: ${selectedSuite.name}`} labelPosition="center" />

                      {/* Generate controls */}
                      <Group>
                        <Select label="Tenant" value={synTenantId} onChange={v => setSynTenantId(v)} data={tenants} size="sm" style={{ flex: 1 }} />
                        <MultiSelect label="Categories (optional)" value={synCategory} onChange={setSynCategory}
                          data={categories} size="sm" clearable searchable style={{ flex: 1 }}
                          description="Leave empty for all categories" />
                      </Group>
                      <Group>
                        <Select label="Model for generation" value={synGenModel} onChange={v => setSynGenModel(v)}
                          data={providerModels} size="sm" searchable style={{ flex: 1 }}
                          description="LLM used to generate test prompts" />
                        <NumberInput label="Count" value={synCount} onChange={v => setSynCount(v)} min={5} max={30} size="sm" w={80} />
                        <Button mt="xl" size="sm" onClick={generateTests} loading={synRunning === 'generate'} leftSection={<IconWand size={14} />}>
                          Generate Tests <Badge size="xs" color="grape" variant="light" ml={4}>AI</Badge>
                        </Button>
                      </Group>
                      <Group>
                        <Switch label="Use real classifier (costs tokens per test)" checked={synUseClassifier}
                          onChange={e => setSynUseClassifier(e.currentTarget.checked)} />
                        <Button size="sm" onClick={runSuite} loading={synRunning === 'run'} disabled={!selectedSuite.testCases?.length}
                          leftSection={<IconPlayerPlay size={14} />} color="green">
                          Run Suite {synUseClassifier && <Badge size="xs" color="yellow" variant="light" ml={4}>LLM</Badge>}
                        </Button>
                      </Group>

                      {/* Test cases */}
                      {selectedSuite.testCases?.length > 0 && (
                        <ScrollArea mah={400}>
                          <Table striped highlightOnHover withTableBorder size="xs">
                            <Table.Thead>
                              <Table.Tr>
                                <Table.Th>#</Table.Th>
                                <Table.Th>Prompt</Table.Th>
                                <Table.Th>Expected Category</Table.Th>
                                <Table.Th>Expected Tier</Table.Th>
                                <Table.Th>Tags</Table.Th>
                              </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                              {selectedSuite.testCases.map((tc, i) => (
                                <Table.Tr key={tc._id || i}>
                                  <Table.Td>{i + 1}</Table.Td>
                                  <Table.Td><Text size="xs" lineClamp={1}>{tc.prompt}</Text></Table.Td>
                                  <Table.Td><Code fz={10}>{tc.expectedCategory || '—'}</Code></Table.Td>
                                  <Table.Td>
                                    <Badge size="xs" color={TIER_COLORS[tc.expectedTierMin]}>{tc.expectedTierMin || '—'}</Badge>
                                    {tc.expectedTierMax && <Text span size="xs"> - {tc.expectedTierMax}</Text>}
                                  </Table.Td>
                                  <Table.Td><Group gap={2}>{tc.tags?.map(t => <Badge key={t} size="xs" variant="dot">{t}</Badge>)}</Group></Table.Td>
                                </Table.Tr>
                              ))}
                            </Table.Tbody>
                          </Table>
                        </ScrollArea>
                      )}

                      {/* Test runs */}
                      {testRuns.length > 0 && (<>
                        <Divider label="Test Runs" labelPosition="center" />
                        <Group gap="xs" wrap="wrap">
                          {testRuns.map(run => (
                            <Paper key={run._id} p="xs" withBorder radius="sm"
                              style={{ cursor: 'pointer', borderColor: selectedRun?._id === run._id ? 'var(--mantine-color-blue-6)' : undefined }}
                              onClick={() => setSelectedRun(run)}>
                              <Group gap="xs">
                                <Text size="xs">{new Date(run.createdAt).toLocaleString()}</Text>
                                <Badge size="xs" color={run.summary.tierMatches === run.summary.total ? 'green' : 'yellow'}>
                                  {run.summary.tierMatches}/{run.summary.total} tier
                                </Badge>
                                {run.evaluation?.score != null && (
                                  <Badge size="xs" color={run.evaluation.score >= 80 ? 'green' : run.evaluation.score >= 50 ? 'yellow' : 'red'}>
                                    Score: {run.evaluation.score}
                                  </Badge>
                                )}
                              </Group>
                            </Paper>
                          ))}
                        </Group>
                      </>)}

                      {/* Selected run results */}
                      {selectedRun && (<>
                        <Paper p="sm" withBorder>
                          <Group justify="space-between" mb="xs">
                            <Group gap="md">
                              <div><Text size="xs" c="dimmed">Tier Matches</Text><Text fw={700}>{selectedRun.summary.tierMatches}/{selectedRun.summary.total}</Text></div>
                              <div><Text size="xs" c="dimmed">Category Matches</Text><Text fw={700}>{selectedRun.summary.categoryMatches}/{selectedRun.summary.total}</Text></div>
                              <div><Text size="xs" c="dimmed">Avg Confidence</Text><Text fw={700}>{selectedRun.summary.avgConfidence?.toFixed(2)}</Text></div>
                              <div>
                                <Text size="xs" c="dimmed">Tier Distribution</Text>
                                <Group gap={4}>
                                  {Object.entries(selectedRun.summary.tierDistribution || {}).map(([t, n]) => (
                                    <Badge key={t} size="xs" color={TIER_COLORS[t]}>{t}: {n}</Badge>
                                  ))}
                                </Group>
                              </div>
                            </Group>
                            {!selectedRun.evaluation && (
                              <Group gap="xs">
                                <Select size="xs" value={synEvalModel} onChange={v => setSynEvalModel(v)}
                                  data={providerModels} searchable placeholder="Eval model" w={250} />
                                <Button size="xs" onClick={evaluateRun} loading={synRunning === 'evaluate'}
                                  leftSection={<IconWand size={14} />} variant="light">
                                  AI Evaluate <Badge size="xs" color="grape" variant="light" ml={4}>AI</Badge>
                                </Button>
                              </Group>
                            )}
                          </Group>

                          {/* Results table */}
                          <ScrollArea mah={400}>
                            <Table striped size="xs">
                              <Table.Thead>
                                <Table.Tr>
                                  <Table.Th></Table.Th>
                                  <Table.Th>Prompt</Table.Th>
                                  <Table.Th>Got</Table.Th>
                                  <Table.Th>Expected</Table.Th>
                                  <Table.Th>Category</Table.Th>
                                  <Table.Th>Conf</Table.Th>
                                  <Table.Th>Match</Table.Th>
                                </Table.Tr>
                              </Table.Thead>
                              <Table.Tbody>
                                {selectedRun.results?.map((r, i) => (<>
                                  <Table.Tr key={i} style={{ cursor: 'pointer', background: (!r.tierMatch || !r.categoryMatch) ? 'var(--mantine-color-red-light)' : undefined }}
                                    onClick={() => setExpandedResult(expandedResult === i ? null : i)}>
                                    <Table.Td>
                                      {expandedResult === i ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                                    </Table.Td>
                                    <Table.Td><Text size="xs" lineClamp={1} maw={200}>{r.prompt}</Text></Table.Td>
                                    <Table.Td>
                                      <Badge size="xs" color={TIER_COLORS[r.routedTier]}>{r.routedTier}</Badge>
                                    </Table.Td>
                                    <Table.Td>
                                      <Badge size="xs" variant="outline" color={TIER_COLORS[r.expectedTierMin]}>{r.expectedTierMin || '?'}{r.expectedTierMax ? `–${r.expectedTierMax}` : '+'}</Badge>
                                    </Table.Td>
                                    <Table.Td><Code fz={10}>{r.category || '—'}</Code></Table.Td>
                                    <Table.Td>{r.confidence?.toFixed(2)}</Table.Td>
                                    <Table.Td>
                                      {r.tierMatch && r.categoryMatch
                                        ? <Badge size="xs" color="green">OK</Badge>
                                        : <Badge size="xs" color="red">{!r.tierMatch && !r.categoryMatch ? 'Both' : !r.tierMatch ? 'Tier' : 'Cat'}</Badge>}
                                    </Table.Td>
                                  </Table.Tr>
                                  {expandedResult === i && (
                                    <Table.Tr key={`${i}-detail`} style={{ background: 'var(--prism-bg-hover)' }}>
                                      <Table.Td colSpan={7} py="xs" px="md">
                                        <Stack gap={6}>
                                          {/* Tier Progression */}
                                          {r.classifierTier && (
                                            <Paper p="xs" radius="sm" withBorder style={{ background: 'var(--prism-bg-input)' }}>
                                              <Text size="xs" fw={600} mb={4}>Tier Progression</Text>
                                              <Group gap="xs" wrap="wrap">
                                                <div style={{ textAlign: 'center' }}>
                                                  <Text size="xs" c="dimmed">Classifier</Text>
                                                  <Badge size="sm" color={TIER_COLORS[r.classifierTier]}>{r.classifierTier}</Badge>
                                                  {r.classifierModel && <Text size="xs" c="dimmed" mt={2}>{r.classifierModel}</Text>}
                                                </div>
                                                {r.afterOverrides !== r.classifierTier && (<>
                                                  <Text size="xs" c="dimmed">→</Text>
                                                  <div style={{ textAlign: 'center' }}>
                                                    <Text size="xs" c="dimmed">Overrides</Text>
                                                    <Badge size="sm" color={TIER_COLORS[r.afterOverrides]}>{r.afterOverrides}</Badge>
                                                  </div>
                                                </>)}
                                                {r.afterCostMode !== (r.afterOverrides || r.classifierTier) && (<>
                                                  <Text size="xs" c="dimmed">→</Text>
                                                  <div style={{ textAlign: 'center' }}>
                                                    <Text size="xs" c="dimmed">Quality</Text>
                                                    <Badge size="sm" color={TIER_COLORS[r.afterCostMode]}>{r.afterCostMode}</Badge>
                                                  </div>
                                                </>)}
                                                {r.finalTier !== r.classifierTier && (<>
                                                  <Text size="xs" c="dimmed">→</Text>
                                                  <div style={{ textAlign: 'center' }}>
                                                    <Text size="xs" c="dimmed">Final</Text>
                                                    <Badge size="sm" color={TIER_COLORS[r.finalTier]} variant="filled">{r.finalTier}</Badge>
                                                    {r.finalModel && <Text size="xs" c="dimmed" mt={2}>{r.finalModel}</Text>}
                                                  </div>
                                                </>)}
                                              </Group>
                                            </Paper>
                                          )}

                                          <Group gap="xs">
                                            <Text size="xs" c="dimmed" fw={600}>Method:</Text>
                                            <Code fz={10}>{r.selectionMethod}</Code>
                                            {r.routingMs > 0 && <><Text size="xs" c="dimmed" fw={600}>Time:</Text><Text size="xs">{r.routingMs}ms</Text></>}
                                          </Group>
                                          {r.reasoning && (
                                            <Text size="xs" c="dimmed" style={{ fontStyle: 'italic' }}>{r.reasoning}</Text>
                                          )}
                                          {r.trace?.length > 0 && (
                                            <Stack gap={2} mt={4}>
                                              {r.trace.map((t, ti) => (
                                                <Group key={ti} gap={4}>
                                                  <Badge size="xs" variant="light" color={t.changed ? 'green' : 'gray'} miw={24}>{t.step}</Badge>
                                                  <Text size="xs" fw={600} miw={80}>{t.name}</Text>
                                                  <Text size="xs" c="dimmed">{t.detail}</Text>
                                                </Group>
                                              ))}
                                            </Stack>
                                          )}
                                          {(!r.trace || r.trace.length === 0) && r.overrides && (
                                            <Text size="xs" c="dimmed">Overrides: {r.overrides}</Text>
                                          )}
                                        </Stack>
                                      </Table.Td>
                                    </Table.Tr>
                                  )}
                                </>))}
                              </Table.Tbody>
                            </Table>
                          </ScrollArea>

                          {/* AI Evaluation */}
                          {selectedRun.evaluation && (
                            <Stack gap="xs" mt="md">
                              <Divider label={`AI Evaluation (Score: ${selectedRun.evaluation.score}/100)`} labelPosition="center" />
                              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{selectedRun.evaluation.analysis}</Text>
                              {selectedRun.evaluation.qualitySuggestions?.length > 0 && (
                                <Alert color="blue" title="For better quality:" p="xs">
                                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                                    {selectedRun.evaluation.qualitySuggestions.map((s, i) => <li key={i}><Text size="xs">{s}</Text></li>)}
                                  </ul>
                                </Alert>
                              )}
                              {selectedRun.evaluation.costSuggestions?.length > 0 && (
                                <Alert color="green" title="To save costs:" p="xs">
                                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                                    {selectedRun.evaluation.costSuggestions.map((s, i) => <li key={i}><Text size="xs">{s}</Text></li>)}
                                  </ul>
                                </Alert>
                              )}
                            </Stack>
                          )}
                        </Paper>
                      </>)}
                    </>)}
                  </Stack>
                </Tabs.Panel>

                {/* ── Test Route tab ──────────────────────────────────── */}
                <Tabs.Panel value="test-route" pt="md">
                  <Stack>
                    <Text size="sm" c="dimmed">
                      Dry-run a prompt through the routing pipeline. See step-by-step which rules match,
                      what the classifier decides, and which model gets selected.
                    </Text>
                    <Textarea label="User prompt" placeholder="Write a thread-safe LRU cache in Python…" value={testPrompt}
                      onChange={e => setTestPrompt(e.target.value)} minRows={2} autosize />
                    <Textarea label="System prompt (optional)" placeholder="You are a senior software engineer…" value={testSystemPrompt}
                      onChange={e => setTestSystemPrompt(e.target.value)} minRows={1} autosize />
                    <Group>
                      <Select label="Tenant" value={testTenantId} onChange={v => setTestTenantId(v)}
                        data={tenants} size="sm" style={{ flex: 1 }} />
                      <Switch label="Call real classifier (costs tokens)" checked={testUseClassifier}
                        onChange={e => setTestUseClassifier(e.currentTarget.checked)} mt="xl" />
                      <Button onClick={runTestRoute} loading={testRunning} disabled={!testPrompt || !testTenantId}
                        leftSection={<IconPlayerPlay size={14} />} mt="xl">Run</Button>
                    </Group>

                    {testResult && (
                      <Stack gap="xs">
                        {/* Summary */}
                        <Paper p="xs" withBorder>
                          <Group gap="md">
                            <div><Text size="xs" c="dimmed">Model</Text><Text size="sm" fw={700}>{testResult.summary.finalModel}</Text></div>
                            <div><Text size="xs" c="dimmed">Tier</Text><Badge size="sm" color={TIER_COLORS[testResult.summary.finalTier]}>{testResult.summary.finalTier}</Badge></div>
                            <div><Text size="xs" c="dimmed">Category</Text><Badge size="sm" color="grape">{testResult.summary.category || '—'}</Badge></div>
                            <div><Text size="xs" c="dimmed">Confidence</Text><Text size="sm">{testResult.summary.confidence != null ? (testResult.summary.confidence * 100).toFixed(0) + '%' : '—'}</Text></div>
                            <div><Text size="xs" c="dimmed">Time</Text><Text size="sm">{testResult.summary.routingMs}ms</Text></div>
                            {testResult.summary.routingCostUsd > 0 && (
                              <div><Text size="xs" c="dimmed">Cost</Text><Text size="sm">${testResult.summary.routingCostUsd.toFixed(6)}</Text></div>
                            )}
                            <Button size="xs" variant="subtle" color="gray"
                              onClick={() => { navigator.clipboard.writeText(JSON.stringify(testResult, null, 2)); notifications.show({ message: 'Copied to clipboard', color: 'green' }); }}>
                              Copy JSON
                            </Button>
                          </Group>
                        </Paper>

                        {/* Trace steps */}
                        <Divider label="Routing Trace" labelPosition="center" />
                        {testResult.trace.map(t => (
                          <Paper key={t.step} p="xs" withBorder radius="sm"
                            style={{ borderLeftWidth: 3, borderLeftColor: t.changed ? 'var(--mantine-color-green-6)' : 'var(--prism-border)' }}>
                            <Group justify="space-between" mb={4}>
                              <Group gap="xs">
                                <Badge size="xs" variant="light" color={t.changed ? 'green' : 'gray'}>{t.step}</Badge>
                                <Text size="sm" fw={600}>{t.name}</Text>
                              </Group>
                              {t.changed != null && (
                                <Badge size="xs" color={t.changed ? 'green' : 'gray'} variant="light">
                                  {t.changed ? 'Changed' : 'No change'}
                                </Badge>
                              )}
                            </Group>
                            <Code block fz={10} style={{ whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto' }}>
                              {JSON.stringify(t.data, null, 2)}
                            </Code>
                          </Paper>
                        ))}
                      </Stack>
                    )}
                  </Stack>
                </Tabs.Panel>
              </Tabs>
            </Paper>
          ) : (
            <Center h={300}>
              <Text c="dimmed">Select a rule set or create a new one</Text>
            </Center>
          )}
        </div>
      </SimpleGrid>

      <KeywordRuleModal
        opened={kwModal.open}
        onClose={() => setKwModal({ open: false, idx: null })}
        initial={kwModal.idx !== null ? selected?.keywordRules?.[kwModal.idx] : null}
        onSave={saveKwRule}
      />
      <RoleModal
        opened={roleModal.open}
        onClose={() => setRoleModal({ open: false, idx: null })}
        initial={roleModal.idx !== null ? selected?.systemPromptRoles?.[roleModal.idx] : null}
        onSave={saveRoleRule}
      />
    </Stack>
  );
}
