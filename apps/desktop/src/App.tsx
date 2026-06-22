import { useCallback, useEffect, useMemo, useState } from 'react';
import { asset } from '@/lib/asset';
import {
  ConnectionBridge,
  isConnected,
  useActiveAsk,
  useActiveWorkspaceId,
  useConnection,
  ChatStoreBridge,
  chatStore,
  composerDraftStore,
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
import type { View } from './shell/ViewHeader';
import { ContextRail, type RailPane } from './shell/ContextRail';
import type { AgentLink, FileSelection } from './shell/surfaces/registry';
import { useAgentSurfaceReveal } from './shell/surfaces/useAgentSurfaceReveal';
import { WorkflowsPanel } from './workflows/WorkflowsPanel';
import { CollaboratePanel } from './collaborate/CollaboratePanel';
import { SettingsPanel } from './settings/SettingsPanel';
import { AppsPanel } from './apps/AppsPanel';
import { UpdateBanner } from './shell/UpdateBanner';
import { Splash } from './Splash';
import { api, toErrorMessage } from '@moxxy/client-core';

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
  const [view, setView] = useState<View>('chat');
  // Context rail starts collapsed. The context button opens a dropdown
  // (terminal / files changed / browser); picking one sets the active pane
  // and opens the rail. Null = collapsed.
  const [railPane, setRailPane] = useState<RailPane | null>(null);
  // The file the `file` pane shows (set by auto-reveal on Write/Edit).
  const [railFile, setRailFile] = useState<FileSelection>({ path: null, mode: 'content' });
  const [lastConnected, setLastConnected] = useState<typeof phase>(undefined);
  // Local flag that flips the moment the user clicks "Open my
  // workspaces" in the FirstRunWizard, so we don't re-render the
  // wizard while waiting for prefs.read to round-trip.
  const [justFinishedOnboarding, setJustFinishedOnboarding] = useState(false);
  // Capture the latest `connected` phase to keep the shell mounted across the
  // brief `snapshot === undefined` gap a workspace switch can produce. Gate the
  // derive-during-render update on a STABLE SCALAR key (not object identity): an
  // upstream snapshot mirror that returns a fresh connected-phase object every
  // poll would otherwise re-set state and force an extra render each tick — at
  // worst a render loop. The key only changes when the connection's identity
  // actually changes.
  const connectedKey =
    phase?.phase === 'connected'
      ? `${phase.sessionId}|${phase.activeProvider}|${phase.activeMode}`
      : null;
  const lastConnectedKey =
    lastConnected?.phase === 'connected'
      ? `${lastConnected.sessionId}|${lastConnected.activeProvider}|${lastConnected.activeMode}`
      : null;
  if (phase?.phase === 'connected' && connectedKey !== lastConnectedKey) {
    setLastConnected(phase);
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

  // When the agent drives the browser / terminal / writes a file, open the
  // matching embedded pane so its work is shown (once per session per pane; the
  // file pane re-reveals when a different file is written).
  const revealPane = useCallback((pane: RailPane, file?: FileSelection): void => {
    setRailPane(pane);
    if (file) setRailFile(file);
  }, []);
  useAgentSurfaceReveal(activeWorkspaceId, revealPane);

  // Pane → chat/agent channel. Built-in panes use `ask` ("Ask agent about this
  // file"); the browser pane's region-capture attaches screenshots directly.
  // `send` deliberately stages for review (no silent auto-send) — the consent
  // gate matches composerDraftStore's review-in-composer behaviour.
  const agent = useMemo<AgentLink>(
    () => ({
      ask: (text) => {
        if (activeWorkspaceId) composerDraftStore.prefill(activeWorkspaceId, text);
      },
      send: (text) => {
        if (activeWorkspaceId) composerDraftStore.prefill(activeWorkspaceId, text);
      },
      attach: (a) => {
        if (activeWorkspaceId) {
          composerDraftStore.prefill(
            activeWorkspaceId,
            `Please look at \`${a.name ?? a.path ?? 'the attached item'}\`.`,
          );
        }
      },
    }),
    [activeWorkspaceId],
  );

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
  if (activeWorkspaceId === null || (!snapshot && !lastConnected)) {
    return (
      <>
        <ConnectionBridge />
        <ChatStoreBridge />
        <Splash />
      </>
    );
  }

  const cliMissing = phase?.phase === 'cli-missing';
  const connectedWithoutProvider =
    phase?.phase === 'connected' && phase.activeProvider === null;

  if (cliMissing || connectedWithoutProvider) {
    return (
      <>
        <ConnectionBridge />
        <ChatStoreBridge />
        <Onboarding
          phase={phase}
          // Nothing to do on completion: finishing the recovery gate (CLI
          // installed / provider added) flips the connection phase, which
          // re-renders this gate and drops it on its own.
          onComplete={() => undefined}
        />
      </>
    );
  }

  if (!isConnected(phase) && !hasEverConnected) {
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

  const connected = isConnected(phase);
  const shellPhase = connected ? phase! : lastConnected!;
  // (mode + provider were previously surfaced as a chip in the chat
  // header; that's been dropped in favour of the workspace path.
  // Keep this comment so the variable's absence is intentional.)

  return (
    <div className="app-shell">
      <ConnectionBridge />
      <ChatStoreBridge />
      <UpdateBanner />
      <WorkspaceSidebar view={view} onView={setView} workspaceId={activeWorkspaceId} />
      {view === 'chat' && (
        <>
          <ChatSurface
            phase={shellPhase}
            workspaceId={activeWorkspaceId}
            railPane={railPane}
            onPickPane={setRailPane}
            onView={setView}
          />
          <ContextRail
            pane={railPane}
            onClose={() => setRailPane(null)}
            workspaceId={activeWorkspaceId}
            file={railFile}
            agent={agent}
          />
        </>
      )}
      {view === 'workflows' && (
        <main className="col-main col-main--flat">
          <WorkflowsPanel onView={setView} />
        </main>
      )}
      {view === 'collaborate' && (
        <main className="col-main col-main--flat">
          <CollaboratePanel onView={setView} workspaceId={activeWorkspaceId} />
        </main>
      )}
      {view === 'settings' && (
        <main className="col-main col-main--flat">
          <SettingsPanel onView={setView} />
        </main>
      )}
      {view === 'apps' && (
        <main className="col-main col-main--flat">
          <AppsPanel onView={setView} />
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
        boxShadow: '0 18px 36px -18px rgba(15, 23, 42, 0.25)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 13,
        color: 'var(--color-text-muted)',
        zIndex: 50,
      }}
    >
      <img
        src={asset('logo.png')}
        alt=""
        aria-hidden="true"
        className="moxxy-avatar-loader moxxy-avatar-loader--sm"
        height={28}
        style={{ height: 28, width: 'auto', objectFit: 'contain', imageRendering: 'pixelated' }}
      />
      {label}
    </div>
  );
}
