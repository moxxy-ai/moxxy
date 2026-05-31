/**
 * Shared plumbing for the per-domain IPC handler modules.
 *
 * The {@link handle} wrapper is the SINGLE choke point through which
 * every renderer→main command flows: it runtime-validates the payload
 * (via `validateIpcInput`) before any handler touches the filesystem /
 * a child process / the vault. Every domain module registers through
 * it so a new command can't skip the boundary check.
 *
 * The rest of the exports are the small set of lookups the domain
 * handlers share:
 *
 *   - {@link drivers} — the per-workspace {@link SessionDriver} registry
 *     shared between the session handlers (runTurn / abortTurn) and
 *     `bindWindow`, which owns the drivers' lifecycle.
 *   - {@link resolveSupervisor} / {@link mustRemote} / {@link mustSession} —
 *     workspace → supervisor → RemoteSession resolution, with the
 *     "not connected to a runner" guards the session/settings handlers
 *     rely on.
 *   - {@link waitForSessionState} — the post-RPC settle poll that keeps
 *     the renderer's provider/mode pickers from snapping back.
 *   - {@link getInProcessPlugins} — the lazily-built bag of in-process
 *     plugins (vault + Codex transcriber) re-used across IPC calls.
 */

import { ipcMain } from 'electron';

import type {
  IpcCommandName,
  IpcCommands,
  MoxxyIpcErrorCode,
} from '@moxxy/desktop-ipc-contract';
import { encodeIpcError } from '@moxxy/desktop-ipc-contract';
import { validateIpcInput } from '@moxxy/desktop-ipc-contract/validation';
import type { SessionLike } from '@moxxy/sdk';

import type { RunnerSupervisor } from '../runner-supervisor';
import type { RunnerPool } from '../runner-pool';
import type { SessionDriver } from '../session-driver';
import { buildInProcessPlugins, type InProcessPlugins } from '../in-process-plugins';

/** Driver lookup shared across the IPC handlers + bindWindow. Keyed by
 *  workspace id so runTurn / abortTurn target the right runner. The primary
 *  window publishes/unpublishes through {@link publishDriver} /
 *  {@link unpublishDriver} so deferred secondary attaches can be drained. */
export const drivers = new Map<string, SessionDriver>();

type DriverWaiter = (driver: SessionDriver) => void;
/** Secondary windows (focus widget) that asked to attach to a workspace's
 *  driver before it existed. Drained when the primary publishes one. Without
 *  this, a secondary that binds while the supervisor is ALREADY `connected`
 *  (so no further pool change fires) would never attach. */
const driverWaiters = new Map<string, Set<DriverWaiter>>();

/**
 * Register interest in the driver for `id`. If one already exists, `cb` fires
 * immediately; otherwise it fires once when {@link publishDriver} publishes it.
 * Returns an unregister fn (a no-op once `cb` has fired).
 */
export function whenDriverReady(id: string, cb: DriverWaiter): () => void {
  const existing = drivers.get(id);
  if (existing) {
    cb(existing);
    return () => {};
  }
  let set = driverWaiters.get(id);
  if (!set) {
    set = new Set();
    driverWaiters.set(id, set);
  }
  set.add(cb);
  return () => {
    const s = driverWaiters.get(id);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) driverWaiters.delete(id);
  };
}

/** Publish a freshly-created driver and drain any pending secondary waiters. */
export function publishDriver(id: string, driver: SessionDriver): void {
  drivers.set(id, driver);
  const set = driverWaiters.get(id);
  if (!set) return;
  driverWaiters.delete(id);
  for (const cb of set) {
    try {
      cb(driver);
    } catch {
      /* a waiter throwing must not block the others */
    }
  }
}

/** Drop a driver on disconnect/dispose. Pending waiters stay registered so
 *  they attach to the next driver published for this workspace. */
export function unpublishDriver(id: string): void {
  drivers.delete(id);
}

/**
 * A handler error carrying a stable {@link MoxxyIpcErrorCode}. The shared
 * guards (`mustRemote` etc.) throw these so the renderer can branch on a code
 * rather than string-matching messages. Anything else a handler throws is
 * classified `runner-error` at the choke point.
 */
export class IpcError extends Error {
  constructor(
    readonly code: MoxxyIpcErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'IpcError';
  }
}

/**
 * Strongly-typed `ipcMain.handle` — channel + arg shapes come from
 * `IpcCommands` so a renamed command surfaces as a type error. This is also
 * the single place that (1) runtime-validates the payload and (2) wraps every
 * failure in the uniform {@link encodeIpcError} envelope, so the renderer sees
 * one error shape with a stable code for every command.
 */
export function handle<K extends IpcCommandName>(
  channel: K,
  fn: (
    ...args: Parameters<IpcCommands[K]>
  ) => Promise<Awaited<ReturnType<IpcCommands[K]>>>,
): void {
  ipcMain.handle(channel, async (_evt, ...args) => {
    // Runtime-validate the payload at the boundary before any handler
    // touches the filesystem / a child process / the vault. Schemas
    // exist only for the security-sensitive commands; the rest pass
    // through (validateIpcInput is a no-op without a schema).
    try {
      validateIpcInput(channel, args[0]);
    } catch (e) {
      throw new Error(
        encodeIpcError({ code: 'invalid-payload', message: messageOf(e) }),
      );
    }
    try {
      return await fn(...(args as Parameters<IpcCommands[K]>));
    } catch (e) {
      const code: MoxxyIpcErrorCode = e instanceof IpcError ? e.code : 'runner-error';
      throw new Error(encodeIpcError({ code, message: messageOf(e) }));
    }
  });
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function resolveSupervisor(
  pool: RunnerPool,
  workspaceId?: string,
): RunnerSupervisor | null {
  const id = workspaceId ?? pool.activeWorkspaceId();
  return id ? pool.get(id) : null;
}

export function mustSession(pool: RunnerPool, workspaceId?: string): SessionLike {
  return mustRemote(pool, workspaceId) as unknown as SessionLike;
}

export function mustRemote(
  pool: RunnerPool,
  workspaceId?: string,
): NonNullable<ReturnType<RunnerSupervisor['remote']>> {
  const sup = resolveSupervisor(pool, workspaceId);
  const session = sup?.remote();
  if (!session) throw new IpcError('not-connected', 'not connected to a runner');
  return session;
}

type RemoteSessionT = NonNullable<ReturnType<RunnerSupervisor['remote']>>;

/**
 * Resolve the workspace context a per-workspace command operates on, in one
 * call: the effective workspace id (explicit arg or the pool's active one),
 * its supervisor, and — by default — its connected RemoteSession. Replaces the
 * `args?.workspaceId ?? pool.activeWorkspaceId()` + `mustRemote`/`mustDriver`
 * boilerplate repeated across the session/settings/workflows handlers, and
 * throws the typed {@link IpcError}s the choke point turns into a coded
 * envelope.
 *
 * Pass `{ requireSession: false }` for commands dispatched through the driver
 * (not the session) that only need the id + supervisor — they get
 * `session: null` instead of a throw when not yet connected.
 */
export function resolveCtx(
  pool: RunnerPool,
  args?: { workspaceId?: string },
): { workspaceId: string; supervisor: RunnerSupervisor; session: RemoteSessionT };
export function resolveCtx(
  pool: RunnerPool,
  args: { workspaceId?: string } | undefined,
  opts: { readonly requireSession: false },
): { workspaceId: string; supervisor: RunnerSupervisor; session: RemoteSessionT | null };
export function resolveCtx(
  pool: RunnerPool,
  args?: { workspaceId?: string },
  opts: { readonly requireSession?: boolean } = {},
): { workspaceId: string; supervisor: RunnerSupervisor; session: RemoteSessionT | null } {
  const workspaceId = args?.workspaceId ?? pool.activeWorkspaceId();
  if (!workspaceId) throw new IpcError('no-workspace', 'no active workspace');
  const supervisor = pool.get(workspaceId);
  if (!supervisor) throw new IpcError('not-connected', 'not connected to a runner');
  const session = supervisor.remote();
  if (!session && opts.requireSession !== false) {
    throw new IpcError('not-connected', 'not connected to a runner');
  }
  return { workspaceId, supervisor, session };
}

/**
 * Poll `session.getInfo()` until `predicate` holds or `timeoutMs`
 * elapses. setProvider / setMode on RemoteSession fire-and-forget the
 * RPC; without this wait, the IPC returns before the runner's
 * InfoChanged notification has updated RemoteSession's local cache,
 * and the renderer's follow-up `session.info` fetch reads the
 * pre-change state — making the picker visibly snap back to the old
 * value until the user clicks a second time. Cheap polling here is
 * the right trade-off vs. surgery on the runner client view.
 */
export async function waitForSessionState(
  session: NonNullable<ReturnType<RunnerSupervisor['remote']>>,
  predicate: (info: ReturnType<typeof session.getInfo>) => boolean,
  timeoutMs = 1500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (predicate(session.getInfo())) return;
    } catch {
      /* getInfo throws before attach — bail */
      return;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
}

export function mustDriver(workspaceId: string): SessionDriver {
  const driver = drivers.get(workspaceId);
  if (!driver) {
    throw new IpcError('not-connected', `no active session for workspace ${workspaceId}`);
  }
  return driver;
}

/**
 * Lazily-built bag of in-process plugins (Codex transcriber today,
 * extensible to more). Built on first access so the cost of the
 * keychain / vault probe is paid only when the user actually exercises
 * one of these capabilities. Re-used across IPC calls so the
 * underlying VaultStore caches its master key.
 */
let pluginsCache: InProcessPlugins | null = null;
export function getInProcessPlugins(): InProcessPlugins {
  if (!pluginsCache) pluginsCache = buildInProcessPlugins();
  return pluginsCache;
}
