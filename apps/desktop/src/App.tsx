import { useState } from 'react';
import { useConnection, isConnected } from './lib/useConnection';
import { ConnectionScreen } from './connection/ConnectionScreen';
import { OnboardingWizard } from './onboarding/OnboardingWizard';
import { ChatSurface } from './chat/ChatSurface';
import { WorkspaceSidebar, type View } from './shell/WorkspaceSidebar';
import { ContextRail } from './shell/ContextRail';
import { WorkflowsPanel } from './workflows/WorkflowsPanel';
import { SettingsPanel } from './settings/SettingsPanel';
import { Splash } from './Splash';

/**
 * Top-level shell. Three layers of gating, in order:
 *
 *   1. CLI / provider onboarding takes the whole pane while either
 *      condition is unmet.
 *   2. While the runner is connecting (any phase that isn't
 *      `connected`), the ConnectionScreen owns the pane.
 *   3. Once connected, the workspace shell renders:
 *      WorkspaceSidebar | ContextRail | <active view>.
 */
export function App(): JSX.Element {
  const { snapshot, hasEverConnected, retry } = useConnection();
  const phase = snapshot?.phase;
  const [forceWizard, setForceWizard] = useState(false);
  const [view, setView] = useState<View>('chat');
  const [railOpen, setRailOpen] = useState(true);
  // Hold onto the last 'connected' phase so transient reconnects (e.g.
  // workspace switching restarts the runner) don't blank out the
  // chat header's provider/mode chips while the new socket comes up.
  const [lastConnected, setLastConnected] = useState<typeof phase>(undefined);
  if (phase?.phase === 'connected' && phase !== lastConnected) {
    // Pure state-during-render is fine here: same input ⇒ same output.
    setLastConnected(phase);
  }

  // Hold the splash until the first snapshot arrives — prevents a
  // flash of "ConnectionScreen / resolving" during cold boot.
  if (!snapshot) return <Splash />;

  const cliMissing = phase?.phase === 'cli-missing';
  const connectedWithoutProvider =
    phase?.phase === 'connected' && phase.activeProvider === null;

  if (forceWizard || cliMissing || connectedWithoutProvider) {
    return (
      <OnboardingWizard
        phase={phase}
        onComplete={() => setForceWizard(false)}
      />
    );
  }

  // Cold start: we've never been connected. Full ConnectionScreen.
  if (!isConnected(phase) && !hasEverConnected) {
    return <ConnectionScreen snapshot={snapshot} onRetry={() => void retry()} />;
  }

  // Transient reconnect: keep the shell, show a banner. The chat
  // header chip falls back to the last-known mode/provider so the UI
  // doesn't shuffle while the runner restarts.
  const connected = isConnected(phase);
  const shellPhase = connected ? phase! : lastConnected!;
  const activeMode = shellPhase.phase === 'connected' ? shellPhase.activeMode : null;
  const activeProvider = shellPhase.phase === 'connected' ? shellPhase.activeProvider : null;

  return (
    <div className="app-shell">
      <WorkspaceSidebar view={view} onView={setView} />
      {view === 'chat' && (
        <>
          {railOpen && (
            <ContextRail
              mode={activeMode}
              provider={activeProvider}
              onClose={() => setRailOpen(false)}
            />
          )}
          <ChatSurface
            phase={shellPhase}
            railOpen={railOpen}
            onShowRail={() => setRailOpen(true)}
          />
        </>
      )}
      {view === 'workflows' && (
        <main className="col-main col-main--flat">
          <WorkflowsPanel />
        </main>
      )}
      {view === 'settings' && (
        <main className="col-main col-main--flat">
          <SettingsPanel />
        </main>
      )}
      {!connected && <ReconnectBanner label={describePhase(phase)} />}
    </div>
  );
}

function describePhase(
  phase: import('@shared/ipc').ConnectionPhase | undefined,
): string {
  if (!phase) return 'Reconnecting…';
  switch (phase.phase) {
    case 'idle':
      return 'Starting…';
    case 'resolving-cli':
      return 'Resolving moxxy CLI…';
    case 'spawning':
      return 'Starting agent runtime…';
    case 'adopting':
      return 'Attaching to running runner…';
    case 'attaching':
      return 'Attaching session…';
    case 'reconnecting':
      return phase.reason ? `Reconnecting — ${phase.reason}` : 'Reconnecting…';
    case 'failed':
      return phase.error ? `Disconnected — ${phase.error}` : 'Disconnected';
    default:
      return 'Reconnecting…';
  }
}

function ReconnectBanner({ label }: { readonly label: string }): JSX.Element {
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 24,
        transform: 'translateX(-50%)',
        padding: '8px 14px',
        background: 'var(--color-card-bg)',
        border: '1px solid var(--color-card-border)',
        borderRadius: 999,
        boxShadow: '0 18px 36px -18px rgba(15, 23, 42, 0.25)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 13,
        color: 'var(--color-text-muted)',
        zIndex: 50,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          border: '2px solid var(--color-card-border)',
          borderTopColor: 'var(--color-primary)',
          animation: 'moxxy-spin 0.8s linear infinite',
        }}
      />
      {label}
    </div>
  );
}
