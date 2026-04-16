// ── DemoOverlay ───────────────────────────────────────────────────────────────
// Floating engagement card that appears after 90 seconds in demo mode.
// Positioned bottom-right, slide-in animation, dismissible via X button.

import { useEffect, useState } from 'react';
import { Paper, Text, Button, Group, Stack, Anchor, ActionIcon, Transition, Divider } from '@mantine/core';
import { IconX } from '@tabler/icons-react';

export default function DemoOverlay() {
  const [visible, setVisible]     = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!dismissed) setVisible(true);
    }, 90_000);
    return () => clearTimeout(timer);
  }, [dismissed]);

  function dismiss() {
    setVisible(false);
    setDismissed(true);
  }

  return (
    <Transition
      mounted={visible && !dismissed}
      transition="slide-up"
      duration={400}
      timingFunction="ease"
    >
      {(styles) => (
        <Paper
          withBorder
          shadow="xl"
          p="lg"
          radius="md"
          style={{
            ...styles,
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 2000,
            width: 320,
            maxWidth: 'calc(100vw - 32px)',
          }}
        >
          <Group justify="space-between" align="flex-start" mb="sm">
            <Text fw={700} size="md">Interested in Model Prism?</Text>
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={dismiss} aria-label="Dismiss">
              <IconX size={14} />
            </ActionIcon>
          </Group>

          <Text size="sm" c="dimmed" mb="md">
            Deploy your own LLM gateway with intelligent routing, cost tracking, and multi-tenant support.
          </Text>

          <Stack gap="xs">
            <Button
              component="a"
              href="https://github.com/weisser-dev/open-model-prism"
              target="_blank"
              rel="noopener noreferrer"
              variant="filled"
              size="sm"
              fullWidth
            >
              View product page
            </Button>
            <Button
              component="a"
              href="https://github.com/weisser-dev/open-model-prism/wiki"
              target="_blank"
              rel="noopener noreferrer"
              variant="light"
              size="sm"
              fullWidth
            >
              Read docs
            </Button>
          </Stack>
        </Paper>
      )}
    </Transition>
  );
}
