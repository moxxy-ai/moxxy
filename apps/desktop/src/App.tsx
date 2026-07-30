import { useEffect, useState } from 'react';
import { MoxxyMark } from '@/components/MoxxyMark';
import {
  ConnectionBridge,
  isConnected,
  useActiveAsk,
  useActiveWorkspaceId,
  useConnection,
  ChatStoreBridge,
  chatStore,
  usePrefs,
  useSessionInfoBridge,
  useComposerChatViewRequest,
} from '@moxxy/client-core';
import { AskSheet } from './chat/AskSheet';
import { useAskSurfaceClaimed } from '@/lib/askSurface';
import { useTheme } from '@/lib/useTheme';
import { toggleSidebarCollapsed } from '@/lib/useSidebarCollapsed';
import { ConnectionScreen, type UpdateCliResult } from './connection/ConnectionScreen';
import { Onboarding } from './onboarding/Onboarding';
import { ChatSurface } from './chat/ChatSurface';
import { WorkspaceSidebar } from './shell/WorkspaceSidebar';
import { AppRail } from './shell/AppRail';
import type { View } from './shell/views';
import { Workbench, type WorkbenchTab } from './shell/Workbench';
import { useAgentSurfaceReveal } from './shell/surfaces/useAgentSurfaceReveal';
import { CollaboratePanel } from './collaborate/CollaboratePanel';
import { SettingsPanel } from './settings/SettingsPanel';
import { AutomationsPanel, useAutomationsKind } from './automations/AutomationsPanel';
import { AutomationsIndex } from './automations/AutomationsIndex';
import {
  ChannelsIndex,
  ChannelsSurface,
  useChannelSelection,
} from './channels/ChannelsSurface';
import { SettingsIndex, useSettingsTab } from './settings/SettingsPanel';
import { AppsPanel } from './apps/AppsPanel';
import { MobilePanel } from './mobile/MobilePanel';
import { UpdateBanner } from './shell/UpdateBanner';
import { Splash } from './Splash';
import { api, toErrorMessage } from '@moxxy/client-core';
import {
  resolveActiveSessionShell,
  shouldShowProviderRecovery,
  type LastConnectedSession,
} from './app-readiness';
import { useSessionInfoReady } from './app-session-readiness';

const RUNNER_LOCKED_VIEWS: ReadonlyArray<View> = ['collaborate', 'apps', 'automations'];
const RUNNER_LOCKED_REASON = 'Moxxy is still loading this session';

/**
 * Top-level shell. Three layers of gating, in order:
 *
 *   1. CLI / provider onboarding takes the whole pane while either
 *      condition is unmet.
 *   2. While the runner is connecting (any phase that isn't
 *      `connected`), the ConnectionScreen owns the pane.
 *   3. Once connected, the Harness frame renders:
 *      AppRail | index column | field | workbench.
 */
export function App(): JSX.Element {
  // Theme controller — applies the persisted light/dark/system pref to
  // <html data-theme> and tracks OS scheme changes. Mounted exactly once.
  useTheme();
  // Re-emit the runner's registry-change push (`session.info.changed`) as the
  // SESSION_INFO_REFRESH_EVENT every info-derived view listens for — Settings
  // tabs, mode badge, agent picker — so agent-made changes (provider_add, …)
  // show up live instead of after an app restart. Mounted exactly once.
  useSessionInfoBridge();
  const activeWorkspaceId = useActiveWorkspaceId();
  const { snapshot, hasEverConnected, retry } = useConnection(activeWorkspaceId);
  const { prefs, loading: prefsLoading } = usePrefs();
  const phase = snapshot?.phase;
  const sessionInfoReady = useSessionInfoReady(activeWorkspaceId, phase);
  const [view, setView] = useState<View>('chat');
  // The workbench starts collapsed — but collapsed now leaves a vertical tab
  // strip, so it is still discoverable and one click opens the pane you want.
  // Null = collapsed.
  const [benchTab, setBenchTab] = useState<WorkbenchTab | null>(null);
  // Each destination remembers what it was showing, so switching away and back
  // does not silently reset the list to its first entry.
  const [automationsKind, setAutomationsKind] = useAutomationsKind();
  const [channelId, setChannelId] = useChannelSelection();
  const [settingsTab, setSettingsTab] = useSettingsTab();
  const [lastConnected, setLastConnected] = useState<LastConnectedSession | null>(null);
  // Local flag that flips the moment the user clicks "Open my
  // workspaces" in the FirstRunWizard, so we don't re-render the
  // wizard while waiting for prefs.read to round-trip.
  const [justFinishedOnboarding, setJustFinishedOnboarding] = useState(false);
  // Capture the latest `connected` phase (keyed by the active workspace) to keep
  // the shell mounted across the brief `snapshot === undefined` gap a workspace
  // switch can produce. Gate the derive-during-render update on a STABLE SCALAR
  // key (not object identity): an upstream snapshot mirror that returns a fresh
  // connected-phase object every poll would otherwise re-set state and force an
  // extra render each tick — at worst a render loop. The key only changes when
  // the active workspace or the connection's identity actually changes.
  const connectedKey =
    activeWorkspaceId && phase?.phase === 'connected'
      ? `${activeWorkspaceId}|${phase.sessionId}|${phase.activeProvider}|${phase.activeMode}`
      : null;
  const lastConnectedKey =
    lastConnected?.phase.phase === 'connected'
      ? `${lastConnected.workspaceId}|${lastConnected.phase.sessionId}|${lastConnected.phase.activeProvider}|${lastConnected.phase.activeMode}`
      : null;
  if (
    activeWorkspaceId &&
    phase?.phase === 'connected' &&
    connectedKey !== lastConnectedKey
  ) {
    setLastConnected({ workspaceId: activeWorkspaceId, phase });
  }

  // Mirror the active workspace into the chat store so unread state
  // clears as soon as the user switches.
  useEffect(() => {
    chatStore.setActive(activeWorkspaceId);
  }, [activeWorkspaceId]);

  // When an app (or other off-chat surface) does "Send to chat", it stages a
  // composer draft and pulses a request to show the chat view — switch to it so
  // the user lands on the prefilled composer.
  useComposerChatViewRequest(() => setView('chat'));

  // When the agent drives the browser / terminal, open the matching workbench
  // tab so its work is shown to the user (once per session per tab).
  useAgentSurfaceReveal(activeWorkspaceId, setBenchTab);

  // Cmd/Ctrl+B toggles the workspace sidebar (same window-level keydown
  // pattern as WorkflowCanvas's Delete handling). Skipped while typing —
  // Cmd+B means "bold" inside inputs/textareas/contentEditable.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== 'b') return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      toggleSidebarCollapsed();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Boot-probe heartbeat: the React tree mounted, so a hot-updated bundle is
  // healthy — tell main to confirm it (no-op on the bundled floor). A SINGLE
  // swallowed invoke here was the prime suspect for "updates but reverts to the
  // old version": if this confirm never lands (e.g. it races IPC registration),
  // the 15s boot-probe poisons a perfectly healthy bundle and relaunches onto
  // the floor. So retry with backoff, and if every attempt fails, report it so
  // the failure is recorded in the boot-log rather than masquerading as a revert.
  useEffect(() => {
    let cancelled = false;
    const delays = [0, 500, 1500, 4000]; // ~6s of attempts, well within the probe's 15s
    void (async () => {
      let lastError = 'unknown';
      for (const delay of delays) {
        if (cancelled) return;
        if (delay) await new Promise((r) => setTimeout(r, delay));
        try {
          await api().invoke('app.appBooted');
          return; // confirmed
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
      }
      if (cancelled) return;
      await api()
        .invoke('app.bootHeartbeatFailed', { error: lastError })
        .catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // First-run gate. Block on prefs loading so we never flash the
  // main UI before deciding whether onboarding is needed.
  const shell = resolveActiveSessionShell({
    activeWorkspaceId,
    snapshot,
    lastConnected,
    sessionInfoReady,
  });
  const runnerTabsLocked = shell.sessionLoading;
  const onView = (next: View): void => {
    if (runnerTabsLocked && isRunnerLockedView(next)) {
      setView('chat');
      return;
    }
    setView(next);
  };

  useEffect(() => {
    if (runnerTabsLocked && isRunnerLockedView(view)) {
      setView('chat');
    }
  }, [runnerTabsLocked, view]);

  if (prefsLoading) {
    return (
      <>
        <ConnectionBridge />
        <ChatStoreBridge />
        <Splash message="Loading preferences…" />
      </>
    );
  }

  if (prefs && !prefs.onboardingComplete && !justFinishedOnboarding) {
    return (
      <>
        <ConnectionBridge />
        <ChatStoreBridge />
        <Onboarding onComplete={() => setJustFinishedOnboarding(true)} />
      </>
    );
  }

  // Hold the splash until we have a connection snapshot for some
  // workspace AND we know who the active one is — but ONLY on the very
  // first boot. Once we've connected at least once (`lastConnected` set),
  // a workspace switch can briefly leave `snapshot` undefined; dropping to
  // the full-screen Splash there is exactly the flicker the user saw. Keep
  // the shell mounted instead and fall back to `lastConnected` for the
  // chrome phase (see `shellPhase` below).
  if (shell.needsInitialSplash || activeWorkspaceId === null) {
    return (
      <>
        <ConnectionBridge />
        <ChatStoreBridge />
        <Splash />
      </>
    );
  }

  const cliMissing = shell.phase.phase === 'cli-missing';
  const connectedWithoutProvider = shouldShowProviderRecovery(
    shell.phase,
    shell.sessionLoading,
  );

  if (cliMissing || connectedWithoutProvider) {
    return (
      <>
        <ConnectionBridge />
        <ChatStoreBridge />
        <Onboarding
          phase={shell.phase}
          // Nothing to do on completion: finishing the recovery gate (CLI
          // installed / provider added) flips the connection phase, which
          // re-renders this gate and drops it on its own.
          onComplete={() => undefined}
        />
      </>
    );
  }

  if (!shell.connected && !hasEverConnected) {
    // Terminal protocol-incompatible self-heal: update the bundled CLI in
    // place (host `app.updateCli`), then re-run the supervisor connect — which
    // respawns the runner from the now-newer CLI, so the client attaches
    // cleanly. App.tsx owns the IPC call + the retry; ConnectionScreen stays
    // presentational. Failures surface in the screen's error + manual hint.
    const onUpdateCli = async (): Promise<UpdateCliResult> => {
      try {
        const { code } = await api().invoke('app.updateCli');
        if (code !== 0) {
          return { ok: false, error: `Updating the moxxy CLI failed (npm exited with code ${code}).` };
        }
        void retry();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: toErrorMessage(e) };
      }
    };
    return (
      <>
        <ConnectionBridge />
        <ChatStoreBridge />
        <ConnectionScreen
          snapshot={snapshot}
          onRetry={() => void retry()}
          onUpdateCli={onUpdateCli}
        />
      </>
    );
  }

  const connected = shell.connected;
  const shellPhase = shell.phase;
  // (mode + provider were previously surfaced as a chip in the chat
  // header; that's been dropped in favour of the workspace path.
  // Keep this comment so the variable's absence is intentional.)

  return (
    <div className="app-shell">
      <ConnectionBridge />
      <ChatStoreBridge />
      <UpdateBanner />
      {/* One navigation organ. The index column beside it changes CONTENTS per
          destination rather than being a different component per view. */}
      <AppRail
        view={view}
        onView={onView}
        disabledViews={runnerTabsLocked ? RUNNER_LOCKED_VIEWS : undefined}
        disabledReason={RUNNER_LOCKED_REASON}
      />
      {/* One index column per destination: the rail says where you are, the
          column says what is in here. */}
      {view === 'chat' && <WorkspaceSidebar onOpenRun={() => onView('chat')} />}
      {view === 'automations' && (
        <AutomationsIndex kind={automationsKind} onPick={setAutomationsKind} />
      )}
      {view === 'channels' && <ChannelsIndex selected={channelId} onSelect={setChannelId} />}
      {view === 'settings' && <SettingsIndex tab={settingsTab} onPick={setSettingsTab} />}
      {view === 'chat' && (
        <>
          <ChatSurface
            phase={shellPhase}
            workspaceId={activeWorkspaceId}
            sessionLoading={shell.sessionLoading}
          />
          <Workbench
            tab={benchTab}
            onPick={setBenchTab}
            onClose={() => setBenchTab(null)}
            workspaceId={activeWorkspaceId}
          />
        </>
      )}
      {view === 'collaborate' && (
        <main className="field">
          <CollaboratePanel workspaceId={activeWorkspaceId} />
        </main>
      )}
      {view === 'settings' && (
        <main className="field">
          <SettingsPanel tab={settingsTab} />
        </main>
      )}
      {view === 'apps' && (
        <main className="field">
          <AppsPanel />
        </main>
      )}
      {view === 'automations' && (
        <main className="field">
          <AutomationsPanel kind={automationsKind} />
        </main>
      )}
      {/* Channels is independent of the runner session (the gateway lives in the
          main process), so it is never runner-locked. */}
      {view === 'channels' && (
        <main className="field">
          <ChannelsSurface selected={channelId} />
        </main>
      )}
      {/* Mobile pairing is a property of the INSTALL, not another chat surface to
          configure, so it sits at the foot of the rail rather than in the channel
          catalog. Like Channels it never depends on the runner session. */}
      {view === 'mobile' && (
        <main className="field">
          <MobilePanel />
        </main>
      )}
      {!connected && <ReconnectBanner label={describePhase(phase)} />}
      {/* The runner BLOCKS on permission/approval asks. ChatSurface renders
          them in the chat view and AgentTaskModal claims the surface while a
          background-agent modal is open — this fallback catches every other
          view so an ask is never invisible (and never double-rendered). */}
      {view !== 'chat' && <GlobalAskFallback workspaceId={activeWorkspaceId} />}
    </div>
  );
}

/** True when the key event originated in a text-entry surface (so global
 *  shortcuts must not fire). Mirrors WorkflowCanvas's guard. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function isRunnerLockedView(view: View): boolean {
  return RUNNER_LOCKED_VIEWS.includes(view);
}

function GlobalAskFallback({ workspaceId }: { readonly workspaceId: string | null }): JSX.Element | null {
  const ask = useActiveAsk(workspaceId);
  const claimed = useAskSurfaceClaimed();
  if (!ask || claimed) return null;
  // AskSheet's inner Sheet already owns the dialog semantics (role/aria-modal),
  // its own focus trap, Escape, and focus restoration — so this outer wrapper
  // must NOT add a second dialog/trap. What it adds is a polite live region so a
  // screen-reader user in a NON-chat view is told the runner is now blocked on
  // their input (otherwise the sheet appears silently off-context).
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 24,
        transform: 'translateX(-50%)',
        width: 'min(620px, calc(100vw - 48px))',
        zIndex: 60,
      }}
    >
      <AskSheet ask={ask} />
    </div>
  );
}

function describePhase(
  phase: import('@moxxy/desktop-ipc-contract').ConnectionPhase | undefined,
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
    case 'protocol-incompatible':
      // Terminal — say so plainly rather than implying a reconnect is coming.
      return phase.hint;
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
        padding: '6px 14px 6px 6px',
        background: 'var(--color-card-bg)',
        border: '1px solid var(--color-card-border)',
        borderRadius: 999,
        boxShadow: 'var(--color-card-shadow)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 13,
        color: 'var(--color-text-muted)',
        zIndex: 50,
      }}
    >
      <MoxxyMark size={28} className="moxxy-avatar-loader moxxy-avatar-loader--sm" />
      {label}
    </div>
  );
}
