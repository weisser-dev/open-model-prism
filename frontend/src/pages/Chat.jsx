import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Title, Stack, Group, Paper, Text, Textarea, Button, Select, Badge,
  ScrollArea, ActionIcon, Loader, Box, CopyButton, Tooltip, Modal,
  TextInput, NumberInput, Switch, Divider, Alert, Code, MultiSelect,
} from '@mantine/core';
import { IconSend, IconTrash, IconRobot, IconUser, IconCopy, IconCheck, IconSettings } from '@tabler/icons-react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import api, { isDemoMode } from '../hooks/useApi';

const TIER_COLORS = { micro: 'grape', minimal: 'teal', low: 'blue', medium: 'yellow', advanced: 'cyan', high: 'red', ultra: 'pink', critical: 'orange' };

// ── Markdown renderer with code block copy button ────────────────────────────
function MarkdownContent({ content }) {
  return (
    <ReactMarkdown
      components={{
        code({ inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '');
          const codeStr = String(children).replace(/\n$/, '');
          if (!inline && (match || codeStr.includes('\n'))) {
            return (
              <div style={{ position: 'relative', marginTop: 8, marginBottom: 8 }}>
                <CopyButton value={codeStr} timeout={2000}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? 'Copied' : 'Copy'} position="left">
                      <ActionIcon size="xs" variant="subtle" color={copied ? 'green' : 'gray'}
                        onClick={copy} style={{ position: 'absolute', top: 6, right: 6, zIndex: 1 }}>
                        {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </CopyButton>
                <SyntaxHighlighter
                  style={oneDark}
                  language={match?.[1] || 'text'}
                  PreTag="div"
                  customStyle={{ borderRadius: 8, padding: '12px 14px', fontSize: 12, margin: 0 }}
                  {...props}
                >{codeStr}</SyntaxHighlighter>
              </div>
            );
          }
          return (
            <code style={{ background: 'var(--prism-border-lighter)', padding: '1px 5px', borderRadius: 4, fontSize: '0.85em' }} {...props}>
              {children}
            </code>
          );
        },
        p({ children }) { return <p style={{ margin: '4px 0', lineHeight: 1.6 }}>{children}</p>; },
        ul({ children }) { return <ul style={{ margin: '4px 0', paddingLeft: 20 }}>{children}</ul>; },
        ol({ children }) { return <ol style={{ margin: '4px 0', paddingLeft: 20 }}>{children}</ol>; },
        li({ children }) { return <li style={{ margin: '2px 0' }}>{children}</li>; },
        h1({ children }) { return <h3 style={{ margin: '12px 0 4px', fontSize: '1.1em' }}>{children}</h3>; },
        h2({ children }) { return <h4 style={{ margin: '10px 0 4px', fontSize: '1.05em' }}>{children}</h4>; },
        h3({ children }) { return <h5 style={{ margin: '8px 0 4px', fontSize: '1em' }}>{children}</h5>; },
        blockquote({ children }) {
          return <blockquote style={{ borderLeft: '3px solid var(--prism-border-blockquote)', margin: '8px 0', padding: '4px 12px', opacity: 0.8 }}>{children}</blockquote>;
        },
        table({ children }) {
          return <div style={{ overflowX: 'auto', margin: '8px 0' }}><table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85em' }}>{children}</table></div>;
        },
        th({ children }) { return <th style={{ border: '1px solid var(--prism-border-medium)', padding: '4px 8px', textAlign: 'left', background: 'var(--prism-table-header-bg)' }}>{children}</th>; },
        td({ children }) { return <td style={{ border: '1px solid var(--prism-border-light)', padding: '4px 8px' }}>{children}</td>; },
      }}
    >{content}</ReactMarkdown>
  );
}

// ── Response metadata display ────────────────────────────────────────────────
function ResponseMeta({ meta }) {
  if (!meta) return null;
  return (
    <Group gap={6} mt={4} wrap="wrap">
      {meta.model && <Badge size="xs" variant="light" color="blue">{meta.model}</Badge>}
      {meta.category && <Badge size="xs" variant="light" color="grape">{meta.category}</Badge>}
      {meta.tier && <Badge size="xs" variant="light" color={TIER_COLORS[meta.tier] || 'gray'}>{meta.tier}</Badge>}
      {meta.tokens != null && <Text size="xs" c="dimmed">{meta.tokens} tok</Text>}
      {meta.cost != null && meta.cost > 0 && <Text size="xs" c="dimmed">${meta.cost.toFixed(6)}</Text>}
      {meta.confidence != null && <Text size="xs" c="dimmed">{(meta.confidence * 100).toFixed(0)}% conf</Text>}
      {meta.routingMs != null && <Text size="xs" c="dimmed">{meta.routingMs}ms</Text>}
    </Group>
  );
}

export default function Chat({ isPublic = false, chatToken = null, isAdmin = false, brandName = '', chatTitle = '', logoSrc = '' }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [models, setModels]       = useState([]);
  const [model, setModel]         = useState('auto');
  const [messages, setMessages]   = useState([]);  // { role, content, meta? }
  const [input, setInput]         = useState('');
  const [streaming, setStreaming]  = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [activeToken, setActiveToken] = useState(chatToken);
  const [chatReady, setChatReady] = useState(false);
  const [chatDisabled, setChatDisabled] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const scrollRef  = useRef(null);
  const abortRef   = useRef(null);

  // Set page title for public chat
  useEffect(() => {
    if (isPublic) document.title = chatTitle || (brandName ? `${brandName} — Chat` : 'Model Prism — Chat');
  }, [isPublic, brandName, chatTitle]);

  useEffect(() => {
    if (isPublic) {
      // Load public config
      fetch('/api/prism/admin/chat/public/config').then(async r => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          if (data.enabled === false) { setChatDisabled(true); return; }
          setAccessDenied(true); return;
        }
        const cfg = await r.json();
        const modelList = (cfg.allowedModels || []).map(m => ({ value: m, label: m }));
        setModels([{ value: 'auto', label: 'auto (Model Prism Routing)' }, ...modelList]);
        setModel(cfg.defaultModel || 'auto');
        if (cfg.visibility === 'public') setChatReady(true);
        // token mode: need token before ready
      }).catch(() => setAccessDenied(true));
    } else {
      // Admin mode: check if chat is enabled, then load models
      api.get('/api/prism/admin/chat/config').then(r => {
        if (!r.data?.enabled) { setChatDisabled(true); return; }
        setChatReady(true);
      }).catch(() => setChatDisabled(true));
      // Load all models from providers (for model selector)
      api.get('/api/prism/admin/providers').then(r => {
        const allModels = (r.data || []).flatMap(p =>
          (p.discoveredModels || []).filter(m => m.visible !== false)
            .map(m => ({ value: m.id, label: `${m.id}${m.tier ? ` [${m.tier}]` : ''}` }))
        );
        const seen = new Set();
        const unique = allModels.filter(m => { if (seen.has(m.value)) return false; seen.add(m.value); return true; });
        unique.sort((a, b) => a.label.localeCompare(b.label));
        setModels([{ value: 'auto', label: 'auto (Model Prism Routing)' }, ...unique]);
      }).catch(() => {});
    }
  }, [isPublic]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || streaming) return;
    const userMsg = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setStreaming(true);

    const assistantIdx = newMessages.length;
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    const controller = new AbortController();
    abortRef.current = controller;

    // ── Demo mode: simulate streaming response ────────────────────────────
    if (isDemoMode) {
      const demoResponses = [
        "Here's a quick example:\n\n```python\ndef hello(name):\n    return f\"Hello, {name}!\"\n\nprint(hello(\"World\"))\n```\n\nThis function takes a name parameter and returns a greeting string using an f-string.",
        "Sure! Let me help with that.\n\n## Key Points\n\n1. **First**, consider the architecture\n2. **Then**, implement the core logic\n3. **Finally**, add error handling\n\nWould you like me to elaborate on any of these?",
        "That's a great question! Here's what I'd recommend:\n\n```javascript\nconst result = data\n  .filter(item => item.active)\n  .map(item => item.value * 2)\n  .reduce((sum, val) => sum + val, 0);\n```\n\nThis uses method chaining for a clean, functional approach.",
        "I can help with that. The main differences are:\n\n| Feature | Option A | Option B |\n|---------|----------|----------|\n| Speed | Fast | Moderate |\n| Cost | Low | High |\n| Quality | Good | Excellent |\n\nFor most use cases, **Option A** is the better choice.",
      ];
      const demoText = 'Demo generated answer - no llm used:\n\n' + demoResponses[Math.floor(Math.random() * demoResponses.length)];
      const demoModel = model === 'auto' ? 'qwen.qwen3-coder-30b-a3b-v1:0' : model;
      let partial = '';
      for (let i = 0; i < demoText.length; i += 3) {
        await new Promise(r => setTimeout(r, 15));
        partial = demoText.slice(0, i + 3);
        setMessages(prev => { const u = [...prev]; u[assistantIdx] = { role: 'assistant', content: partial }; return u; });
      }
      setMessages(prev => { const u = [...prev]; u[assistantIdx] = { role: 'assistant', content: demoText, meta: {
        model: demoModel, category: 'coding_medium', tier: 'medium', tokens: Math.round(100 + Math.random() * 500), cost: Math.round(Math.random() * 0.005 * 1e6) / 1e6, confidence: 0.92, routingMs: Math.round(50 + Math.random() * 200),
      } }; return u; });
      abortRef.current = null;
      setStreaming(false);
      return;
    }

    try {
      const jwtToken = localStorage.getItem('token');
      const endpoint = isPublic ? '/api/prism/admin/chat/public' : '/api/prism/admin/chat';
      const headers = { 'Content-Type': 'application/json' };
      if (!isPublic && jwtToken) headers['Authorization'] = `Bearer ${jwtToken}`;
      if (isPublic && activeToken) headers['x-chat-token'] = activeToken;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: { message: response.statusText } }));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let responseMeta = null;
      let totalTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              setMessages(prev => {
                const updated = [...prev];
                updated[assistantIdx] = { role: 'assistant', content: fullContent };
                return updated;
              });
            }
            // Capture usage from last chunk
            if (parsed.usage) {
              totalTokens = parsed.usage.total_tokens || (parsed.usage.prompt_tokens || 0) + (parsed.usage.completion_tokens || 0);
            }
            // Capture routing info
            if (parsed.auto_routing) {
              responseMeta = {
                model: parsed.auto_routing.selected_model || parsed.model,
                category: parsed.auto_routing.category,
                tier: parsed.auto_routing.cost_tier,
                confidence: parsed.auto_routing.confidence,
                routingMs: parsed.auto_routing.routing_time_ms,
              };
            }
            // Capture model + cost from response
            if (parsed.model && !responseMeta?.model) {
              responseMeta = { ...responseMeta, model: parsed.model };
            }
            if (parsed.cost_info) {
              responseMeta = { ...responseMeta, cost: parsed.cost_info.cost_usd, tokens: parsed.cost_info.tokens_used };
            }
          } catch { /* skip invalid JSON */ }
        }
      }

      // Update assistant message with metadata
      if (responseMeta || totalTokens) {
        setMessages(prev => {
          const updated = [...prev];
          updated[assistantIdx] = {
            ...updated[assistantIdx],
            meta: { ...responseMeta, tokens: responseMeta?.tokens || totalTokens || undefined },
          };
          return updated;
        });
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages(prev => {
          const updated = [...prev];
          updated[assistantIdx] = { role: 'assistant', content: `Error: ${err.message}` };
          return updated;
        });
      }
    }

    abortRef.current = null;
    setStreaming(false);
  }, [input, messages, model, streaming]);

  function clearChat() {
    if (streaming && abortRef.current) abortRef.current.abort();
    setMessages([]);
    setStreaming(false);
  }

  if (chatDisabled) {
    return (
      <Stack align="center" justify="center" h="calc(100vh - 80px)">
        <IconRobot size={64} style={{ opacity: 0.2 }} />
        <Text c="dimmed" size="lg">Chat is currently disabled</Text>
        <Text c="dimmed" size="sm">An admin can enable it in Settings &rarr; Chat Settings.</Text>
      </Stack>
    );
  }

  if (accessDenied) {
    return (
      <Stack align="center" justify="center" h="calc(100vh - 80px)">
        <IconRobot size={64} style={{ opacity: 0.2 }} />
        <Text c="dimmed" size="lg">Chat is not available</Text>
        <Text c="dimmed" size="sm">An administrator needs to enable public chat access.</Text>
      </Stack>
    );
  }

  if (isPublic && !chatReady) {
    return (
      <Stack align="center" justify="center" h="calc(100vh - 80px)" maw={400} mx="auto">
        <IconRobot size={64} style={{ opacity: 0.3 }} />
        <Title order={3}>Enter Access Token</Title>
        <Text c="dimmed" size="sm" ta="center">This chat requires an access token. Contact your administrator to get one.</Text>
        <Group gap="xs" w="100%">
          <Textarea value={tokenInput} onChange={e => setTokenInput(e.target.value)}
            placeholder="Paste your access token here…" style={{ flex: 1 }} minRows={1} />
          <Button onClick={() => { setActiveToken(tokenInput.trim()); setChatReady(true); }}
            disabled={!tokenInput.trim()}>Enter</Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack h={isPublic ? '100vh' : 'calc(100vh - 80px)'} gap={0}>
      <Group justify="space-between" px="md" py="xs" style={{ borderBottom: '1px solid var(--prism-border)' }}>
        <Group gap="xs">
          {isPublic && logoSrc && <img src={logoSrc} alt="" style={{ height: 24, width: 'auto' }} />}
          <Title order={3}>{isPublic && chatTitle ? chatTitle : 'Chat'}</Title>
        </Group>
        <Group gap="xs">
          <Select value={model} onChange={v => setModel(v)} data={models}
            size="xs" searchable w={300} />
          <Button variant="subtle" color="gray" size="xs" onClick={clearChat} leftSection={<IconTrash size={14} />}>
            New Chat
          </Button>
          {isAdmin && (
            <Tooltip label="Chat Settings">
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => setSettingsOpen(true)}>
                <IconSettings size={16} />
              </ActionIcon>
            </Tooltip>
          )}
          {isAdmin && (
            <Modal opened={settingsOpen} onClose={() => setSettingsOpen(false)} title="Chat Settings" size="lg">
              <ChatSettingsModal onClose={() => setSettingsOpen(false)} />
            </Modal>
          )}
        </Group>
      </Group>

      <ScrollArea style={{ flex: 1 }} px="md" viewportRef={scrollRef}>
        <Stack gap="sm" py="md" maw={800} mx="auto">
          {messages.length === 0 && (
            <Paper p="xl" withBorder radius="md" style={{ textAlign: 'center' }}>
              <IconRobot size={48} style={{ opacity: 0.3 }} />
              <Text c="dimmed" mt="sm">Send a message to start chatting.</Text>
              <Text c="dimmed" size="xs" mt={4}>
                Model: <strong>{model === 'auto' ? 'Auto Routing (Model Prism)' : model}</strong>
              </Text>
            </Paper>
          )}
          {messages.map((msg, i) => (
            <Group key={i} align="flex-start" gap="xs" wrap="nowrap"
              style={{ flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
              <Box mt={4}>
                {msg.role === 'user'
                  ? <IconUser size={20} style={{ opacity: 0.5 }} />
                  : <IconRobot size={20} style={{ opacity: 0.5 }} />}
              </Box>
              <div style={{ maxWidth: '80%' }}>
                <Paper p="sm" radius="md"
                  style={{
                    background: msg.role === 'user' ? 'var(--mantine-color-blue-light)' : 'var(--prism-bg-hover)',
                    wordBreak: 'break-word',
                  }}>
                  {msg.role === 'assistant' && msg.content ? (
                    <div style={{ fontSize: 14 }}>
                      <MarkdownContent content={msg.content} />
                    </div>
                  ) : msg.role === 'user' ? (
                    <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</Text>
                  ) : (
                    streaming && i === messages.length - 1 ? <Loader size="xs" /> : null
                  )}
                </Paper>
                {msg.role === 'assistant' && msg.meta && <ResponseMeta meta={msg.meta} />}
              </div>
            </Group>
          ))}
        </Stack>
      </ScrollArea>

      <Paper p="md" style={{ borderTop: '1px solid var(--prism-border)' }}>
        <Group gap="xs" maw={800} mx="auto" align="flex-end">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
            autosize minRows={1} maxRows={6}
            style={{ flex: 1 }}
            disabled={streaming}
          />
          <Button onClick={sendMessage} disabled={!input.trim() || streaming}
            loading={streaming} leftSection={<IconSend size={16} />}>
            Send
          </Button>
        </Group>
      </Paper>
    </Stack>
  );
}

// ── Chat Settings Modal ──────────────────────────────────────────────────────
function ChatSettingsModal({ onClose }) {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const [tokenLabel, setTokenLabel] = useState('');
  const [tokenHours, setTokenHours] = useState(24);
  const [newToken, setNewToken] = useState(null);

  useEffect(() => {
    api.get('/api/prism/admin/chat/config').then(r => setCfg(r.data)).catch(() => {});
    api.get('/api/prism/admin/providers').then(r => {
      const m = (r.data || []).flatMap(p =>
        (p.discoveredModels || []).filter(m => m.visible !== false)
          .map(m => ({ value: m.id, label: `${m.id}${m.tier ? ` [${m.tier}]` : ''}` }))
      );
      const seen = new Set();
      setAvailableModels(m.filter(x => { if (seen.has(x.value)) return false; seen.add(x.value); return true; }).sort((a, b) => a.label.localeCompare(b.label)));
    }).catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try { const { data } = await api.put('/api/prism/admin/chat/config', cfg); setCfg(data); } catch {}
    setSaving(false);
  }

  async function generateToken() {
    try {
      const { data } = await api.post('/api/prism/admin/chat/tokens', { label: tokenLabel || 'unnamed', expiresInHours: tokenHours });
      setNewToken(data); setTokenLabel('');
      const { data: u } = await api.get('/api/prism/admin/chat/config'); setCfg(u);
    } catch {}
  }

  async function revokeToken(token) {
    try { await api.delete(`/api/prism/admin/chat/tokens/${token}`); const { data } = await api.get('/api/prism/admin/chat/config'); setCfg(data); } catch {}
  }

  if (!cfg) return <Loader size="sm" />;

  return (
    <Stack gap="sm">
      <Select label="Visibility" value={cfg.visibility || 'admin'} onChange={v => setCfg(p => ({ ...p, visibility: v }))}
        data={[{ value: 'admin', label: 'Admin only' }, { value: 'public', label: 'Public (rate-limited)' }, { value: 'token', label: 'Token-based' }]} size="sm" />
      <Select label="Default model" value={cfg.defaultModel || 'auto'} onChange={v => setCfg(p => ({ ...p, defaultModel: v }))}
        data={[{ value: 'auto', label: 'auto (Routing)' }, ...availableModels]} size="sm" searchable />
      <MultiSelect label="Allowed models" description="Empty = all" value={cfg.allowedModels || []} onChange={v => setCfg(p => ({ ...p, allowedModels: v }))}
        data={availableModels} size="sm" searchable clearable />
      <Textarea label="System prompt" value={cfg.systemPrompt || ''} onChange={e => setCfg(p => ({ ...p, systemPrompt: e.target.value }))} minRows={2} autosize size="sm" />
      <Group>
        <NumberInput label="Rate limit (req/min)" value={cfg.rateLimit?.requestsPerMinute || 10}
          onChange={v => setCfg(p => ({ ...p, rateLimit: { ...p.rateLimit, requestsPerMinute: v } }))} min={1} max={100} size="sm" w={150} />
        <NumberInput label="Max tokens/req" value={cfg.rateLimit?.maxTokensPerRequest || 4000}
          onChange={v => setCfg(p => ({ ...p, rateLimit: { ...p.rateLimit, maxTokensPerRequest: v } }))} min={100} max={32000} size="sm" w={150} />
      </Group>
      <Button size="sm" onClick={save} loading={saving} w={120}>Save</Button>

      {cfg.visibility === 'token' && (<>
        <Divider label="Access Tokens" labelPosition="center" />
        <Group>
          <TextInput placeholder="Label" value={tokenLabel} onChange={e => setTokenLabel(e.target.value)} size="sm" style={{ flex: 1 }} />
          <NumberInput value={tokenHours} onChange={v => setTokenHours(v)} min={1} max={720} size="sm" w={80} label="Hours" />
          <Button size="sm" onClick={generateToken} mt="xl">Generate</Button>
        </Group>
        {newToken && <Alert color="green" withCloseButton onClose={() => setNewToken(null)}><Code block>{newToken.token}</Code></Alert>}
        {cfg.accessTokens?.map(t => (
          <Group key={t.token} gap="xs">
            <Code fz={10}>{t.token.slice(0, 8)}…</Code>
            <Badge size="xs">{t.label}</Badge>
            {t.used && <Badge size="xs" color="green">Used</Badge>}
            <ActionIcon size="xs" color="red" variant="subtle" onClick={() => revokeToken(t.token)}>×</ActionIcon>
          </Group>
        ))}
      </>)}

      {cfg.visibility !== 'admin' && (
        <Alert color="blue" p="xs"><Text size="xs">Public URL: <Code>/public/chat</Code></Text></Alert>
      )}
    </Stack>
  );
}
