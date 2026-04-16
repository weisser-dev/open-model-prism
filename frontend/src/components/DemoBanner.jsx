// ── DemoBanner ────────────────────────────────────────────────────────────────
// Thin fixed banner shown at the very top of the page in demo mode.
// Dismissible — closes permanently for the session.

import { useState } from 'react';

export default function DemoBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        background: 'rgba(245, 158, 11, 0.85)',
        backdropFilter: 'blur(4px)',
        color: '#000',
        fontSize: 12,
        fontWeight: 500,
        textAlign: 'center',
        padding: '5px 48px',
        letterSpacing: '0.01em',
        lineHeight: 1.4,
      }}
    >
      This is an interactive demo — all data is mocked.{' '}
      <a
        href="https://github.com/weisser-dev/open-model-prism"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#000', fontWeight: 700, textDecoration: 'underline' }}
      >
        View product &rarr;
      </a>

      <button
        onClick={() => setDismissed(true)}
        aria-label="Close demo banner"
        style={{
          position: 'absolute',
          right: 12,
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '2px 6px',
          fontSize: 16,
          fontWeight: 700,
          color: 'rgba(0,0,0,0.6)',
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
