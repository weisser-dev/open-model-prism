import { useEffect, useState, useCallback } from 'react';
import {
  Title, SimpleGrid, Paper, Text, Group, Stack, Select, Loader, Center,
  Badge, SegmentedControl, Box, Table, TextInput,
} from '@mantine/core';
import {
  IconCoin, IconArrowDownRight, IconMessageCircle,
  IconArrowUp, IconArrowDown, IconUsers, IconAlertTriangle, IconClock,
} from '@tabler/icons-react';
import PollBar, { useAutoRefresh } from '../components/PollBar';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend, Line, ComposedChart,
} from 'recharts';
import api from '../hooks/useApi';

function StatCard({ title, value, subtitle, icon: Icon, color }) {
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between">
        <Stack gap={0}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{title}</Text>
          <Text size="xl" fw={700}>{value}</Text>
          {subtitle && <Text size="xs" c="dimmed">{subtitle}</Text>}
        </Stack>
        <Icon size={32} color={`var(--mantine-color-${color}-6)`} />
      </Group>
    </Paper>
  );
}

function fmtTokens(n) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(0)}k`;
  return n.toLocaleString();
}

export default function Dashboard() {
  const [summary, setSummary]     = useState(null);
  const [models, setModels]       = useState([]);
  const [daily, setDaily]         = useState([]);
  const [timeRange, setTimeRange] = useState('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [tenantId, setTenantId]   = useState('');
  const [tenants, setTenants]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [chartMode, setChartMode] = useState('cost'); // 'cost' | 'tokens'
  const [catData, setCatData]     = useState([]);
  const [configChanges, setConfigChanges] = useState([]);
  const [expandedChange, setExpandedChange] = useState(null);

  // Load tenant list once on mount
  useEffect(() => {
    api.get('/api/prism/admin/tenants').then(r => setTenants(r.data)).catch(() => {});
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    // Parse timeRange: "6h" → hours=6, "30d" → days=30, "custom" → from/to dates
    const isHours = timeRange.endsWith('h');
    let timeQs;
    if (timeRange === 'custom') {
      if (!customFrom || !customTo) { setLoading(false); return; } // wait until both set
      timeQs = `from=${new Date(customFrom).toISOString()}&to=${new Date(customTo).toISOString()}`;
    } else {
      const value = parseInt(timeRange);
      timeQs = isHours ? `hours=${value}` : `days=${value}`;
    }
    const qs = `${timeQs}${tenantId ? `&tenantId=${tenantId}` : ''}`;
    try {
      const [sumRes, modRes, dayRes, catRes, chgRes] = await Promise.all([
        api.get(`/api/prism/admin/dashboard/summary?${qs}`),
        api.get(`/api/prism/admin/dashboard/models?${qs}`),
        api.get(`/api/prism/admin/dashboard/daily?${qs}`),
        api.get(`/api/prism/admin/dashboard/categories?${qs}`),
        api.get(`/api/prism/admin/dashboard/config-changes?${qs}`).catch(() => ({ data: [] })),
      ]);
      setSummary({ ...(sumRes.data.summary || sumRes.data), uniqueUsers: sumRes.data.uniqueUsers, usersViaProxy: sumRes.data.usersViaProxy, usersDirect: sumRes.data.usersDirect });
      setModels(modRes.data);
      setCatData(catRes.data || []);
      setConfigChanges(chgRes.data || []);
      setDaily(dayRes.data.map(d => {
        let date = d._id;
        let label = date;
        if (isHours && date?.includes('T')) {
          // Convert UTC hour to local time for display
          const utcDate = new Date(date + ':00Z');
          label = utcDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          date = utcDate.toISOString();
        } else if (date?.length === 10) {
          // Date only — format as local short date
          label = new Date(date + 'T12:00:00').toLocaleDateString([], { month: '2-digit', day: '2-digit' });
        }
        return { ...d, date, label };
      }));
    } catch (err) {
      console.error('Dashboard load error:', err);
    }
    setLoading(false);
  }, [timeRange, tenantId, customFrom, customTo]);

  useEffect(() => { loadData(); }, [loadData]);

  const { remaining, pollMs, setPollMs, manualRefresh } = useAutoRefresh(loadData, 60_000);

  if (loading) return <Center h={400}><Loader /></Center>;

  const s = summary || {};
  const savingsPercent = s.totalBaselineCost > 0
    ? ((s.totalSaved / s.totalBaselineCost) * 100).toFixed(1)
    : '0';
  const autoRoutePct = s.totalRequests > 0
    ? ((s.autoRoutedCount / s.totalRequests) * 100).toFixed(0)
    : '0';

  const selectedTenant = tenants.find(t => t._id === tenantId);

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Group gap="sm">
          <Title order={2}>Dashboard</Title>
          {selectedTenant && (
            <Badge size="lg" variant="light" color="blue">{selectedTenant.name}</Badge>
          )}
        </Group>
        <Group gap="sm" wrap="wrap">
          <Select
            value={tenantId}
            onChange={v => setTenantId(v || '')}
            data={[
              { value: '', label: 'All tenants' },
              ...tenants.map(t => ({ value: t._id, label: t.name })),
            ]}
            placeholder="All tenants"
            clearable
            w={{ base: '100%', xs: 200 }}
          />
          <Select
            value={timeRange}
            onChange={v => { setTimeRange(v); if (v !== 'custom') { setCustomFrom(''); setCustomTo(''); } }}
            data={[
              { value: '6h',  label: 'Last 6 hours' },
              { value: '12h', label: 'Last 12 hours' },
              { value: '24h', label: 'Last 24 hours' },
              { value: '7d',  label: 'Last 7 days' },
              { value: '30d', label: 'Last 30 days' },
              { value: '90d', label: 'Last 90 days' },
              { value: 'custom', label: 'Custom range' },
            ]}
            w={{ base: '100%', xs: 160 }}
            size="xs"
          />
          <TextInput type="datetime-local" value={customFrom}
            onChange={e => { setCustomFrom(e.target.value); if (e.target.value) setTimeRange('custom'); }}
            size="xs" w={185} styles={{ input: { fontSize: 12 } }} placeholder="From"
          />
          <TextInput type="datetime-local" value={customTo}
            onChange={e => { setCustomTo(e.target.value); if (e.target.value) setTimeRange('custom'); }}
            size="xs" w={185} styles={{ input: { fontSize: 12 } }} placeholder="To"
          />
          <Box style={{ minWidth: 180 }}>
            <PollBar remaining={remaining} pollMs={pollMs} setPollMs={setPollMs} onRefresh={manualRefresh} />
          </Box>
        </Group>
      </Group>

      {/* ── KPI cards — Row 1: Costs ──────────────────────────────────── */}
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <StatCard
          title="Total Cost"
          value={`$${(s.totalActualCost || 0).toFixed(2)}`}
          subtitle={timeRange === 'custom' ? 'Custom range' : `Last ${timeRange.endsWith('h') ? timeRange.replace('h', ' hours') : timeRange.replace('d', ' days')}`}
          icon={IconCoin}
          color="blue"
        />
        <StatCard
          title="Savings vs Baseline"
          value={`$${(s.totalSaved || 0).toFixed(2)}`}
          subtitle={`${savingsPercent}% saved`}
          icon={IconArrowDownRight}
          color="green"
        />
        <StatCard
          title="Classifier Cost"
          value={`$${(s.totalRoutingCost || 0).toFixed(2)}`}
          subtitle={`${s.autoRoutedCount || 0} classified requests`}
          icon={IconCoin}
          color="cyan"
        />
      </SimpleGrid>

      {/* ── KPI cards — Row 2: Tokens ──────────────────────────────────── */}
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <StatCard
          title="Input Tokens"
          value={fmtTokens(s.totalInputTokens || 0)}
          subtitle="Prompt / context tokens"
          icon={IconArrowUp}
          color="orange"
        />
        <StatCard
          title="Output Tokens"
          value={fmtTokens(s.totalOutputTokens || 0)}
          subtitle="Generated tokens"
          icon={IconArrowDown}
          color="yellow"
        />
        <StatCard
          title="Requests"
          value={(s.totalRequests || 0).toLocaleString()}
          subtitle={`${autoRoutePct}% auto-routed (${s.autoRoutedCount || 0})`}
          icon={IconMessageCircle}
          color="violet"
        />
      </SimpleGrid>

      {/* ── KPI cards — Row 3: Users & Health ──────────────────────────── */}
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        {s.uniqueUsers != null ? (
          <StatCard
            title="Unique Users"
            value={s.uniqueUsers?.toLocaleString() || '0'}
            subtitle="By anonymized IP"
            icon={IconUsers}
            color="grape"
          />
        ) : (
          <StatCard
            title="Unique Users"
            value="—"
            subtitle="Enable in Settings → Log & Observability"
            icon={IconUsers}
            color="gray"
          />
        )}
        <StatCard
          title="Error Rate"
          value={s.totalRequests > 0 ? (() => {
            const pct = (s.errorCount || 0) / s.totalRequests * 100;
            return pct < 0.1 && pct > 0 ? `${pct.toFixed(2)}%` : `${pct.toFixed(1)}%`;
          })() : '0%'}
          subtitle={`${(s.errorCount || 0).toLocaleString()} errors / ${(s.totalRequests || 0).toLocaleString()} req`}
          icon={IconAlertTriangle}
          color={(s.errorCount || 0) / (s.totalRequests || 1) > 0.05 ? 'red' : 'green'}
        />
        <StatCard
          title="Avg Latency"
          value={s.avgDurationMs ? `${(s.avgDurationMs / 1000).toFixed(1)}s` : '—'}
          subtitle="Average response time"
          icon={IconClock}
          color="indigo"
        />
      </SimpleGrid>

      {/* ── Time series chart ────────────────────────────────────────────── */}
      {daily.length > 0 && (
        <Paper withBorder p="md" radius="md">
          <Group justify="space-between" mb="md">
            <Title order={4}>
              {chartMode === 'cost' ? 'Cost' : 'Token Usage'} — {timeRange === 'custom' ? 'Custom Range' : timeRange.endsWith('h') ? `Last ${timeRange.replace('h','')} Hours (hourly)` : `Last ${timeRange.replace('d','')} Days (daily)`}
            </Title>
            <SegmentedControl
              size="xs"
              value={chartMode}
              onChange={setChartMode}
              data={[
                { value: 'cost',   label: 'Cost ($)' },
                { value: 'tokens', label: 'Tokens' },
              ]}
            />
          </Group>
          <ResponsiveContainer width="100%" height={300}>
            {(() => {
              const isHourly = timeRange.endsWith('h');
              const xTickFmt = v => {
                if (!v) return '';
                // Find the matching data point and use its pre-computed label
                const entry = daily.find(d => d.date === v);
                if (entry?.label) return entry.label;
                if (v.length === 10) return v.slice(5);
                return v;
              };
              return chartMode === 'cost' ? (
                <ComposedChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={xTickFmt} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="cost" />
                  <YAxis yAxisId="users" orientation="right" tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v, name) => name === 'Active Users' ? v : `$${v.toFixed(4)}`} labelFormatter={xTickFmt} />
                  <Legend />
                  <Area yAxisId="cost" type="monotone" dataKey="actualCost"   stroke="#4c6ef5" fill="#4c6ef5" fillOpacity={0.2} name="Actual Cost ($)" />
                  <Area yAxisId="cost" type="monotone" dataKey="baselineCost" stroke="var(--prism-chart-baseline-stroke)" fill="var(--prism-chart-baseline-fill)" fillOpacity={0.1} name="Baseline Cost ($)" />
                  <Line yAxisId="users" type="linear" dataKey="activeUsers" stroke="#51cf66" strokeWidth={2} dot={{ r: 4, fill: '#51cf66', stroke: '#2f9e44', strokeWidth: 1 }} name="Active Users" />
                </ComposedChart>
              ) : (
                <ComposedChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={xTickFmt} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="tokens" tickFormatter={v => fmtTokens(v)} />
                  <YAxis yAxisId="users" orientation="right" tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v, name) => name === 'Active Users' ? v : fmtTokens(v)} labelFormatter={xTickFmt} />
                  <Legend />
                  <Bar yAxisId="tokens" dataKey="inputTokens"  stackId="t" fill="#f76707" name="Input Tokens" />
                  <Bar yAxisId="tokens" dataKey="outputTokens" stackId="t" fill="#fab005" name="Output Tokens" />
                  <Line yAxisId="users" type="linear" dataKey="activeUsers" stroke="#51cf66" strokeWidth={2} dot={{ r: 4, fill: '#51cf66', stroke: '#2f9e44', strokeWidth: 1 }} name="Active Users" />
                </ComposedChart>
              );
            })()}
          </ResponsiveContainer>
        </Paper>
      )}

      {/* ── Model usage chart ─────────────────────────────────────────── */}
      {models.length > 0 && (
        <Paper withBorder p="md" radius="md">
          <Title order={4} mb="md">Model Usage</Title>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={models.map(m => ({ ...m, model: m._id }))} margin={{ bottom: 90 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="model"
                angle={-35}
                textAnchor="end"
                height={100}
                interval={0}
                tick={{ fontSize: 11 }}
                tickFormatter={v => v.length > 28 ? v.slice(0, 26) + '…' : v}
              />
              <YAxis />
              <Tooltip formatter={(val, name, props) => [val, props.payload.model]} />
              <Bar dataKey="requests" fill="#4c6ef5" name="Requests" />
            </BarChart>
          </ResponsiveContainer>
        </Paper>
      )}

      {/* ── Model detail table ─────────────────────────────────────────── */}
      {models.length > 0 && (
        <Paper withBorder p="md" radius="md">
          <Title order={4} mb="xs">Cost & Performance per Model</Title>
          <Text size="xs" c="dimmed" mb="md">Latency = time until model responds with full context.</Text>
          <Box style={{ overflowX: 'auto' }}>
            <Table striped highlightOnHover size="sm" style={{ minWidth: 700 }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Model</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Requests</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Input Tokens</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Output Tokens</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Cost</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Avg Latency</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {[...models].sort((a, b) => (b.actualCost || 0) - (a.actualCost || 0)).map(m => {
                  const avgMs = m.durationMsCount > 0 ? m.durationMsTotal / m.durationMsCount : 0;
                  return (
                    <Table.Tr key={m._id}>
                      <Table.Td>
                        <Text size="xs" fw={500} style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m._id}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Text size="xs" style={{ fontVariantNumeric: 'tabular-nums' }}>{(m.requests || 0).toLocaleString()}</Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Text size="xs" style={{ fontVariantNumeric: 'tabular-nums' }}>{((m.inputTokens || 0) / 1e6).toFixed(1)}M</Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Text size="xs" style={{ fontVariantNumeric: 'tabular-nums' }}>{((m.outputTokens || 0) / 1e6).toFixed(1)}M</Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Text size="xs" fw={600} style={{ fontVariantNumeric: 'tabular-nums' }}>${(m.actualCost || 0).toFixed(2)}</Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Text size="xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {avgMs > 0 ? `${(avgMs / 1000).toFixed(1)}s` : '—'}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Box>
        </Paper>
      )}

      {/* ── Category Distribution ───────────────────────────────────────── */}
      {catData.length > 0 && (
        <Paper withBorder p="md" radius="md">
          <Title order={4} mb="md">Category Distribution</Title>
          <Table striped highlightOnHover size="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Category</Table.Th>
                <Table.Th>Tier</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Requests</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Cost</Table.Th>
                <Table.Th></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {catData.slice(0, 15).map((c, i) => {
                const cat = c._id?.category || 'unknown';
                const tier = c._id?.costTier || '?';
                const maxReqs = catData[0]?.requests || 1;
                const TIER_CLR = { micro: 'grape', minimal: 'teal', low: 'blue', medium: 'yellow', advanced: 'cyan', high: 'red', ultra: 'pink', critical: 'orange' };
                return (
                  <Table.Tr key={i}>
                    <Table.Td><Text size="sm" fw={500}>{cat}</Text></Table.Td>
                    <Table.Td><Badge size="xs" color={TIER_CLR[tier] || 'gray'}>{tier}</Badge></Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>{(c.requests || 0).toLocaleString()}</Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>${(c.actualCost || 0).toFixed(2)}</Table.Td>
                    <Table.Td style={{ width: 100 }}>
                      <div style={{ height: 6, background: 'var(--prism-border)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.round((c.requests / maxReqs) * 100)}%`, height: '100%', background: 'var(--mantine-color-blue-6)', borderRadius: 3 }} />
                      </div>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Paper>
      )}

      {/* ── Configuration Changes ─────────────────────────────────────── */}
      {configChanges.length > 0 && (
        <Paper withBorder p="md" radius="md">
          <Title order={4} mb="md">Configuration Changes</Title>
          <Stack gap="xs">
            {configChanges.slice(0, 20).map((c, i) => {
              const targetColors = { 'rule-set': 'orange', tenant: 'cyan', category: 'grape', model: 'blue' };
              const actionColors = { create: 'green', update: 'yellow', delete: 'red' };
              const isExpanded = expandedChange === i;
              return (
                <Paper key={c._id || i} p="xs" withBorder radius="sm"
                  style={{ cursor: 'pointer', borderLeftWidth: 3, borderLeftColor: `var(--mantine-color-${targetColors[c.target] || 'gray'}-6)` }}
                  onClick={() => setExpandedChange(isExpanded ? null : i)}>
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                      <Badge size="xs" color={actionColors[c.action] || 'gray'} variant="light">{c.action}</Badge>
                      <Badge size="xs" color={targetColors[c.target] || 'gray'} variant="light">{c.target}</Badge>
                      <Text size="xs" fw={600} truncate>{c.targetName}</Text>
                    </Group>
                    <Group gap="xs" wrap="nowrap">
                      <Text size="xs" c="dimmed">{c.user}</Text>
                      <Text size="xs" c="dimmed">{new Date(c.timestamp).toLocaleString()}</Text>
                    </Group>
                  </Group>
                  <Text size="xs" c="dimmed" mt={2} truncate>{c.summary}</Text>
                  {isExpanded && c.changes?.length > 0 && (
                    <Table size="xs" mt="xs" striped>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Field</Table.Th>
                          <Table.Th>Before</Table.Th>
                          <Table.Th>After</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {c.changes.map((ch, ci) => (
                          <Table.Tr key={ci}>
                            <Table.Td><Text size="xs" fw={500}>{ch.field}</Text></Table.Td>
                            <Table.Td><Text size="xs" c="red" style={{ wordBreak: 'break-all' }}>{typeof ch.before === 'object' ? JSON.stringify(ch.before) : String(ch.before ?? '—')}</Text></Table.Td>
                            <Table.Td><Text size="xs" c="green" style={{ wordBreak: 'break-all' }}>{typeof ch.after === 'object' ? JSON.stringify(ch.after) : String(ch.after ?? '—')}</Text></Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  )}
                </Paper>
              );
            })}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
