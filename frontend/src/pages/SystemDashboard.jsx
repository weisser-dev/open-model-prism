import { useEffect, useState, useCallback } from 'react';
import {
  Title, Grid, Card, Text, Badge, Group, Stack, Table,
  Loader, Center, Alert, Progress,
  SegmentedControl, Tooltip, ActionIcon, Box,
} from '@mantine/core';
import {
  IconServer, IconAlertTriangle,
  IconActivity, IconShield, IconTrash,
} from '@tabler/icons-react';
import PollBar, { useAutoRefresh } from '../components/PollBar';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
  ResponsiveContainer, BarChart, Bar, Legend,
} from 'recharts';
import api from '../hooks/useApi';


// ── Helpers ───────────────────────────────────────────────────────────────────
function mb(v)  { return v != null ? `${v} MB` : '—'; }
function pct(v) { return v != null ? `${v}%`  : '—'; }

function podStatusColor(pod) {
  const ageMs = Date.now() - new Date(pod.updatedAt).getTime();
  if (ageMs > 70_000) return 'red';
  if (ageMs > 45_000) return 'yellow';
  return 'green';
}

function heapColor(pct) {
  if (pct > 85) return 'red';
  if (pct > 65) return 'yellow';
  return 'teal';
}

// ── Pod Card ─────────────────────────────────────────────────────────────────
function PodCard({ pod, isSelf, onEvict }) {
  const heapPct = pod.heapTotalMb > 0
    ? Math.round(pod.heapUsedMb / pod.heapTotalMb * 100)
    : 0;
  const color = podStatusColor(pod);
  const ageS  = Math.floor((Date.now() - new Date(pod.updatedAt).getTime()) / 1000);

  return (
    <Card withBorder p="md" radius="md">
      <Group justify="space-between" mb="xs">
        <Group gap={6} wrap="nowrap">
          <IconServer size={16} />
          <Text size="sm" fw={600} style={{ fontFamily: 'monospace' }}>
            {pod.hostname || pod.podId?.slice(0, 8)}
          </Text>
          {isSelf && <Badge size="xs" color="blue" variant="light">this pod</Badge>}
          <Badge size="xs" color={{ control: 'violet', worker: 'orange', full: 'gray' }[pod.role] || 'gray'} variant="light">
            {pod.role || 'full'}
          </Badge>
          {pod.version && <Badge size="xs" color="gray" variant="outline">v{pod.version}</Badge>}
        </Group>
        <Group gap={4} wrap="nowrap">
          <Badge size="xs" color={color} variant="dot">
            {color === 'green' ? 'live' : color === 'yellow' ? 'stale' : 'offline'} ({ageS}s ago)
          </Badge>
          {!isSelf && (
            <Tooltip label="Evict from dashboard (removes stale record — pod re-appears on next heartbeat if still running)">
              <ActionIcon
                size="xs" variant="subtle" color="red"
                onClick={() => onEvict(pod.podId)}
              >
                <IconTrash size={11} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>

      <Grid gutter="xs">
        <Grid.Col span={6}>
          <Text size="xs" c="dimmed">Heap</Text>
          <Progress value={heapPct} color={heapColor(heapPct)} size="sm" mb={2} />
          <Text size="xs">{mb(pod.heapUsedMb)} / {mb(pod.heapTotalMb)} ({heapPct}%)</Text>
        </Grid.Col>
        <Grid.Col span={6}>
          <Text size="xs" c="dimmed">RSS</Text>
          <Text size="sm" fw={500}>{mb(pod.rssMb)}</Text>
        </Grid.Col>
        <Grid.Col span={4}>
          <Text size="xs" c="dimmed">Req/min</Text>
          <Text size="sm" fw={500}>{pod.reqPerMin ?? '—'}</Text>
        </Grid.Col>
        <Grid.Col span={4}>
          <Text size="xs" c="dimmed">Blocked/min</Text>
          <Text size="sm" fw={500} c={pod.blockedPerMin > 0 ? 'red' : undefined}>
            {pod.blockedPerMin ?? '—'}
          </Text>
        </Grid.Col>
        <Grid.Col span={4}>
          <Text size="xs" c="dimmed">EL Lag</Text>
          <Text size="sm" fw={500}>{pod.eventLoopLagMs != null ? `${pod.eventLoopLagMs}ms` : '—'}</Text>
        </Grid.Col>
        <Grid.Col span={6}>
          <Text size="xs" c="dimmed">PID</Text>
          <Text size="xs" c="dimmed" style={{ fontFamily: 'monospace' }}>{pod.pid}</Text>
        </Grid.Col>
        <Grid.Col span={6}>
          <Text size="xs" c="dimmed">Uptime</Text>
          <Text size="xs" c="dimmed">{pod.uptimeSeconds != null ? `${Math.floor(pod.uptimeSeconds / 60)}m` : '—'}</Text>
        </Grid.Col>
      </Grid>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SystemDashboard({ currentUser }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [chartView, setChartView] = useState('requests');

  const isAdmin = currentUser?.role === 'admin';

  const load = useCallback(async () => {
    try {
      const { data: d } = await api.get('/api/prism/admin/system/overview');
      setData(d);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  async function evictPod(podId) {
    try {
      await api.delete(`/api/prism/admin/system/pods/${encodeURIComponent(podId)}`);
      await load();
    } catch { /* already gone */ }
  }

  useEffect(() => { load(); }, [load]);

  const { remaining, pollMs, setPollMs, manualRefresh } = useAutoRefresh(load, 30_000);

  if (loading) return <Center h={300}><Loader /></Center>;
  if (error)   return <Alert color="red" icon={<IconAlertTriangle />}>{error}</Alert>;

  const { thisPod, pods, counters, providerStats, trafficBuckets } = data;

  const totalReqPerMin  = pods.reduce((s, p) => s + (p.reqPerMin || 0), 0);
  const totalBlocked    = pods.reduce((s, p) => s + (p.blockedPerMin || 0), 0);
  const activePods      = pods.filter(p => podStatusColor(p) !== 'red').length;
  const workerCount     = pods.filter(p => podStatusColor(p) !== 'red' && (p.role === 'worker' || p.role === 'full')).length;
  const controlCount    = pods.filter(p => podStatusColor(p) !== 'red' && (p.role === 'control' || p.role === 'full')).length;

  return (
    <Stack gap="lg">
      <Group justify="space-between" wrap="wrap">
        <Group gap="sm">
          <Title order={3}>System</Title>
          <a href="/failed" style={{ fontSize: 12, color: 'var(--mantine-color-red-5)', textDecoration: 'none' }}>Failed Requests →</a>
          <a href="/metrics" target="_blank" rel="noopener" style={{ fontSize: 12, color: 'var(--mantine-color-dimmed)', textDecoration: 'none' }}>Prometheus /metrics →</a>
        </Group>
        <Box style={{ minWidth: 180 }}>
          <PollBar remaining={remaining} pollMs={pollMs} setPollMs={setPollMs} onRefresh={manualRefresh} />
        </Box>
      </Group>

      {/* KPI Row */}
      <Grid>
        <Grid.Col span={{ base: 6, sm: 3 }}>
          <Card withBorder p="sm">
            <Text size="xs" c="dimmed">Active Pods</Text>
            <Text size="xl" fw={700} c={activePods === 0 ? 'red' : 'teal'}>{activePods}</Text>
            <Group gap={4} mt={2}>
              <Badge size="xs" color="orange" variant="light">{workerCount} worker</Badge>
              <Badge size="xs" color="violet" variant="light">{controlCount} control</Badge>
            </Group>
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 3 }}>
          <Card withBorder p="sm">
            <Text size="xs" c="dimmed">Req / min (all pods)</Text>
            <Text size="xl" fw={700}>{totalReqPerMin}</Text>
            <Text size="xs" c="dimmed">gateway requests</Text>
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 3 }}>
          <Card withBorder p="sm">
            <Text size="xs" c="dimmed">Blocked / min</Text>
            <Text size="xl" fw={700} c={totalBlocked > 0 ? 'orange' : undefined}>{totalBlocked}</Text>
            <Text size="xs" c="dimmed">rate-limited requests</Text>
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 3 }}>
          <Card withBorder p="sm">
            <Text size="xs" c="dimmed">Provider Errors (5 min)</Text>
            <Text size="xl" fw={700} c={providerStats.some(p => p.errors > 0) ? 'red' : undefined}>
              {providerStats.reduce((s, p) => s + p.errors, 0)}
            </Text>
            <Text size="xs" c="dimmed">across {providerStats.length} providers</Text>
          </Card>
        </Grid.Col>
      </Grid>

      {/* Pod Cards */}
      <div>
        <Text fw={600} mb="xs">
          <IconServer size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          Backend Pods
        </Text>
        {pods.length === 0 ? (
          <Alert color="yellow" icon={<IconAlertTriangle />}>
            No pod heartbeats found. Heartbeat service may not have started yet — wait 30 seconds.
          </Alert>
        ) : (
          <Grid>
            {pods.map(pod => (
              <Grid.Col key={pod.podId} span={{ base: 12, sm: 6, md: 4 }}>
                <PodCard pod={pod} isSelf={pod.podId === thisPod} onEvict={evictPod} />
              </Grid.Col>
            ))}
          </Grid>
        )}
      </div>

      {/* Traffic Chart */}
      <div>
        <Group justify="space-between" mb="xs">
          <Text fw={600}>
            <IconActivity size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Gateway Traffic (last 60 min)
          </Text>
          <SegmentedControl
            size="xs"
            value={chartView}
            onChange={setChartView}
            data={[
              { label: 'Requests', value: 'requests' },
              { label: 'Tokens',   value: 'tokens' },
              { label: 'Errors',   value: 'errors' },
            ]}
          />
        </Group>
        <Card withBorder p="sm">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trafficBuckets} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--prism-chart-grid)" />
              <XAxis
                dataKey="_id"
                tickFormatter={v => v?.slice(11) || ''}
                tick={{ fontSize: 10 }}
              />
              <YAxis tick={{ fontSize: 10 }} />
              <RechartTooltip contentStyle={{ background: 'var(--prism-tooltip-bg)', border: '1px solid var(--prism-tooltip-border)' }} />
              {chartView === 'requests' && (
                <Area type="monotone" dataKey="requests" stroke="#339af0" fill="#1971c2" fillOpacity={0.3} />
              )}
              {chartView === 'tokens' && (
                <Area type="monotone" dataKey="tokens" stroke="#51cf66" fill="#2f9e44" fillOpacity={0.3} />
              )}
              {chartView === 'errors' && (
                <Area type="monotone" dataKey="errors" stroke="#ff6b6b" fill="#c92a2a" fillOpacity={0.3} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Provider Health */}
      {providerStats.length > 0 && (
        <div>
          <Text fw={600} mb="xs">
            <IconShield size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Provider Health (last 5 min)
          </Text>
          <Card withBorder p={0}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Provider ID</Table.Th>
                  <Table.Th>Requests</Table.Th>
                  <Table.Th>Errors</Table.Th>
                  <Table.Th>Error Rate</Table.Th>
                  <Table.Th>Avg Routing</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {providerStats.map(p => {
                  const errRate = p.total > 0 ? Math.round(p.errors / p.total * 100) : 0;
                  return (
                    <Table.Tr key={p._id}>
                      <Table.Td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                        {String(p._id).slice(-8)}
                      </Table.Td>
                      <Table.Td>{p.total}</Table.Td>
                      <Table.Td>
                        <Badge size="xs" color={p.errors > 0 ? 'red' : 'teal'}>
                          {p.errors}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Badge size="xs" color={errRate > 10 ? 'red' : errRate > 0 ? 'yellow' : 'teal'}>
                          {errRate}%
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        {p.avgRouting != null ? `${Math.round(p.avgRouting)}ms` : '—'}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Card>
        </div>
      )}

    </Stack>
  );
}

