/**
 * Wire every IPC handler declared in [`IpcCommands`].
 *
 * Each handler is a thin glue around either the supervisor (for
 * connection/session calls) or onboarding helpers (for setup
 * commands). The renderer's `window.moxxy.invoke('foo', args)` lands
 * here, typed end-to-end through the shared `IpcCommands` map.
 *
 * Event forwarding is handled per-window in [`bindWindow`]: it
 * subscribes to the supervisor's `change` event and (re-)creates a
 * [`SessionDriver`] every time we land in `connected`, so the new
 * session's log gets mirrored to the right renderer.
 */

import { ipcMain, type BrowserWindow } from 'electron';

import type {
  ConnectionSnapshot,
  IpcCommandName,
  IpcCommands,
  IpcEvents,
} from '../shared/ipc';
import type { SessionLike } from '@moxxy/sdk';
import { RunnerSupervisor } from './runner-supervisor';
import { probeOnboarding, saveProviderKey } from './onboarding';
import { installMoxxyCli, probeNode } from './installer';
import { SessionDriver } from './session-driver';
import { DeskStore } from './desks';
import { dialog, shell, BrowserWindow as BrowserWindowApi } from 'electron';

export function registerIpcHandlers(
  supervisor: RunnerSupervisor,
  desks: DeskStore,
): void {
  handle('connection.snapshot', async () => supervisor.snapshot());
  handle('connection.retry', async () => {
    supervisor.forceRetry();
  });

  handle('onboarding.status', () => probeOnboarding());
  handle('onboarding.probeNode', () => probeNode());
  handle('onboarding.installMoxxyCli', async () => {
    const target = BrowserWindowApi.getFocusedWindow() ?? BrowserWindowApi.getAllWindows()[0];
    if (!target) throw new Error('no window to stream install progress to');
    const code = await installMoxxyCli(target);
    // After a successful install, retry the supervisor immediately so
    // the connection screen recovers without the user pressing Retry.
    if (code === 0) supervisor.forceRetry();
    return code;
  });
  handle('onboarding.openExternal', async ({ url }) => {
    await shell.openExternal(url);
  });
  handle('onboarding.saveProviderKey', async ({ provider, secret }) => {
    await saveProviderKey(provider, secret);
    const session = supervisor.remote();
    if (session) {
      session.providers.setActive(provider);
    }
  });

  handle('session.info', async () => {
    const session = supervisor.remote();
    return session ? session.getInfo() : null;
  });
  handle('session.runTurn', async ({ prompt, model }) => {
    const driver = mustHaveDriver();
    return driver.runTurn(prompt, model);
  });
  handle('session.abortTurn', async ({ turnId }) => {
    const driver = mustHaveDriver();
    driver.abortTurn(turnId);
  });
  handle('session.setProvider', async ({ provider }) => {
    const session = mustHaveSession(supervisor);
    session.providers.setActive(provider);
  });
  handle('session.setMode', async ({ mode }) => {
    const session = mustHaveSession(supervisor);
    session.modes.setActive(mode);
  });

  handle('desks.list', async () => {
    const list = await desks.list();
    const active = await desks.getActive();
    return { desks: list, activeId: active?.id ?? null };
  });
  handle('desks.create', async ({ name, cwd }) => desks.create({ name, cwd }));
  handle('desks.remove', async ({ id }) => {
    await desks.remove(id);
    const active = await desks.getActive();
    await supervisor.setCwd(active?.cwd ?? null);
  });
  handle('desks.setActive', async ({ id }) => {
    await desks.setActive(id);
    const active = await desks.getActive();
    await supervisor.setCwd(active?.cwd ?? null);
  });
  handle('desks.pickFolder', async () => {
    const window =
      BrowserWindowApi.getFocusedWindow() ?? BrowserWindowApi.getAllWindows()[0];
    const result = await dialog.showOpenDialog(window ?? null!, {
      title: 'Bind a desk to a folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0]!;
  });

  // Workflows
  handle('workflows.list', async () => {
    const session = sessionLike(supervisor);
    const view = session.workflows;
    if (!view) return [];
    return await view.list();
  });
  handle('workflows.setEnabled', async ({ name, enabled }) => {
    const session = sessionLike(supervisor);
    if (session.workflows) await session.workflows.setEnabled(name, enabled);
  });
  handle('workflows.run', async ({ name }) => {
    const session = sessionLike(supervisor);
    if (!session.workflows) throw new Error('workflows plugin not loaded');
    return await session.workflows.run(name);
  });

  // Settings — providers (read from SessionInfo + ready flag)
  handle('settings.providers', async () => {
    const session = supervisor.remote();
    if (!session) return [];
    const info = session.getInfo();
    const readySet = new Set(info.readyProviders ?? []);
    return info.providers.map((p) => ({
      name: p.name,
      ready: readySet.has(p.name),
    }));
  });

  // MCP admin
  handle('settings.mcpServers', async () => {
    const session = sessionLike(supervisor);
    if (!session.mcpAdmin) return [];
    return await session.mcpAdmin.listServers();
  });
  handle('settings.mcpToggle', async ({ name, enabled }) => {
    const session = sessionLike(supervisor);
    if (!session.mcpAdmin) throw new Error('mcp admin not available');
    if (enabled) await session.mcpAdmin.enableAndAttach(name);
    else await session.mcpAdmin.detach(name);
  });

  // Vault entries (read entry names without decrypting)
  handle('settings.vaultEntries', async () => {
    const { readVaultKeys } = await import('./onboarding');
    const home = (await import('node:os')).homedir();
    const names = await readVaultKeys(home);
    return names.map((name) => ({ name }));
  });

  // Skills
  handle('settings.skills', async () => {
    const { listSkills } = await import('./skills');
    return listSkills();
  });
  handle('settings.readSkill', async ({ name }) => {
    const { readSkill } = await import('./skills');
    return readSkill(name);
  });
  handle('settings.writeSkill', async ({ name, body }) => {
    const { writeSkill } = await import('./skills');
    await writeSkill(name, body);
  });
}

/**
 * Bind a window to the supervisor: forward `connection.changed` to
 * it, create a SessionDriver when we connect, dispose it on
 * disconnect. Returns a cleanup callback for the window-closed hook.
 */
export function bindWindow(
  supervisor: RunnerSupervisor,
  window: BrowserWindow,
): () => void {
  let driver: SessionDriver | null = null;
  driverByWindow.set(window, () => driver);

  const send = <K extends keyof IpcEvents>(channel: K, payload: IpcEvents[K]): void => {
    if (window.isDestroyed()) return;
    window.webContents.send(channel, payload);
  };

  const refreshDriver = (): void => {
    const session = supervisor.remote();
    driver?.dispose();
    driver = session ? new SessionDriver(session, window) : null;
  };

  const onChange = (snapshot: ConnectionSnapshot): void => {
    send('connection.changed', snapshot.phase);
    if (snapshot.phase.phase === 'connected') refreshDriver();
    else if (driver) {
      driver.dispose();
      driver = null;
    }
  };

  supervisor.on('change', onChange);
  // If we're already connected when the window is born, attach now.
  if (supervisor.snapshot().phase.phase === 'connected') refreshDriver();

  return () => {
    supervisor.off('change', onChange);
    driver?.dispose();
    driver = null;
    driverByWindow.delete(window);
  };
}

// ---- internals ----

/**
 * Tracks the active SessionDriver for the currently-focused window.
 * For now we only support one window; future multi-window support
 * will key this by window id and pick based on the IPC sender.
 */
const driverByWindow = new WeakMap<BrowserWindow, () => SessionDriver | null>();

function mustHaveSession(supervisor: RunnerSupervisor) {
  const session = supervisor.remote();
  if (!session) throw new Error('not connected to a runner');
  return session;
}

/**
 * Same as {@link mustHaveSession} but typed as `SessionLike` so we can
 * reach the optional `workflows` / `mcpAdmin` views. The runner exposes
 * these views on the wire even though `RemoteSession`'s class shape
 * doesn't declare them; this assertion narrows the type for callers
 * that handle the `undefined` case explicitly.
 */
function sessionLike(supervisor: RunnerSupervisor): SessionLike {
  return mustHaveSession(supervisor) as unknown as SessionLike;
}

function mustHaveDriver(): SessionDriver {
  // Single-window scoping: grab whichever driver is currently active.
  // (Refined when multi-window lands.)
  for (const accessor of Array.from(activeDriverAccessors())) {
    const driver = accessor();
    if (driver) return driver;
  }
  throw new Error('not connected to a runner');
}

function* activeDriverAccessors(): Generator<() => SessionDriver | null> {
  // WeakMap doesn't support iteration; we expose a sidecar Set that
  // mirrors it. Maintained alongside `driverByWindow`.
  for (const accessor of driverAccessors) yield accessor;
}

const driverAccessors = new Set<() => SessionDriver | null>();

// Hook the WeakMap maintenance into a tiny helper so bindWindow() and
// the unbind callback stay aligned.
const originalSet = driverByWindow.set.bind(driverByWindow);
driverByWindow.set = function patched(window: BrowserWindow, accessor) {
  driverAccessors.add(accessor);
  return originalSet(window, accessor);
};
const originalDelete = driverByWindow.delete.bind(driverByWindow);
driverByWindow.delete = function patched(window: BrowserWindow) {
  for (const accessor of driverAccessors) {
    // Best-effort: remove any accessors whose window is the one
    // being deleted. We can't identify exactly which without an
    // index, so we drop those returning null and let bindWindow
    // re-add fresh ones.
    if (accessor() === null) driverAccessors.delete(accessor);
  }
  return originalDelete(window);
};

/**
 * Strongly-typed `ipcMain.handle` — channel + arg shapes come from
 * `IpcCommands` so a renamed command surfaces as a type error.
 */
function handle<K extends IpcCommandName>(
  channel: K,
  fn: (
    ...args: Parameters<IpcCommands[K]>
  ) => Promise<Awaited<ReturnType<IpcCommands[K]>>>,
): void {
  ipcMain.handle(channel, (_evt, ...args) => {
    return fn(...(args as Parameters<IpcCommands[K]>));
  });
}
