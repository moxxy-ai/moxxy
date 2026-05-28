import { useState } from 'react';
import { useSidecarStatus } from './lib/runner';

export function App(): JSX.Element {
  const status = useSidecarStatus();
  const [theme] = useState<'dark' | 'light'>('dark');

  return (
    <div className="app-shell" data-theme={theme}>
      <aside className="app-sidebar">
        <SidebarHeader status={status} />
      </aside>
      <main className="app-main bp-grid-fade">
        <div className="empty-state">
          <div>
            <h1>
              <span className="grad-text">moxxy</span>
            </h1>
            <p>
              {status === 'running'
                ? 'Connect a provider to start your first turn.'
                : status === 'starting'
                  ? 'Starting the local runner…'
                  : 'Runner offline — open the dev panel to inspect logs.'}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

interface SidebarHeaderProps {
  readonly status: 'starting' | 'running' | 'crashed' | 'stopped';
}

function SidebarHeader({ status }: SidebarHeaderProps): JSX.Element {
  const dot =
    status === 'running'
      ? 'var(--color-green)'
      : status === 'crashed'
        ? 'var(--color-pink)'
        : 'var(--color-text-dim)';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '1rem',
        borderBottom: '1px solid var(--color-border)',
        fontSize: '0.875rem',
        fontWeight: 600,
        letterSpacing: '0.02em',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: dot,
          boxShadow: status === 'running' ? `0 0 8px ${dot}` : 'none',
        }}
      />
      <span>runner</span>
      <span
        className="mono"
        style={{
          marginLeft: 'auto',
          fontSize: '0.7rem',
          color: 'var(--color-text-dim)',
        }}
        data-testid="runner-status"
      >
        {status}
      </span>
    </div>
  );
}
