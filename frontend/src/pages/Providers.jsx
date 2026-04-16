import { useEffect, useRef, useState } from 'react';
import {
  Title, Paper, Table, Button, Group, Modal, TextInput, Select,
  PasswordInput, Stack, Badge, ActionIcon, Text, Switch, Drawer,
  ScrollArea, Textarea, Loader, Code, Divider, Alert,
} from '@mantine/core';
import {
  IconPlus, IconPlugConnected, IconSearch, IconTrash, IconEdit,
  IconMessageCircle, IconSend, IconListCheck, IconBuilding,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import api from '../hooks/useApi';

const PROVIDER_TYPES = [
  { value: 'openai', label: 'OpenAI Compatible' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'vllm', label: 'vLLM' },
  { value: 'bedrock', label: 'AWS Bedrock (Native)' },
  { value: 'bedrock-proxy', label: 'AWS Bedrock (via Proxy)' },
  { value: 'azure', label: 'Azure OpenAI (Native)' },
  { value: 'azure-proxy', label: 'Azure OpenAI (via Proxy)' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'custom', label: 'Custom' },
];

const EMPTY_FORM = { name: '', slug: '', type: 'openai', baseUrl: '', apiKey: '', skipSSL: false, httpProxy: '', accessKeyId: '', secretAccessKey: '', region: 'us-east-1', vpcEndpointRuntime: '', vpcEndpointControl: '', showVpcEndpoints: false, deployments: '', responsesModels: '', apiVersion: '2025-04-01-preview' };

// Auto-prefix slug based on provider type
function autoSlugPrefix(type) {
  if (type === 'bedrock' || type === 'bedrock-proxy') return 'aws-';
  if (type === 'azure' || type === 'azure-proxy') return 'az-';
  return '';
}

// Detect versioned path suffixes that should not be part of the base URL
// e.g. /v1, /v2, /v10 — only the version segment itself, not preceding path
const VERSION_PATH_RE = /\/v\d+\/?$/i;

function detectUrlIssue(url) {
  if (!url) return null;
  const match = url.match(VERSION_PATH_RE);
  if (match) {
    const stripped = url.slice(0, url.length - match[0].length).replace(/\/$/, '') || url;
    return { suffix: match[0].replace(/\/$/, ''), stripped };
  }
  return null;
}

export default function Providers() {
  const [providers, setProviders] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editProvider, setEditProvider] = useState(null); // provider being edited
  const [form, setForm] = useState(EMPTY_FORM);
  const [urlWarning, setUrlWarning] = useState(null); // { suffix, stripped }
  const [addToDefaultPrompt, setAddToDefaultPrompt] = useState(null); // { providerId, providerName }
  const [loading, setLoading] = useState(false);

  // Connection log modal
  const [connLog, setConnLog] = useState(null); // { providerName, log: [], success }

  // Try Models drawer
  const [tryProvider, setTryProvider] = useState(null);
  const [tryModel, setTryModel] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => { loadProviders(); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function loadProviders() {
    const { data } = await api.get('/api/prism/admin/providers');
    setProviders(data);
  }

  function openCreate() {
    setEditProvider(null);
    setForm(EMPTY_FORM);
    setUrlWarning(null);
    setModalOpen(true);
  }

  function openEdit(p) {
    setEditProvider(p);
    const baseUrl = p.config?.baseUrl || '';
    const hasVpc = !!(p.config?.options?.vpcEndpointRuntime || p.config?.options?.vpcEndpointControl);
    setForm({
      name: p.name,
      slug: p.slug || '',
      type: p.type,
      baseUrl,
      apiKey: '', // never prefill secret
      accessKeyId: '', // never prefill — backend preserves existing if empty
      secretAccessKey: '', // never prefill — backend preserves existing if empty
      skipSSL: p.config?.options?.skipSSL || false,
      httpProxy: p.config?.options?.httpProxy || '',
      region: p.config?.auth?.region || 'us-east-1',
      vpcEndpointRuntime: p.config?.options?.vpcEndpointRuntime || '',
      vpcEndpointControl: p.config?.options?.vpcEndpointControl || '',
      showVpcEndpoints: hasVpc,
      deployments: p.config?.options?.deployments || '',
      responsesModels: p.config?.options?.responsesModels || '',
      apiVersion: p.config?.options?.apiVersion || '2025-04-01-preview',
      _slugManual: true, // don't auto-generate on edit
      _hasCredentials: !!(p.config?.auth?.hasCredentials), // track if credentials exist
    });
    setUrlWarning(detectUrlIssue(baseUrl));
    setModalOpen(true);
  }

  function handleBaseUrlChange(value) {
    setForm(f => ({ ...f, baseUrl: value }));
    setUrlWarning(detectUrlIssue(value));
  }

  async function saveProvider() {
    setLoading(true);
    try {
      const isBedrock = form.type === 'bedrock';
      const isAzure = form.type === 'azure';
      const prefix = autoSlugPrefix(form.type);
      const slug = form.slug || undefined;

      // Auto-prefix https:// on VPC endpoints if missing
      const ensureHttps = (url) => {
        if (!url) return undefined;
        url = url.trim();
        if (!url) return undefined;
        if (!/^https?:\/\//i.test(url)) return `https://${url}`;
        return url;
      };

      // Build Bedrock auth — only include credentials if user entered new ones
      const bedrockAuth = { type: 'aws_credentials', region: form.region || 'us-east-1' };
      if (form.accessKeyId) bedrockAuth.accessKeyId = form.accessKeyId;
      if (form.secretAccessKey) bedrockAuth.secretAccessKey = form.secretAccessKey;

      const payload = {
        name: form.name,
        slug: slug && !slug.startsWith(prefix) && prefix ? prefix + slug : slug,
        type: form.type,
        config: {
          baseUrl: form.baseUrl || undefined,
          auth: isBedrock ? bedrockAuth : { type: 'api_key', apiKey: form.apiKey },
          options: {
            skipSSL: form.skipSSL,
            ...(form.httpProxy && { httpProxy: form.httpProxy }),
            ...(isBedrock && {
              // Only send VPC endpoints when toggle is on; explicitly clear when off
              vpcEndpointRuntime: form.showVpcEndpoints ? ensureHttps(form.vpcEndpointRuntime) : '',
              vpcEndpointControl: form.showVpcEndpoints ? ensureHttps(form.vpcEndpointControl) : '',
            }),
            ...(isAzure && {
              deployments: form.deployments || '',
              responsesModels: form.responsesModels || '',
              apiVersion: form.apiVersion || '2025-04-01-preview',
            }),
          },
        },
      };
      let savedId;
      const urlChanged = !editProvider || (editProvider.config?.baseUrl !== form.baseUrl);
      if (editProvider) {
        const { data } = await api.put(`/api/prism/admin/providers/${editProvider._id}`, payload);
        savedId = editProvider._id;
        notifications.show({ title: 'Saved', message: 'Provider updated', color: 'green' });
      } else {
        const { data } = await api.post('/api/prism/admin/providers', payload);
        savedId = data._id;
        notifications.show({ title: 'Created', message: 'Provider added', color: 'green' });
      }
      setModalOpen(false);
      setForm(EMPTY_FORM);
      setEditProvider(null);
      setUrlWarning(null);
      loadProviders();

      // Auto test + discover when URL is set and changed
      if (savedId && form.baseUrl && urlChanged) {
        // 1. Test connection
        try {
          await api.post(`/api/prism/admin/providers/${savedId}/test`);
          notifications.show({ title: 'Connection OK', message: 'Provider is reachable', color: 'green' });
        } catch (testErr) {
          notifications.show({
            title: 'Connection failed',
            message: testErr.response?.data?.error || 'Could not reach provider — check URL and key',
            color: 'orange',
          });
        }
        loadProviders();

        // 2. Discover models
        try {
          const { data: discoverData } = await api.post(`/api/prism/admin/providers/${savedId}/discover`);
          const pathNote = discoverData.apiPath && discoverData.apiPath !== '/v1' ? ` via ${discoverData.apiPath}` : '';
          notifications.show({ title: 'Models fetched', message: `Found ${discoverData.count} models${pathNote}`, color: 'teal' });
          loadProviders();
          // For new providers: prompt to add to default tenant
          if (!editProvider) {
            setAddToDefaultPrompt({ providerId: savedId, providerName: form.name });
          }
        } catch {
          notifications.show({ title: 'Model fetch failed', message: 'Try "Discover Models" manually.', color: 'yellow' });
        }
      }
    } catch (err) {
      notifications.show({ title: 'Error', message: err.response?.data?.error || 'Failed', color: 'red' });
    }
    setLoading(false);
  }

  async function testConnection(id) {
    try {
      await api.post(`/api/prism/admin/providers/${id}/test`);
      notifications.show({ title: 'Connected', message: 'Connection successful', color: 'green' });
      loadProviders();
    } catch (err) {
      notifications.show({ title: 'Failed', message: err.response?.data?.error || 'Connection failed', color: 'red' });
      loadProviders();
    }
  }

  async function checkConnection(p) {
    setConnLog({ providerName: p.name, providerId: p._id, log: ['Checking...'], success: null, suggestUrl: null });
    try {
      const { data } = await api.post(`/api/prism/admin/providers/${p._id}/check`);
      setConnLog({ providerName: p.name, providerId: p._id, log: data.log, success: data.success, suggestUrl: data.suggestUrl || null });
      loadProviders();
    } catch (err) {
      const errData = err.response?.data;
      setConnLog({
        providerName: p.name,
        providerId: p._id,
        log: errData?.log || [`✗ Error: ${errData?.error || err.message}`],
        success: false,
        suggestUrl: null,
      });
      loadProviders();
    }
  }

  async function applyHttpsSuggestion(providerId, httpsUrl) {
    try {
      await api.put(`/api/prism/admin/providers/${providerId}`, { config: { baseUrl: httpsUrl } });
      notifications.show({ title: 'Updated', message: `Base URL switched to ${httpsUrl}`, color: 'green' });
      setConnLog(prev => ({ ...prev, suggestUrl: null }));
      loadProviders();
    } catch (err) {
      notifications.show({ title: 'Error', message: err.response?.data?.error || 'Failed', color: 'red' });
    }
  }

  async function discoverModels(id) {
    try {
      const { data } = await api.post(`/api/prism/admin/providers/${id}/discover`);
      const pathNote = data.apiPath && data.apiPath !== '/v1' ? ` via ${data.apiPath}` : '';
      notifications.show({ title: 'Models Discovered', message: `Found ${data.count} models${pathNote}`, color: 'green' });
      loadProviders();
    } catch (err) {
      notifications.show({ title: 'Discovery Failed', message: err.response?.data?.error || 'Failed', color: 'red' });
    }
  }

  async function deleteProvider(id) {
    if (!confirm('Delete this provider?')) return;
    await api.delete(`/api/prism/admin/providers/${id}`);
    loadProviders();
  }

  function openTryModels(p) {
    setTryProvider(p);
    setMessages([]);
    setInput('');
    const firstModel = p.discoveredModels?.[0]?.id || '';
    setTryModel(firstModel);
  }

  async function sendMessage() {
    if (!input.trim() || !tryModel || chatLoading) return;

    const userMsg = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setChatLoading(true);

    try {
      // Call provider directly via admin proxy endpoint
      const { data } = await api.post(`/api/prism/admin/providers/${tryProvider._id}/chat`, {
        model: tryModel,
        messages: newMessages,
      });
      const assistantContent = data.choices?.[0]?.message?.content || '(no response)';
      setMessages(prev => [...prev, { role: 'assistant', content: assistantContent }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err.response?.data?.error || err.message}`,
        error: true,
      }]);
    }
    setChatLoading(false);
  }

  const statusColor = { connected: 'green', error: 'red', unchecked: 'gray' };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Providers</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>Add Provider</Button>
      </Group>

      <Paper withBorder radius="md" style={{ overflowX: 'auto' }}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Type</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Models</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {providers.map(p => (
              <Table.Tr key={p._id}>
                <Table.Td>
                  {p.name}
                  {p.slug && <Code style={{ fontSize: 10, marginLeft: 6 }}>{p.slug}</Code>}
                </Table.Td>
                <Table.Td><Badge variant="light">{p.type}</Badge></Table.Td>
                <Table.Td>
                  <Badge color={statusColor[p.status]}>{p.status}</Badge>
                  {p.config?.options?.skipSSL && <Badge variant="outline" color="orange" size="xs" ml={4}>skipSSL</Badge>}
                  {p.config?.options?.apiPath && p.config.options.apiPath !== '/v1' && (
                    <Badge variant="outline" color="cyan" size="xs" ml={4}>{p.config.options.apiPath}</Badge>
                  )}
                </Table.Td>
                <Table.Td>{p.discoveredModels?.length || 0}</Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <ActionIcon variant="subtle" onClick={() => testConnection(p._id)} title="Test Connection">
                      <IconPlugConnected size={16} />
                    </ActionIcon>
                    <ActionIcon variant="subtle" color="blue" onClick={() => checkConnection(p)} title="Check Connection (with log)">
                      <IconListCheck size={16} />
                    </ActionIcon>
                    <ActionIcon variant="subtle" onClick={() => discoverModels(p._id)} title="Discover Models">
                      <IconSearch size={16} />
                    </ActionIcon>
                    <ActionIcon variant="subtle" color="violet" onClick={() => openTryModels(p)} title="Try Models"
                      disabled={!p.discoveredModels?.length}>
                      <IconMessageCircle size={16} />
                    </ActionIcon>
                    <ActionIcon variant="subtle" onClick={() => openEdit(p)} title="Edit">
                      <IconEdit size={16} />
                    </ActionIcon>
                    <ActionIcon variant="subtle" color="red" onClick={() => deleteProvider(p._id)} title="Delete">
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {providers.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={5}><Text c="dimmed" ta="center">No providers configured</Text></Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Paper>

      {/* Create / Edit Modal */}
      <Modal
        opened={modalOpen}
        onClose={() => { setModalOpen(false); setEditProvider(null); setForm(EMPTY_FORM); setUrlWarning(null); }}
        title={editProvider ? `Edit: ${editProvider.name}` : 'Add Provider'}
      >
        <Stack>
          <TextInput label="Name" value={form.name} onChange={e => {
            const name = e.target.value;
            const autoSlug = !editProvider && !form._slugManual;
            setForm({ ...form, name, ...(autoSlug ? { slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') } : {}) });
          }} />
          <TextInput
            label="Slug"
            description="Used in model IDs, e.g. my-provider/claude-haiku-4-5"
            placeholder="my-provider"
            value={form.slug}
            onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''), _slugManual: true })}
            styles={{ input: { fontFamily: 'monospace' } }}
          />
          <Select label="Type" value={form.type} onChange={v => setForm({ ...form, type: v })} data={PROVIDER_TYPES} />
          {form.type !== 'bedrock' && form.type !== 'azure' && (
            <TextInput
              label="Base URL"
              placeholder="https://api.openai.com"
              value={form.baseUrl}
              onChange={e => handleBaseUrlChange(e.target.value)}
            />
          )}
          {urlWarning && form.type !== 'bedrock' && form.type !== 'azure' && (
            <Alert color="yellow" title={`Versioned path detected: "${urlWarning.suffix}"`}>
              <Text size="sm" mb="xs">
                The gateway appends <Code>/v1/models</Code> automatically. Keeping <Code>{urlWarning.suffix}</Code>
                {' '}may cause double-path errors (e.g. <Code>{urlWarning.suffix}/v1/models</Code>).
              </Text>
              <Group gap="xs">
                <Button size="xs" variant="filled" color="yellow"
                  onClick={() => { setForm(f => ({ ...f, baseUrl: urlWarning.stripped })); setUrlWarning(null); }}>
                  Strip it → {urlWarning.stripped}
                </Button>
                <Button size="xs" variant="subtle" onClick={() => setUrlWarning(null)}>
                  Keep as-is
                </Button>
              </Group>
            </Alert>
          )}
          {form.type === 'bedrock' ? (<>
            {/* AWS Bedrock native auth */}
            <TextInput label="AWS Region" placeholder="us-east-1" value={form.region || ''}
              onChange={e => setForm({ ...form, region: e.target.value })} />
            <PasswordInput label="Access Key ID"
              placeholder={editProvider && form._hasCredentials ? '••••••• (saved — leave blank to keep)' : 'AKIA...'}
              description={editProvider && form._hasCredentials ? 'Credentials are saved. Leave blank to keep existing.' : 'Leave empty to use IAM role (EC2/ECS/Lambda default credential chain)'}
              value={form.accessKeyId || ''} onChange={e => setForm({ ...form, accessKeyId: e.target.value })} />
            <PasswordInput label="Secret Access Key"
              placeholder={editProvider && form._hasCredentials ? '••••••• (saved — leave blank to keep)' : 'wJalr...'}
              value={form.secretAccessKey || ''} onChange={e => setForm({ ...form, secretAccessKey: e.target.value })} />
            <Switch
              label="Use custom VPC endpoints"
              description="For private connectivity via AWS PrivateLink — most users don't need this"
              checked={!!form.showVpcEndpoints}
              onChange={e => setForm({ ...form, showVpcEndpoints: e.currentTarget.checked })}
            />
            {form.showVpcEndpoints && (<>
              <TextInput label="VPC Endpoint — Runtime" placeholder="https://vpce-xxx.bedrock-runtime.us-east-1.vpce.amazonaws.com"
                description="For chat/streaming calls (Converse API)"
                value={form.vpcEndpointRuntime || ''} onChange={e => setForm({ ...form, vpcEndpointRuntime: e.target.value })} />
              <TextInput label="VPC Endpoint — Control" placeholder="https://vpce-xxx.bedrock.us-east-1.vpce.amazonaws.com"
                description="For model listing/discovery"
                value={form.vpcEndpointControl || ''} onChange={e => setForm({ ...form, vpcEndpointControl: e.target.value })} />
            </>)}
          </>) : form.type === 'azure' ? (<>
            {/* Azure OpenAI native auth */}
            <TextInput label="Azure Endpoint" placeholder="https://my-resource.openai.azure.com"
              description="Your Azure OpenAI resource endpoint URL"
              value={form.baseUrl || ''} onChange={e => setForm({ ...form, baseUrl: e.target.value })} />
            <PasswordInput label="Azure API Key" placeholder={editProvider ? 'Leave blank to keep existing' : 'Azure OpenAI API key'}
              value={form.apiKey || ''} onChange={e => setForm({ ...form, apiKey: e.target.value })} />
            <Alert color="blue" p="xs" mb="xs">
              <Text size="xs">
                Azure doesn't support listing deployments via the Data Plane API (<a href="https://github.com/Azure/azure-rest-api-specs/tree/main/specification/cognitiveservices/data-plane/AzureOpenAI/inference/preview" target="_blank" rel="noopener" style={{color: 'var(--prism-accent)'}}>Azure REST API specs</a>).
                You must add your deployment names manually below. Some models (e.g. gpt-5.3-codex) only support the Responses API.
              </Text>
            </Alert>
            <Textarea label="Chat Completions Deployments" placeholder={"gpt-5.2\ngpt-5.3-chat"} required
              description="Required — one Azure deployment name per line. These use /openai/deployments/{name}/chat/completions"
              minRows={2} autosize error={!form.deployments && !form.responsesModels ? 'At least one deployment required' : null}
              value={(form.deployments || '').replace(/,/g, '\n')} onChange={e => setForm({ ...form, deployments: e.target.value.replace(/\n/g, ',') })} />
            <Textarea label="Responses API Models (optional)" placeholder={"gpt-5.3-codex"}
              description="Models using the newer Responses API (e.g. Codex) — uses /openai/responses with model in body"
              minRows={1} autosize
              value={(form.responsesModels || '').replace(/,/g, '\n')} onChange={e => setForm({ ...form, responsesModels: e.target.value.replace(/\n/g, ',') })} />
            <TextInput label="API Version" placeholder="2025-04-01-preview"
              description="Azure OpenAI API version (default: 2025-04-01-preview)"
              value={form.apiVersion || ''} onChange={e => setForm({ ...form, apiVersion: e.target.value })} />
          </>) : (
            <PasswordInput
              label="API Key"
              placeholder={editProvider ? 'Leave blank to keep existing key' : 'sk-...'}
              value={form.apiKey}
              onChange={e => setForm({ ...form, apiKey: e.target.value })}
            />
          )}
          <Switch
            label="Skip SSL verification"
            description="Useful for self-signed certificates (e.g. internal endpoints)"
            checked={form.skipSSL}
            onChange={e => setForm({ ...form, skipSSL: e.currentTarget.checked })}
          />
          <Switch
            label="Use HTTP proxy"
            description="Route requests through a proxy server (for corporate networks / firewalls)"
            checked={!!form.httpProxy}
            onChange={e => {
              if (e.currentTarget.checked) {
                // Pre-fill with last known proxy from other providers
                const knownProxy = providers
                  .filter(p => p._id !== editProvider?._id)
                  .map(p => p.config?.options?.httpProxy)
                  .find(Boolean);
                setForm({ ...form, httpProxy: form.httpProxy || knownProxy || 'http://' });
              } else {
                setForm({ ...form, httpProxy: '' });
              }
            }}
          />
          {form.httpProxy && (
            <TextInput
              label="HTTP/HTTPS Proxy URL"
              placeholder="http://proxy.internal:8080"
              description="Applied to all outbound requests from this provider"
              value={form.httpProxy}
              onChange={e => setForm({ ...form, httpProxy: e.target.value })}
            />
          )}
          <Button onClick={saveProvider} loading={loading} disabled={!form.name}>
            {editProvider ? 'Save Changes' : 'Create'}
          </Button>
        </Stack>
      </Modal>

      {/* Connection Log Modal */}
      <Modal
        opened={!!connLog}
        onClose={() => setConnLog(null)}
        title={connLog ? `Connection Check — ${connLog.providerName}` : ''}
      >
        {connLog && (
          <Stack>
            <Code block style={{ whiteSpace: 'pre-wrap' }}>
              {connLog.log.join('\n')}
            </Code>
            {connLog.success === null && <Loader size="xs" />}
            {connLog.success === true && <Text c="green" fw={600}>Connection successful</Text>}
            {connLog.success === false && <Text c="red" fw={600}>Connection failed</Text>}
            {connLog.suggestUrl && (
              <Alert color="blue" title="Switch to HTTPS?">
                <Text size="sm" mb="xs">HTTPS worked. Update this provider's base URL to <Code>{connLog.suggestUrl}</Code>?</Text>
                <Group gap="xs">
                  <Button size="xs" onClick={() => applyHttpsSuggestion(connLog.providerId, connLog.suggestUrl)}>
                    Update to HTTPS
                  </Button>
                  <Button size="xs" variant="subtle" onClick={() => setConnLog(c => ({ ...c, suggestUrl: null }))}>
                    Ignore
                  </Button>
                </Group>
              </Alert>
            )}
          </Stack>
        )}
      </Modal>

      {/* Try Models Drawer */}
      <Drawer
        opened={!!tryProvider}
        onClose={() => setTryProvider(null)}
        title={`Try Models — ${tryProvider?.name}`}
        position="right"
        size="lg"
      >
        {tryProvider && (
          <Stack h="calc(100vh - 120px)" style={{ display: 'flex', flexDirection: 'column' }}>
            <Select
              label="Model"
              value={tryModel}
              onChange={setTryModel}
              data={(tryProvider.discoveredModels || []).map(m => ({ value: m.id, label: m.name || m.id }))}
              placeholder="Select model..."
            />

            <Divider />

            {/* Messages */}
            <ScrollArea style={{ flex: 1 }} viewportRef={messagesEndRef}>
              <Stack gap="xs" p="xs">
                {messages.length === 0 && (
                  <Text c="dimmed" ta="center" size="sm" mt="xl">Send a message to test this provider</Text>
                )}
                {messages.map((m, i) => (
                  <Paper
                    key={i}
                    p="sm"
                    radius="md"
                    bg={m.role === 'user' ? 'indigo.9' : m.error ? 'red.9' : 'dark.6'}
                    style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}
                  >
                    <Text size="xs" c="dimmed" mb={4}>{m.role}</Text>
                    <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{m.content}</Text>
                  </Paper>
                ))}
                {chatLoading && (
                  <Group gap="xs"><Loader size="xs" /><Text size="sm" c="dimmed">Thinking...</Text></Group>
                )}
                <div ref={messagesEndRef} />
              </Stack>
            </ScrollArea>

            {/* Input */}
            <Group gap="xs" align="flex-end">
              <Textarea
                style={{ flex: 1 }}
                placeholder="Type a message..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                autosize
                minRows={1}
                maxRows={4}
              />
              <ActionIcon size="lg" variant="filled" onClick={sendMessage} disabled={!input.trim() || !tryModel || chatLoading}>
                <IconSend size={16} />
              </ActionIcon>
            </Group>
          </Stack>
        )}
      </Drawer>

      {/* ── Add to default tenant prompt ──────────────────────────────────── */}
      <Modal
        opened={!!addToDefaultPrompt}
        onClose={() => setAddToDefaultPrompt(null)}
        title={<Group gap="xs"><IconBuilding size={16} /><Text fw={600}>Add to default tenant?</Text></Group>}
        size="sm"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Add <strong>{addToDefaultPrompt?.providerName}</strong> to the default <Code>api</Code> tenant?
            This makes all its models available via <Code>/api/v1/…</Code> immediately.
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setAddToDefaultPrompt(null)}>Skip</Button>
            <Button
              leftSection={<IconBuilding size={14} />}
              onClick={async () => {
                try {
                  await api.post('/api/prism/admin/tenants/default/add-provider', {
                    providerId: addToDefaultPrompt.providerId,
                  });
                  notifications.show({ title: 'Added', message: `${addToDefaultPrompt.providerName} linked to default tenant`, color: 'teal' });
                } catch (err) {
                  notifications.show({ title: 'Error', message: err.response?.data?.error || 'Failed', color: 'red' });
                }
                setAddToDefaultPrompt(null);
              }}
            >
              Yes, add to default tenant
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
