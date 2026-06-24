/**
 * Wire every IPC handler declared in [`IpcCommands`].
 *
 * Two collaborators:
 *
 *   1. {@link RunnerPool} — one supervisor per workspace; the active
 *      one is the foreground. session.* commands accept an optional
 *      workspaceId arg and default to the active workspace so the
 *      renderer can target background workspaces without switching.
 *
 *   2. {@link DeskStore} — workspace metadata on disk.
 *
 * Events forwarded from each supervisor are tagged with workspaceId
 * (see {@link bindWindow}), so the renderer can dispatch into the
 * right per-workspace chat state and surface "background turn
 * finished in workspace X" notifications later.
 *
 * The handler bodies themselves live in the per-domain modules under
 * `./ipc/*`; this file stays a thin orchestrator that calls each
 * domain registrar (every one funnels through the single validated
 * `handle` choke point in `./ipc/shared`) plus the window-binding
 * lifecycle.
 */

import type { BrowserWindow } from 'electron';

import type { ConnectionPhase, IpcEvents } from '@moxxy/desktop-ipc-contract';
import type { RunnerSupervisor } from './runner-supervisor';
import type { RunnerPool } from './runner-pool';
import { SessionDriver } from './session-driver';
import type { DeskStore } from './desks';
import { sendEvent } from './send-event';
import { desktopEventBus, wsEventBus } from './event-bus';
import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import { drivers, publishDriver, setActiveBus, unpublishDriver, whenDriverReady } from './ipc/shared';
import { registerAppHandlers } from './ipc/app';
import { registerUpdateHandlers, type UpdateConfig } from './ipc/update';
import { registerAskHandlers } from './ipc/ask';
import { registerConnectionHandlers } from './ipc/connection';
import { registerOnboardingHandlers } from './ipc/onboarding';
import { registerProviderLoginHandlers } from './ipc/provider-login';
import { registerSessionHandlers } from './ipc/session';
import { registerSessionsHandlers } from './ipc/sessions';
import { registerWorkspaceFsHandlers } from './ipc/workspace-fs';
import { registerAppsHandlers } from './ipc/apps';
import { registerAnonymizerHandlers } from './ipc/anonymizer';
import { registerGitHandlers } from './ipc/git';
import { registerSurfaceHandlers } from './ipc/surfaces';
import { registerDesksHandlers } from './ipc/desks';
import { registerWorkflowsHandlers } from './ipc/workflows';
import { registerSchedulerHandlers } from './ipc/scheduler';
import { registerWebhookHandlers } from './ipc/webhooks';
import { registerPrefsHandlers } from './ipc/prefs';
import { registerSettingsHandlers } from './ipc/settings';
import { registerVaultHandlers } from './ipc/vault';
import { registerChatHandlers } from './ipc/chat';
import { registerMobileGatewayHandlers, type MobileGatewayController } from './ipc/mobile-gateway';

export function registerIpcHandlers(
  buses: ReadonlyArray<CommandBus>,
  pool: RunnerPool,
  desks: DeskStore,
  opts: {
    readonly update?: UpdateConfig;
    /** Bridge-lifecycle surface for the mobile-gateway commands; the Electron
     *  main injects it. Omitted ⇒ the commands report `not-supported`. */
    readonly mobileGateway?: MobileGatewayController;
  } = {},
): void {
  // Register the SAME handler bodies onto every transport. `setActiveBus`
  // points the shared `handle()` at one bus for the duration of a sweep; the
  // registrars are oblivious to which transport they're wiring. Pass the
  // Electron bus exactly once (a second `ipcMain.handle` for a channel throws).
  for (const bus of buses) {
    setActiveBus(bus);
    registerAskHandlers();
    registerAppHandlers(pool);
    // Self-update handlers. The baked signing key is supplied by the app's main
    // (it owns `update-key.ts`); an empty/absent config means updates report as
    // unavailable rather than erroring.
    registerUpdateHandlers(opts.update ?? { publicKeyPem: '' });
    registerConnectionHandlers(pool);
    registerOnboardingHandlers(pool);
    registerProviderLoginHandlers(pool);
    registerSessionHandlers(pool);
    registerSessionsHandlers(pool, desks);
    registerWorkspaceFsHandlers(desks);
    registerAppsHandlers();
    registerAnonymizerHandlers(pool, desks);
    registerGitHandlers(desks);
    registerSurfaceHandlers(pool);
    registerDesksHandlers(pool, desks);
    registerWorkflowsHandlers(pool, desks);
    registerSchedulerHandlers(undefined, desks);
    registerWebhookHandlers(undefined, desks);
    registerPrefsHandlers();
    registerSettingsHandlers(pool);
    registerVaultHandlers();
    registerChatHandlers(pool);
    registerMobileGatewayHandlers(opts.mobileGateway ?? null);
  }
}

/**
 * Bind a window to the runner pool: forward every supervisor's
 * `connection.changed` to the renderer, manage per-workspace
 * SessionDrivers so streamed events get the right workspaceId tag,
 * and tear everything down when the window closes.
 *
 * `claimGlobal` controls whether this window's drivers register
 * themselves in the module-level `drivers` map that IPC RPCs
 * (runTurn, abortTurn, …) look up. Pass true for the *primary*
 * window (the main app) and false for secondary surfaces like the
 * focus widget — secondary surfaces still receive every runner
 * event via their own local SessionDriver subscriptions, but the
 * RPC entry-points keep routing through the primary's driver so
 * turn book-keeping (the turns map on the driver) doesn't get
 * split between processes.
 */
export function bindWindow(
  pool: RunnerPool,
  window: BrowserWindow,
  opts: { readonly claimGlobal?: boolean } = {},
): () => void {
  const claimGlobal = opts.claimGlobal ?? true;
  const unbindDesktopEvents = desktopEventBus.addSink({
    broadcast: (channel, payload) => {
      sendEvent(window, channel, payload);
    },
  });
  const send = <K extends keyof IpcEvents>(channel: K, payload: IpcEvents[K]): void => {
    sendEvent(window, channel, payload);
    // Mirror `connection.changed` to non-Electron transports — but only from
    // the PRIMARY binding, so a secondary surface (focus widget) doesn't emit a
    // duplicate WS copy of the same workspace phase. No-op without a WS bridge.
    if (claimGlobal) wsEventBus.broadcast(channel, payload);
  };

  // Maintain one SessionDriver per workspace for the lifetime of its
  // active RemoteSession.
  const localDrivers = new Map<string, SessionDriver>();
  // For SECONDARY bindings (focus widget): we don't own the driver,
  // we just attach our window to whichever driver is already in the
  // global registry. Keep the unsubs so the close handler can drop
  // us from the broadcast set without affecting the primary's driver.
  const attachUnsubs = new Map<string, () => void>();

  const ensureDriverFor = (id: string, sup: RunnerSupervisor): void => {
    const session = sup.remote();
    if (claimGlobal) {
      // Primary: own the driver.
      const existing = localDrivers.get(id);
      // A `connected` pool change can fire more than once for the SAME
      // live session (e.g. a secondary window binding, a redundant
      // supervisor re-emit). Disposing+recreating the driver in that
      // case aborts whatever turn is in flight — fatal for research,
      // whose human-in-the-loop approval keeps a turn parked for many
      // seconds. Only rebuild when the underlying session actually
      // changed (a genuine reconnect); otherwise leave the running
      // driver — and its in-flight turn — untouched.
      if (existing && session && existing.wraps(session)) return;
      if (existing) existing.dispose();
      if (session) {
        const driver = new SessionDriver(session, window, id);
        localDrivers.set(id, driver);
        // publishDriver (not drivers.set) so any secondary window that bound
        // while we were already connected — and is parked on whenDriverReady —
        // attaches the moment this driver exists.
        publishDriver(id, driver);
      } else {
        localDrivers.delete(id);
        unpublishDriver(id);
      }
      return;
    }

    // Secondary: don't create our own driver — that would split the
    // runner event stream into two pumps. Instead, attach our window
    // to the existing driver so we receive its broadcast.
    attachUnsubs.get(id)?.();
    attachUnsubs.delete(id);
    if (session) {
      // Attach now if the driver exists, otherwise register to attach the
      // moment the primary publishes one. (A bare `drivers.get` here missed
      // the case where the supervisor is already `connected` before the
      // primary built its driver — no later pool change re-runs this fn, so
      // the secondary would never attach.) whenDriverReady fires synchronously
      // when the driver already exists, so this covers both timings.
      const cancel = whenDriverReady(id, (driver) => {
        if (window.isDestroyed()) return;
        attachUnsubs.set(id, driver.attachWindow(window));
      });
      // If the waiter hasn't fired yet (driver not ready), the stored cleanup
      // unregisters it; once it fires it overwrites this with the real detach.
      if (!attachUnsubs.has(id)) attachUnsubs.set(id, cancel);
    }
  };

  const onPoolChange = (id: string): void => {
    const sup = pool.get(id);
    if (!sup) return;
    const phase = sup.snapshot().phase;
    if (phase.phase === 'connected') ensureDriverFor(id, sup);
    else {
      // Primary tears down its own driver on disconnect; secondary
      // just drops its attachment.
      if (claimGlobal) {
        const existing = localDrivers.get(id);
        if (existing) {
          existing.dispose();
          localDrivers.delete(id);
          unpublishDriver(id);
        }
      } else {
        attachUnsubs.get(id)?.();
        attachUnsubs.delete(id);
      }
    }
    send('connection.changed', { workspaceId: id, phase });
  };

  pool.on('change', onPoolChange);

  // If the pool is already populated when the window opens, prime
  // each supervisor's connection state into the renderer.
  for (const { id, supervisor } of pool.list()) {
    const phase: ConnectionPhase = supervisor.snapshot().phase;
    if (phase.phase === 'connected') ensureDriverFor(id, supervisor);
    send('connection.changed', { workspaceId: id, phase });
  }

  return () => {
    unbindDesktopEvents();
    pool.off('change', onPoolChange);
    for (const driver of localDrivers.values()) driver.dispose();
    localDrivers.clear();
    // Secondary windows drop their attachments; the primary's driver
    // keeps running for the main window.
    for (const fn of attachUnsubs.values()) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    attachUnsubs.clear();
    if (claimGlobal) drivers.clear();
  };
}
