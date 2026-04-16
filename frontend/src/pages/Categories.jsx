import { useEffect, useState } from 'react';
import {
  Title, Paper, Table, Button, Group, Stack, Badge, Text, ActionIcon,
  Modal, TextInput, Textarea, Select, Checkbox, SimpleGrid, Card,
  SegmentedControl, Tooltip, Divider, TagsInput, ThemeIcon, Menu,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconRefresh, IconPlus, IconEdit, IconTrash,
  IconEye, IconShield, IconDotsVertical, IconAlertTriangle,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import api from '../hooks/useApi';

const TIER_COLORS  = { micro: 'grape', minimal: 'teal', low: 'blue', medium: 'yellow', advanced: 'cyan', high: 'red', ultra: 'pink', critical: 'orange' };
const TIER_OPTIONS = [
  { value: 'micro',    label: 'Micro' },
  { value: 'minimal',  label: 'Minimal' },
  { value: 'low',      label: 'Low' },
  { value: 'medium',   label: 'Medium' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'high',     label: 'High' },
  { value: 'ultra',    label: 'Ultra' },
  { value: 'critical', label: 'Critical' },
];
const EMPTY_FORM = {
  key: '', name: '', description: '', costTier: 'low',
  examples: [], defaultModel: '', requiresVision: false,
  targetSystemPrompt: '',
};

export default function Categories() {
  const [categories, setCategories]         = useState([]);
  const [view, setView]                     = useState('list');
  const [saving, setSaving]                 = useState(false);
  const [resetting, setResetting]           = useState(false);
  const [form, setForm]                     = useState(EMPTY_FORM);
  const [editId, setEditId]                 = useState(null);
  const [opened, { open, close }]           = useDisclosure(false);
  // Inline confirm state
  const [confirmTarget, setConfirmTarget]   = useState(null); // { type: 'delete'|'reset', cat? }
  const [confirmLoading, setConfirmLoading] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const { data } = await api.get('/api/prism/admin/categories');
      setCategories(data);
    } catch {
      notifications.show({ message: 'Failed to load categories', color: 'red' });
    }
  }

  function openAdd() {
    setEditId(null);
    setForm(EMPTY_FORM);
    open();
  }

  function openEdit(cat) {
    setEditId(cat._id);
    setForm({
      key:                cat.key,
      name:               cat.name,
      description:        cat.description || '',
      costTier:           cat.costTier,
      examples:           cat.examples || [],
      defaultModel:       cat.defaultModel || '',
      requiresVision:     cat.requiresVision || false,
      targetSystemPrompt: cat.targetSystemPrompt || '',
    });
    open();
  }

  async function save() {
    if (!form.key || !form.name || !form.costTier) {
      notifications.show({ message: 'Key, name and tier are required', color: 'red' });
      return;
    }
    setSaving(true);
    try {
      if (editId) {
        await api.put(`/api/prism/admin/categories/${editId}`, form);
        notifications.show({ message: 'Category updated', color: 'green' });
      } else {
        await api.post('/api/prism/admin/categories', form);
        notifications.show({ message: 'Category created', color: 'green' });
      }
      close();
      load();
    } catch (err) {
      notifications.show({ message: err.response?.data?.error || 'Failed to save', color: 'red' });
    }
    setSaving(false);
  }

  function confirmDelete(cat) {
    setConfirmTarget({ type: 'delete', cat });
  }

  function confirmReset() {
    setConfirmTarget({ type: 'reset' });
  }

  async function executeConfirm() {
    setConfirmLoading(true);
    try {
      if (confirmTarget.type === 'delete') {
        await api.delete(`/api/prism/admin/categories/${confirmTarget.cat._id}`);
        notifications.show({ message: `"${confirmTarget.cat.name}" deleted`, color: 'orange' });
      } else if (confirmTarget.type === 'reset') {
        const { data } = await api.post('/api/prism/admin/categories/reset-defaults');
        notifications.show({
          title: 'Defaults restored',
          message: data.created > 0
            ? `Created ${data.created} missing categories (${data.skipped} already present)`
            : 'All built-in categories were already present',
          color: 'green',
        });
      }
      load();
    } catch (err) {
      notifications.show({ message: err.response?.data?.error || 'Failed', color: 'red' });
    }
    setConfirmLoading(false);
    setConfirmTarget(null);
  }

  const builtInCount = categories.filter(c => c.isBuiltIn).length;
  const customCount  = categories.filter(c => !c.isBuiltIn).length;
  const editingBuiltIn = !!(editId && categories.find(c => c._id === editId)?.isBuiltIn);

  return (
    <Stack>
      {/* Header */}
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm">
          <Title order={2}>Routing Categories</Title>
          <Badge variant="light" color="gray">{categories.length}</Badge>
          {builtInCount > 0 && <Badge variant="dot" color="gray" size="sm">{builtInCount} built-in</Badge>}
          {customCount  > 0 && <Badge variant="dot" color="violet" size="sm">{customCount} custom</Badge>}
        </Group>
        <Group gap="sm" wrap="nowrap">
          <SegmentedControl
            size="xs"
            value={view}
            onChange={setView}
            data={[
              { value: 'list', label: 'List' },
              { value: 'card', label: 'Cards' },
            ]}
          />
          <Tooltip label="Re-create any deleted built-in categories">
            <Button
              variant="light"
              leftSection={<IconRefresh size={16} />}
              onClick={confirmReset}
              loading={resetting}
              size="sm"
            >
              Reset Defaults
            </Button>
          </Tooltip>
          <Button leftSection={<IconPlus size={16} />} onClick={openAdd} size="sm">
            Add Category
          </Button>
        </Group>
      </Group>

      {/* ── List view ──────────────────────────────────────────────────────── */}
      {view === 'list' && (
        <Paper withBorder radius="md" style={{ overflowX: 'auto' }}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40}>#</Table.Th>
                <Table.Th>Key</Table.Th>
                <Table.Th>Name</Table.Th>
                <Table.Th>Tier</Table.Th>
                <Table.Th>Examples</Table.Th>
                <Table.Th w={90}>Type</Table.Th>
                <Table.Th w={72}></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {categories.map(c => (
                <Table.Tr key={c._id}>
                  <Table.Td><Text size="xs" c="dimmed">{c.order}</Text></Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Text size="sm" ff="monospace">{c.key}</Text>
                      {c.requiresVision && (
                        <Tooltip label="Requires vision">
                          <IconEye size={12} style={{ color: 'var(--mantine-color-blue-5)', flexShrink: 0 }} />
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{c.name}</Text>
                    {c.description && <Text size="xs" c="dimmed" lineClamp={1}>{c.description}</Text>}
                  </Table.Td>
                  <Table.Td>
                    <Badge color={TIER_COLORS[c.costTier]} size="sm">{c.costTier}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed" lineClamp={1} style={{ maxWidth: 260 }}>
                      {c.examples?.join(' · ')}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" size="sm" color={c.isBuiltIn ? 'gray' : 'violet'}>
                      {c.isBuiltIn ? 'built-in' : 'custom'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end">
                      <ActionIcon size="sm" variant="subtle" onClick={() => openEdit(c)}>
                        <IconEdit size={14} />
                      </ActionIcon>
                      <ActionIcon size="sm" variant="subtle" color="red" onClick={() => confirmDelete(c)}>
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
              {categories.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={7}>
                    <Text c="dimmed" ta="center" py="md">
                      No categories yet — click "Reset Defaults" to load built-in categories.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Paper>
      )}

      {/* ── Card view ──────────────────────────────────────────────────────── */}
      {view === 'card' && (
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="sm">
          {categories.map(c => (
            <Card key={c._id} withBorder radius="md" p="sm" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* Row: tier badge + icons + menu */}
              <Group justify="space-between" wrap="nowrap">
                <Group gap={5} wrap="nowrap">
                  <Badge color={TIER_COLORS[c.costTier]} size="sm" style={{ flexShrink: 0 }}>
                    {c.costTier}
                  </Badge>
                  {c.requiresVision && (
                    <Tooltip label="Requires vision capability">
                      <ThemeIcon size={18} variant="light" color="blue" radius="xl" style={{ flexShrink: 0 }}>
                        <IconEye size={11} />
                      </ThemeIcon>
                    </Tooltip>
                  )}
                  {c.isBuiltIn && (
                    <Tooltip label="Built-in category">
                      <ThemeIcon size={18} variant="light" color="gray" radius="xl" style={{ flexShrink: 0 }}>
                        <IconShield size={11} />
                      </ThemeIcon>
                    </Tooltip>
                  )}
                </Group>
                <Menu withinPortal position="bottom-end" shadow="sm">
                  <Menu.Target>
                    <ActionIcon size="sm" variant="subtle">
                      <IconDotsVertical size={14} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => openEdit(c)}>
                      Edit
                    </Menu.Item>
                    <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={() => confirmDelete(c)}>
                      Delete
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>

              {/* Name + key */}
              <Text size="sm" fw={600} lineClamp={1}>{c.name}</Text>
              <Text size="xs" ff="monospace" c="dimmed">{c.key}</Text>

              {/* Description */}
              {c.description && (
                <Text size="xs" c="dimmed" lineClamp={2}>{c.description}</Text>
              )}

              {/* Example tags */}
              {c.examples?.length > 0 && (
                <Group gap={4} wrap="wrap" style={{ marginTop: 'auto' }}>
                  {c.examples.slice(0, 3).map((ex, i) => (
                    <Badge key={i} variant="dot" size="xs" color="gray">{ex}</Badge>
                  ))}
                  {c.examples.length > 3 && (
                    <Text size="xs" c="dimmed">+{c.examples.length - 3}</Text>
                  )}
                </Group>
              )}
            </Card>
          ))}

          {/* "Add" card */}
          <Card
            withBorder
            radius="md"
            p="sm"
            onClick={openAdd}
            style={{
              border: '2px dashed var(--mantine-color-default-border)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 100,
            }}
          >
            <Stack align="center" gap={4}>
              <IconPlus size={22} style={{ color: 'var(--mantine-color-dimmed)' }} />
              <Text size="sm" c="dimmed">Add Category</Text>
            </Stack>
          </Card>
        </SimpleGrid>
      )}

      {/* ── Confirm Modal ──────────────────────────────────────────────────── */}
      <Modal
        opened={!!confirmTarget}
        onClose={() => setConfirmTarget(null)}
        title={
          <Group gap="xs">
            <IconAlertTriangle size={18} color="var(--mantine-color-orange-5)" />
            <Text fw={600}>
              {confirmTarget?.type === 'delete' ? `Delete "${confirmTarget.cat?.name}"?` : 'Reset system defaults?'}
            </Text>
          </Group>
        }
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            {confirmTarget?.type === 'delete'
              ? (confirmTarget.cat?.isBuiltIn
                  ? 'This is a built-in category. You can restore it later with "Reset Defaults".'
                  : 'This custom category will be permanently deleted.')
              : 'This will re-create any deleted built-in categories. Existing categories are not changed.'}
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setConfirmTarget(null)}>Cancel</Button>
            <Button
              color={confirmTarget?.type === 'delete' ? 'red' : 'blue'}
              onClick={executeConfirm}
              loading={confirmLoading}
            >
              {confirmTarget?.type === 'delete' ? 'Delete' : 'Reset Defaults'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* ── Add / Edit Modal ────────────────────────────────────────────────── */}
      <Modal
        opened={opened}
        onClose={close}
        title={
          <Group gap="sm">
            <Text fw={600}>{editId ? 'Edit Category' : 'New Category'}</Text>
            {editId && <Badge variant="light" color={editingBuiltIn ? 'gray' : 'violet'} size="sm">
              {editingBuiltIn ? 'built-in' : 'custom'}
            </Badge>}
          </Group>
        }
        size="md"
      >
        <Stack gap="sm">
          <Group grow>
            <TextInput
              label="Key"
              placeholder="coding_complex"
              description="Unique identifier (snake_case)"
              value={form.key}
              onChange={e => setForm(f => ({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))}
              disabled={editingBuiltIn}
              required
            />
            <Select
              label="Cost Tier"
              data={TIER_OPTIONS}
              value={form.costTier}
              onChange={v => setForm(f => ({ ...f, costTier: v }))}
              required
            />
          </Group>

          <TextInput
            label="Name"
            placeholder="Complex Coding"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            required
          />

          <Textarea
            label="Description"
            placeholder="When should this category be used?"
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={2}
          />

          <TagsInput
            label="Examples"
            placeholder="Type and press Enter to add"
            description="Sample prompts that belong to this category"
            value={form.examples}
            onChange={v => setForm(f => ({ ...f, examples: v }))}
          />

          <TextInput
            label="Default Model"
            placeholder="e.g. gpt-4o  (overrides tenant default for this category)"
            value={form.defaultModel}
            onChange={e => setForm(f => ({ ...f, defaultModel: e.target.value }))}
          />

          <Textarea
            label="Target System Prompt"
            description="Injected into every non-FIM request that lands on this category. Combined with the tenant's default system prompt. Leave empty to skip."
            placeholder='e.g. "You are an expert software engineer. Prefer idiomatic code, call out edge cases."'
            value={form.targetSystemPrompt}
            onChange={e => setForm(f => ({ ...f, targetSystemPrompt: e.target.value }))}
            rows={3}
            autosize
            maxRows={8}
          />

          <Checkbox
            label="Requires vision capability"
            description="Flag requests with images to route to vision-capable models"
            checked={form.requiresVision}
            onChange={e => setForm(f => ({ ...f, requiresVision: e.currentTarget.checked }))}
          />

          <Divider />

          <Group justify="flex-end">
            <Button variant="subtle" onClick={close}>Cancel</Button>
            <Button onClick={save} loading={saving}>
              {editId ? 'Save Changes' : 'Create Category'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
