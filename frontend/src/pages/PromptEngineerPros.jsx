import { useEffect, useState, useCallback } from 'react';
import {
  Title, Stack, Text, Badge, Group, Button, Modal, Paper,
  Alert, Progress, Loader, ActionIcon, ScrollArea, Code,
  Divider, Grid, RingProgress, Center, Table, Anchor,
  Collapse, Box, Tooltip, Select, MultiSelect, NumberInput, Switch, Pagination,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconBrain, IconRefresh, IconAlertTriangle, IconBulb, IconChartBar,
  IconChevronDown, IconChevronRight, IconExternalLink, IconSettings,
} from '@tabler/icons-react';
import api from '../hooks/useApi';
import ModelPrismLogo from '../components/ModelPrismLogo';

// ── Score helpers ─────────────────────────────────────────────────────────────
function scoreColor(v) {
  if (v >= 70) return 'green';
  if (v >= 45) return 'yellow';
  if (v >= 25) return 'orange';
  return 'red';
}

function ScoreBadge({ value }) {
  return (
    <Badge size="xs" color={scoreColor(value)} variant="light" style={{ fontVariantNumeric: 'tabular-nums', minWidth: 36 }}>
      {value}
    </Badge>
  );
}

// ── Score bar row (used in detail modal) ──────────────────────────────────────
function ScoreRow({ label, value, description }) {
  return (
    <div>
      <Group justify="space-between" mb={2}>
        <Tooltip label={description} withArrow>
          <Text size="xs" fw={500} style={{ cursor: 'default' }}>{label}</Text>
        </Tooltip>
        <Badge size="xs" color={scoreColor(value)} variant="light">{value}/100</Badge>
      </Group>
      <Progress value={value} color={scoreColor(value)} size="sm" radius="xl" />
    </div>
  );
}

// ── Detail modal ──────────────────────────────────────────────────────────────
const DIMS = [
  { key: 'specificity',      label: 'Specificity',       desc: 'How specific and actionable the request is' },
  { key: 'context',          label: 'Context',           desc: 'Does it provide necessary background (code, stack, error)?' },
  { key: 'outputDefinition', label: 'Output Definition', desc: 'Is the expected output/format/scope clear?' },
  { key: 'modelFit',         label: 'Model Fit',         desc: 'Is the complexity appropriate for the model used?' },
  { key: 'tokenEfficiency',  label: 'Token Efficiency',  desc: 'Is context size proportionate to the task?' },
];

function DetailModal({ result, rank, onClose }) {
  if (!result) return null;
  const ringColor = scoreColor(result.overall);
  return (
    <Modal opened onClose={onClose}
      title={<Group gap="xs"><Text fw={700}>Prompt #{rank} Analysis</Text><Badge color={ringColor} variant="light">Score {result.overall}/100</Badge></Group>}
      size="lg" radius="md" scrollAreaComponent={ScrollArea.Autosize}>
      <Stack gap="md">
        <Paper withBorder p="md" radius="md">
          <Grid>
            <Grid.Col span={3}>
              <Center h="100%">
                <RingProgress size={90} thickness={8} roundCaps
                  sections={[{ value: result.overall, color: ringColor }]}
                  label={<Center><Text size="sm" fw={700} c={ringColor}>{result.overall}</Text></Center>}
                />
              </Center>
            </Grid.Col>
            <Grid.Col span={9}>
              <Stack gap={8}>
                {DIMS.map(d => <ScoreRow key={d.key} label={d.label} value={result[d.key] ?? 50} description={d.desc} />)}
              </Stack>
            </Grid.Col>
          </Grid>
        </Paper>

        <div>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>User Message</Text>
          <Code block fz={11} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {result.promptExcerpt || '(not available)'}{result.promptExcerpt?.length >= 200 ? '\n[truncated]' : ''}
          </Code>
        </div>

        {result.issues?.length > 0 && (
          <div>
            <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={6}>Issues</Text>
            <Stack gap={6}>
              {result.issues.map((issue, i) => (
                <Group key={i} gap={8} wrap="nowrap" align="flex-start">
                  <IconAlertTriangle size={14} color="var(--mantine-color-red-5)" style={{ flexShrink: 0, marginTop: 1 }} />
                  <Text size="sm">{issue}</Text>
                </Group>
              ))}
            </Stack>
          </div>
        )}

        {result.suggestions?.length > 0 && (
          <div>
            <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={6}>How to Improve</Text>
            <Stack gap={6}>
              {result.suggestions.map((s, i) => (
                <Group key={i} gap={8} wrap="nowrap" align="flex-start">
                  <IconBulb size={14} color="var(--mantine-color-blue-5)" style={{ flexShrink: 0, marginTop: 1 }} />
                  <Text size="sm">{s}</Text>
                </Group>
              ))}
            </Stack>
          </div>
        )}

        <Divider />
        <Group gap="xs" wrap="wrap">
          <Badge size="xs" variant="outline">{result.routedModel || '—'}</Badge>
          {result.category && <Badge size="xs" color="grape" variant="light">{result.category}</Badge>}
          <Badge size="xs" color="gray" variant="light">{((result.inputTokens||0)+(result.outputTokens||0)).toLocaleString()} tokens</Badge>
          {result.costUsd > 0 && <Badge size="xs" color="teal" variant="light">${result.costUsd.toFixed(4)}</Badge>}
          <Text size="xs" c="dimmed">{result.tenant}</Text>
          <Text size="xs" c="dimmed">{result.timestamp ? new Date(result.timestamp).toLocaleString() : ''}</Text>
        </Group>
      </Stack>
    </Modal>
  );
}

// ── Expandable table row ──────────────────────────────────────────────────────
function PromptRow({ result, rank }) {
  const [open, setOpen] = useState(false);
  const tokens = (result.inputTokens || 0) + (result.outputTokens || 0);

  return (
    <>
      <Table.Tr
        style={{ cursor: 'pointer' }}
        onClick={() => setOpen(v => !v)}
      >
        <Table.Td py="xs" px="sm" style={{ width: 24 }}>
          {open
            ? <IconChevronDown size={13} style={{ opacity: .5 }} />
            : <IconChevronRight size={13} style={{ opacity: .35 }} />}
        </Table.Td>
        <Table.Td py="xs" style={{ maxWidth: 260 }}>
          <Text size="xs" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>
            {result.promptExcerpt || <Text span c="dimmed" fs="italic">—</Text>}
          </Text>
        </Table.Td>
        <Table.Td py="xs" ta="center"><ScoreBadge value={result.overall} /></Table.Td>
        <Table.Td py="xs" ta="center"><ScoreBadge value={result.specificity ?? 50} /></Table.Td>
        <Table.Td py="xs" ta="center"><ScoreBadge value={result.context ?? 50} /></Table.Td>
        <Table.Td py="xs" ta="center"><ScoreBadge value={result.outputDefinition ?? 50} /></Table.Td>
        <Table.Td py="xs" ta="center"><ScoreBadge value={result.modelFit ?? 50} /></Table.Td>
        <Table.Td py="xs" ta="center"><ScoreBadge value={result.tokenEfficiency ?? 50} /></Table.Td>
        <Table.Td py="xs" ta="right">
          <Text size="xs" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {tokens > 0 ? tokens.toLocaleString() : '—'}
          </Text>
        </Table.Td>
        <Table.Td py="xs" style={{ maxWidth: 160 }}>
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }}>
            {result.routedModel || '—'}
          </Text>
        </Table.Td>
        <Table.Td py="xs" ta="right">
          <Text size="xs" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {result.inputTokens > 0 ? `${Math.round(result.inputTokens / 1000)}k` : '—'}
          </Text>
        </Table.Td>
        <Table.Td py="xs" ta="right">
          <Text size="xs" c="teal" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {result.costUsd > 0 ? `$${result.costUsd.toFixed(4)}` : '—'}
          </Text>
        </Table.Td>
      </Table.Tr>

      <Table.Tr style={{ background: 'var(--prism-bg-input)' }}>
        <Table.Td colSpan={12} p={0} style={{ borderBottom: open ? undefined : 'none' }}>
          <Collapse in={open}>
            <Box px="md" py="sm">
              <Grid gutter="md">
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>Prompt</Text>
                  <Code block fz={10} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 100, overflow: 'auto' }}>
                    {result.promptExcerpt || '(not available)'}
                    {result.promptExcerpt?.length >= 200 ? '\n[truncated]' : ''}
                  </Code>
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 3 }}>
                  {result.issues?.length > 0 && (
                    <>
                      <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>Issues</Text>
                      <Stack gap={4}>
                        {result.issues.map((issue, i) => (
                          <Group key={i} gap={6} wrap="nowrap" align="flex-start">
                            <IconAlertTriangle size={11} color="var(--mantine-color-red-5)" style={{ flexShrink: 0, marginTop: 1 }} />
                            <Text size="xs">{issue}</Text>
                          </Group>
                        ))}
                      </Stack>
                    </>
                  )}
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 3 }}>
                  {result.suggestions?.length > 0 && (
                    <>
                      <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>Suggestions</Text>
                      <Stack gap={4}>
                        {result.suggestions.map((s, i) => (
                          <Group key={i} gap={6} wrap="nowrap" align="flex-start">
                            <IconBulb size={11} color="var(--mantine-color-blue-5)" style={{ flexShrink: 0, marginTop: 1 }} />
                            <Text size="xs">{s}</Text>
                          </Group>
                        ))}
                      </Stack>
                    </>
                  )}
                </Grid.Col>
              </Grid>
              <Group gap="xs" mt="xs" wrap="wrap">
                {result.category && <Badge size="xs" color="grape" variant="light">{result.category}</Badge>}
                <Text size="xs" c="dimmed">{result.tenant}</Text>
                <Text size="xs" c="dimmed">{result.timestamp ? new Date(result.timestamp).toLocaleString() : ''}</Text>
              </Group>
            </Box>
          </Collapse>
        </Table.Td>
      </Table.Tr>
    </>
  );
}

// ── Prompt table ──────────────────────────────────────────────────────────────
function PromptTable({ results }) {
  const TH = ({ children, ta = 'left' }) => (
    <Table.Th py="xs" ta={ta} style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--mantine-color-dimmed)', whiteSpace: 'nowrap' }}>
      {children}
    </Table.Th>
  );

  return (
    <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
      <ScrollArea>
        <Table highlightOnHover striped="odd" verticalSpacing={0} style={{ tableLayout: 'auto', minWidth: 900 }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: 24 }} />
              <TH>Prompt</TH>
              <TH ta="center">Score</TH>
              <TH ta="center">Spec.</TH>
              <TH ta="center">Context</TH>
              <TH ta="center">Output</TH>
              <TH ta="center">Model Fit</TH>
              <TH ta="center">Token Eff.</TH>
              <TH ta="right">Tokens</TH>
              <TH>Model</TH>
              <TH ta="right">Ctx Size</TH>
              <TH ta="right">Cost</TH>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {results.map((r, i) => (
              <PromptRow key={i} result={r} rank={i + 1} />
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Paper>
  );
}

// ── "How we rank" — ranking grid ─────────────────────────────────────────────
const RANK_DIMS = [
  {
    label: 'Specificity',
    desc: 'Is the request specific and actionable — or vague?',
    bad: '"write tests for my code"',
    good: '"Write Jest unit tests for UserService.create() — cover edge cases"',
  },
  {
    label: 'Context',
    desc: 'Does the prompt include necessary background: code, stack trace, error, file path?',
    bad: '"fix the bug"',
    good: '"Fix NullPointerException in Auth.java:42 — stack trace: …"',
  },
  {
    label: 'Output Definition',
    desc: 'Is the expected output format, scope, or success criteria stated?',
    bad: '"improve this"',
    good: '"Refactor for readability — keep public API, return TypeScript"',
  },
  {
    label: 'Model Fit',
    desc: 'Is the routed model appropriate for the task complexity?',
    bad: 'Simple autocomplete routed to an ultra-tier model',
    good: 'Architecture review → advanced tier; FIM → micro model',
  },
  {
    label: 'Token Efficiency',
    desc: 'Is context size proportionate to the task? Are sessions kept focused?',
    bad: '50-turn session accumulated just to ask one simple question',
    good: 'New topic = new session; only relevant context included',
  },
];

function HowWeRank() {
  return (
    <Paper withBorder radius="md" p="lg">
      <Stack gap="md">
        <div>
          <Text fw={700} size="sm">How we score prompts</Text>
          <Text size="xs" c="dimmed" mt={2}>
            Each prompt is scored across five dimensions by an LLM (0–100 per dimension).
            The overall score is the average — lower scores indicate more room to improve.
          </Text>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
          {RANK_DIMS.map(d => (
            <Tooltip key={d.label} multiline maw={280} withArrow
              label={
                <Stack gap={4}>
                  <Text size="xs" fw={600}>{d.desc}</Text>
                  <Text size="xs" c="red.3">✗ {d.bad}</Text>
                  <Text size="xs" c="green.3">✓ {d.good}</Text>
                </Stack>
              }>
              <Paper withBorder p="sm" radius="sm" style={{ cursor: 'default' }}>
                <Text size="xs" fw={600} mb={2}>{d.label}</Text>
                <Text size="xs" c="dimmed" lineClamp={2}>{d.desc}</Text>
              </Paper>
            </Tooltip>
          ))}
        </div>
        <Text size="xs" c="dimmed">Hover any dimension for examples</Text>
      </Stack>
    </Paper>
  );
}

// ── Cost insight ──────────────────────────────────────────────────────────────
function CostInsight({ results }) {
  if (!results?.length) return null;
  const totalCost   = results.reduce((s, r) => s + (r.costUsd || 0), 0);
  const totalTokens = results.reduce((s, r) => s + (r.inputTokens || 0) + (r.outputTokens || 0), 0);
  const poorCost    = results.filter(r => r.overall < 50).reduce((s, r) => s + (r.costUsd || 0), 0);
  if (totalCost === 0) return null;
  const pct = Math.round((poorCost / totalCost) * 100);
  return (
    <Alert color="blue" variant="light" radius="md">
      <Group gap="md" wrap="wrap" justify="center">
        <Text size="sm">
          <strong>{pct}%</strong> of analyzed spend (${poorCost.toFixed(4)}) came from prompts
          scoring below 50/100. Better prompts → smaller context → cheaper models → lower costs.
        </Text>
        <Text size="xs" c="dimmed">{totalTokens.toLocaleString()} tokens across {results.length} prompts</Text>
      </Group>
    </Alert>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
function StatsBar({ results }) {
  if (!results?.length) return null;
  const avg  = Math.round(results.reduce((s, r) => s + r.overall, 0) / results.length);
  const bad  = results.filter(r => r.overall < 40).length;
  const ok   = results.filter(r => r.overall >= 40 && r.overall < 70).length;
  const good = results.filter(r => r.overall >= 70).length;
  return (
    <Group gap="md" wrap="wrap">
      {[
        { label: 'Avg Score', value: `${avg}/100`, color: scoreColor(avg) },
        { label: 'Critical',  value: bad,          color: 'red' },
        { label: 'Mediocre',  value: ok,           color: 'yellow' },
        { label: 'Good',      value: good,         color: 'green' },
      ].map(({ label, value, color }) => (
        <Paper key={label} withBorder p="xs" radius="md" style={{ minWidth: 90 }}>
          <Text size="xs" c="dimmed">{label}</Text>
          <Text fw={700} c={color}>{value}</Text>
        </Paper>
      ))}
    </Group>
  );
}

// ── Settings Modal ────────────────────────────────────────────────────────────
function PromptAnalysesSettingsModal({ opened, onClose }) {
  const [cfg, setCfg]           = useState(null);
  const [saving, setSaving]     = useState(false);
  const [providers, setProviders] = useState([]);
  const [models, setModels]     = useState([]);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    if (!opened) return;
    api.get('/api/prism/admin/prompt-engineer/settings').then(r => setCfg(r.data)).catch(() => {});
    api.get('/api/prism/admin/providers').then(r => {
      setProviders((r.data || []).filter(p => p.status === 'connected' || p.discoveredModels?.length > 0));
    }).catch(() => {});
    api.get('/api/prism/admin/categories').then(r => {
      setCategories((r.data || []).map(c => ({ value: c.key, label: c.name || c.key })));
    }).catch(() => {});
  }, [opened]);

  useEffect(() => {
    if (!cfg?.providerId || !providers.length) { setModels([]); return; }
    const p = providers.find(p => p._id === cfg.providerId);
    setModels((p?.discoveredModels || []).filter(m => m.visible !== false).map(m => ({ value: m.id, label: m.name || m.id })));
  }, [cfg?.providerId, providers]);

  async function save() {
    setSaving(true);
    try {
      await api.put('/api/prism/admin/prompt-engineer/settings', cfg);
      notifications.show({ message: 'Settings saved', color: 'green' });
      onClose();
    } catch {
      notifications.show({ message: 'Failed to save', color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Prompt Analyses Settings" size="md">
      {!cfg ? <Loader size="sm" /> : (
        <Stack gap="sm">
          <Switch label="Enable Prompt Analyses" checked={cfg.enabled ?? false}
            onChange={e => setCfg(p => ({ ...p, enabled: e.currentTarget.checked }))} />
          {cfg.enabled && (<>
            <Divider label="LLM Engine" labelPosition="left" />
            <Group gap="sm" wrap="wrap" align="flex-end">
              <Select label="Provider" placeholder="Select provider…" size="sm" w={200}
                data={providers.map(p => ({ value: p._id, label: p.name }))}
                value={cfg.providerId || null}
                onChange={v => setCfg(p => ({ ...p, providerId: v || '', model: '' }))}
                clearable />
              <Select label="Model" size="sm" style={{ flex: 1 }}
                placeholder={cfg.providerId ? (models.length ? 'Select model…' : 'No models discovered') : 'Select provider first'}
                data={models} value={cfg.model || null}
                onChange={v => setCfg(p => ({ ...p, model: v || '' }))}
                searchable disabled={!cfg.providerId || models.length === 0} />
            </Group>
            <Divider label="Scope" labelPosition="left" />
            <Group gap="sm" wrap="wrap" align="flex-end">
              <NumberInput label="Max prompts" description="0 = all" size="sm" w={140}
                value={cfg.maxPrompts ?? 100} onChange={v => setCfg(p => ({ ...p, maxPrompts: v }))}
                min={0} max={2000} step={10} />
              <NumberInput label="Min prompt length" description="Skip shorter prompts (chars)" size="sm" w={180}
                value={cfg.minPromptLength ?? 20} onChange={v => setCfg(p => ({ ...p, minPromptLength: v }))}
                min={0} max={500} step={5} />
              <MultiSelect label="Ignore categories" placeholder="Select categories…" size="sm" style={{ flex: 1 }}
                data={categories} value={cfg.ignoredCategories || []}
                onChange={v => setCfg(p => ({ ...p, ignoredCategories: v }))}
                searchable clearable />
            </Group>
            <Divider label="Automation" labelPosition="left" />
            <Switch label="Auto-analyze new prompts (hourly)"
              description="Automatically analyzes new human prompts every hour. Uses the configured provider and model — this will incur LLM costs."
              checked={cfg.autoAnalyze ?? false}
              onChange={e => setCfg(p => ({ ...p, autoAnalyze: e.currentTarget.checked }))} />
          </>)}
          <Group justify="flex-end" mt="xs">
            <Button variant="subtle" onClick={onClose}>Cancel</Button>
            <Button onClick={save} loading={saving}>Save</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

// ── Preview / confirm modal ───────────────────────────────────────────────────
function AnalyzeConfirmModal({ opened, onClose, onConfirm }) {
  const [preview, setPreview]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const [resetMode, setResetMode] = useState(false);

  useEffect(() => {
    if (!opened) { setPreview(null); setResetMode(false); return; }
    setLoading(true);
    api.get(`/api/prism/admin/prompt-engineer/preview?reset=${resetMode}`)
      .then(r => setPreview(r.data))
      .catch(() => setPreview(null))
      .finally(() => setLoading(false));
  }, [opened, resetMode]);

  return (
    <Modal opened={opened} onClose={onClose} title="Confirm Analysis Run" size="sm" radius="md">
      {loading || !preview ? <Stack align="center" py="md"><Loader size="sm" /></Stack> : (
        <Stack gap="sm">
          {preview.enabled === false ? (
            <Alert color="yellow" variant="light">Prompt Analyses is disabled. Enable it in ⚙ Settings first.</Alert>
          ) : (
            <>
              <Paper withBorder p="sm" radius="sm">
                <Stack gap={4}>
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">Prompts to analyze</Text>
                    <Text size="sm" fw={600}>{preview.count?.toLocaleString()}</Text>
                  </Group>
                  {preview.alreadyAnalyzed > 0 && !resetMode && (
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">Skipping already-analyzed</Text>
                      <Badge size="xs" color="gray" variant="light">{preview.alreadyAnalyzed}</Badge>
                    </Group>
                  )}
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">Est. input tokens</Text>
                    <Text size="sm">{preview.estimatedInputTokens?.toLocaleString()}</Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">Est. output tokens</Text>
                    <Text size="sm">{preview.estimatedOutputTokens?.toLocaleString()}</Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">Est. cost</Text>
                    <Text size="sm" fw={600} c="teal">${preview.estimatedCost}</Text>
                  </Group>
                  <Text size="xs" c="dimmed">Model: {preview.model}</Text>
                </Stack>
              </Paper>
              {preview.alreadyAnalyzed > 0 && (
                <Switch size="sm"
                  label={`Re-analyze all (including ${preview.alreadyAnalyzed} already done)`}
                  checked={resetMode}
                  onChange={e => setResetMode(e.currentTarget.checked)} />
              )}
              <Group justify="flex-end" mt="xs">
                <Button variant="subtle" onClick={onClose}>Cancel</Button>
                <Button color="blue" onClick={() => onConfirm(resetMode)} disabled={preview.count === 0}>
                  {resetMode ? 'Re-analyze All' : 'Analyze New'}
                </Button>
              </Group>
            </>
          )}
        </Stack>
      )}
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PromptEngineerPros() {
  const [results, setResults]     = useState(null);
  const [meta, setMeta]           = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(null);
  const [publicEndpoint, setPublicEndpoint] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen]   = useState(false);
  const [enabled, setEnabled]           = useState(true);
  const [page, setPage]               = useState(1);
  const [pages, setPages]             = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [progress, setProgress]       = useState(null);

  const loadResults = useCallback(async (p = page) => {
    try {
      const { data } = await api.get(`/api/prism/admin/prompt-engineer/results?page=${p}&limit=50`);
      if (data) {
        setResults(data.results || []);
        setMeta({ createdAt: data.createdAt, model: data.model, analyzed: data.analyzed, analyzedThisRun: data.analyzedThisRun, failed: data.failed, skipped: data.skipped });
        setPages(data.pages || 1);
        setTotalResults(data.total || 0);
      }
    } catch {}
    setLoading(false);
  }, [page]);

  useEffect(() => { loadResults(page); }, [page]);

  useEffect(() => {
    loadResults();
    api.get('/api/prism/admin/prompt-engineer/settings')
      .then(r => {
        setPublicEndpoint(r.data?.publicEndpoint === true);
        setEnabled(r.data?.enabled !== false);
      })
      .catch(() => {});
  }, []);

  // Poll progress while analysis is running
  useEffect(() => {
    if (!analyzing) { setProgress(null); return; }
    const iv = setInterval(async () => {
      try {
        const { data } = await api.get('/api/prism/admin/prompt-engineer/progress');
        setProgress(data);
        if (!data.running) {
          setAnalyzing(false);
          loadResults();
        } else {
          // Refresh results to show incremental progress
          loadResults();
        }
      } catch {}
    }, 5000);
    return () => clearInterval(iv);
  }, [analyzing]);

  async function triggerAnalysis(reset = false) {
    setConfirmOpen(false);
    setAnalyzing(true);
    setPage(1);
    try {
      await api.post('/api/prism/admin/prompt-engineer/analyze', { reset });
      notifications.show({ message: 'Analysis started — results appear as batches complete', color: 'blue' });
    } catch (err) {
      notifications.show({ message: err.response?.data?.error || 'Analysis failed', color: 'red' });
      setAnalyzing(false);
    }
  }

  if (loading) return <Stack align="center" mt="xl"><Loader /></Stack>;

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Title order={2}>Prompt Analyses</Title>
          <Badge color="blue" variant="light" size="sm" tt="uppercase" fw={700}>AI</Badge>
        </Group>
        <Group gap="xs">
          <ActionIcon variant="subtle" onClick={loadResults} title="Refresh">
            <IconRefresh size={16} />
          </ActionIcon>
          <ActionIcon variant="subtle" onClick={() => setSettingsOpen(true)} title="Settings">
            <IconSettings size={16} />
          </ActionIcon>
          <Button leftSection={<IconBrain size={16} />} onClick={() => setConfirmOpen(true)}
            loading={analyzing} color="blue" size="sm" disabled={!enabled}>
            Analyze Prompts
          </Button>
        </Group>
      </Group>

      <Text c="dimmed" size="sm">
        LLM-powered quality scoring of recent user prompts — identifies patterns that inflate cost or
        reduce response quality. Use the gear icon to configure provider, model, and scope.
      </Text>

      {!enabled && (
        <Alert color="yellow" variant="light" icon={<IconSettings size={16} />}>
          <Text size="sm">
            Prompt Analyses is <strong>disabled by default</strong>. Open <strong>⚙ Settings</strong> to enable it,
            select an LLM provider and model, and start analyzing prompts.
          </Text>
        </Alert>
      )}

      <HowWeRank />

      {results?.length > 0 && (
        <>
          <StatsBar results={results} />
          {meta && (
            <Text size="xs" c="dimmed">
              Last analysis: {meta.createdAt ? new Date(meta.createdAt).toLocaleString() : '—'}
              {' · '}{meta.analyzedThisRun != null ? `${meta.analyzedThisRun} new` : meta.analyzed} analyzed
              {meta.analyzedThisRun != null && meta.analyzed !== meta.analyzedThisRun ? `, ${meta.analyzed} total` : ''}
              {meta.failed > 0 ? `, ${meta.failed} failed` : ''}
              {meta.model ? ` · ${meta.model}` : ''}
            </Text>
          )}
        </>
      )}

      {analyzing && progress && (
        <Paper withBorder p="sm" radius="md">
          <Group justify="space-between" mb={4}>
            <Text size="xs" fw={500}>Analyzing prompts…</Text>
            <Text size="xs" c="dimmed">{progress.done} / {progress.total}</Text>
          </Group>
          <Progress value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0} size="sm" color="blue" radius="xl" animated />
          {progress.failed > 0 && <Text size="xs" c="red" mt={4}>{progress.failed} failed</Text>}
        </Paper>
      )}

      {results?.length > 0 && <CostInsight results={results} />}

      {results?.length > 0 ? (
        <>
          <PromptTable results={results} />
          {pages > 1 && (
            <Group justify="center">
              <Pagination value={page} onChange={setPage} total={pages} size="sm" />
              <Text size="xs" c="dimmed">{totalResults} results</Text>
            </Group>
          )}
        </>
      ) : (
        <Alert color="blue" variant="light" icon={<IconChartBar size={16} />}>
          <Text size="sm">
            No results yet. Click <strong>Analyze Prompts</strong> to run the first analysis.
            Make sure prompt logging is enabled in <strong>Settings → Log & Observability</strong>.
          </Text>
        </Alert>
      )}

      {selected && (
        <DetailModal result={selected.result} rank={selected.rank} onClose={() => setSelected(null)} />
      )}
      <AnalyzeConfirmModal
        opened={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={triggerAnalysis}
      />
      <PromptAnalysesSettingsModal
        opened={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          api.get('/api/prism/admin/prompt-engineer/settings').then(r => {
            setPublicEndpoint(r.data?.publicEndpoint === true);
            setEnabled(r.data?.enabled !== false);
          }).catch(() => {});
        }}
      />
    </Stack>
  );
}
