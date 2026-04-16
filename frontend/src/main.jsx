import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider, createTheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import App from './App';

const theme = createTheme({
  primaryColor: 'indigo',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
});

// Inject global CSS custom properties for theming (dark / light / custom)
const styleEl = document.createElement('style');
styleEl.textContent = `
:root, [data-mantine-color-scheme="dark"] {
  --prism-bg-body: #141517;
  --prism-bg-sidebar: #1a1b1e;
  --prism-bg-card: #1a1b1e;
  --prism-bg-input: #25262b;
  --prism-bg-hover: #2c2e33;
  --prism-bg-code: #0d0d14;
  --prism-bg-header: #1a1b1e;
  --prism-bg-overlay: rgba(20,21,23,0.7);
  --prism-text: rgba(255,255,255,0.9);
  --prism-text-dimmed: rgba(255,255,255,0.5);
  --prism-text-muted: rgba(255,255,255,0.3);
  --prism-border: #2c2e33;
  --prism-border-light: rgba(255,255,255,0.1);
  --prism-border-lighter: rgba(255,255,255,0.08);
  --prism-border-medium: rgba(255,255,255,0.15);
  --prism-border-blockquote: rgba(255,255,255,0.2);
  --prism-table-header-bg: rgba(255,255,255,0.05);
  --prism-primary: #228be6;
  --prism-accent: #38bdf8;
  --prism-success: #40c057;
  --prism-warning: #fab005;
  --prism-error: #fa5252;
  --prism-error-bg: rgba(255,50,50,0.05);
  --prism-info: #4c6ef5;
  --prism-chart-baseline-stroke: #868e96;
  --prism-chart-baseline-fill: #868e96;
  --prism-chart-grid: #333;
  --prism-tooltip-bg: #1a1b1e;
  --prism-tooltip-border: #333;
  --prism-nav-text: rgba(255,255,255,0.7);
  --prism-nav-active: #228be6;
  --prism-nav-hover-bg: rgba(255,255,255,0.05);
  --prism-btn-text: #ffffff;
  --prism-scrollbar: #3a3a3a;
  --prism-scrollbar-hover: #555555;
  --prism-table-row-hover: rgba(255,255,255,0.03);
  --prism-table-stripe: rgba(255,255,255,0.02);
}

[data-mantine-color-scheme="light"] {
  --prism-bg-body: #ffffff;
  --prism-bg-sidebar: #f8f9fa;
  --prism-bg-card: #ffffff;
  --prism-bg-input: #f1f3f5;
  --prism-bg-hover: #e9ecef;
  --prism-bg-code: #f1f3f5;
  --prism-bg-header: #f8f9fa;
  --prism-bg-overlay: rgba(255,255,255,0.7);
  --prism-text: #1a1b1e;
  --prism-text-dimmed: #868e96;
  --prism-text-muted: #adb5bd;
  --prism-border: #dee2e6;
  --prism-border-light: #e9ecef;
  --prism-border-lighter: #e9ecef;
  --prism-border-medium: #dee2e6;
  --prism-border-blockquote: #ced4da;
  --prism-table-header-bg: #f8f9fa;
  --prism-primary: #228be6;
  --prism-accent: #1c7ed6;
  --prism-success: #2f9e44;
  --prism-warning: #e67700;
  --prism-error: #e03131;
  --prism-error-bg: rgba(255,50,50,0.05);
  --prism-info: #4c6ef5;
  --prism-chart-baseline-stroke: #adb5bd;
  --prism-chart-baseline-fill: #adb5bd;
  --prism-chart-grid: #dee2e6;
  --prism-tooltip-bg: #ffffff;
  --prism-tooltip-border: #dee2e6;
  --prism-nav-text: #495057;
  --prism-nav-active: #228be6;
  --prism-nav-hover-bg: rgba(0,0,0,0.04);
  --prism-btn-text: #ffffff;
  --prism-scrollbar: #c1c1c1;
  --prism-scrollbar-hover: #a0a0a0;
  --prism-table-row-hover: rgba(0,0,0,0.02);
  --prism-table-stripe: rgba(0,0,0,0.015);
}

/* Code component readable on all backgrounds */
.mantine-Code-root {
  color: var(--prism-text) !important;
  background: var(--prism-bg-input) !important;
}

/* Scrollbar theming */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--prism-scrollbar); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--prism-scrollbar-hover); }
`;
document.head.appendChild(styleEl);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <Notifications position="top-right" />
      <App />
    </MantineProvider>
  </React.StrictMode>
);
