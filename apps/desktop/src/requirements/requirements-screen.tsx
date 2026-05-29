import { useEffect, useRef } from 'react';
import {
  type RequirementCheck,
  type RequirementsApi,
  useRequirements,
} from '@/lib/requirements';

interface RequirementsScreenProps {
  readonly api?: RequirementsApi;
  /** Called when every requirement is satisfied — the app reveals the
   *  main chat surface in response. */
  readonly onReady?: () => void;
}

/**
 * Setup wall the app shows whenever a requirement is unmet (first
 * launch, user uninstalled Node, etc). Re-renders the checklist live
 * while an install runs so the user sees stdout streaming in.
 */
export function RequirementsScreen({
  api,
  onReady,
}: RequirementsScreenProps): JSX.Element {
  const fallback = useRequirements();
  const reqs = api ?? fallback;
  const wasReadyRef = useRef(false);

  useEffect(() => {
    if (reqs.status?.allMet && !wasReadyRef.current) {
      wasReadyRef.current = true;
      onReady?.();
    }
  }, [reqs.status, onReady]);

  return (
    <div
      data-testid="requirements-screen"
      style={{
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        display: 'grid',
        placeItems: 'center',
        padding: '2rem',
      }}
    >
      <div
        className="corner-bracket elev"
        style={{
          width: '100%',
          maxWidth: 560,
          padding: '1.5rem 1.75rem',
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-block)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <header>
          <h1
            style={{
              margin: 0,
              fontSize: '1.5rem',
              fontWeight: 700,
              letterSpacing: 'var(--tracking-tight)',
            }}
          >
            <span className="grad-text">Get moxxy ready</span>
          </h1>
          <p
            style={{
              margin: '0.25rem 0 0',
              color: 'var(--color-text-dim)',
              fontSize: '0.875rem',
            }}
          >
            One-time setup. The app will detect changes and self-correct
            if anything goes missing later.
          </p>
        </header>

        {reqs.error && (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: '0.5rem 0.75rem',
              background:
                'color-mix(in oklab, var(--color-pink) 12%, transparent)',
              border: '1px solid var(--color-pink)',
              borderRadius: 'var(--radius-block)',
              fontSize: '0.85rem',
            }}
          >
            {reqs.error}
          </p>
        )}

        {reqs.loading && !reqs.status ? (
          <p style={{ color: 'var(--color-text-dim)' }}>Probing…</p>
        ) : (
          <ul
            role="list"
            data-testid="requirements-list"
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            {(reqs.status?.checks ?? []).map((c) => (
              <CheckRow key={c.kind} check={c} api={reqs} />
            ))}
          </ul>
        )}

        {reqs.install.running || reqs.install.progress.length > 0 ? (
          <InstallLog api={reqs} />
        ) : null}

        <footer
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: '0.5rem',
            borderTop: '1px solid var(--color-border)',
          }}
        >
          <button
            type="button"
            data-testid="requirements-refresh"
            onClick={() => void reqs.refresh()}
            disabled={reqs.loading || reqs.install.running}
            style={{
              fontSize: '0.8rem',
              color: 'var(--color-text-dim)',
              padding: '0.4rem 0.6rem',
              border: '1px dashed var(--color-border-light)',
              borderRadius: 'var(--radius-block)',
            }}
          >
            Re-check
          </button>
          <span
            className="mono"
            style={{ fontSize: '0.7rem', color: 'var(--color-text-dim)' }}
          >
            {reqs.status?.allMet ? 'Ready' : 'Setup incomplete'}
          </span>
        </footer>
      </div>
    </div>
  );
}

function CheckRow({
  check,
  api,
}: {
  readonly check: RequirementCheck;
  readonly api: RequirementsApi;
}): JSX.Element {
  return (
    <li
      data-testid={`requirement-${check.kind}`}
      data-satisfied={check.satisfied}
      style={{
        padding: '0.6rem 0.8rem',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-block)',
        background: 'var(--color-bg)',
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: '0.5rem 0.75rem',
        alignItems: 'center',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: check.satisfied
            ? 'var(--color-green)'
            : 'var(--color-pink)',
          boxShadow: check.satisfied
            ? '0 0 8px var(--color-green)'
            : undefined,
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span
          style={{
            fontSize: '0.9rem',
            fontWeight: 600,
            color: 'var(--color-text)',
          }}
        >
          {labelFor(check.kind)}
        </span>
        {check.detail && (
          <span
            className="mono"
            style={{
              fontSize: '0.7rem',
              color: 'var(--color-text-dim)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {check.detail}
          </span>
        )}
      </div>
      {!check.satisfied && check.install && (
        <button
          type="button"
          data-testid={`requirement-install-${check.kind}`}
          disabled={api.install.running}
          onClick={() => void api.install.run(check.install!)}
          style={{
            fontSize: '0.8rem',
            padding: '0.35rem 0.7rem',
            background:
              check.install.kind === 'command'
                ? 'var(--color-primary)'
                : 'transparent',
            color:
              check.install.kind === 'command'
                ? 'var(--color-bg)'
                : 'var(--color-primary)',
            border:
              check.install.kind === 'command'
                ? 'none'
                : '1px solid var(--color-primary)',
            borderRadius: 'var(--radius-block)',
            fontWeight: 600,
            opacity: api.install.running ? 0.5 : 1,
          }}
        >
          {check.install.label}
        </button>
      )}
    </li>
  );
}

function labelFor(kind: 'node' | 'moxxy-cli' | 'provider-key'): string {
  return kind === 'node'
    ? 'Node.js'
    : kind === 'moxxy-cli'
      ? 'moxxy CLI'
      : 'Provider key';
}

function InstallLog({ api }: { readonly api: RequirementsApi }): JSX.Element {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [api.install.progress.length]);
  return (
    <div
      data-testid="install-log"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.25rem',
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: '0.65rem',
          color: 'var(--color-text-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {api.install.running ? 'Installing…' : 'Install log'}
      </span>
      <pre
        ref={ref}
        className="mono"
        style={{
          margin: 0,
          padding: '0.5rem 0.6rem',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-block)',
          fontSize: '0.7rem',
          color: 'var(--color-text-muted)',
          maxHeight: 180,
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
        }}
      >
        {api.install.progress.map((p) => p.line).join('\n')}
      </pre>
      {api.install.lastExitCode !== null && (
        <span
          className="mono"
          data-testid="install-exit-code"
          style={{
            fontSize: '0.7rem',
            color:
              api.install.lastExitCode === 0
                ? 'var(--color-green)'
                : 'var(--color-pink)',
          }}
        >
          exit {api.install.lastExitCode}
        </span>
      )}
      {api.install.error && (
        <span
          className="mono"
          role="alert"
          style={{ fontSize: '0.7rem', color: 'var(--color-pink)' }}
        >
          {api.install.error}
        </span>
      )}
    </div>
  );
}
