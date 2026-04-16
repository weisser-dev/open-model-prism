import { useEffect, useState, useMemo } from 'react';
import {
  Title, Paper, Table, Stack, Badge, Text, Group, Select, MultiSelect,
  ActionIcon, TextInput, NumberInput, Tooltip, Loader, Center, SegmentedControl,
  Collapse, Button, Divider, Code, Modal, Textarea, Checkbox, Alert,
} from '@mantine/core';
import {
  IconEdit, IconCheck, IconX, IconChevronDown, IconChevronRight,
  IconRefresh, IconFilter, IconArrowUp, IconArrowDown, IconWand, IconPlus,
  IconEye, IconEyeOff, IconDatabaseImport,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import api from '../hooks/useApi';

// Tier cycle order: null → critical → ultra → high → advanced → medium → low → minimal → micro → null
const TIER_CYCLE = [null, 'critical', 'ultra', 'high', 'advanced', 'medium', 'low', 'minimal', 'micro'];

const TIER_META = {
  critical: { color: 'orange', label: 'Critical' },
  ultra:    { color: 'pink',   label: 'Ultra' },
  high:     { color: 'red',    label: 'High' },
  advanced: { color: 'cyan',   label: 'Advanced' },
  medium:   { color: 'yellow', label: 'Medium' },
  low:      { color: 'blue',   label: 'Low' },
  minimal:  { color: 'teal',   label: 'Minimal' },
  micro:    { color: 'grape',  label: 'Micro' },
  null:     { color: 'gray',   label: 'Unset' },
};

const TIER_OPTIONS = [
  { value: '',         label: '— Unset —' },
  { value: 'critical', label: 'Critical' },
  { value: 'ultra',    label: 'Ultra' },
  { value: 'high',     label: 'High' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'medium',   label: 'Medium' },
  { value: 'low',      label: 'Low' },
  { value: 'minimal',  label: 'Minimal' },
  { value: 'micro',    label: 'Micro' },
];

const COST_TIER_OPTIONS = [
  { value: 'critical', label: 'Critical' },
  { value: 'ultra',    label: 'Ultra' },
  { value: 'high',     label: 'High' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'medium',   label: 'Medium' },
  { value: 'low',      label: 'Low' },
  { value: 'minimal',  label: 'Minimal' },
  { value: 'micro',    label: 'Micro' },
];

function TierBadge({ tier, onClick, style }) {
  const meta = TIER_META[tier] ?? TIER_META.null;
  return (
    <Tooltip label={onClick ? 'Click to change tier' : undefined} disabled={!onClick}>
      <Badge
        color={meta.color}
        size="sm"
        variant={tier ? 'filled' : 'outline'}
        style={{ cursor: onClick ? 'pointer' : 'default', ...style }}
        onClick={onClick}
      >
        {meta.label}
      </Badge>
    </Tooltip>
  );
}

function PriceCell({ value }) {
  if (value == null) return <Text size="xs" c="dimmed">—</Text>;
  return <Text size="xs">${value.toFixed(2)}</Text>;
}

// ── New Category Modal ────────────────────────────────────────────────────────
function NewCategoryModal({ opened, onClose, onCreated }) {
  const [form, setForm] = useState({ key: '', name: '', description: '', costTier: 'medium' });
  const [saving, setSaving] = useState(false);

  function setField(field, value) {
    setForm(f => {
      const next = { ...f, [field]: value };
      if (field === 'name' && !f._keyEdited) {
        next.key = value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      }
      if (field === 'key') next._keyEdited = true;
      return next;
    });
  }

  async function handleCreate() {
    if (!form.key || !form.name || !form.costTier) {
      notifications.show({ title: 'Required', message: 'Key, name and cost tier are required', color: 'red' });
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post('/api/prism/admin/categories', {
        key: form.key, name: form.name, description: form.description, costTier: form.costTier,
      });
      notifications.show({ title: 'Created', message: `Category "${form.name}" created`, color: 'green' });
      setForm({ key: '', name: '', description: '', costTier: 'medium' });
      onCreated(data);
    } catch (err) {
      notifications.show({ title: 'Error', message: err.response?.data?.error || err.message, color: 'red' });
    }
    setSaving(false);
  }

  return (
    <Modal opened={opened} onClose={onClose} title="New Routing Category" size="sm">
      <Stack gap="sm">
        <TextInput label="Name" placeholder="e.g. Code Generation" value={form.name} onChange={e => setField('name', e.target.value)} required />
        <TextInput label="Key / Slug" placeholder="e.g. code_generation" value={form.key} onChange={e => setField('key', e.target.value)} description="Unique identifier used in routing rules" required />
        <Textarea label="Description" placeholder="When to route requests to this category…" value={form.description} onChange={e => setField('description', e.target.value)} rows={2} />
        <Select label="Cost Tier" data={COST_TIER_OPTIONS} value={form.costTier} onChange={v => setField('costTier', v)} required />
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate} loading={saving}>Create Category</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default function Models() {
  const [models, setModels]         = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [editing, setEditing]       = useState(null);
  const [editForm, setEditForm]     = useState({});
  const [suggesting, setSuggesting] = useState(null);
  const [newCatModal, setNewCatModal] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [bulkResetting, setBulkResetting] = useState(false);

  // Filters
  const [filterProvider, setFilterProvider] = useState('');
  const [filterTier, setFilterTier]         = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterText, setFilterText]         = useState('');
  const [groupBy, setGroupBy] = useState('provider');
  const [collapsed, setCollapsed] = useState({});
  const [sortCol, setSortCol] = useState('');
  const [sortDir, setSortDir] = useState('asc');

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  }

  function SortTh({ col, children, style }) {
    const active = sortCol === col;
    return (
      <Table.Th
        style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', ...style }}
        onClick={() => handleSort(col)}
      >
        <Group gap={4} wrap="nowrap" display="inline-flex">
          {children}
          {active
            ? (sortDir === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />)
            : <IconArrowUp size={12} style={{ opacity: 0.2 }} />}
        </Group>
      </Table.Th>
    );
  }

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [mRes, cRes] = await Promise.all([
        api.get('/api/prism/admin/providers/models/all'),
        api.get('/api/prism/admin/categories'),
      ]);
      setModels(mRes.data);
      setCategories(cRes.data.map(c => ({ value: c.key || c.slug || c.name, label: c.name })));
    } catch (err) {
      notifications.show({ title: 'Load failed', message: err.message, color: 'red' });
    }
    setLoading(false);
  }

  function handleCategoryCreated(newCat) {
    const opt = { value: newCat.key || newCat.slug || newCat.name, label: newCat.name };
    setCategories(prev => [...prev, opt]);
    if (editing) setEditForm(f => ({ ...f, categories: [...(f.categories || []), opt.value] }));
    setNewCatModal(false);
  }

  // ── Inline tier cycle (no edit mode needed) ───────────────────────────────
  async function cycleTier(m) {
    const idx = TIER_CYCLE.indexOf(m.tier ?? null);
    const nextTier = TIER_CYCLE[(idx + 1) % TIER_CYCLE.length];
    try {
      await api.patch(`/api/prism/admin/providers/${m.providerId}/models/${encodeURIComponent(m.id)}`, {
        tier: nextTier,
      });
      setModels(prev => prev.map(x =>
        x.providerId === m.providerId && x.id === m.id ? { ...x, tier: nextTier } : x
      ));
    } catch (err) {
      notifications.show({ title: 'Save failed', message: err.message, color: 'red' });
    }
  }

  // ── Inline visible toggle ─────────────────────────────────────────────────
  async function toggleVisible(m) {
    const newVisible = !(m.visible !== false);
    try {
      await api.patch(`/api/prism/admin/providers/${m.providerId}/models/${encodeURIComponent(m.id)}`, {
        visible: newVisible,
      });
      setModels(prev => prev.map(x =>
        x.providerId === m.providerId && x.id === m.id ? { ...x, visible: newVisible } : x
      ));
    } catch (err) {
      notifications.show({ title: 'Save failed', message: err.message, color: 'red' });
    }
  }

  // ── Edit mode ─────────────────────────────────────────────────────────────
  function startEdit(m) {
    setEditing({ providerId: m.providerId, modelId: m.id });
    setEditForm({
      tier: m.tier || '',
      categories: m.categories || [],
      priority: m.priority ?? 50,
      notes: m.notes || '',
      inputPer1M: m.inputPer1M ?? '',
      outputPer1M: m.outputPer1M ?? '',
      contextWindow: m.contextWindow ?? '',
      maxOutputTokens: m.maxOutputTokens ?? '',
    });
    // Auto-suggest if model has no tier yet
    if (!m.tier) {
      setTimeout(() => autoSuggest(m, true), 100);
    }
  }

  function cancelEdit() { setEditing(null); setEditForm({}); }

  async function saveEdit(m) {
    try {
      await api.patch(`/api/prism/admin/providers/${m.providerId}/models/${encodeURIComponent(m.id)}`, {
        tier: editForm.tier || null,
        categories: editForm.categories,
        priority: editForm.priority,
        notes: editForm.notes,
        inputPer1M: editForm.inputPer1M === '' ? null : Number(editForm.inputPer1M),
        outputPer1M: editForm.outputPer1M === '' ? null : Number(editForm.outputPer1M),
        contextWindow: editForm.contextWindow === '' ? null : Number(editForm.contextWindow),
        maxOutputTokens: editForm.maxOutputTokens === '' ? null : Number(editForm.maxOutputTokens),
      });
      notifications.show({ title: 'Saved', message: `${m.id} updated`, color: 'green' });
      setEditing(null);
      setModels(prev => prev.map(x =>
        x.providerId === m.providerId && x.id === m.id
          ? { ...x, tier: editForm.tier || null, categories: editForm.categories,
              priority: editForm.priority, notes: editForm.notes,
              inputPer1M: editForm.inputPer1M === '' ? null : Number(editForm.inputPer1M),
              outputPer1M: editForm.outputPer1M === '' ? null : Number(editForm.outputPer1M),
              contextWindow: editForm.contextWindow === '' ? null : Number(editForm.contextWindow),
              maxOutputTokens: editForm.maxOutputTokens === '' ? null : Number(editForm.maxOutputTokens) }
          : x
      ));
    } catch (err) {
      notifications.show({ title: 'Save failed', message: err.response?.data?.error || err.message, color: 'red' });
    }
  }

  async function autoSuggest(m, silent = false) {
    setSuggesting(`${m.providerId}:${m.id}`);
    try {
      const { data } = await api.get(`/api/prism/admin/providers/models/suggest?modelId=${encodeURIComponent(m.id)}`);
      setEditForm(f => ({
        ...f,
        tier:            data.tier            ?? f.tier,
        categories:      data.categories?.length ? data.categories : f.categories,
        inputPer1M:      data.inputPer1M      != null ? data.inputPer1M      : f.inputPer1M,
        outputPer1M:     data.outputPer1M     != null ? data.outputPer1M     : f.outputPer1M,
        priority:        data.priority        != null ? data.priority        : f.priority,
        contextWindow:   data.contextWindow   != null ? data.contextWindow   : f.contextWindow,
        maxOutputTokens: data.maxOutputTokens != null ? data.maxOutputTokens : f.maxOutputTokens,
      }));
      if (!silent) notifications.show({ title: 'Suggested', message: `Filled from registry (${data.family || data.id})`, color: 'blue' });
    } catch {
      if (!silent) notifications.show({ title: 'No suggestion', message: 'Model not found in local registry', color: 'orange' });
    }
    setSuggesting(null);
  }

  // ── Bulk show/hide selected models ─────────────────────────────────────
  async function bulkSetVisibility(visible) {
    const targets = models.filter(m => selectedKeys.has(`${m.providerId}:${m.id}`));
    if (!targets.length) return;
    try {
      await Promise.all(targets.map(m =>
        api.patch(`/api/prism/admin/providers/${m.providerId}/models/${encodeURIComponent(m.id)}`, { visible })
      ));
      setModels(prev => prev.map(m =>
        selectedKeys.has(`${m.providerId}:${m.id}`) ? { ...m, visible } : m
      ));
      notifications.show({ title: visible ? 'Shown' : 'Hidden', message: `${targets.length} model(s) updated`, color: 'green' });
    } catch (err) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  }

  // ── Bulk reset selected models to registry defaults ──────────────────────
  async function bulkResetToRegistry() {
    const targets = models.filter(m => selectedKeys.has(`${m.providerId}:${m.id}`));
    if (!targets.length) return;
    setBulkResetting(true);
    let ok = 0, notFound = 0;
    for (const m of targets) {
      try {
        const { data } = await api.get(`/api/prism/admin/providers/models/suggest?modelId=${encodeURIComponent(m.id)}`);
        await api.patch(`/api/prism/admin/providers/${m.providerId}/models/${encodeURIComponent(m.id)}`, {
          tier:        data.tier,
          categories:  data.categories,
          inputPer1M:  data.inputPer1M,
          outputPer1M: data.outputPer1M,
          priority:    data.priority,
        });
        ok++;
      } catch {
        notFound++;
      }
    }
    await load();
    setSelectedKeys(new Set());
    setBulkResetting(false);
    notifications.show({
      title: 'Reset complete',
      message: `${ok} model${ok !== 1 ? 's' : ''} reset to registry defaults` +
               (notFound > 0 ? ` · ${notFound} not found in registry` : ''),
      color: ok > 0 ? 'teal' : 'orange',
    });
  }

  // ── Reorder within tier ───────────────────────────────────────────────────
  async function movePriority(groupItems, idx, direction) {
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= groupItems.length) return;
    const newOrder = [...groupItems];
    [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
    try {
      await api.post('/api/prism/admin/providers/models/reorder-tier', {
        items: newOrder.map(m => ({ providerId: m.providerId, modelId: m.id })),
      });
      const mRes = await api.get('/api/prism/admin/providers/models/all');
      setModels(mRes.data);
    } catch (err) {
      notifications.show({ title: 'Reorder failed', message: err.message, color: 'red' });
    }
  }

  // ── Filtering + sorting ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const result = models.filter(m => {
      // Hidden models always shown in admin (greyed out via opacity — never filtered)
      if (filterProvider && m.providerId !== filterProvider) return false;
      if (filterTier) {
        if (filterTier === 'unset' && m.tier) return false;
        if (filterTier !== 'unset' && m.tier !== filterTier) return false;
      }
      if (filterCategory && !m.categories?.includes(filterCategory)) return false;
      if (filterText && !m.id.toLowerCase().includes(filterText.toLowerCase()) &&
          !m.providerName.toLowerCase().includes(filterText.toLowerCase())) return false;
      return true;
    });

    if (sortCol) {
      const dir = sortDir === 'asc' ? 1 : -1;
      const TIER_ORDER = { high: 0, medium: 1, low: 2, minimal: 3 };
      result.sort((a, b) => {
        let va, vb;
        if (sortCol === 'visible')   { va = a.visible !== false ? 0 : 1; vb = b.visible !== false ? 0 : 1; }
        else if (sortCol === 'id')   { va = a.id?.toLowerCase() || ''; vb = b.id?.toLowerCase() || ''; }
        else if (sortCol === 'provider') { va = a.providerName?.toLowerCase() || ''; vb = b.providerName?.toLowerCase() || ''; }
        else if (sortCol === 'tier') { va = TIER_ORDER[a.tier] ?? 99; vb = TIER_ORDER[b.tier] ?? 99; }
        else if (sortCol === 'context') { va = a.contextWindow || 0; vb = b.contextWindow || 0; }
        else if (sortCol === 'in')   { va = a.inputPer1M || 0; vb = b.inputPer1M || 0; }
        else if (sortCol === 'out')  { va = a.outputPer1M || 0; vb = b.outputPer1M || 0; }
        else if (sortCol === 'priority') { va = a.priority ?? 50; vb = b.priority ?? 50; }
        if (va < vb) return -dir;
        if (va > vb) return dir;
        return 0;
      });
    }
    return result;
  }, [models, filterProvider, filterTier, filterCategory, filterText, sortCol, sortDir]);

  // ── Grouping ──────────────────────────────────────────────────────────────
  const grouped = useMemo(() => {
    if (groupBy === 'flat') return [{ key: 'all', label: 'All Models', items: filtered }];
    const groups = {};
    for (const m of filtered) {
      let key, label;
      if (groupBy === 'provider') {
        key = `${m.providerId}::${m.providerName}`; label = m.providerName;
        if (!groups[key]) groups[key] = { key, label, items: [] };
        groups[key].items.push(m);
      } else if (groupBy === 'category') {
        const cats = m.categories?.length ? m.categories : ['_unassigned'];
        for (const cat of cats) {
          if (!groups[cat]) {
            const catLabel = cat === '_unassigned' ? 'No Category' : (categories.find(c => c.value === cat)?.label || cat);
            groups[cat] = { key: cat, label: catLabel, items: [] };
          }
          groups[cat].items.push(m);
        }
      } else {
        key = m.tier || 'unset'; label = TIER_META[m.tier]?.label ?? 'Unset';
        if (!groups[key]) groups[key] = { key, label, items: [] };
        groups[key].items.push(m);
      }
    }
    const entries = Object.values(groups);
    if (groupBy === 'tier') {
      const order = ['high', 'medium', 'low', 'minimal', 'unset'];
      entries.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
      for (const g of entries) g.items.sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50));
    }
    return entries;
  }, [filtered, groupBy, categories]);

  const providerOptions = useMemo(() => {
    const seen = new Map();
    for (const m of models) seen.set(m.providerId, m.providerName);
    return [{ value: '', label: 'All providers' }, ...Array.from(seen.entries()).map(([v, l]) => ({ value: v, label: l }))];
  }, [models]);

  const tierFilterOptions = [
    { value: '', label: 'All tiers' }, { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' },
    { value: 'minimal', label: 'Minimal' }, { value: 'unset', label: 'Unset' },
  ];

  const hiddenCount = models.filter(m => m.visible === false).length;
  const showRank   = groupBy === 'tier';
  const showMovBtn = groupBy === 'tier';

  if (loading) return <Center h="60vh"><Loader size="xl" /></Center>;

  return (
    <Stack>
      <NewCategoryModal opened={newCatModal} onClose={() => setNewCatModal(false)} onCreated={handleCategoryCreated} />

      <Group justify="space-between">
        <div>
          <Title order={2}>Model Registry</Title>
          <Text size="sm" c="dimmed">
            {models.length} models across {new Set(models.map(m => m.providerId)).size} providers
            {hiddenCount > 0 && <> · <Text span c="orange" size="sm">{hiddenCount} hidden</Text></>}
          </Text>
        </div>
        <ActionIcon variant="light" onClick={load} title="Refresh"><IconRefresh size={18} /></ActionIcon>
      </Group>

      {/* Bulk action bar */}
      {selectedKeys.size > 0 && (
        <Alert color="blue" p="xs" radius="md">
          <Group justify="space-between">
            <Text size="sm">{selectedKeys.size} model{selectedKeys.size !== 1 ? 's' : ''} selected</Text>
            <Group gap="xs">
              <Tooltip label="Applies tier, categories, and pricing from the built-in model registry">
                <Button
                  size="xs"
                  leftSection={<IconDatabaseImport size={13} />}
                  loading={bulkResetting}
                  onClick={bulkResetToRegistry}
                >
                  Reset to registry defaults
                </Button>
              </Tooltip>
              <Button size="xs" variant="light" color="green" leftSection={<IconEye size={13} />} onClick={() => bulkSetVisibility(true)}>Show selected</Button>
              <Button size="xs" variant="light" color="orange" leftSection={<IconEyeOff size={13} />} onClick={() => bulkSetVisibility(false)}>Hide selected</Button>
              <Button size="xs" variant="subtle" onClick={() => setSelectedKeys(new Set())}>
                Clear
              </Button>
            </Group>
          </Group>
        </Alert>
      )}

      {/* Filters */}
      <Paper withBorder radius="md" p="sm">
        <Group gap="sm" wrap="wrap">
          <TextInput
            placeholder="Search model or provider…"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            leftSection={<IconFilter size={14} />}
            style={{ flex: 1, minWidth: 180 }}
            size="sm"
          />
          <Select size="sm" data={providerOptions} value={filterProvider} onChange={v => setFilterProvider(v || '')} w={180} />
          <Select size="sm" data={tierFilterOptions} value={filterTier} onChange={v => setFilterTier(v || '')} w={130} />
          <Select size="sm" data={[{ value: '', label: 'All categories' }, ...categories]} value={filterCategory} onChange={v => setFilterCategory(v || '')} w={180} />
          <Divider orientation="vertical" />
          <SegmentedControl
            size="xs"
            value={groupBy}
            onChange={setGroupBy}
            data={[
              { value: 'provider',  label: 'By Provider' },
              { value: 'tier',      label: 'By Tier' },
              { value: 'category',  label: 'By Category' },
              { value: 'flat',      label: 'Flat' },
            ]}
          />
        </Group>
      </Paper>

      {grouped.map(group => {
        const isCollapsed = collapsed[group.key];
        return (
          <Paper key={group.key} withBorder radius="md">
            {groupBy !== 'flat' && (
              <Group
                p="sm"
                style={{ cursor: 'pointer', borderBottom: isCollapsed ? 'none' : '1px solid var(--prism-border)' }}
                onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}
              >
                {isCollapsed ? <IconChevronRight size={16} /> : <IconChevronDown size={16} />}
                <Text fw={600}>{group.label}</Text>
                {groupBy === 'tier' && <TierBadge tier={group.key === 'unset' ? null : group.key} />}
                <Badge variant="light" size="sm">{group.items.length} models</Badge>
                {groupBy === 'provider' && (
                  <Text size="xs" c="dimmed" ml="auto">
                    {group.items.filter(m => m.tier).length}/{group.items.length} configured
                  </Text>
                )}
              </Group>
            )}

            <Collapse in={!isCollapsed}>
              <div style={{ overflowX: 'auto' }}>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    {showRank && <Table.Th style={{ width: 40, textAlign: 'center' }}>#</Table.Th>}
                    <Table.Th style={{ width: 32 }}>
                      <Checkbox
                        size="xs"
                        checked={group.items.every(m => selectedKeys.has(`${m.providerId}:${m.id}`))}
                        indeterminate={group.items.some(m => selectedKeys.has(`${m.providerId}:${m.id}`)) && !group.items.every(m => selectedKeys.has(`${m.providerId}:${m.id}`))}
                        onChange={e => {
                          setSelectedKeys(prev => {
                            const next = new Set(prev);
                            group.items.forEach(m => {
                              const k = `${m.providerId}:${m.id}`;
                              e.currentTarget.checked ? next.add(k) : next.delete(k);
                            });
                            return next;
                          });
                        }}
                      />
                    </Table.Th>
                    <SortTh col="visible" style={{ width: 28 }}><IconEye size={14} /></SortTh>
                    <SortTh col="id">Model ID</SortTh>
                    {groupBy !== 'provider' && <SortTh col="provider">Provider</SortTh>}
                    <SortTh col="tier">Tier</SortTh>
                    <Table.Th>Categories</Table.Th>
                    <SortTh col="in" style={{ width: 72, textAlign: 'right' }}>In/1M</SortTh>
                    <SortTh col="out" style={{ width: 72, textAlign: 'right' }}>Out/1M</SortTh>
                    <SortTh col="context">Context</SortTh>
                    <Table.Th>Notes</Table.Th>
                    <Table.Th style={{ width: showMovBtn ? 90 : 60 }} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {group.items.map((m, idx) => {
                    const isEdit = editing?.providerId === m.providerId && editing?.modelId === m.id;
                    const isSuggesting = suggesting === `${m.providerId}:${m.id}`;
                    const isHidden = m.visible === false;
                    return (
                      <Table.Tr
                        key={`${m.providerId}:${m.id}`}
                        style={isHidden ? { color: 'var(--prism-text-muted)', background: 'var(--prism-bg-hover)' } : undefined}
                      >
                        {showRank && (
                          <Table.Td style={{ textAlign: 'center' }}>
                            <Text size="xs" fw={600} c="dimmed">{idx + 1}</Text>
                          </Table.Td>
                        )}
                        {/* Row checkbox */}
                        <Table.Td>
                          <Checkbox
                            size="xs"
                            checked={selectedKeys.has(`${m.providerId}:${m.id}`)}
                            onChange={e => {
                              const k = `${m.providerId}:${m.id}`;
                              setSelectedKeys(prev => {
                                const next = new Set(prev);
                                e.currentTarget.checked ? next.add(k) : next.delete(k);
                                return next;
                              });
                            }}
                          />
                        </Table.Td>
                        {/* Visible toggle */}
                        <Table.Td>
                          <Tooltip label={isHidden ? 'Hidden from tenants — click to show' : 'Visible to tenants — click to hide'}>
                            <ActionIcon
                              size="xs"
                              variant="subtle"
                              color={isHidden ? 'gray' : 'green'}
                              onClick={() => toggleVisible(m)}
                            >
                              {isHidden ? <IconEyeOff size={13} /> : <IconEye size={13} />}
                            </ActionIcon>
                          </Tooltip>
                        </Table.Td>
                        <Table.Td>
                          <Code style={{ fontSize: 11 }}>{m.id}</Code>
                        </Table.Td>
                        {groupBy !== 'provider' && (
                          <Table.Td>
                            <Text size="xs">{m.providerName}</Text>
                            <Badge size="xs" variant="light" color="gray">{m.providerType}</Badge>
                          </Table.Td>
                        )}
                        <Table.Td>
                          {isEdit ? (
                            <Select size="xs" data={TIER_OPTIONS} value={editForm.tier}
                              onChange={v => setEditForm(f => ({ ...f, tier: v || '' }))} w={110} />
                          ) : (
                            <TierBadge tier={m.tier} onClick={() => cycleTier(m)} />
                          )}
                        </Table.Td>
                        <Table.Td style={{ maxWidth: 220 }}>
                          {isEdit ? (
                            <Group gap={4} align="center">
                              <MultiSelect
                                size="xs"
                                data={categories}
                                value={editForm.categories}
                                onChange={v => setEditForm(f => ({ ...f, categories: v }))}
                                placeholder="Select categories…"
                                searchable clearable
                                style={{ flex: 1 }}
                              />
                              <Tooltip label="New category">
                                <ActionIcon size="xs" variant="light" color="blue" onClick={() => setNewCatModal(true)}>
                                  <IconPlus size={11} />
                                </ActionIcon>
                              </Tooltip>
                            </Group>
                          ) : (
                            <Group gap={3} wrap="wrap">
                              {(m.categories || []).slice(0, 3).map(c => (
                                <Badge key={c} size="xs" variant="outline" color="indigo">{c}</Badge>
                              ))}
                              {(m.categories?.length || 0) > 3 && (
                                <Badge size="xs" variant="outline" color="gray">+{m.categories.length - 3}</Badge>
                              )}
                              {!m.categories?.length && <Text size="xs" c="dimmed">—</Text>}
                            </Group>
                          )}
                        </Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>
                          {isEdit ? (
                            <NumberInput size="xs" min={0} step={0.01} decimalScale={2}
                              value={editForm.inputPer1M} onChange={v => setEditForm(f => ({ ...f, inputPer1M: v }))}
                              w={70} placeholder="0.00" />
                          ) : <PriceCell value={m.inputPer1M} />}
                        </Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>
                          {isEdit ? (
                            <NumberInput size="xs" min={0} step={0.01} decimalScale={2}
                              value={editForm.outputPer1M} onChange={v => setEditForm(f => ({ ...f, outputPer1M: v }))}
                              w={70} placeholder="0.00" />
                          ) : <PriceCell value={m.outputPer1M} />}
                        </Table.Td>
                        <Table.Td>
                          {isEdit ? (
                            <NumberInput size="xs" min={0} step={1000}
                              value={editForm.contextWindow} onChange={v => setEditForm(f => ({ ...f, contextWindow: v }))}
                              w={80} placeholder="e.g. 200000"
                              rightSection={<Text size="8px" c="dimmed">tok</Text>} />
                          ) : (
                            <Text size="xs" c="dimmed">
                              {m.contextWindow ? `${(m.contextWindow / 1000).toFixed(0)}k` : '—'}
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td style={{ maxWidth: 140 }}>
                          {isEdit ? (
                            <TextInput size="xs" value={editForm.notes}
                              onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                              placeholder="Optional note…" />
                          ) : (
                            <Text size="xs" c="dimmed" lineClamp={1}>{m.notes || '—'}</Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          {isEdit ? (
                            <Group gap={4}>
                              <Tooltip label="Auto-suggest from registry">
                                <ActionIcon size="sm" color="blue" variant="light"
                                  onClick={() => autoSuggest(m)} loading={isSuggesting}>
                                  <IconWand size={13} />
                                </ActionIcon>
                              </Tooltip>
                              <ActionIcon size="sm" color="green" variant="light" onClick={() => saveEdit(m)}>
                                <IconCheck size={13} />
                              </ActionIcon>
                              <ActionIcon size="sm" color="red" variant="light" onClick={cancelEdit}>
                                <IconX size={13} />
                              </ActionIcon>
                            </Group>
                          ) : (
                            <Group gap={2}>
                              {showMovBtn && (
                                <>
                                  <ActionIcon size="xs" variant="subtle" disabled={idx === 0}
                                    onClick={() => movePriority(group.items, idx, -1)}>
                                    <IconArrowUp size={12} />
                                  </ActionIcon>
                                  <ActionIcon size="xs" variant="subtle" disabled={idx === group.items.length - 1}
                                    onClick={() => movePriority(group.items, idx, 1)}>
                                    <IconArrowDown size={12} />
                                  </ActionIcon>
                                </>
                              )}
                              <ActionIcon size="sm" variant="subtle" onClick={() => startEdit(m)}>
                                <IconEdit size={14} />
                              </ActionIcon>
                            </Group>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
              </div>
            </Collapse>
          </Paper>
        );
      })}

      {filtered.length === 0 && (
        <Text c="dimmed" ta="center" mt="xl">
          No models found — add providers and run "Discover Models" first.
        </Text>
      )}
    </Stack>
  );
}
