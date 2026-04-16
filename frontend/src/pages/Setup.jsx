import { useState, useRef, useEffect } from 'react';
import {
  Stepper, TextInput, PasswordInput, Button, Paper, Title, Center, Stack,
  Select, Alert, Container, Group, Text, ThemeIcon, Loader, Badge,
  Textarea, ScrollArea, Code, Divider, SimpleGrid, Checkbox, Card,
} from '@mantine/core';
import {
  IconCheck, IconAlertCircle, IconX, IconPlugConnected, IconSearch,
  IconAlertTriangle, IconWand, IconSend, IconRobot, IconUser, IconSparkles,
  IconUpload,
} from '@tabler/icons-react';
import { FileButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import api from '../hooks/useApi';

// Detect common URL mistakes and return a suggested fix
function detectUrlIssues(url) {
  const trimmed = url.trim().replace(/\/$/, '');
  const issues = [];

  if (/\/api\/v1$/i.test(trimmed)) {
    issues.push({ type: 'apiv1_suffix', message: 'Remove /api/v1 from the end — the API path is auto-detected.', fix: trimmed.replace(/\/api\/v1$/i, '') });
  } else if (/\/v1$/i.test(trimmed)) {
    issues.push({ type: 'v1_suffix', message: 'Remove /v1 from the end — Model Prism auto-detects the API path.', fix: trimmed.replace(/\/v1$/i, '') });
  } else if (/\/api$/i.test(trimmed)) {
    issues.push({ type: 'api_suffix', message: 'Remove /api from the end — the base URL should not include the path.', fix: trimmed.replace(/\/api$/i, '') });
  }

  return issues;
}

export default function Setup({ onComplete }) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Admin form
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [importingSettings, setImportingSettings] = useState(false);

  // Provider form
  const [providerName, setProviderName] = useState('');
  const [providerType, setProviderType] = useState('openai');
  const [providerUrl, setProviderUrl] = useState('');
  const [providerKey, setProviderKey] = useState('');
  const [urlIssues, setUrlIssues] = useState([]);

  // Provider check state
  const [checkLog, setCheckLog] = useState([]);
  const [checkStatus, setCheckStatus] = useState(null); // null | 'running' | 'ok' | 'error'
  const [checkSuggestUrl, setCheckSuggestUrl] = useState(null);
  const [discoverStatus, setDiscoverStatus] = useState(null); // null | 'loading' | 'ok' | 'error'
  const [discoveredModels, setDiscoveredModels] = useState([]);

  // Saved provider ID (allows retry without re-creating)
  const createdProviderId = useRef(null);

  // Profile selection (step 2)
  const [presets, setPresets]             = useState([]);
  const [selectedProfiles, setSelectedProfiles] = useState([]);
  const [presetApplying, setPresetApplying] = useState(false);
  const [presetResult, setPresetResult]   = useState(null);

  // Load dev-defaults on mount (only available in non-production)
  useEffect(() => {
    api.get('/api/prism/setup/dev-defaults').then(({ data }) => {
      if (data.admin?.username) setUsername(data.admin.username);
      if (data.admin?.password) setPassword(data.admin.password);
      if (data.provider?.name)    setProviderName(data.provider.name);
      if (data.provider?.type)    setProviderType(data.provider.type);
      if (data.provider?.baseUrl) { setProviderUrl(data.provider.baseUrl); setUrlIssues(detectUrlIssues(data.provider.baseUrl)); }
      if (data.provider?.apiKey)  setProviderKey(data.provider.apiKey);
    }).catch(() => {}); // silently ignore in production or if endpoint unavailable
  }, []);

  // Mini chat state
  const [chatModel, setChatModel] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);

  function handleUrlChange(val) {
    setProviderUrl(val);
    setUrlIssues(detectUrlIssues(val));
  }

  function applyUrlFix(fix) {
    setProviderUrl(fix);
    setUrlIssues(detectUrlIssues(fix));
  }

  async function createAdmin() {
    setError('');
    setLoading(true);
    try {
      await api.post('/api/prism/setup/admin', { username, password });
      setStep(1);
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to create admin';
      if (msg.toLowerCase().includes('already exists') || err.response?.status === 400) {
        onComplete();
      } else {
        setError(msg);
      }
    }
    setLoading(false);
  }

  async function loginAndComplete() {
    const { data: auth } = await api.post('/api/prism/auth/login', { username, password });
    localStorage.setItem('token', auth.token);
    await api.post('/api/prism/setup/complete');
  }

  async function testAndSaveProvider() {
    setError('');
    setLoading(true);
    setCheckLog([]);
    setCheckStatus('running');
    setDiscoverStatus(null);
    setDiscoveredModels([]);

    try {
      // Log in + mark setup complete so we can call admin APIs
      await loginAndComplete();

      // Use the clean URL (strip trailing /v1 etc. automatically)
      const cleanUrl = urlIssues[0]?.fix ?? providerUrl.trim().replace(/\/$/, '');

      // Create or reuse the provider
      let providerId = createdProviderId.current;
      if (!providerId) {
        const { data: provider } = await api.post('/api/prism/admin/providers', {
          name: providerName,
          type: providerType,
          config: {
            baseUrl: cleanUrl,
            auth: { type: 'api_key', apiKey: providerKey },
          },
        });
        createdProviderId.current = provider._id;
        providerId = provider._id;
      } else {
        // Update the existing provider with new URL/key if user edited
        await api.put(`/api/prism/admin/providers/${providerId}`, {
          config: {
            baseUrl: cleanUrl,
            auth: { type: 'api_key', apiKey: providerKey },
          },
        });
      }

      // Run detailed connection check
      let checkOk = false;
      try {
        const { data: checkResult } = await api.post(`/api/prism/admin/providers/${providerId}/check`);
        setCheckLog(checkResult.log || []);
        checkOk = checkResult.success;
        if (checkResult.suggestUrl) setCheckSuggestUrl(checkResult.suggestUrl);
        setCheckStatus(checkOk ? 'ok' : 'error');
      } catch (checkErr) {
        const errData = checkErr.response?.data;
        setCheckLog(errData?.log || [checkErr.response?.data?.error || checkErr.message]);
        setCheckStatus('error');
      }

      if (!checkOk) {
        // Don't advance — let user fix the URL or key
        setLoading(false);
        return;
      }

      // Connection OK — discover models
      setDiscoverStatus('loading');
      try {
        const { data: discoverData } = await api.post(`/api/prism/admin/providers/${providerId}/discover`);
        setDiscoveredModels(discoverData.models || []);
        setDiscoverStatus('ok');
        // Pre-select first model for the chat widget
        if (discoverData.models?.length) setChatModel(discoverData.models[0].id);
        // Auto-link this provider to the default tenant (silently — it's the whole point of setup)
        api.post('/api/prism/admin/tenants/default/add-provider', { providerId }).catch(() => {});
      } catch (discErr) {
        setDiscoverStatus('error');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save provider');
      setCheckStatus('error');
    }
    setLoading(false);
  }

  async function sendChatMessage() {
    if (!chatInput.trim() || !chatModel) return;
    const userMsg = { role: 'user', content: chatInput };
    setChatMessages(msgs => [...msgs, userMsg]);
    setChatInput('');
    setChatLoading(true);
    try {
      const { data } = await api.post(`/api/prism/admin/providers/${createdProviderId.current}/chat`, {
        model: chatModel,
        messages: [...chatMessages, userMsg],
      });
      const reply = data.choices?.[0]?.message?.content || JSON.stringify(data);
      setChatMessages(msgs => [...msgs, { role: 'assistant', content: reply }]);
    } catch (err) {
      setChatMessages(msgs => [...msgs, { role: 'assistant', content: `Error: ${err.response?.data?.error || err.message}` }]);
    }
    setChatLoading(false);
  }

  async function skipProvider() {
    setError('');
    setLoading(true);
    try {
      await loginAndComplete();
      // Load presets even if provider was skipped
      try {
        const { data } = await api.get('/api/prism/admin/categories/presets');
        setPresets(data);
      } catch { /* ignore */ }
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed');
    }
    setLoading(false);
  }

  async function goToProfiles() {
    // Load preset profiles before showing step 2
    try {
      const { data } = await api.get('/api/prism/admin/categories/presets');
      setPresets(data);
    } catch { /* ignore */ }
    setStep(2);
  }

  async function applyProfilesAndFinish() {
    setPresetApplying(true);
    if (selectedProfiles.length > 0) {
      try {
        const { data } = await api.post('/api/prism/admin/categories/apply-preset', {
          profileIds: selectedProfiles,
          providerId: createdProviderId.current || undefined,
        });
        setPresetResult(data);
      } catch { /* ignore — non-fatal */ }
    }
    setPresetApplying(false);
    setStep(3);
    setTimeout(() => onComplete(), 1500);
  }

  function toggleProfile(id) {
    setSelectedProfiles(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  }

  const providerReady = checkStatus === 'ok';

  return (
    <Center h="100vh">
      <Container size="sm" w="100%">
        <Paper shadow="md" p="xl" radius="md" withBorder>
          <Title order={2} mb="lg" ta="center">Model Prism Setup</Title>

          <Stepper active={step} mb="xl" size="sm">
            <Stepper.Step label="Admin" />
            <Stepper.Step label="Provider" />
            <Stepper.Step label="Profiles" />
            <Stepper.Step label="Complete" />
          </Stepper>

          {error && <Alert icon={<IconAlertCircle />} color="red" mb="md">{error}</Alert>}

          {/* ── Step 0: Admin account ───────────────────────────────────────── */}
          {step === 0 && (
            <Stack>
              <TextInput label="Username" value={username} onChange={e => setUsername(e.target.value)} />
              <PasswordInput
                label="Password"
                description="Minimum 8 characters"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
              <Button
                onClick={createAdmin}
                loading={loading}
                disabled={!username || !password || password.length < 8}
              >
                Create Admin
              </Button>

              <Divider label="or" labelPosition="center" mt="xs" />

              <FileButton
                accept="application/json"
                onChange={async (file) => {
                  if (!file) return;
                  setImportingSettings(true);
                  try {
                    const text = await file.text();
                    const data = JSON.parse(text);
                    if (data?._meta?.type !== 'model-prism-settings-export') {
                      setError('Invalid settings file — not a Model Prism export.');
                      setImportingSettings(false);
                      return;
                    }
                    // Create admin first, then import
                    if (!username || !password || password.length < 8) {
                      setError('Create an admin account first (above), then import settings.');
                      setImportingSettings(false);
                      return;
                    }
                    await createAdmin();
                    await api.post('/api/prism/admin/system/import-settings', data);
                    notifications.show({ message: 'Settings restored from backup — providers, tenants, categories, and config imported.', color: 'green' });
                    if (onComplete) onComplete();
                  } catch (err) {
                    setError(err.response?.data?.error || err.message || 'Import failed');
                  }
                  setImportingSettings(false);
                }}
              >
                {(props) => (
                  <Button {...props} variant="subtle" color="dimmed" size="xs"
                    leftSection={<IconUpload size={12} />}
                    loading={importingSettings}>
                    Import from existing settings.json
                  </Button>
                )}
              </FileButton>
            </Stack>
          )}

          {/* ── Step 1: Provider setup ──────────────────────────────────────── */}
          {step === 1 && (
            <Stack>
              <TextInput
                label="Provider Name"
                placeholder="e.g. OpenAI, My Bedrock"
                value={providerName}
                onChange={e => setProviderName(e.target.value)}
                disabled={providerReady}
              />
              <Select
                label="Provider Type"
                value={providerType}
                onChange={setProviderType}
                disabled={providerReady}
                data={[
                  { value: 'openai', label: 'OpenAI Compatible' },
                  { value: 'ollama', label: 'Ollama' },
                  { value: 'vllm', label: 'vLLM' },
                  { value: 'bedrock', label: 'AWS Bedrock' },
                  { value: 'azure', label: 'Azure OpenAI' },
                  { value: 'openrouter', label: 'OpenRouter' },
                  { value: 'custom', label: 'Custom' },
                ]}
              />

              {/* URL input with smart validation */}
              <TextInput
                label="Base URL"
                placeholder="https://api.openai.com"
                description="Base URL only — no /v1 or /api/v1 suffix (auto-detected)"
                value={providerUrl}
                onChange={e => handleUrlChange(e.target.value)}
                disabled={providerReady}
                error={urlIssues.length > 0 ? ' ' : undefined}
              />
              {urlIssues.map((issue, i) => (
                <Alert key={i} icon={<IconAlertTriangle size={16} />} color="yellow" p="xs">
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm">{issue.message}</Text>
                    <Button
                      size="compact-xs"
                      leftSection={<IconWand size={12} />}
                      onClick={() => applyUrlFix(issue.fix)}
                    >
                      Auto-fix
                    </Button>
                  </Group>
                </Alert>
              ))}
              {checkSuggestUrl && (
                <Alert icon={<IconAlertTriangle size={16} />} color="blue" p="xs">
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm">HTTP worked but HTTPS is recommended: <Code>{checkSuggestUrl}</Code></Text>
                    <Button size="compact-xs" onClick={() => { applyUrlFix(checkSuggestUrl); setCheckSuggestUrl(null); }}>
                      Switch to HTTPS
                    </Button>
                  </Group>
                </Alert>
              )}

              <PasswordInput
                label="API Key"
                placeholder="sk-... (optional for local providers)"
                value={providerKey}
                onChange={e => setProviderKey(e.target.value)}
                disabled={providerReady}
              />

              {/* Connection check log */}
              {checkLog.length > 0 && (
                <Paper withBorder p="sm" radius="md">
                  <Text size="xs" fw={600} mb={4}>Connection log</Text>
                  <ScrollArea h={120}>
                    <Stack gap={2}>
                      {checkLog.map((line, i) => (
                        <Text key={i} size="xs" ff="monospace"
                          c={line.startsWith('✓') ? 'green' : line.startsWith('✗') ? 'red' : 'dimmed'}>
                          {line}
                        </Text>
                      ))}
                    </Stack>
                  </ScrollArea>
                </Paper>
              )}

              {/* Discover status */}
              {discoverStatus && (
                <Group gap="xs">
                  {discoverStatus === 'loading' && <Loader size={14} />}
                  {discoverStatus === 'ok' && (
                    <ThemeIcon size={18} color="green" variant="light" radius="xl"><IconCheck size={12} /></ThemeIcon>
                  )}
                  {discoverStatus === 'error' && (
                    <ThemeIcon size={18} color="red" variant="light" radius="xl"><IconX size={12} /></ThemeIcon>
                  )}
                  <Text size="sm">
                    {discoverStatus === 'loading' && 'Discovering models…'}
                    {discoverStatus === 'ok' && `${discoveredModels.length} models discovered`}
                    {discoverStatus === 'error' && 'Model discovery failed — you can retry later in the Providers page'}
                  </Text>
                </Group>
              )}

              {/* Mini chat widget (shown after success) */}
              {providerReady && discoveredModels.length > 0 && (
                <>
                  <Divider label="Test a model" labelPosition="center" />
                  <Select
                    label="Model"
                    value={chatModel}
                    onChange={setChatModel}
                    data={discoveredModels.slice(0, 20).map(m => ({ value: m.id, label: m.name || m.id }))}
                    searchable
                    size="sm"
                  />
                  <Paper withBorder p="sm" radius="md">
                    <ScrollArea h={140} mb="xs">
                      <Stack gap="xs">
                        {chatMessages.length === 0 && (
                          <Text size="xs" c="dimmed" ta="center">Send a message to verify the model works</Text>
                        )}
                        {chatMessages.map((m, i) => (
                          <Group key={i} gap="xs" align="flex-start">
                            {m.role === 'user'
                              ? <IconUser size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                              : <IconRobot size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                            }
                            <Text size="xs" style={{ whiteSpace: 'pre-wrap', flex: 1 }}>{m.content}</Text>
                          </Group>
                        ))}
                        {chatLoading && <Loader size="xs" />}
                      </Stack>
                    </ScrollArea>
                    <Group gap="xs">
                      <TextInput
                        style={{ flex: 1 }}
                        size="xs"
                        placeholder="Say hello…"
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChatMessage()}
                        disabled={chatLoading}
                      />
                      <Button size="xs" onClick={sendChatMessage} loading={chatLoading} disabled={!chatInput.trim()}>
                        <IconSend size={14} />
                      </Button>
                    </Group>
                  </Paper>
                </>
              )}

              {/* Action buttons */}
              <Group>
                {!providerReady ? (
                  <>
                    <Button
                      onClick={testAndSaveProvider}
                      loading={loading || checkStatus === 'running'}
                      disabled={!providerName || !providerUrl}
                      leftSection={<IconPlugConnected size={16} />}
                    >
                      {checkStatus === 'error' ? 'Retry Connection' : 'Test & Add Provider'}
                    </Button>
                    <Button variant="subtle" onClick={skipProvider} disabled={loading}>
                      Skip for now
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={goToProfiles}
                    leftSection={<IconCheck size={16} />}
                    color="green"
                  >
                    Next: Choose Profiles
                  </Button>
                )}
              </Group>
            </Stack>
          )}

          {/* ── Step 2: Profile selection ────────────────────────────────────── */}
          {step === 2 && (
            <Stack>
              <Text size="sm" c="dimmed">
                Choose one or more usage profiles to pre-configure routing categories.
                You can always adjust them later in the Categories page.
              </Text>
              {presets.length === 0 ? (
                <Center py="xl"><Loader size="sm" /></Center>
              ) : (
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                  {presets.map(profile => (
                    <Card
                      key={profile.id}
                      withBorder
                      radius="md"
                      p="sm"
                      style={{ cursor: 'pointer', borderColor: selectedProfiles.includes(profile.id) ? `var(--mantine-color-${profile.color || 'blue'}-6)` : undefined }}
                      onClick={() => toggleProfile(profile.id)}
                    >
                      <Group gap="xs" mb={4} wrap="nowrap">
                        <Checkbox
                          checked={selectedProfiles.includes(profile.id)}
                          onChange={() => toggleProfile(profile.id)}
                          onClick={e => e.stopPropagation()}
                          size="sm"
                        />
                        <Badge color={profile.color || 'blue'} size="xs" variant="light">{profile.name}</Badge>
                      </Group>
                      <Text size="xs" c="dimmed" lineClamp={2}>{profile.description}</Text>
                      {profile.categories?.length > 0 && (
                        <Text size="xs" c="dimmed" mt={4}>
                          {profile.categories.length} categor{profile.categories.length === 1 ? 'y' : 'ies'}
                        </Text>
                      )}
                      {profile.categories?.length === 0 && (
                        <Text size="xs" c="dimmed" mt={4}>All categories</Text>
                      )}
                    </Card>
                  ))}
                </SimpleGrid>
              )}
              <Group>
                <Button
                  onClick={applyProfilesAndFinish}
                  loading={presetApplying}
                  leftSection={<IconSparkles size={16} />}
                  disabled={selectedProfiles.length === 0}
                >
                  Apply {selectedProfiles.length > 0 ? `${selectedProfiles.length} Profile${selectedProfiles.length > 1 ? 's' : ''}` : 'Profiles'}
                </Button>
                <Button variant="subtle" onClick={() => { setStep(3); setTimeout(() => onComplete(), 1500); }}>
                  Skip
                </Button>
              </Group>
            </Stack>
          )}

          {/* ── Step 3: Complete ─────────────────────────────────────────────── */}
          {step === 3 && (
            <Center>
              <Stack align="center">
                <IconCheck size={48} color="var(--mantine-color-green-6)" />
                <Title order={3}>Setup Complete!</Title>
                <Text size="sm" c="dimmed">
                  {presetResult
                    ? `${presetResult.updated} categor${presetResult.updated === 1 ? 'y' : 'ies'} configured from your selected profiles`
                    : discoveredModels.length > 0
                      ? `Provider ready — ${discoveredModels.length} models available`
                      : 'Configure providers and models in the admin UI'}
                </Text>
              </Stack>
            </Center>
          )}
        </Paper>
      </Container>
    </Center>
  );
}
