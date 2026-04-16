import {
  Title, Paper, Stack, Group, Text, Badge, Code, Divider, Anchor,
  Table, Alert, SimpleGrid,
} from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';

const METHOD_COLOR = { GET: 'green', POST: 'blue', PUT: 'orange', DELETE: 'red', PATCH: 'grape' };

function MethodBadge({ method }) {
  return (
    <Badge variant="filled" color={METHOD_COLOR[method] || 'gray'} size="sm" w={58} style={{ textAlign: 'center' }}>
      {method}
    </Badge>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <Title order={4} mb="sm">{title}</Title>
      {children}
    </div>
  );
}

export default function Docs() {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const gatewayBase = `${origin}/api/<tenant-slug>/v1`;

  return (
    <Stack gap="lg">
      <Title order={2}>Documentation</Title>

      {/* ── Gateway API ──────────────────────────────────────────────────── */}
      <Paper withBorder radius="md" p="lg" style={{ overflowX: 'auto' }}>
        <Section title="Gateway API">
          <Text size="sm" c="dimmed" mb="xs">
            The gateway exposes an OpenAI-compatible REST API per tenant. Use your tenant API key as a
            Bearer token in all authenticated requests.
          </Text>
          <Stack gap="xs">
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>Base URL</Text>
              <Code block>{gatewayBase}</Code>
            </div>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>Authentication</Text>
              <Code block>Authorization: Bearer omp-&lt;your-api-key&gt;</Code>
            </div>
          </Stack>
        </Section>
      </Paper>

      {/* ── Endpoints ────────────────────────────────────────────────────── */}
      <Paper withBorder radius="md" p="lg" style={{ overflowX: 'auto' }}>
        <Section title="Endpoints">
          <Table striped withTableBorder withColumnBorders fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={70}>Method</Table.Th>
                <Table.Th>Path</Table.Th>
                <Table.Th>Auth</Table.Th>
                <Table.Th>Description</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {[
                ['POST', '/v1/chat/completions',  'Bearer', 'Chat completions — streaming and non-streaming (SSE)'],
                ['POST', '/v1/embeddings',         'Bearer', 'Text embeddings'],
                ['GET',  '/v1/models',             'Bearer', 'List models available to this tenant (filtered by model access config)'],
                ['GET',  '/v1/models/public',      'None',   'Public model list — no API key required'],
                ['GET',  '/v1/health',             'None',   'Health check — returns tenant status and provider availability'],
              ].map(([method, path, auth, desc]) => (
                <Table.Tr key={path}>
                  <Table.Td><MethodBadge method={method} /></Table.Td>
                  <Table.Td><Code>{path}</Code></Table.Td>
                  <Table.Td><Text size="xs" c={auth === 'None' ? 'dimmed' : undefined}>{auth}</Text></Table.Td>
                  <Table.Td>{desc}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Section>
      </Paper>

      {/* ── Auto-Routing ─────────────────────────────────────────────────── */}
      <Paper withBorder radius="md" p="lg" style={{ overflowX: 'auto' }}>
        <Section title="Auto-Routing">
          <Stack gap="sm">
            <Text size="sm">
              Set <Code>model: "auto"</Code> to let Model Prism classify the request and route to the
              optimal model based on your configured routing categories.
            </Text>
            <Code block>{`{
  "model": "auto",
  "messages": [{ "role": "user", "content": "Write a Python function to parse JSON." }]
}`}</Code>
            <Text size="sm" c="dimmed">
              The classifier assigns the request to a category (e.g. <Code>code_generation</Code>), then
              selects the configured default model for that category. The response includes a{' '}
              <Code>auto_routing</Code> field with the resolved category and model.
            </Text>

            <Divider my="xs" />

            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Cost Tiers</Text>
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
              {[
                ['minimal', 'teal',   'Tiny tasks — translation, formatting, simple Q&A'],
                ['low',     'blue',   'Standard tasks — drafting, summarisation, function calls'],
                ['medium',  'violet', 'Complex tasks — analysis, data extraction, long context'],
                ['high',    'red',    'Hard tasks — reasoning, agentic coding, security review'],
              ].map(([tier, color, desc]) => (
                <Paper key={tier} withBorder p="xs" radius="sm">
                  <Badge color={color} size="xs" mb={4}>{tier}</Badge>
                  <Text size="xs" c="dimmed">{desc}</Text>
                </Paper>
              ))}
            </SimpleGrid>

            <Divider my="xs" />

            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Context Fallback</Text>
            <Text size="sm" c="dimmed">
              If a request exceeds the selected model's context window, Model Prism automatically
              retries with the next larger model. The response includes a <Code>context_fallback</Code> field
              showing the original and fallback model IDs.
            </Text>
          </Stack>
        </Section>
      </Paper>

      {/* ── Model Access Control ─────────────────────────────────────────── */}
      <Paper withBorder radius="md" p="lg" style={{ overflowX: 'auto' }}>
        <Section title="Model Access Control">
          <Text size="sm" c="dimmed" mb="sm">
            Each tenant can restrict which models are accessible via the gateway. Configured in the Tenants
            page (admin) or the My Tenant page (tenant-admin).
          </Text>
          <Table striped withTableBorder withColumnBorders fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Mode</Table.Th>
                <Table.Th>Behaviour</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {[
                ['all',       'All models from assigned providers are accessible (default)'],
                ['whitelist', 'Only explicitly listed model IDs are accessible'],
                ['blacklist', 'All models except explicitly listed IDs are accessible'],
              ].map(([mode, desc]) => (
                <Table.Tr key={mode}>
                  <Table.Td><Code>{mode}</Code></Table.Td>
                  <Table.Td>{desc}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Section>
      </Paper>

      {/* ── Roles ────────────────────────────────────────────────────────── */}
      <Paper withBorder radius="md" p="lg" style={{ overflowX: 'auto' }}>
        <Section title="Roles & Permissions">
          <Table striped withTableBorder withColumnBorders fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={120}>Role</Table.Th>
                <Table.Th>Permissions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {[
                ['admin',         'red',    'Full access — manage providers, tenants, users, LDAP, categories, all analytics'],
                ['maintainer',    'orange', 'Manage providers, tenants, categories, model registry; view all analytics and request logs'],
                ['finops',        'teal',   'Read-only: analytics, cost tracking, and request logs across all tenants'],
                ['tenant-viewer', 'blue',   'Read-only: dashboard and analytics scoped to assigned tenants only'],
                ['tenant-admin',  'cyan',   'Self-service: manage model access (whitelist/blacklist) and generate client configs for own tenants'],
              ].map(([role, color, desc]) => (
                <Table.Tr key={role}>
                  <Table.Td><Badge color={color} size="sm">{role}</Badge></Table.Td>
                  <Table.Td>{desc}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Section>
      </Paper>

      {/* ── Tenant Self-Service (Portal API) ─────────────────────────────── */}
      <Paper withBorder radius="md" p="lg" style={{ overflowX: 'auto' }}>
        <Section title="Tenant Portal (Self-Service API)">
          <Text size="sm" c="dimmed" mb="sm">
            Users with the <Badge color="cyan" size="xs">tenant-admin</Badge> role can manage their own
            tenant's model access and generate client configs without full admin access.
          </Text>
          <Table striped withTableBorder withColumnBorders fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={70}>Method</Table.Th>
                <Table.Th>Path</Table.Th>
                <Table.Th>Description</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {[
                ['GET',  '/api/prism/tenant-portal/mine',              'List own tenants (all tenants for admin/maintainer)'],
                ['GET',  '/api/prism/tenant-portal/:id',               'Get full tenant config (minus API key hash)'],
                ['PUT',  '/api/prism/tenant-portal/:id/model-config',  'Update model access mode and list for own tenant'],
                ['GET',  '/api/prism/tenant-portal/:id/models',        'List models available to the tenant (respects model access config)'],
              ].map(([method, path, desc]) => (
                <Table.Tr key={path}>
                  <Table.Td><MethodBadge method={method} /></Table.Td>
                  <Table.Td><Code>{path}</Code></Table.Td>
                  <Table.Td>{desc}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Section>
      </Paper>

      {/* ── Client Tool Integration ───────────────────────────────────────── */}
      <Paper withBorder radius="md" p="lg" style={{ overflowX: 'auto' }}>
        <Section title="Client Tool Integration">
          <Text size="sm" c="dimmed" mb="sm">
            Model Prism is OpenAI-API compatible. Use the "Generate Config" button on the Tenants
            page (or My Tenant for tenant-admins) to get ready-to-paste configs for each tool.
          </Text>
          <Table striped withTableBorder withColumnBorders fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Tool</Table.Th>
                <Table.Th>Config File</Table.Th>
                <Table.Th>Notes</Table.Th>
                <Table.Th>Docs</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {[
                ['Continue',    '~/.continue/config.yaml',            'YAML schema v1; provider: openai; roles: chat, edit, apply',       'https://docs.continue.dev/reference'],
                ['OpenCode',    '~/.config/opencode/config.json',     'JSON with $schema; provider.custom.options.baseURL',               'https://opencode.ai/docs/config/'],
                ['Cursor',      'Settings → Models → OpenAI',         'Set Override Base URL; enable models by ID',                       'https://docs.cursor.com/settings/models'],
                ['Claude Code', 'Environment variable',               'Set ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY; requires LiteLLM proxy', null],
                ['Open WebUI',  'docker-compose.yml',                 'OPENAI_API_BASE_URL + OPENAI_API_KEY env vars',                    'https://docs.openwebui.com'],
                ['Python SDK',  'example.py',                         'openai.OpenAI(base_url=..., api_key=...)',                         null],
                ['Node.js SDK', 'example.mjs',                        'new OpenAI({ baseURL: ..., apiKey: ... })',                        null],
              ].map(([tool, file, notes, doc]) => (
                <Table.Tr key={tool}>
                  <Table.Td fw={500}>{tool}</Table.Td>
                  <Table.Td><Code>{file}</Code></Table.Td>
                  <Table.Td><Text size="xs" c="dimmed">{notes}</Text></Table.Td>
                  <Table.Td>
                    {doc
                      ? <Anchor href={doc} target="_blank" size="xs">docs ↗</Anchor>
                      : <Text size="xs" c="dimmed">—</Text>}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Section>
      </Paper>

      {/* ── Preset Profiles ──────────────────────────────────────────────── */}
      <Paper withBorder radius="md" p="lg" style={{ overflowX: 'auto' }}>
        <Section title="Preset Profiles">
          <Text size="sm" c="dimmed" mb="sm">
            Preset profiles are named bundles of routing categories. Apply them during the setup wizard or
            via <Code>POST /api/prism/admin/categories/apply-preset</Code> to automatically configure default models
            per category based on benchmark scores. Non-destructive — only sets categories that don't already
            have a default model.
          </Text>
          <Table striped withTableBorder withColumnBorders fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Profile</Table.Th>
                <Table.Th>Focus</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {[
                ['software_development', 'Code generation, debugging, refactoring, security review, DevOps'],
                ['customer_support',     'FAQ, sentiment analysis, summarisation, instruction following'],
                ['research_analysis',    'Data analysis, STEM, long context, formal reasoning, citation'],
                ['creative_content',     'Brainstorming, copywriting, proofreading, format conversion'],
                ['data_operations',      'SQL, data transformation, API integration, QA testing'],
                ['agentic_workflows',    'Agentic SWE, function calling, multi-step tool use'],
                ['general_all',          'All 45 categories — full coverage preset'],
              ].map(([id, focus]) => (
                <Table.Tr key={id}>
                  <Table.Td><Code>{id}</Code></Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{focus}</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Section>
      </Paper>

      {/* ── Analytics ────────────────────────────────────────────────────── */}
      <Paper withBorder radius="md" p="lg" style={{ overflowX: 'auto' }}>
        <Section title="Analytics & Cost Tracking">
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              Every gateway request is logged asynchronously (fire-and-forget). The dashboard aggregates
              data per day, per model, and per tenant.
            </Text>
            <Table striped withTableBorder withColumnBorders fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Metric</Table.Th>
                  <Table.Th>Description</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {[
                  ['Actual Cost',       'Cost based on tenant pricing overrides or model registry defaults'],
                  ['Baseline Cost',     'Cost at the list price of the originally requested model'],
                  ['Savings',           'Baseline − Actual (reflects savings from routing to cheaper models)'],
                  ['Input Tokens',      'Prompt + context tokens consumed'],
                  ['Output Tokens',     'Generated tokens produced'],
                  ['Auto-routed %',     'Share of requests using model=auto routing'],
                  ['Context Fallback',  'Requests that were retried with a larger-context model'],
                ].map(([metric, desc]) => (
                  <Table.Tr key={metric}>
                    <Table.Td fw={500}>{metric}</Table.Td>
                    <Table.Td><Text size="sm" c="dimmed">{desc}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
        </Section>
      </Paper>

      {/* ── API Key Lifetime ─────────────────────────────────────────────── */}
      <Paper withBorder radius="md" p="lg" style={{ overflowX: 'auto' }}>
        <Section title="API Key Lifecycle">
          <Stack gap="xs">
            <Text size="sm" c="dimmed">
              Tenant API keys support configurable lifetimes and can be enabled/disabled independently.
              Expired or disabled keys return <Code>401</Code> with a <Code>key_expired</Code> or{' '}
              <Code>key_disabled</Code> error code.
            </Text>
            <Group gap="xs" wrap="wrap">
              {['7 days', '14 days', '30 days', '60 days', '90 days', '365 days', 'Unlimited'].map(l => (
                <Badge key={l} size="sm" variant="outline" color="gray">{l}</Badge>
              ))}
            </Group>
            <Text size="sm" c="dimmed">
              Custom API keys are supported (opt-in, min 16 characters). Keys can be rotated at any time
              from the Tenants page — the old key is invalidated immediately.
            </Text>
          </Stack>
        </Section>
      </Paper>

      {/* ── Offline Mode ─────────────────────────────────────────────────── */}
      <Paper withBorder radius="md" p="lg" style={{ overflowX: 'auto' }}>
        <Section title="Offline Mode">
          <Stack gap="xs">
            <Alert color="blue" icon={<IconInfoCircle size={16} />} p="xs">
              <Text size="sm">
                Set <Code>OFFLINE=true</Code> to disable all outbound internet calls. All core gateway
                functionality works fully offline.
              </Text>
            </Alert>
            <Text size="sm" c="dimmed">
              When offline, model enrichment uses the bundled <Code>data/modelsDev.snapshot.json</Code>{' '}
              instead of fetching from models.dev. Token estimation uses a character-based heuristic
              (~3.5 chars/token, code-aware) with no external dependencies.
            </Text>
          </Stack>
        </Section>
      </Paper>

      {/* ── Observability ────────────────────────────────────────────────── */}
      <Paper withBorder radius="md" p="lg" style={{ overflowX: 'auto' }}>
        <Section title="Observability">
          <Stack gap="sm">
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>Health Check</Text>
              <Code block>{origin}/health</Code>
              <Text size="xs" c="dimmed" mt={4}>Returns <Code>200 ok</Code> or <Code>503 db_not_ready</Code>. No authentication required.</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>Prometheus Metrics</Text>
              <Code block>{origin}/metrics</Code>
              <Text size="xs" c="dimmed" mt={4}>Exposes standard Node.js + HTTP metrics. Consider firewalling this endpoint in production.</Text>
            </div>
          </Stack>
        </Section>
      </Paper>

      {/* ── Environment Variables ─────────────────────────────────────────── */}
      <Paper withBorder radius="md" p="lg" style={{ overflowX: 'auto' }}>
        <Section title="Environment Variables">
          <Table striped withTableBorder withColumnBorders fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Variable</Table.Th>
                <Table.Th>Default</Table.Th>
                <Table.Th>Description</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {[
                ['MONGODB_URI',     'mongodb://localhost:27017/openmodelprism', 'MongoDB connection string'],
                ['JWT_SECRET',      'change-me',   'JWT signing secret — change in production'],
                ['ENCRYPTION_KEY',  'change-me-32-chars', '32-byte hex key for AES-256-GCM credential encryption'],
                ['PORT',            '3000',        'HTTP server port'],
                ['CORS_ORIGINS',    '*',           'Comma-separated allowed origins'],
                ['OFFLINE',         'false',       'true = disable all outbound internet calls'],
                ['LOG_LEVEL',       'info',        'debug / info / warn / error'],
                ['NODE_ENV',        'development', 'production = JSON structured logs'],
              ].map(([key, def, desc]) => (
                <Table.Tr key={key}>
                  <Table.Td><Code>{key}</Code></Table.Td>
                  <Table.Td><Text size="xs" c="dimmed">{def}</Text></Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{desc}</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Section>
      </Paper>
    </Stack>
  );
}
