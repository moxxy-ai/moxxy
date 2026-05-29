import { useState } from 'react';
import { useConnection, isConnected } from './lib/useConnection';
import { ConnectionScreen } from './connection/ConnectionScreen';
import { OnboardingWizard } from './onboarding/OnboardingWizard';

/**
 * Phase 1 skeleton. The single source of truth for what to render is
 * the supervisor's `phase`:
 *
 *   - anything other than `connected`     → ConnectionScreen
 *   - `connected`                         → ChatSurface (TBD in Phase 3)
 *
 * The onboarding wizard + chat surface land in subsequent phases so
 * each one can be focused and individually verified.
 */
export function App(): JSX.Element {
  const { snapshot, retry } = useConnection();
  const phase = snapshot?.phase;
  const [forceWizard, setForceWizard] = useState(false);

  const cliMissing = phase?.phase === 'cli-missing';
  const connectedWithoutProvider =
    phase?.phase === 'connected' && phase.activeProvider === null;

  // Onboarding takes over when the CLI isn't installed yet, or when
  // we connected but no provider is configured. The wizard auto-
  // closes when the underlying state changes (provider configured /
  // CLI install completed → supervisor reconnects → we land in
  // `connected` with a provider).
  if (forceWizard || cliMissing || connectedWithoutProvider) {
    return (
      <OnboardingWizard phase={phase} onComplete={() => setForceWizard(false)} />
    );
  }

  if (!isConnected(phase)) {
    return <ConnectionScreen snapshot={snapshot} onRetry={() => void retry()} />;
  }

  return <ConnectedPlaceholder snapshot={snapshot!} />;
}

function ConnectedPlaceholder({
  snapshot,
}: {
  readonly snapshot: NonNullable<ReturnType<typeof useConnection>['snapshot']>;
}): JSX.Element {
  const phase = snapshot.phase;
  if (phase.phase !== 'connected') return <></>;
  return (
    <main className="app-main bp-grid">
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '2rem',
        }}
      >
        <div
          className="elev"
          style={{
            maxWidth: 520,
            width: '100%',
            padding: '1.5rem 1.75rem',
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-block)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          <h1 style={{ margin: 0 }}>
            <span className="grad-text">Connected.</span>
          </h1>
          <p
            className="mono"
            style={{
              margin: 0,
              fontSize: '0.8rem',
              color: 'var(--color-text-dim)',
            }}
          >
            session {phase.sessionId} · provider {phase.activeProvider ?? '(none)'} ·
            mode {phase.activeMode ?? '(none)'}
          </p>
          <p
            style={{
              margin: '0.5rem 0 0',
              fontSize: '0.85rem',
              color: 'var(--color-text-muted)',
            }}
          >
            Phase 1 shell. Onboarding wizard + chat surface arrive in
            the next phases — the connection layer is now the single
            source of truth.
          </p>
        </div>
      </div>
    </main>
  );
}
