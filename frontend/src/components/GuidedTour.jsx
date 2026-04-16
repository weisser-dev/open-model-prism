import { useState, useEffect, useCallback } from 'react';
import { Modal, Stack, Group, Button, Text, Title, ThemeIcon, Progress, Box, Badge, Portal } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import {
  IconSparkles, IconRobot, IconBuilding, IconRouteSquare,
  IconDashboard, IconList, IconBug, IconWand, IconPlayerPlay,
  IconAdjustments, IconShieldCheck,
} from '@tabler/icons-react';

export const TOUR_STEPS = [
  {
    icon: IconSparkles,
    color: 'teal',
    title: 'Welcome to Model Prism!',
    body: "Here's a quick tour of the key areas — takes about 90 seconds. Use the buttons below to navigate, or click any page link to jump there while keeping the tour open.",
  },
  {
    icon: IconRobot,
    color: 'blue',
    title: 'Model Registry',
    body: 'Tiers, categories, and pricing were auto-detected from the built-in registry — check if they look right for your setup. Select any models and hit "Reset to registry defaults" to re-apply the suggestions at any time.',
    to: '/models',
    cta: 'Go to Model Registry',
    highlight: '[data-tour="model-table"]',
  },
  {
    icon: IconBuilding,
    color: 'cyan',
    title: 'Tenants',
    body: 'Create isolated API endpoints for each team or project. Every tenant gets its own API key, model whitelist / blacklist, rate limit, and routing configuration.',
    to: '/tenants',
    cta: 'Go to Tenants',
  },
  {
    icon: IconAdjustments,
    color: 'lime',
    title: 'Override Rules',
    body: 'Each tenant has override rules that act as safety nets — e.g. tool call upgrade (forces minimum tier for function-calling requests), vision upgrade, frustration detection, and conversation turn escalation. Each override has a description tooltip explaining what it does.',
    to: '/tenants',
    cta: 'Go to Tenants',
  },
  {
    icon: IconRouteSquare,
    color: 'orange',
    title: 'Routing Config',
    body: 'Fine-tune how auto-routing classifies requests. Add keyword rules, match system prompt roles, set confidence thresholds, choose a cost mode (economy / balanced / quality), and set a tier boost for explicit tier shifting.',
    to: '/routing-config',
    cta: 'Go to Routing Config',
  },
  {
    icon: IconPlayerPlay,
    color: 'green',
    title: 'Test Route',
    badge: 'New',
    body: 'Dry-run any prompt through the routing pipeline and see a step-by-step trace: signal extraction, keyword rule matches, classifier decision, overrides applied, cost mode adjustments, and final model selection — without making a real LLM call.',
    to: '/routing-config',
    cta: 'Go to Test Route',
  },
  {
    icon: IconWand,
    color: 'grape',
    title: 'Synthetic Tests',
    badge: 'AI',
    body: 'Generate synthetic test prompts using AI, run them through the routing pipeline, and evaluate results with AI-powered analysis. Get actionable suggestions for improving quality or reducing costs — choose any available model for generation and evaluation.',
    to: '/routing-config',
    cta: 'Go to Synthetic Tests',
  },
  {
    icon: IconDashboard,
    color: 'violet',
    title: 'Dashboard',
    body: 'Track spending, savings vs baseline, token usage, model distribution, and daily trends — across all tenants or scoped to one.',
    to: '/',
    cta: 'Go to Dashboard',
  },
  {
    icon: IconList,
    color: 'gray',
    title: 'Request Log',
    body: 'Inspect every proxied request: which model was selected, routing decision, cost, and — when prompt logging is enabled — the full message content.',
    to: '/requests',
    cta: 'Go to Request Log',
  },
  {
    icon: IconBug,
    color: 'yellow',
    title: 'Routing Debug Panel',
    badge: 'New',
    body: 'Click any auto-routed request in the log to see the full routing debug panel: extracted signals (tokens, images, tool calls, domains, languages), pre-routing status, classifier confidence, applied overrides, and the final model selection — all at a glance.',
    to: '/requests',
    cta: 'Go to Request Log',
  },
];

// ── Highlight overlay for tour elements ──────────────────────────────────────
function HighlightOverlay({ selector }) {
  const [rect, setRect] = useState(null);

  useEffect(() => {
    if (!selector) { setRect(null); return; }
    // Wait a tick for navigation to complete
    const timer = setTimeout(() => {
      const el = document.querySelector(selector);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 });
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        setRect(null);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [selector]);

  if (!rect) return null;

  return (
    <Portal>
      <div style={{
        position: 'fixed', top: rect.top, left: rect.left,
        width: rect.width, height: rect.height,
        border: '2px solid var(--mantine-color-blue-5)',
        borderRadius: 8, boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
        zIndex: 199, pointerEvents: 'none',
        animation: 'tour-pulse 1.5s ease-in-out infinite',
      }} />
      <style>{`
        @keyframes tour-pulse {
          0%, 100% { box-shadow: 0 0 0 9999px rgba(0,0,0,0.35), 0 0 8px rgba(59,130,246,0.5); }
          50%      { box-shadow: 0 0 0 9999px rgba(0,0,0,0.35), 0 0 20px rgba(59,130,246,0.8); }
        }
      `}</style>
    </Portal>
  );
}

export default function GuidedTour({ opened, onClose, initialStep = 0 }) {
  const [step, setStep] = useState(initialStep);
  const navigate = useNavigate();

  // Reset to initialStep every time the modal is opened
  useEffect(() => {
    if (opened) setStep(initialStep);
  }, [opened, initialStep]);

  const current = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;

  function goTo(to) {
    navigate(to);
    // Keep tour open — it floats above the destination page
  }

  function next() {
    if (isLast) { onClose(); } else {
      const nextStep = TOUR_STEPS[step + 1];
      if (nextStep?.to) navigate(nextStep.to);
      setStep(s => s + 1);
    }
  }

  function back() {
    const prevStep = TOUR_STEPS[step - 1];
    if (prevStep?.to) navigate(prevStep.to);
    setStep(s => s - 1);
  }

  return (
    <>
      {opened && current?.highlight && <HighlightOverlay selector={current.highlight} />}
      <Modal
        opened={opened}
        onClose={onClose}
        title={
          <Text size="sm" c="dimmed">
            Quick tour — {step + 1} / {TOUR_STEPS.length}
          </Text>
        }
        size="sm"
        centered
        withCloseButton
        styles={{ content: { zIndex: 200 } }}
      >
        <Stack gap="md">
          <Progress value={(step / (TOUR_STEPS.length - 1)) * 100} size={3} radius="xl" />

          <Stack align="center" gap="xs" py="sm">
            <ThemeIcon size={72} radius="xl" color={current.color} variant="light">
              <current.icon size={36} />
            </ThemeIcon>
            <Group gap="xs" justify="center">
              <Title order={3} ta="center" mt={4}>{current.title}</Title>
              {current.badge && (
                <Badge size="sm" color={current.badge === 'AI' ? 'grape' : 'green'} variant="light" mt={4}>
                  {current.badge}
                </Badge>
              )}
            </Group>
            <Text c="dimmed" ta="center" size="sm" maw={340}>{current.body}</Text>
          </Stack>

          {current.to && (
            <Button
              variant="light"
              color={current.color}
              onClick={() => goTo(current.to)}
              fullWidth
            >
              {current.cta} →
            </Button>
          )}

          <Box pt={4}>
            <Group justify="space-between">
              <Button variant="subtle" color="gray" size="xs" onClick={onClose}>
                Close tour
              </Button>
              <Group gap={6}>
                {step > 0 && (
                  <Button variant="subtle" size="xs" onClick={back}>
                    ← Back
                  </Button>
                )}
                <Button size="xs" onClick={next}>
                  {isLast ? 'Done' : 'Next →'}
                </Button>
              </Group>
            </Group>
          </Box>
        </Stack>
      </Modal>
    </>
  );
}
