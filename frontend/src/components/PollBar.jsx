import { useEffect, useRef, useState } from 'react';
import { Group, Text, Progress, ActionIcon, Select } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';

const INTERVAL_OPTIONS = [
  { value: '15',  label: '15s' },
  { value: '30',  label: '30s' },
  { value: '60',  label: '60s' },
  { value: '120', label: '2m'  },
  { value: '300', label: '5m'  },
];

/**
 * Hook — wires up auto-refresh with a configurable interval.
 * Returns { remaining, pollMs, setPollMs, manualRefresh }
 *
 * Pass `loadFn` as a stable reference (useCallback) or the hook will
 * always use the latest version automatically via the ref trick.
 */
export function useAutoRefresh(loadFn, defaultMs = 60_000) {
  const [pollMs, setPollMs]       = useState(defaultMs);
  const [remaining, setRemaining] = useState(defaultMs);
  const loadRef = useRef(loadFn);
  loadRef.current = loadFn; // always call the freshest version

  useEffect(() => {
    setRemaining(pollMs);
    const id = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1000) {
          loadRef.current();
          return pollMs;
        }
        return prev - 1000;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [pollMs]);

  function manualRefresh() {
    loadRef.current();
    setRemaining(pollMs);
  }

  return { remaining, pollMs, setPollMs, manualRefresh };
}

/**
 * Compact countdown bar.
 * Props: remaining (ms), pollMs (ms), setPollMs, onRefresh
 */
export default function PollBar({ remaining, pollMs, setPollMs, onRefresh }) {
  const secs = Math.ceil(remaining / 1000);
  const pct  = (remaining / pollMs) * 100;

  return (
    <Group gap="xs" align="center" wrap="wrap" style={{ minWidth: 0 }}>
      <ActionIcon size="xs" variant="subtle" onClick={onRefresh} title="Refresh now">
        <IconRefresh size={13} />
      </ActionIcon>
      <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
        next poll {secs}s
      </Text>
      <Progress
        value={pct}
        color="blue"
        size={3}
        radius="xl"
        style={{ flex: 1, minWidth: 60 }}
      />
      <Select
        size="xs"
        value={String(Math.round(pollMs / 1000))}
        onChange={v => setPollMs(Number(v) * 1000)}
        data={INTERVAL_OPTIONS}
        w={{ base: 56, xs: 62 }}
        withCheckIcon={false}
        comboboxProps={{ withinPortal: true }}
        styles={{ input: { paddingLeft: 6, paddingRight: 6, fontSize: 11, textAlign: 'center' } }}
      />
    </Group>
  );
}
