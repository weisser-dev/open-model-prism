import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Title, Paper, Table, Stack, Badge, Text, Group, Pagination, Tooltip,
  Select, SegmentedControl, Accordion, Switch, TextInput, NumberInput,
  Divider, ActionIcon, Collapse, Box, Alert, Code, ScrollArea, Button,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle, IconArrowsExchange, IconFilter, IconSettings,
  IconChevronDown, IconChevronRight, IconFileText, IconRefresh,
} from '@tabler/icons-react';
import api from '../hooks/useApi';
import PollBar, { useAutoRefresh } from '../components/PollBar';

const TIER_COLORS = { micro: 'grape', minimal: 'teal', low: 'blue', medium: 'yellow', advanced: 'cyan', high: 'red', ultra: 'pink', critical: 'orange' };

// ── Routing debug panel ──────────────────────────────────────────────────────
function RoutingDetailsPanel({ r }) {
  const sig = r.routingSignals;
  if (!r.isAutoRouted && !sig) return null;

  const overrides = r.overrideApplied ? r.overrideApplied.split('+').filter(Boolean) : [];

  return (
    <Paper p="xs" radius="sm" withBorder style={{ background: 'var(--prism-bg-input)' }}>
      <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb={6}>Routing Details</Text>
      <Group gap="lg" align="flex-start" wrap="wrap">
        {/* Signals */}
        <div style={{ minWidth: 160 }}>
          <Text size="xs" fw={600} mb={2}>Signals</Text>
          <Group gap={4} wrap="wrap">
            {sig?.totalTokens != null && <Badge size="xs" variant="light">{sig.totalTokens} tok</Badge>}
            {sig?.hasImages && <Badge size="xs" color="violet" variant="light">Images</Badge>}
            {sig?.hasToolCalls && <Badge size="xs" color="orange" variant="light">Tool Calls</Badge>}
            {sig?.isFimRequest && <Badge size="xs" color="grape" variant="light">FIM</Badge>}
            {sig?.isToolAgentRequest && <Badge size="xs" color="indigo" variant="light">Tool Agent</Badge>}
            {sig?.conversationTurns > 1 && <Badge size="xs" variant="light">{sig.conversationTurns} turns</Badge>}
            {sig?.detectedDomains?.map(d => <Badge key={d} size="xs" color="teal" variant="dot">{d}</Badge>)}
            {sig?.detectedLanguages?.map(l => <Badge key={l} size="xs" color="cyan" variant="dot">{l}</Badge>)}
          </Group>
        </div>

        {/* Pre-routing */}
        <div style={{ minWidth: 120 }}>
          <Text size="xs" fw={600} mb={2}>Pre-Routing</Text>
          <Badge size="xs" color={sig?.preRouted ? 'green' : 'gray'} variant="light">
            {sig?.preRouted ? 'Yes' : 'Classifier'}
          </Badge>
          {sig?.signalSource && <Text size="xs" c="dimmed" mt={2}>{sig.signalSource}</Text>}
          {sig?.prevSessionFillPct != null && (
            <Text size="xs" c="dimmed" mt={2}>Session fill: {Math.round(sig.prevSessionFillPct * 100)}%</Text>
          )}
        </div>

        {/* Classification */}
        <div style={{ minWidth: 140 }}>
          <Text size="xs" fw={600} mb={2}>Classification</Text>
          <Group gap={4} wrap="wrap">
            {r.category && <Badge size="xs" color="grape">{r.category}</Badge>}
            {r.costTier && <Badge size="xs" color={TIER_COLORS[r.costTier] || 'gray'}>{r.costTier}</Badge>}
            {r.complexity && <Badge size="xs" variant="outline">{r.complexity}</Badge>}
          </Group>
          {r.confidence != null && (
            <Group gap={4} mt={4}>
              <div style={{ flex: 1, height: 4, background: 'var(--prism-border)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${Math.round(r.confidence * 100)}%`, height: '100%', background: r.confidence > 0.8 ? 'var(--mantine-color-green-6)' : r.confidence > 0.5 ? 'var(--mantine-color-yellow-6)' : 'var(--mantine-color-red-6)' }} />
              </div>
              <Text size="xs" c="dimmed">{(r.confidence * 100).toFixed(0)}%</Text>
            </Group>
          )}
        </div>

        {/* Overrides */}
        <div style={{ minWidth: 120 }}>
          <Text size="xs" fw={600} mb={2}>Overrides</Text>
          {overrides.length ? (
            <Group gap={4} wrap="wrap">
              {overrides.map(o => <Badge key={o} size="xs" color="orange" variant="light">{o}</Badge>)}
            </Group>
          ) : <Text size="xs" c="dimmed">None</Text>}
        </div>

        {/* Result */}
        <div style={{ minWidth: 120 }}>
          <Text size="xs" fw={600} mb={2}>Result</Text>
          <Text size="xs">{r.routedModel}</Text>
          {r.routingMs != null && <Text size="xs" c="dimmed">{r.routingMs}ms</Text>}
          {r.routingCostUsd > 0 && <Text size="xs" c="dimmed">${r.routingCostUsd.toFixed(6)}</Text>}
        </div>
      </Group>
    </Paper>
  );
}

// ── Expanded prompt row ───────────────────────────────────────────────────────
// ── Single collapsible message row ───────────────────────────────────────────
function MessageRow({ m, index }) {
  const [open, setOpen] = useState(false);
  const preview = (m.content || '').replace(/\s+/g, ' ').slice(0, 100);
  const roleColor = m.role === 'user' ? 'blue' : m.role === 'system' ? 'violet' : m.role === 'tool' ? 'orange' : 'gray';
  return (
    <>
      <Table.Tr style={{ cursor: 'pointer' }} onClick={() => setOpen(v => !v)}>
        <Table.Td py={4} px="xs" style={{ width: 18 }}>
          {open ? <IconChevronDown size={11} style={{ opacity: .4 }} /> : <IconChevronRight size={11} style={{ opacity: .25 }} />}
        </Table.Td>
        <Table.Td py={4} style={{ width: 28 }}>
          <Text size="xs" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>{index + 1}</Text>
        </Table.Td>
        <Table.Td py={4} style={{ width: 64 }}>
          <Badge size="xs" color={roleColor} variant="light">{m.role}</Badge>
        </Table.Td>
        <Table.Td py={4}>
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 500 }}>
            {preview}{(m.content || '').length > 100 ? '…' : ''}
          </Text>
        </Table.Td>
        <Table.Td py={4} ta="right" style={{ width: 50 }}>
          <Text size="xs" c="dimmed">{(m.content || '').length} ch</Text>
        </Table.Td>
      </Table.Tr>
      <Table.Tr style={{ background: 'var(--prism-bg-input)' }}>
        <Table.Td colSpan={5} p={0} style={{ borderBottom: open ? undefined : 'none' }}>
          <Collapse in={open}>
            <Box px="sm" py="xs">
              <ScrollArea mah={240} style={{ overflowY: 'auto' }}>
                <Text size="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace' }}>
                  {m.content}
                </Text>
              </ScrollArea>
            </Box>
          </Collapse>
        </Table.Td>
      </Table.Tr>
    </>
  );
}

function PromptRow({ r, colSpan }) {
  const snap = r.promptSnapshot;
  const resp = r.responseSnapshot?.content ? r.responseSnapshot : null;
  const hasError = r.status === 'error' && (r.errorMessage || r.errorType);
  const hasFallback = r.handledFallback && r.fallbackDetail;
  const paths = r.capturedPaths?.length ? r.capturedPaths : null;
  const hasRouting = r.isAutoRouted || r.routingSignals;

  if (!snap && !resp && !hasError && !hasFallback && !paths && !hasRouting) {
    return (
      <Table.Tr style={{ background: 'var(--prism-bg-hover)' }}>
        <Table.Td colSpan={colSpan} py="xs" px="md">
          <Text size="xs" c="dimmed" fs="italic">
            No details available — enable prompt logging and path capture in{' '}
            <strong>Settings → Log &amp; Observability</strong> to capture prompt content for this request.
          </Text>
        </Table.Td>
      </Table.Tr>
    );
  }

  return (
    <Table.Tr style={{ background: 'var(--prism-bg-hover)' }}>
      <Table.Td colSpan={colSpan} py="xs" px="md">
        <Stack gap="xs">
          {hasRouting && <RoutingDetailsPanel r={r} />}

          {hasFallback && (
            <Alert color="yellow" variant="light" title="Error handled via fallback" p="xs"
              icon={<IconArrowsExchange size={14} />}>
              <Stack gap={4}>
                <Text size="xs">{r.fallbackDetail}</Text>
                {r.fallbackType && (
                  <Badge size="xs" color="yellow" variant="light">{r.fallbackType.replace('_', ' ')}</Badge>
                )}
                {r.requestedModel !== r.routedModel && (
                  <Group gap={4}>
                    <Text size="xs" c="dimmed">requested:</Text>
                    <Badge size="xs" variant="outline">{r.requestedModel}</Badge>
                    <Text size="xs" c="dimmed">served by:</Text>
                    <Badge size="xs" color="yellow" variant="outline">{r.routedModel}</Badge>
                  </Group>
                )}
              </Stack>
            </Alert>
          )}

          {hasError && (
            <Alert color="red" title={r.errorType || 'Error'} p="xs">
              <Stack gap={4}>
                {/* Show routed model if known (non-'none') */}
                {r.routedModel && r.routedModel !== 'none' && (
                  <Group gap={6}>
                    <Text size="xs" c="dimmed">Routed to:</Text>
                    <Badge size="xs" color="red" variant="outline">{r.routedModel}</Badge>
                  </Group>
                )}
                {/* Show classifier result if available */}
                {(r.category || r.confidence != null) && (
                  <Group gap={6}>
                    {r.category && <Badge size="xs" color="grape" variant="light">{r.category}</Badge>}
                    {r.confidence != null && <Text size="xs" c="dimmed">confidence: {Math.round(r.confidence * 100)}%</Text>}
                  </Group>
                )}
                <Text size="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {r.errorMessage}
                </Text>
              </Stack>
            </Alert>
          )}

          {paths && (
            <div>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={2}>Captured Paths ({paths.length})</Text>
              <ScrollArea mah={160}>
                <Group gap={4} wrap="wrap">
                  {paths.map((p, i) => (
                    <Code key={i} fz={10} style={{ wordBreak: 'break-all' }}>{p}</Code>
                  ))}
                </Group>
              </ScrollArea>
            </div>
          )}

          {snap?.systemPrompt && (
            <div>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={2}>System Prompt</Text>
              <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--prism-border)', borderRadius: 4 }}>
                <Text size="xs" p="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace' }}>
                  {snap.systemPrompt}
                </Text>
              </div>
            </div>
          )}

          {snap?.messages?.length ? (
            <div>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>
                Messages ({snap.messages.length}{snap.messageCount > snap.messages.length ? ` of ${snap.messageCount}` : ''})
              </Text>
              <Paper withBorder radius="sm" style={{ overflow: 'hidden' }}>
                <ScrollArea mah={360}>
                  <Table verticalSpacing={0} style={{ tableLayout: 'fixed', width: '100%' }}>
                    <Table.Tbody>
                      {snap.messages.map((m, i) => <MessageRow key={i} m={m} index={i} />)}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </Paper>
            </div>
          ) : snap?.lastUserMessage ? (
            <div>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={2}>Last User Message</Text>
              <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--prism-border)', borderRadius: 4 }}>
                <Text size="xs" p="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace' }}>
                  {snap.lastUserMessage}
                </Text>
              </div>
            </div>
          ) : null}

          {resp && (
            <div>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={2}>
                Response{resp.finishReason ? ` (${resp.finishReason})` : ''}
              </Text>
              <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--prism-border)', borderRadius: 4 }}>
                <Text size="xs" p="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace' }}>
                  {resp.content}
                </Text>
              </div>
            </div>
          )}
        </Stack>
      </Table.Td>
    </Table.Tr>
  );
}

// ── Log config panel (admin only) ─────────────────────────────────────────────
const FILE_LOGGING_DEFAULTS = {
  enabled: false,
  directory: '/var/log/open-model-prism',
  maxSizeMb: 100,
  maxFiles: 7,
  includePrompts: false,
};

function LogConfigPanel({ isAdmin }) {
  const [cfg, setCfg]     = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/api/prism/admin/system/log-config').then(r => {
      const d = r.data;
      // Ensure fileLogging always has all defaults (old documents may be missing fields)
      d.fileLogging = { ...FILE_LOGGING_DEFAULTS, ...(d.fileLogging || {}) };
      setCfg(d);
    }).catch(() => {});
  }, []);

  async function save(patch) {
    const next = { ...cfg, ...patch };
    // Ensure fileLogging is always a complete object
    if (next.fileLogging) {
      next.fileLogging = { ...FILE_LOGGING_DEFAULTS, ...next.fileLogging };
    }
    setCfg(next);
    setSaving(true);
    try {
      const { data } = await api.put('/api/prism/admin/system/log-config', next);
      data.fileLogging = { ...FILE_LOGGING_DEFAULTS, ...(data.fileLogging || {}) };
      setCfg(data);
    } finally {
      setSaving(false);
    }
  }

  if (!isAdmin || !cfg) return null;

  return (
    <Accordion variant="contained" radius="md">
      <Accordion.Item value="log-config">
        <Accordion.Control icon={<IconSettings size={16} />}>
          Logging Configuration
          {saving && <Text size="xs" c="dimmed" ml="xs" component="span">saving…</Text>}
        </Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
            <Alert color="blue" p="xs">
              <Text size="xs">
                Changes take effect immediately across all pods. Prompt data stored in the database
                is visible in expanded rows. File logs are written to disk for offline analysis
                (e.g. detecting agent usage patterns, auditing traffic per tenant).
              </Text>
            </Alert>

            <Divider label="Prompt Capture" labelPosition="left" />
            <Group align="flex-start" gap="xl">
              <Switch
                label="Store prompt content in database"
                description="Captures message content in request logs. Increases DB storage per request."
                checked={cfg.promptLogging ?? false}
                onChange={e => save({ promptLogging: e.currentTarget.checked })}
                size="sm"
              />
              {cfg.promptLogging && (
                <Select
                  label="Capture depth"
                  size="sm"
                  value={cfg.promptLogLevel ?? 'last_user'}
                  onChange={v => save({ promptLogLevel: v })}
                  data={[
                    { value: 'last_user', label: 'Last user message only (lower storage)' },
                    { value: 'full',      label: 'Full conversation — all messages' },
                  ]}
                  w={280}
                />
              )}
            </Group>

            <Divider label="File Logging" labelPosition="left" />
            <Text size="xs" c="dimmed">
              Writes one JSONL file per day to the specified directory. Each line is a JSON
              object with request metadata, routing signals, and optionally the full prompt.
              Use these files to grep agent patterns, audit tenant usage, or feed analytics tools.
            </Text>
            <Group align="flex-start" gap="xl" wrap="wrap">
              <Switch
                label="Enable file logging"
                size="sm"
                checked={cfg.fileLogging?.enabled ?? false}
                onChange={e => save({ fileLogging: { ...cfg.fileLogging, enabled: e.currentTarget.checked } })}
              />
              {cfg.fileLogging?.enabled && (
                <>
                  <Switch
                    label="Include prompt content in file logs"
                    description="Requires prompt logging to be enabled"
                    size="sm"
                    checked={cfg.fileLogging?.includePrompts ?? false}
                    onChange={e => save({ fileLogging: { ...cfg.fileLogging, includePrompts: e.currentTarget.checked } })}
                  />
                </>
              )}
            </Group>
            {cfg.fileLogging?.enabled && (
              <Group gap="md" wrap="wrap">
                <TextInput
                  label="Log directory"
                  size="sm"
                  defaultValue={cfg.fileLogging?.directory ?? '/var/log/open-model-prism'}
                  onBlur={e => save({ fileLogging: { ...cfg.fileLogging, directory: e.target.value } })}
                  w={300}
                  leftSection={<IconFileText size={14} />}
                />
                <NumberInput
                  label="Max file size (MB)"
                  size="sm" w={140}
                  value={cfg.fileLogging?.maxSizeMb ?? 100}
                  onChange={v => save({ fileLogging: { ...cfg.fileLogging, maxSizeMb: v } })}
                  min={10} max={1000} step={50}
                />
                <NumberInput
                  label="Max files (days)"
                  size="sm" w={140}
                  value={cfg.fileLogging?.maxFiles ?? 7}
                  onChange={v => save({ fileLogging: { ...cfg.fileLogging, maxFiles: v } })}
                  min={1} max={365}
                />
              </Group>
            )}
            {cfg.fileLogging?.enabled && (
              <Code fz={11} block>
                {cfg.fileLogging.directory}/requests-YYYY-MM-DD.jsonl
              </Code>
            )}

            <Divider label="Path Capture" labelPosition="left" />
            <Text size="xs" c="dimmed">
              Extracts filesystem paths from prompt messages (e.g. <Code fz={11}>/home/user/repo/src/file.ts</Code>).
              Aggregate the top 100 in the panel below to see which repos and files your users reference most.
              Does not require prompt logging — paths are extracted on the fly and stored separately.
            </Text>
            <Switch
              label="Enable path capture"
              size="sm"
              checked={cfg.pathCapture?.enabled ?? false}
              onChange={e => save({ pathCapture: { enabled: e.currentTarget.checked } })}
            />

            <Divider label="Prompt Retention" labelPosition="left" />
            <Text size="xs" c="dimmed">
              Automatically removes prompt content (system prompt, messages, response, captured paths)
              from logs older than the configured window. Log metadata (tokens, cost, model, routing) is
              kept forever. Reduces database storage and improves query performance over time.
            </Text>
            <Group align="flex-end" gap="md" wrap="wrap">
              <Switch
                label="Enable prompt retention"
                description="Strip old prompt content on a schedule"
                size="sm"
                checked={cfg.promptRetentionEnabled ?? false}
                onChange={e => save({ promptRetentionEnabled: e.currentTarget.checked })}
              />
              {cfg.promptRetentionEnabled && (
                <NumberInput
                  label="Retention window (hours)"
                  description="Prompt data older than this will be stripped"
                  size="sm"
                  w={220}
                  value={cfg.promptRetentionHours ?? 48}
                  onChange={v => save({ promptRetentionHours: v })}
                  min={1}
                  max={8760}
                  step={24}
                />
              )}
            </Group>

            <Divider label="Data Maintenance" labelPosition="left" />
            <DataMaintenancePanel />
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

// ── Data Maintenance panel ───────────────────────────────────────────────────
function DataMaintenancePanel() {
  const [shrinking, setShrinking] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  async function shrink(hours) {
    setShrinking(true);
    setLastResult(null);
    try {
      const { data } = await api.post('/api/prism/admin/system/shrink-logs', { olderThanHours: hours });
      setLastResult({ ok: true, count: data.shrunk, hours });
      notifications.show({ message: `Stripped prompt content from ${data.shrunk} log entr${data.shrunk === 1 ? 'y' : 'ies'} older than ${hours}h`, color: 'green' });
    } catch (err) {
      setLastResult({ ok: false });
      notifications.show({ message: err.response?.data?.error || 'Failed to shrink logs', color: 'red' });
    } finally {
      setShrinking(false);
    }
  }

  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        Strip prompt content (messages, system prompt, response, paths) from logs older than a
        threshold — keeping all metadata (tokens, cost, model, routing). One-time operation, runs immediately.
      </Text>
      <Group gap="xs" wrap="wrap">
        {[6, 12, 24, 48, 168, 720].map(h => (
          <Button key={h} size="xs" variant="light" color="orange" loading={shrinking}
            onClick={() => shrink(h)}>
            &gt; {h >= 168 ? `${h / 168}w` : h >= 24 ? `${h / 24}d` : `${h}h`}
          </Button>
        ))}
      </Group>
      {lastResult?.ok && (
        <Text size="xs" c="dimmed">
          Done — {lastResult.count} log{lastResult.count !== 1 ? 's' : ''} shrunk (older than {lastResult.hours}h).
        </Text>
      )}
    </Stack>
  );
}

// ── Top paths panel ───────────────────────────────────────────────────────────
function TopPathsPanel({ tenantFilter }) {
  const [paths, setPaths]   = useState(null);
  const [days, setDays]     = useState('30');
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days });
      if (tenantFilter) params.set('tenantId', tenantFilter);
      const { data } = await api.get(`/api/prism/admin/dashboard/top-paths?${params}`);
      setPaths(data);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }

  // Load when accordion opens (paths === null = not yet loaded)

  return (
    <Accordion variant="contained" radius="md">
      <Accordion.Item value="top-paths">
        <Accordion.Control icon={<IconFileText size={16} />} onClick={() => { if (paths === null) load(); }}>
          Top File Paths
          {paths !== null && <Text size="xs" c="dimmed" ml="xs" component="span">{paths.length} unique paths</Text>}
        </Accordion.Control>
        <Accordion.Panel>
          <Stack gap="sm">
            <Group gap="sm">
              <Select
                size="xs"
                value={days}
                onChange={v => { setDays(v); setPaths(null); }}
                data={[
                  { value: '7',  label: 'Last 7 days' },
                  { value: '30', label: 'Last 30 days' },
                  { value: '90', label: 'Last 90 days' },
                ]}
                w={140}
              />
              <ActionIcon size="sm" variant="subtle" onClick={load} loading={loading}>
                <IconRefresh size={14} />
              </ActionIcon>
            </Group>
            {paths === null
              ? <Text size="xs" c="dimmed">Click to load top paths. Requires path capture to be enabled in Logging Configuration.</Text>
              : paths.length === 0
                ? <Text size="xs" c="dimmed">No paths captured yet. Enable "Path Capture" in the Logging Configuration panel above.</Text>
                : (
                  <Table striped highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Path</Table.Th>
                        <Table.Th w={80}>Requests</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {paths.map((p, i) => (
                        <Table.Tr key={i}>
                          <Table.Td>
                            <Text size="xs" ff="monospace" style={{ wordBreak: 'break-all' }}>{p.path}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Badge size="xs" variant="light">{p.count}</Badge>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )
            }
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function RequestLog({ filterFailed = false, isAdmin = false }) {
  const [requests, setRequests]   = useState([]);
  const [page, setPage]           = useState(1);
  const [pages, setPages]         = useState(1);
  const [total, setTotal]         = useState(0);
  const [tenants, setTenants]     = useState([]);
  const [tenantFilter, setTenantFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState(filterFailed ? 'error' : '');
  const [sessionFilter, setSessionFilter] = useState('');
  const [groupBySession, setGroupBySession] = useState(false);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [categoryFilter, setCategoryFilter] = useState('');
  const [overrideFilter, setOverrideFilter] = useState('');
  const [hideAutocomplete, setHideAutocomplete] = useState(false);
  const [sourceFilter, setSourceFilter] = useState('');
  const [timePreset, setTimePreset] = useState('');   // '' | '1h' | '6h' | '24h' | '7d' | 'custom'
  const [fromDate, setFromDate]     = useState('');   // ISO date string YYYY-MM-DD
  const [toDate, setToDate]         = useState('');
  const [reclassifying, setReclassifying] = useState(false);
  const [reclassifyResult, setReclassifyResult] = useState(null);

  // isAdmin from props — passed by App.jsx

  const [allCategories, setAllCategories] = useState([]);
  useEffect(() => {
    api.get('/api/prism/admin/dashboard/tenants-list').then(r => setTenants(r.data)).catch(() => {});
    // Load all known categories for the filter dropdown (server-side, not just current page)
    api.get('/api/prism/admin/categories').then(r => {
      setAllCategories((r.data || []).map(c => c.key).sort());
    }).catch(() => {});
  }, []);

  // Compute from/to from preset
  function presetToDates(preset) {
    if (!preset || preset === 'custom') return { from: null, to: null };
    const now = new Date();
    const offsets = { '1h': 1*60*60*1000, '6h': 6*60*60*1000, '24h': 24*60*60*1000, '7d': 7*24*60*60*1000 };
    return { from: new Date(now - offsets[preset]).toISOString(), to: null };
  }

  useEffect(() => { setPage(1); setExpandedRows(new Set()); }, [filterFailed, tenantFilter, statusFilter, sessionFilter, categoryFilter, overrideFilter, hideAutocomplete, sourceFilter, timePreset, fromDate, toDate]);
  useEffect(() => { load(); }, [page, filterFailed, tenantFilter, statusFilter, sessionFilter, categoryFilter, overrideFilter, hideAutocomplete, sourceFilter, timePreset, fromDate, toDate]);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page, limit: 25 });
      if (tenantFilter)     params.set('tenantId', tenantFilter);
      if (statusFilter === 'unknown') {
        params.set('status', 'error');
        params.set('errorCategory', 'unknown');
      } else if (statusFilter) {
        params.set('status', statusFilter);
      } else if (filterFailed) {
        params.set('status', 'error');
      }
      if (sessionFilter)    params.set('sessionId', sessionFilter);
      if (categoryFilter)        params.set('category', categoryFilter);
      if (overrideFilter)        params.set('override', overrideFilter);
      if (hideAutocomplete)      params.set('excludeAutocomplete', '1');
      if (sourceFilter === 'user') params.set('toolAgent', 'false');
      if (sourceFilter === 'tool') params.set('toolAgent', 'true');
      if (filterFailed)          params.set('hideResolved', '1');

      if (timePreset && timePreset !== 'custom') {
        const { from } = presetToDates(timePreset);
        if (from) params.set('from', from);
      } else if (timePreset === 'custom') {
        if (fromDate) params.set('from', new Date(fromDate).toISOString());
        if (toDate)   params.set('to',   new Date(toDate + 'T23:59:59').toISOString());
      }

      const { data } = await api.get(`/api/prism/admin/dashboard/requests?${params}`);
      setRequests(data.requests);
      setPages(data.pages);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    }
  }, [page, filterFailed, tenantFilter, statusFilter, sessionFilter, categoryFilter, overrideFilter, hideAutocomplete, sourceFilter, timePreset, fromDate, toDate]);

  const { remaining, pollMs, setPollMs, manualRefresh } = useAutoRefresh(load, 60_000);

  function toggleRow(id) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const tenantOptions = [
    { value: '', label: 'All tenants' },
    ...tenants.map(t => ({ value: t._id, label: `${t.slug} — ${t.name}` })),
  ];

  const colCount = 10; // expand, time, session, status, tenant, requested, routed, category, tokens, cost

  // Build category options from all known categories (server-side) + current page extras
  const categoryOptions = useMemo(() => {
    const fromPage = requests.map(r => r.category).filter(Boolean);
    const merged = [...new Set([...allCategories, ...fromPage])].sort();
    return [
      { value: '', label: 'All categories' },
      ...merged.map(c => ({ value: c, label: c === 'coding_autocomplete' ? 'Autocomplete (FIM)' : c })),
    ];
  }, [allCategories, requests]);

  const SESSION_COLORS = ['violet', 'blue', 'teal', 'green', 'orange', 'pink', 'cyan', 'indigo', 'lime', 'grape'];

  // Build color map — by sessionId or systemPromptHash depending on toggle
  const sessionColorMap = {};
  if (groupBySession) {
    const seen = [];
    requests.forEach(r => {
      const key = r.systemPromptHash || r.sessionId;
      if (key && !sessionColorMap[key]) {
        seen.push(key);
        sessionColorMap[key] = SESSION_COLORS[(seen.length - 1) % SESSION_COLORS.length];
      }
    });
  }

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Group gap="sm">
          <Title order={2}>{filterFailed ? 'Failed Requests' : 'Request Log'}</Title>
          {filterFailed && <Badge color="red" variant="light" size="lg">errors only</Badge>}
          <Text c="dimmed" size="sm">{total.toLocaleString()} {filterFailed ? 'failed' : 'total'}</Text>
        </Group>
        <Group gap="xs">
          {filterFailed && isAdmin && (
            <Button size="xs" variant="light" color="green"
              onClick={async () => {
                if (!confirm('Mark all current errors as resolved? New errors after this will still appear.')) return;
                try {
                  const { data } = await api.post('/api/prism/admin/dashboard/resolve-errors-before', { before: new Date().toISOString() });
                  notifications.show({ message: `${data.resolved} errors marked as resolved`, color: 'green' });
                  load();
                } catch { notifications.show({ message: 'Failed to resolve errors', color: 'red' }); }
              }}>
              ✓ Clear all current errors
            </Button>
          )}
          <Box style={{ minWidth: 180 }}>
            <PollBar remaining={remaining} pollMs={pollMs} setPollMs={setPollMs} onRefresh={manualRefresh} />
          </Box>
        </Group>
      </Group>

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <Group gap="sm" wrap="wrap">
        <IconFilter size={16} style={{ color: 'var(--mantine-color-dimmed)' }} />
        <Select
          placeholder="All tenants"
          data={tenantOptions}
          value={tenantFilter}
          onChange={v => setTenantFilter(v || '')}
          searchable
          clearable
          size="sm"
          w={{ base: '100%', xs: 220 }}
        />
        <Select
          placeholder="All categories"
          data={categoryOptions}
          value={categoryFilter}
          onChange={v => setCategoryFilter(v || '')}
          searchable
          clearable
          size="sm"
          w={{ base: '100%', xs: 200 }}
        />
        <Select
          placeholder="All overrides"
          data={[
            { value: '', label: 'All overrides' },
            { value: 'frustration_upgrade',       label: 'frustration_upgrade' },
            { value: 'conversation_turn_upgrade',  label: 'conversation_turn_upgrade' },
            { value: 'classifier_fallback',        label: 'classifier_fallback' },
            { value: 'context_tier_upgrade',       label: 'context_tier_upgrade' },
            { value: 'session_context_upgrade',    label: 'session_context_upgrade' },
            { value: 'tool_call_upgrade',          label: 'tool_call_upgrade' },
            { value: 'domain_gate',                label: 'domain_gate' },
          ]}
          value={overrideFilter}
          onChange={v => setOverrideFilter(v || '')}
          clearable
          size="sm"
          w={{ base: '100%', xs: 210 }}
        />
        <Select
          placeholder="All sources"
          data={[
            { value: 'user', label: 'Human' },
            { value: 'tool', label: 'Autocomplete / Auto' },
          ]}
          value={sourceFilter}
          onChange={v => setSourceFilter(v || '')}
          clearable
          size="sm"
          w={{ base: '100%', xs: 160 }}
        />
        {!filterFailed && (
          <SegmentedControl
            size="xs"
            value={statusFilter}
            onChange={setStatusFilter}
            data={[
              { value: '',        label: 'All' },
              { value: 'success', label: 'OK' },
              { value: 'error',   label: 'Errors' },
              { value: 'unknown', label: 'Unknown Errors' },
            ]}
          />
        )}
        <SegmentedControl
          size="xs"
          value={timePreset}
          onChange={v => { setTimePreset(v); if (v !== 'custom') { setFromDate(''); setToDate(''); } }}
          data={[
            { value: '',      label: 'All time' },
            { value: '1h',    label: '1h' },
            { value: '6h',    label: '6h' },
            { value: '24h',   label: '24h' },
            { value: '7d',    label: '7d' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        {timePreset === 'custom' && (
          <Group gap={4} wrap="nowrap">
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              style={{
                background: 'var(--prism-bg-hover)',
                border: '1px solid var(--prism-border)',
                borderRadius: 4,
                color: 'var(--mantine-color-text)',
                padding: '4px 8px',
                fontSize: 12,
              }}
            />
            <Text size="xs" c="dimmed">–</Text>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              style={{
                background: 'var(--prism-bg-hover)',
                border: '1px solid var(--prism-border)',
                borderRadius: 4,
                color: 'var(--mantine-color-text)',
                padding: '4px 8px',
                fontSize: 12,
              }}
            />
          </Group>
        )}
        {sessionFilter && (
          <Badge
            color="violet"
            variant="light"
            size="lg"
            style={{ cursor: 'pointer' }}
            rightSection={<Text size="xs" c="dimmed" ml={4}>×</Text>}
            onClick={() => setSessionFilter('')}
          >
            Session: {sessionFilter.slice(0, 8)}…
          </Badge>
        )}
        <Switch
          label="Group by agent"
          size="xs"
          checked={groupBySession}
          onChange={e => setGroupBySession(e.currentTarget.checked)}
        />
        <Switch
          label="Hide autocomplete"
          size="xs"
          checked={hideAutocomplete}
          onChange={e => setHideAutocomplete(e.currentTarget.checked)}
          title="Hide coding_autocomplete and tool_agent requests"
        />
        {isAdmin && (
          <Tooltip label="Re-detect FIM/tool-agent patterns in unclassified requests from the last 30 days (requires prompt logging to be enabled)">
            <Button
              size="xs"
              variant="subtle"
              loading={reclassifying}
              onClick={async () => {
                setReclassifying(true);
                setReclassifyResult(null);
                try {
                  const { data } = await api.post('/api/prism/admin/dashboard/reclassify-fim', { days: 30 });
                  setReclassifyResult(`Scanned ${data.scanned}, updated ${data.updated}`);
                  if (data.updated > 0) load();
                } catch { setReclassifyResult('Failed'); }
                finally { setReclassifying(false); }
              }}
            >
              Reclassify FIM
            </Button>
          </Tooltip>
        )}
        {reclassifyResult && <Text size="xs" c="dimmed">{reclassifyResult}</Text>}
      </Group>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <Paper withBorder radius="md" style={{ overflowX: 'auto' }}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={24} />
              <Table.Th>Time</Table.Th>
              <Table.Th>Session</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Tenant</Table.Th>
              <Table.Th>Requested</Table.Th>
              <Table.Th>Routed To</Table.Th>
              <Table.Th>Category</Table.Th>
              <Table.Th>Tokens</Table.Th>
              <Table.Th>Cost</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {requests.map(r => {
              const hasPrompt = true; // always expandable — shows hint if no data logged
              const isExpanded = expandedRows.has(r._id);
              const tenantDoc = r.tenantId; // populated object or ObjectId string
              const tenantSlug = tenantDoc?.slug || (tenantFilter ? tenants.find(t => t._id === tenantFilter)?.slug : '');

              const groupKey = r.systemPromptHash || r.sessionId;
              return [
                <Table.Tr
                  key={r._id}
                  style={{
                    ...(r.status === 'error' ? { background: 'var(--prism-error-bg)' } : {}),
                    ...(groupBySession && groupKey && sessionColorMap[groupKey]
                      ? { borderLeft: `3px solid var(--mantine-color-${sessionColorMap[groupKey]}-6)` }
                      : {}),
                  }}
                >
                  {/* Expand toggle */}
                  <Table.Td>
                    {hasPrompt ? (
                      <ActionIcon
                        size="xs" variant="subtle"
                        onClick={() => toggleRow(r._id)}
                        title="Show prompt"
                      >
                        {isExpanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                      </ActionIcon>
                    ) : null}
                  </Table.Td>

                  <Table.Td><Text size="xs">{new Date(r.timestamp).toLocaleString()}</Text></Table.Td>

                  <Table.Td>
                    {r.sessionId ? (
                      <Tooltip label={`Session: ${r.sessionId}${r.systemPromptHash ? `\nAgent: ${r.systemPromptHash}` : ''}\nClick to filter`} multiline>
                        <Badge
                          size="xs"
                          variant={sessionFilter === r.sessionId ? 'filled' : 'light'}
                          color={sessionColorMap[groupKey] || 'gray'}
                          style={{ cursor: 'pointer', fontFamily: 'monospace' }}
                          onClick={() => setSessionFilter(
                            sessionFilter === r.sessionId ? '' : r.sessionId
                          )}
                        >
                          {r.sessionId.slice(0, 8)}
                        </Badge>
                      </Tooltip>
                    ) : (
                      <Text size="xs" c="dimmed">—</Text>
                    )}
                  </Table.Td>

                  <Table.Td style={{
                    borderLeft: r.status === 'error'
                      ? '2px solid var(--mantine-color-red-7)'
                      : r.handledFallback
                        ? '2px solid var(--mantine-color-yellow-6)'
                        : undefined,
                  }}>
                    <Stack gap={3}>
                      <Group gap={4} wrap="nowrap">
                        {r.status === 'error'
                          ? <Badge color="red" size="xs" leftSection={<IconAlertTriangle size={10} />}>error</Badge>
                          : r.handledFallback
                            ? <Badge color="yellow" size="xs" variant="light">ok</Badge>
                            : <Badge color="green" size="xs">ok</Badge>
                        }
                        {r.status === 'error' && r.errorCategory && (
                          <Tooltip label={`${r.errorDescription || r.errorCategory}${r.errorFixedIn ? ` — fixed in ${r.errorFixedIn}` : ''}`} multiline maw={300}>
                            <Badge size="xs" variant="light" style={{ cursor: 'help' }}
                              color={r.errorCategory === 'fixed' ? 'green' : r.errorCategory === 'provider' ? 'orange' : r.errorCategory === 'proxy' ? 'yellow' : 'gray'}>
                              {r.errorCategory === 'fixed' ? `fixed ${r.errorFixedIn || ''}` : r.errorCategory}
                            </Badge>
                          </Tooltip>
                        )}
                        {r.handledFallback && (
                          <Tooltip label={r.fallbackDetail || 'error handled via fallback — expand for details'} multiline maw={300}>
                            <Badge color="yellow" size="xs" variant="light" leftSection={<IconArrowsExchange size={10} />} style={{ cursor: 'help' }}>
                              handled
                            </Badge>
                          </Tooltip>
                        )}
                        {!r.handledFallback && r.contextFallback && (
                          <Tooltip label={`Context overflow: ${r.originalModel || r.requestedModel} → ${r.routedModel}`} multiline maw={280}>
                            <Badge color="orange" size="xs" variant="light" leftSection={<IconArrowsExchange size={10} />} style={{ cursor: 'help' }}>
                              fallback
                            </Badge>
                          </Tooltip>
                        )}
                      </Group>
                      {r.status === 'error' && r.errorMessage && (
                        <Text size="xs" c="red.4" lineClamp={1}
                          style={{ maxWidth: 220, fontFamily: 'monospace', fontSize: 10, opacity: 0.8 }}>
                          {r.errorMessage}
                        </Text>
                      )}
                      {r.handledFallback && r.fallbackDetail && (
                        <Text size="xs" c="yellow.5" lineClamp={1}
                          style={{ maxWidth: 220, fontFamily: 'monospace', fontSize: 10, opacity: 0.8 }}>
                          {r.fallbackDetail}
                        </Text>
                      )}
                    </Stack>
                  </Table.Td>

                  <Table.Td>
                    <Text size="xs" ff="monospace" c="dimmed">{tenantSlug || '—'}</Text>
                  </Table.Td>

                  <Table.Td>
                    <Text size="xs" ff="monospace">{r.requestedModel}</Text>
                  </Table.Td>

                  <Table.Td>
                    <Text size="xs" ff="monospace" c={r.contextFallback ? 'orange' : undefined}>{r.routedModel}</Text>
                  </Table.Td>

                  <Table.Td>
                    {r.category && (
                      <Badge size="xs" color={TIER_COLORS[r.costTier]}>{r.category}</Badge>
                    )}
                  </Table.Td>

                  <Table.Td>
                    {(() => {
                      const total = r.inputTokens + r.outputTokens;
                      const fillPct = r.contextWindowUsed && r.inputTokens
                        ? Math.min(100, Math.round(r.inputTokens / r.contextWindowUsed * 100))
                        : null;
                      const fillColor = fillPct >= 90 ? 'red' : fillPct >= 70 ? 'orange' : 'teal';
                      return (
                        <Tooltip
                          label={fillPct != null
                            ? `Input: ${r.inputTokens.toLocaleString()} / ${r.contextWindowUsed.toLocaleString()} (${fillPct}% context)\nOutput: ${r.outputTokens.toLocaleString()}`
                            : `Input: ${r.inputTokens.toLocaleString()}\nOutput: ${r.outputTokens.toLocaleString()}`}
                          multiline
                        >
                          <Stack gap={2} style={{ cursor: 'default' }}>
                            <Text size="xs">{total.toLocaleString()}</Text>
                            {fillPct != null && (
                              <div style={{ width: 48, height: 3, background: 'var(--prism-border)', borderRadius: 2 }}>
                                <div style={{ width: `${fillPct}%`, height: '100%', background: `var(--mantine-color-${fillColor}-6)`, borderRadius: 2 }} />
                              </div>
                            )}
                          </Stack>
                        </Tooltip>
                      );
                    })()}
                  </Table.Td>

                  <Table.Td>
                    <Text size="xs">${r.actualCostUsd?.toFixed(4) ?? '0.0000'}</Text>
                  </Table.Td>
                </Table.Tr>,

                // Expanded prompt row
                isExpanded && hasPrompt
                  ? <PromptRow key={`${r._id}-prompt`} r={r} colSpan={colCount} />
                  : null,
              ];
            })}
            {requests.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={colCount}>
                  <Text c="dimmed" ta="center">
                    {filterFailed ? 'No failed requests — great!' : 'No requests logged yet'}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Paper>

      {pages > 1 && (
        <Group justify="center">
          <Pagination total={pages} value={page} onChange={setPage} />
        </Group>
      )}

      {/* ── Admin log config ──────────────────────────────────────────────── */}
      <LogConfigPanel isAdmin={isAdmin} />

      {/* ── Top file paths (path capture) ─────────────────────────────────── */}
      <TopPathsPanel tenantFilter={tenantFilter} />
    </Stack>
  );
}
