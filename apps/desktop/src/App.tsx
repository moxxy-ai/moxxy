import { useState } from 'react';
import { useSidecarStatus, type SidecarStatus } from './lib/runner';
import { useRunnerSession } from './lib/runner-session';
import { useDesks } from './lib/desks';
import { DeskSidebar } from './desks/desk-sidebar';
import { Composer, Transcript } from './chat';

export function App(): JSX.Element {
  const status = useSidecarStatus();
  const session = useRunnerSession();
  const desks = useDesks();
  const [theme] = useState<'dark' | 'light'>('dark');

  return (
    <div className="app-shell" data-theme={theme}>
      <aside className="app-sidebar">
        <SidebarHeader status={status} />
        <DeskSidebar api={desks} />
      </aside>
      <main className="app-main bp-grid-fade">
        {session.blocks.length === 0 ? (
          <EmptyState status={status} ready={session.ready} />
        ) : (
          <Transcript blocks={session.blocks} />
        )}
        <Composer
          ready={session.ready && status === 'running'}
          activeTurnId={session.activeTurnId}
          onSend={(p) => void session.send(p)}
          onAbort={() => void session.abort()}
        />
        {session.error && <ErrorBanner message={session.error} />}
      </main>
    </div>
  );
}

function SidebarHeader({ status }: { readonly status: SidecarStatus }): JSX.Element {
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

function EmptyState({
  status,
  ready,
}: {
  readonly status: SidecarStatus;
  readonly ready: boolean;
}): JSX.Element {
  return (
    <div className="empty-state">
      <div>
        <h1>
          <span className="grad-text">moxxy</span>
        </h1>
        <p>
          {ready
            ? 'Type a prompt below to start your first turn.'
            : status === 'running'
              ? 'Connect a provider to start your first turn.'
              : status === 'starting'
                ? 'Starting the local runner…'
                : 'Runner offline — open the dev panel to inspect logs.'}
        </p>
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { readonly message: string }): JSX.Element {
  return (
    <div
      role="alert"
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 112,
        transform: 'translateX(-50%)',
        padding: '0.5rem 0.9rem',
        background: 'var(--color-pink)',
        color: 'var(--color-bg)',
        borderRadius: 'var(--radius-block)',
        fontSize: '0.85rem',
        boxShadow: 'var(--elev)',
      }}
    >
      {message}
    </div>
  );
}
