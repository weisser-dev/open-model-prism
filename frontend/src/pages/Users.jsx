import { useEffect, useState } from 'react';
import {
  Title, Paper, Table, Button, Group, Modal, TextInput, PasswordInput,
  Stack, Badge, ActionIcon, Text, Select, MultiSelect, Switch, Alert,
} from '@mantine/core';
import { IconPlus, IconPencil, IconTrash, IconAlertCircle } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import api from '../hooks/useApi';

const ROLES = [
  { value: 'admin',              label: 'Admin — full system access' },
  { value: 'maintainer',         label: 'Maintainer — config management' },
  { value: 'finops',             label: 'FinOps — cost visibility (no prompts)' },
  { value: 'auditor',            label: 'Auditor — read-only global (Enterprise)' },
  { value: 'tenant-maintainer',  label: 'Tenant Maintainer — keys, overrides, budgets' },
  { value: 'tenant-admin',       label: 'Tenant Admin — model whitelist/blacklist' },
  { value: 'tenant-viewer',      label: 'Tenant Viewer — dashboard read-only' },
  { value: 'chat-user',          label: 'Chat User — chat only (LDAP default)' },
];

const ROLE_COLORS = {
  admin: 'red',
  maintainer: 'orange',
  finops: 'teal',
  auditor: 'cyan',
  'tenant-maintainer': 'violet',
  'tenant-admin': 'indigo',
  'tenant-viewer': 'blue',
  'chat-user': 'gray',
};

function roleBadge(role) {
  return <Badge color={ROLE_COLORS[role] ?? 'gray'}>{role}</Badge>;
}

function sourceBadge(source) {
  return (
    <Badge color={source === 'ldap' ? 'violet' : 'blue'} variant="light">
      {source === 'ldap' ? 'LDAP' : 'Local'}
    </Badge>
  );
}

function activeBadge(active) {
  return <Badge color={active ? 'green' : 'gray'}>{active ? 'Active' : 'Inactive'}</Badge>;
}

function formatLastLogin(ts) {
  if (!ts) return <Text c="dimmed" size="sm">Never</Text>;
  return (
    <Text size="sm">
      {new Date(ts).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })}
    </Text>
  );
}

const EMPTY_CREATE = { username: '', password: '', role: 'chat-user', tenants: [] };
const EMPTY_EDIT = { role: '', tenants: [], active: true, password: '' };

export default function Users({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null); // user object
  const [createForm, setCreateForm] = useState(EMPTY_CREATE);
  const [editForm, setEditForm] = useState(EMPTY_EDIT);
  const [loading, setLoading] = useState(false);
  const [modalError, setModalError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const [u, t] = await Promise.all([
        api.get('/api/prism/admin/users'),
        api.get('/api/prism/admin/tenants'),
      ]);
      setUsers(u.data);
      setTenants(t.data);
    } catch {
      notifications.show({ title: 'Error', message: 'Failed to load users', color: 'red' });
    }
  }

  const tenantOptions = tenants.map(t => ({ value: t._id, label: t.name }));

  // --- Create ---
  function openCreate() {
    setCreateForm(EMPTY_CREATE);
    setModalError('');
    setCreateOpen(true);
  }

  async function submitCreate() {
    setModalError('');
    if (!createForm.username.trim()) { setModalError('Username is required.'); return; }
    if (createForm.password.length < 8) { setModalError('Password must be at least 8 characters.'); return; }
    setLoading(true);
    try {
      await api.post('/api/prism/admin/users', {
        username: createForm.username.trim(),
        password: createForm.password,
        role: createForm.role,
        tenants: createForm.tenants,
      });
      notifications.show({ title: 'User created', message: createForm.username, color: 'green' });
      setCreateOpen(false);
      load();
    } catch (err) {
      setModalError(err.response?.data?.error || 'Failed to create user.');
    }
    setLoading(false);
  }

  // --- Edit ---
  function openEdit(user) {
    setEditTarget(user);
    setEditForm({
      role: user.role,
      tenants: (user.tenants || []).map(t => (typeof t === 'object' ? t._id : t)),
      active: user.active,
      password: '',
    });
    setModalError('');
  }

  async function submitEdit() {
    setModalError('');
    if (editForm.password && editForm.password.length < 8) {
      setModalError('New password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    const payload = {
      role: editForm.role,
      tenants: editForm.tenants,
      active: editForm.active,
    };
    if (editForm.password) payload.password = editForm.password;
    try {
      await api.put(`/api/prism/admin/users/${editTarget._id}`, payload);
      notifications.show({ title: 'User updated', message: editTarget.username, color: 'green' });
      setEditTarget(null);
      load();
    } catch (err) {
      setModalError(err.response?.data?.error || 'Failed to update user.');
    }
    setLoading(false);
  }

  // --- Delete ---
  async function deleteUser(user) {
    if (!window.confirm(`Delete user "${user.username}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/prism/admin/users/${user._id}`);
      notifications.show({ title: 'User deleted', message: user.username, color: 'orange' });
      load();
    } catch (err) {
      notifications.show({
        title: 'Error',
        message: err.response?.data?.error || 'Failed to delete user.',
        color: 'red',
      });
    }
  }

  const isSelf = (user) => currentUser && (user._id === currentUser.id || user.username === currentUser.username);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Users</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
          Add User
        </Button>
      </Group>

      <Paper withBorder radius="md" style={{ overflowX: 'auto' }}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Username</Table.Th>
              <Table.Th>Role</Table.Th>
              <Table.Th>Type</Table.Th>
              <Table.Th>Tenants</Table.Th>
              <Table.Th>Active</Table.Th>
              <Table.Th>Last Login</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.map(user => (
              <Table.Tr key={user._id}>
                <Table.Td>
                  <Text fw={500}>{user.username}</Text>
                </Table.Td>
                <Table.Td>{roleBadge(user.role)}</Table.Td>
                <Table.Td>{sourceBadge(user.source)}</Table.Td>
                <Table.Td>
                  {user.tenants && user.tenants.length > 0 ? (
                    <Badge variant="light" color="indigo">
                      {user.tenants.length} tenant{user.tenants.length !== 1 ? 's' : ''}
                    </Badge>
                  ) : (
                    <Text c="dimmed" size="sm">None</Text>
                  )}
                </Table.Td>
                <Table.Td>{activeBadge(user.active)}</Table.Td>
                <Table.Td>{formatLastLogin(user.lastLogin)}</Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <ActionIcon
                      variant="subtle"
                      color="blue"
                      title="Edit user"
                      onClick={() => openEdit(user)}
                    >
                      <IconPencil size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      title={isSelf(user) ? 'Cannot delete yourself' : 'Delete user'}
                      disabled={isSelf(user)}
                      onClick={() => deleteUser(user)}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {users.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={7}>
                  <Text c="dimmed" ta="center" py="md">No users found</Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Paper>

      {/* Create Modal */}
      <Modal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add Local User"
        size="md"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Only local users can be created here. LDAP users are created automatically on first login.
          </Text>

          {modalError && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
              {modalError}
            </Alert>
          )}

          <TextInput
            label="Username"
            placeholder="jsmith"
            required
            value={createForm.username}
            onChange={e => setCreateForm({ ...createForm, username: e.target.value })}
          />
          <PasswordInput
            label="Password"
            placeholder="Min 8 characters"
            required
            value={createForm.password}
            onChange={e => setCreateForm({ ...createForm, password: e.target.value })}
          />
          <Select
            label="Role"
            data={ROLES}
            value={createForm.role}
            onChange={v => setCreateForm({ ...createForm, role: v })}
          />
          <MultiSelect
            label="Tenants"
            description="Assign one or more tenants to this user"
            placeholder="Select tenants..."
            data={tenantOptions}
            value={createForm.tenants}
            onChange={v => setCreateForm({ ...createForm, tenants: v })}
            searchable
            clearable
          />
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={submitCreate} loading={loading}>Create User</Button>
          </Group>
        </Stack>
      </Modal>

      {/* Edit Modal */}
      <Modal
        opened={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={editTarget ? `Edit User: ${editTarget.username}` : 'Edit User'}
        size="md"
      >
        <Stack>
          {modalError && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
              {modalError}
            </Alert>
          )}

          <Select
            label="Role"
            data={ROLES}
            value={editForm.role}
            onChange={v => setEditForm({ ...editForm, role: v })}
          />
          <MultiSelect
            label="Tenants"
            description="Assign one or more tenants to this user"
            placeholder="Select tenants..."
            data={tenantOptions}
            value={editForm.tenants}
            onChange={v => setEditForm({ ...editForm, tenants: v })}
            searchable
            clearable
          />
          <Switch
            label="Active"
            description="Inactive users cannot log in"
            checked={editForm.active}
            onChange={e => setEditForm({ ...editForm, active: e.currentTarget.checked })}
          />
          <PasswordInput
            label="New Password"
            description="Leave blank to keep the existing password"
            placeholder="Leave blank to keep existing"
            value={editForm.password}
            onChange={e => setEditForm({ ...editForm, password: e.target.value })}
          />
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={submitEdit} loading={loading}>Save Changes</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
