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
  const { snapshot, retry } = useConnection();
  const phase = snapshot?.phase;
  const [forceWizard, setForceWizard] = useState(false);
  const [view, setView] = useState<View>('chat');

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

  if (!isConnected(phase)) {
    return <ConnectionScreen snapshot={snapshot} onRetry={() => void retry()} />;
  }

  const activeMode = phase!.phase === 'connected' ? phase!.activeMode : null;
  const activeProvider = phase!.phase === 'connected' ? phase!.activeProvider : null;

  return (
    <div className="app-shell">
      <WorkspaceSidebar view={view} onView={setView} />
      {view === 'chat' && (
        <>
          <ContextRail mode={activeMode} provider={activeProvider} />
          <ChatSurface phase={phase!} />
        </>
      )}
      {view === 'workflows' && (
        <main className="col-main" style={{ paddingLeft: 18 }}>
          <article
            className="card"
            style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
          >
            <WorkflowsPanel />
          </article>
        </main>
      )}
      {view === 'settings' && (
        <main className="col-main" style={{ paddingLeft: 18 }}>
          <article
            className="card"
            style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
          >
            <SettingsPanel />
          </article>
        </main>
      )}
    </div>
  );
}
