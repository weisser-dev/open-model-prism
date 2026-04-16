import { useEffect, useState } from 'react';
import {
  Title, Paper, Stack, Switch, TextInput, PasswordInput, Select, Button,
  Group, Table, ActionIcon, Text, Alert, Divider, Badge,
} from '@mantine/core';
import { IconPlus, IconTrash, IconAlertCircle, IconCircleCheck } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import api from '../hooks/useApi';

const ROLE_OPTIONS = [
  { value: 'maintainer', label: 'Maintainer' },
  { value: 'finops', label: 'FinOps' },
  { value: 'tenant-viewer', label: 'Tenant Viewer' },
];

const DEFAULT_CONFIG = {
  enabled: false,
  url: '',
  bindDn: '',
  bindPassword: '',
  searchBase: '',
  searchFilter: '(uid={{username}})',
  tlsInsecure: false,
  defaultRole: 'tenant-viewer',
  groupMappings: [],
};

function newMapping() {
  return { groupDn: '', role: 'tenant-viewer', _key: Math.random().toString(36).slice(2) };
}

export default function LdapSettings() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { success, message }
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const { data } = await api.get('/api/prism/admin/ldap');
      setConfig({
        ...DEFAULT_CONFIG,
        ...data,
        bindPassword: '',
        groupMappings: (data.groupMappings || []).map(m => ({
          ...m,
          _key: Math.random().toString(36).slice(2),
        })),
      });
    } catch (err) {
      notifications.show({
        title: 'Error',
        message: err.response?.data?.error || 'Failed to load LDAP configuration.',
        color: 'red',
      });
    } finally {
      setLoaded(true);
    }
  }

  function set(field, value) {
    setConfig(prev => ({ ...prev, [field]: value }));
  }

  // --- Group mappings ---
  function addMapping() {
    setConfig(prev => ({ ...prev, groupMappings: [...prev.groupMappings, newMapping()] }));
  }

  function updateMapping(key, field, value) {
    setConfig(prev => ({
      ...prev,
      groupMappings: prev.groupMappings.map(m =>
        m._key === key ? { ...m, [field]: value } : m
      ),
    }));
  }

  function removeMapping(key) {
    setConfig(prev => ({
      ...prev,
      groupMappings: prev.groupMappings.filter(m => m._key !== key),
    }));
  }

  // --- Test connection ---
  async function testConnection() {
    setTestResult(null);
    setTesting(true);
    try {
      const { data } = await api.post('/api/prism/admin/ldap/test', {
        url: config.url,
        bindDn: config.bindDn,
        bindPassword: config.bindPassword,
        tlsInsecure: config.tlsInsecure,
      });
      setTestResult({ success: data.success, message: data.message || data.error || 'OK' });
    } catch (err) {
      setTestResult({
        success: false,
        message: err.response?.data?.error || 'Connection test failed.',
      });
    }
    setTesting(false);
  }

  // --- Save ---
  async function save() {
    setSaving(true);
    setTestResult(null);
    try {
      const payload = {
        enabled: config.enabled,
        url: config.url,
        bindDn: config.bindDn,
        searchBase: config.searchBase,
        searchFilter: config.searchFilter,
        tlsInsecure: config.tlsInsecure,
        defaultRole: config.defaultRole,
        groupMappings: config.groupMappings.map(({ groupDn, role }) => ({ groupDn, role })),
      };
      if (config.bindPassword) payload.bindPassword = config.bindPassword;
      await api.put('/api/prism/admin/ldap', payload);
      notifications.show({ title: 'Saved', message: 'LDAP configuration saved.', color: 'green' });
    } catch (err) {
      notifications.show({
        title: 'Error',
        message: err.response?.data?.error || 'Failed to save LDAP configuration.',
        color: 'red',
      });
    }
    setSaving(false);
  }

  const disabled = !config.enabled;

  if (!loaded) return <Text c="dimmed">Loading...</Text>;

  return (
    <Stack>
      <Title order={2}>LDAP / Active Directory Settings</Title>

      {/* Enable toggle */}
      <Paper withBorder radius="md" p="lg">
        <Group>
          <Switch
            size="lg"
            label="Enable LDAP Authentication"
            description="Allow users to sign in using your LDAP/AD directory"
            checked={config.enabled}
            onChange={e => set('enabled', e.currentTarget.checked)}
            styles={{ label: { fontWeight: 600, fontSize: 16 } }}
          />
          {config.enabled && (
            <Badge color="green" variant="light" ml="auto">Enabled</Badge>
          )}
        </Group>
      </Paper>

      {/* Config form */}
      <Paper withBorder radius="md" p="lg">
        <Stack>
          <Text fw={600} size="lg">Server Configuration</Text>

          <TextInput
            label="Server URL"
            placeholder="ldap://host:389 or ldaps://host:636"
            description="Use ldaps:// for SSL/TLS encrypted connections"
            disabled={disabled}
            value={config.url}
            onChange={e => set('url', e.target.value)}
          />
          <TextInput
            label="Bind DN"
            placeholder="cn=service,dc=example,dc=com"
            description="Service account used to search the directory"
            disabled={disabled}
            value={config.bindDn}
            onChange={e => set('bindDn', e.target.value)}
          />
          <PasswordInput
            label="Bind Password"
            placeholder="Leave blank to keep existing"
            description="Current password is stored securely and not displayed"
            disabled={disabled}
            value={config.bindPassword}
            onChange={e => set('bindPassword', e.target.value)}
          />
          <TextInput
            label="Search Base"
            placeholder="ou=users,dc=example,dc=com"
            description="Base DN to search for users"
            disabled={disabled}
            value={config.searchBase}
            onChange={e => set('searchBase', e.target.value)}
          />
          <TextInput
            label="Search Filter"
            placeholder="(uid={{username}})"
            description="Use {{username}} as a placeholder for the login username"
            disabled={disabled}
            value={config.searchFilter}
            onChange={e => set('searchFilter', e.target.value)}
          />
          <Switch
            label="Skip TLS Verification"
            description="Disable certificate validation — use only for self-signed certs in trusted environments"
            disabled={disabled}
            checked={config.tlsInsecure}
            onChange={e => set('tlsInsecure', e.currentTarget.checked)}
          />
          <Select
            label="Default Role for New LDAP Users"
            description="Applied when no group mapping matches"
            disabled={disabled}
            data={ROLE_OPTIONS}
            value={config.defaultRole}
            onChange={v => set('defaultRole', v)}
          />
        </Stack>
      </Paper>

      {/* Group mappings */}
      <Paper withBorder radius="md" p="lg">
        <Stack>
          <Group justify="space-between" align="center">
            <Stack gap={2}>
              <Text fw={600} size="lg">Group to Role Mappings</Text>
              <Text size="sm" c="dimmed">
                First matching group wins. Order matters — drag or delete rows to reorder.
              </Text>
            </Stack>
            <Button
              leftSection={<IconPlus size={16} />}
              variant="light"
              disabled={disabled}
              onClick={addMapping}
            >
              Add Mapping
            </Button>
          </Group>

          <div style={{ overflowX: 'auto' }}>
          <Table withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: '50%' }}>Group DN</Table.Th>
                <Table.Th style={{ width: '35%' }}>Assigned Role</Table.Th>
                <Table.Th style={{ width: '15%' }}></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {config.groupMappings.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={3}>
                    <Text c="dimmed" ta="center" py="sm">
                      No group mappings configured — all LDAP users will receive the default role.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : (
                config.groupMappings.map((mapping, index) => (
                  <Table.Tr key={mapping._key}>
                    <Table.Td>
                      <TextInput
                        placeholder="cn=admins,ou=groups,dc=example,dc=com"
                        disabled={disabled}
                        value={mapping.groupDn}
                        onChange={e => updateMapping(mapping._key, 'groupDn', e.target.value)}
                        aria-label={`Group DN for mapping ${index + 1}`}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Select
                        data={ROLE_OPTIONS}
                        disabled={disabled}
                        value={mapping.role}
                        onChange={v => updateMapping(mapping._key, 'role', v)}
                        aria-label={`Role for mapping ${index + 1}`}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Group justify="center">
                        <ActionIcon
                          color="red"
                          variant="subtle"
                          disabled={disabled}
                          onClick={() => removeMapping(mapping._key)}
                          title="Remove mapping"
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>
          </div>
        </Stack>
      </Paper>

      {/* Info note */}
      <Alert icon={<IconAlertCircle size={16} />} color="blue" variant="light">
        LDAP users are created automatically on first login. Roles are assigned via group mapping (first match wins)
        or the default role above. Existing users' roles can be overridden manually from the Users page.
      </Alert>

      {/* Test result */}
      {testResult && (
        <Alert
          icon={testResult.success ? <IconCircleCheck size={16} /> : <IconAlertCircle size={16} />}
          color={testResult.success ? 'green' : 'red'}
          variant="light"
          title={testResult.success ? 'Connection successful' : 'Connection failed'}
        >
          {testResult.message}
        </Alert>
      )}

      <Divider />

      {/* Actions */}
      <Group>
        <Button
          variant="default"
          loading={testing}
          disabled={disabled || saving}
          onClick={testConnection}
        >
          Test Connection
        </Button>
        <Button
          loading={saving}
          disabled={testing}
          onClick={save}
        >
          Save Configuration
        </Button>
      </Group>
    </Stack>
  );
}
