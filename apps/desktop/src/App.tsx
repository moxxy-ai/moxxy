import { useState } from 'react';
import { useConnection, isConnected } from './lib/useConnection';
import { ConnectionScreen } from './connection/ConnectionScreen';
import { OnboardingWizard } from './onboarding/OnboardingWizard';
import { ChatSurface } from './chat/ChatSurface';
import { DeskSidebar } from './desks/DeskSidebar';
import { WorkflowsPanel } from './workflows/WorkflowsPanel';
import { SettingsPanel } from './settings/SettingsPanel';
import { Splash } from './Splash';

type View = 'chat' | 'workflows' | 'settings';

/**
 * Top-level shell. Three layers of gating, in order:
 *
 *   1. CLI / provider onboarding takes the whole pane while either
 *      condition is unmet.
 *   2. While the runner is connecting (any phase that isn't
 *      `connected`), the ConnectionScreen owns the pane.
 *   3. Once connected, the main shell renders: DeskSidebar on the
 *      left + the active view (chat / workflows / settings).
 */
export function App(): JSX.Element {
  const { snapshot, retry } = useConnection();
  const phase = snapshot?.phase;
  const [forceWizard, setForceWizard] = useState(false);
  const [view, setView] = useState<View>('chat');

  // First snapshot hasn't arrived yet — keep the splash on until we know
  // whether to show onboarding, the connection screen, or the chat
  // shell. Without this gate a flash of "ConnectionScreen / connecting"
  // shows for the few hundred ms before snapshot resolves.
  if (!snapshot) {
    return <Splash />;
  }

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

  return (
    <div className="app-shell" style={{ flexDirection: 'row' }}>
      <DeskSidebar view={view} onView={setView} />
      {view === 'chat' && <ChatSurface phase={phase!} />}
      {view === 'workflows' && <WorkflowsPanel />}
      {view === 'settings' && <SettingsPanel />}
    </div>
  );
}
