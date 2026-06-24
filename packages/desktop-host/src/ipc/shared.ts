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

import type {
  IpcCommandName,
  IpcCommands,
} from '@moxxy/desktop-ipc-contract';
import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import { IpcError } from '@moxxy/desktop-ipc-contract/dispatch';
import type { SessionLike } from '@moxxy/sdk';

// Re-exported so the many `import { IpcError } from './shared'` sites (and the
// guards below) keep working after the class moved into the contract's shared
// dispatch core. One class, referenced by both the host guards and `dispatch`.
export { IpcError };

import type { RunnerSupervisor } from '../runner-supervisor';
import type { RunnerPool } from '../runner-pool';
import type { SessionDriver } from '../session-driver';
import type { DeskStore } from '../desks';
import { buildInProcessPlugins, type InProcessPlugins } from '../in-process-plugins';

/**
 * A `targetSessionId → display name` lookup, for stamping `targetSessionName`
 * onto the automation summaries (webhooks / schedules / workflows). Returns
 * null for an unknown id — e.g. a trigger bound to a since-deleted session.
 */
export type SessionNameResolver = (id: string | null | undefined) => string | null;

/**
 * Build a {@link SessionNameResolver} from the desk registry with a single
 * `desks.list()` read (so a list handler resolves N triggers without N disk
 * reads). Returns an all-null resolver when no registry is wired (the
 * injected-store test variants pass none).
 */
export async function buildSessionNameResolver(desks?: DeskStore): Promise<SessionNameResolver> {
  const names = new Map<string, string>();
  if (desks) {
    for (const desk of await desks.list()) {
      for (const session of desk.sessions) names.set(session.id, session.name);
    }
  }
  return (id) => (id ? (names.get(id) ?? null) : null);
}

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
 * The bus the per-domain registrars currently register against. Set by
 * {@link registerIpcHandlers} immediately before each registration sweep, so
 * the SAME registrar bodies (which call {@link handle}) register their handlers
 * onto every transport in turn — Electron, then the WebSocket bridge — without
 * any registrar knowing which transport it's wiring.
 *
 * Mutation is safe because registration is a single synchronous sweep per bus;
 * `activeBus` is only read while a registrar runs, never across an await.
 */
let activeBus: CommandBus | null = null;

/** Point {@link handle} at `bus` for the next registration sweep. */
export function setActiveBus(bus: CommandBus): void {
  activeBus = bus;
}

/**
 * Register a command handler against the {@link activeBus}. Channel + arg shapes
 * come from `IpcCommands` so a renamed command surfaces as a type error. The
 * payload validation + uniform error classification that used to live here now
 * live in the transport-neutral `dispatch` core that each bus calls — so this
 * is a thin, transport-agnostic forwarder and the registrars are unchanged.
 */
export function handle<K extends IpcCommandName>(
  channel: K,
  fn: (
    ...args: Parameters<IpcCommands[K]>
  ) => Promise<Awaited<ReturnType<IpcCommands[K]>>>,
): void {
  if (!activeBus) {
    throw new Error('no active CommandBus — setActiveBus() must run before registering handlers');
  }
  activeBus.handle(channel, fn);
}

export function resolveSupervisor(
  pool: RunnerPool,
  workspaceId?: string,
): RunnerSupervisor | null {
  const id = workspaceId ?? pool.activeWorkspaceId();
  return id ? pool.get(id) : null;
}

/**
 * Resolve the {@link SessionDriver} for a workspace, defaulting to the pool's
 * active workspace when no id is given — the same "default to active" rule
 * {@link resolveSupervisor} owns, kept in one place so a future change to how
 * "active" is chosen doesn't silently skip the driver-targeting handlers.
 * Returns `undefined` (no throw) when there is no active workspace or no driver
 * yet; callers that require one use {@link mustDriver} on the resolved id.
 */
export function resolveDriver(pool: RunnerPool, workspaceId?: string): SessionDriver | undefined {
  const id = workspaceId ?? pool.activeWorkspaceId();
  return id ? drivers.get(id) : undefined;
}

type RemoteSessionT = NonNullable<ReturnType<RunnerSupervisor['remote']>>;

const REMOTE_SESSION_WAIT_MS = 5_000;
const REMOTE_SESSION_POLL_MS = 40;

/**
 * Wait briefly for a supervisor's RemoteSession to appear. This covers the
 * cold-start race where the renderer optimistically switches active session
 * before the `sessions.setActive` IPC call has created and attached the
 * runner. Returning null immediately makes every `session.info` consumer cache
 * a false "not ready" state until a manual remount; waiting here centralizes
 * the readiness boundary for all clients.
 */
export async function waitForRemoteSession(
  pool: RunnerPool,
  workspaceId?: string,
  timeoutMs = REMOTE_SESSION_WAIT_MS,
): Promise<RemoteSessionT | null> {
  const id = workspaceId ?? pool.activeWorkspaceId();
  if (!id) return null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const session = pool.get(id)?.remote() ?? null;
    if (session) return session;
    await waitForPoolChange(pool, id, Math.min(REMOTE_SESSION_POLL_MS, Math.max(0, deadline - Date.now())));
  }
  return pool.get(id)?.remote() ?? null;
}

export function mustSession(pool: RunnerPool, workspaceId?: string): SessionLike {
  // RemoteSession implements ClientSession (which extends SessionLike), so it is
  // a SessionLike directly — no cast needed.
  return mustRemote(pool, workspaceId);
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

function waitForPoolChange(pool: RunnerPool, id: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pool.off('change', onChange);
      resolve();
    };
    const onChange = (changedId: string): void => {
      if (changedId === id) cleanup();
    };
    const timer = setTimeout(cleanup, timeoutMs);
    pool.on('change', onChange);
  });
}

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
