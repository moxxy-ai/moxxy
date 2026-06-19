/**
 * A swappable way to expose a locally-bound surface (the web channel) to the
 * user over the public internet — so an agent on Telegram/TUI can hand the user
 * a URL they can open. One provider is active per session (registered via
 * plugins, like every other block); core seeds a `localhost` no-op provider so
 * `getActive()` is non-null.
 */
import { spawn, type ChildProcess } from 'node:child_process';

export interface TunnelOpenOptions {
  readonly port: number;
  readonly host: string;
}

export interface TunnelHandle {
  /** The publicly reachable base URL (e.g. https://abc.trycloudflare.com). */
  readonly url: string;
  /** Tear the tunnel down (kill the subprocess, close the connection). */
  close(): Promise<void>;
}

export interface TunnelProviderDef {
  readonly name: string;
  /** Open a tunnel to `http://host:port`, resolving once the public URL is known. */
  open(opts: TunnelOpenOptions): Promise<TunnelHandle>;
  /** Optional readiness gate (e.g. the `cloudflared` binary is installed). */
  isAvailable?(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Shared CLI-tunnel subprocess management
//
// cloudflared/ngrok (channel-web) and the webhooks tunnel all do the same
// thing: spawn a CLI, watch its stdout/stderr for the assigned public URL,
// resolve once it's seen (or reject on timeout/exit/error), and guarantee the
// child is killed on close *and* on process exit (Node does not reap children).
// `spawnCliTunnel` is the single implementation they all share.
// ---------------------------------------------------------------------------

/**
 * Guarantees spawned tunnel children (cloudflared/ngrok/…) never orphan or
 * leak. Node does NOT kill child processes when the parent exits, so we track
 * every live child and kill any survivors on process teardown — in addition to
 * the explicit `close()` path. Each tracked child is also force-killed
 * (SIGKILL) if it ignores SIGTERM, so a wedged tunnel can't drain
 * memory/handles.
 */
const liveChildren = new Set<ChildProcess>();
let exitHookInstalled = false;

function killChild(child: ChildProcess): void {
  if (child.exitCode != null || child.signalCode != null) return;
  try {
    child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
  // Escalate if it doesn't exit promptly. unref so this timer never holds the
  // event loop open on its own.
  const t = setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      /* gone */
    }
  }, 2000);
  t.unref?.();
  child.once('exit', () => clearTimeout(t));
}

function ensureExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const killAll = (): void => {
    for (const child of liveChildren) {
      try {
        child.kill('SIGKILL'); // process is exiting; be decisive, no async escalation
      } catch {
        /* gone */
      }
    }
    liveChildren.clear();
  };
  process.once('exit', killAll);
  // Registering a SIGINT/SIGTERM listener suppresses Node's default
  // terminate-on-signal behavior, so an entrypoint that spawns a tunnel but
  // installs no exit handler of its own would swallow the first Ctrl-C and hang
  // with the process still alive. Re-raise the signal after cleanup so the
  // default termination still fires. `process.once` removes the listener before
  // it runs, so re-raising hits Node's default disposition (terminate).
  const onSignal = (sig: 'SIGINT' | 'SIGTERM') => (): void => {
    killAll();
    process.kill(process.pid, sig);
  };
  process.once('SIGINT', onSignal('SIGINT'));
  process.once('SIGTERM', onSignal('SIGTERM'));
}

/** Track a spawned child; returns an `untrack()` that also kills it cleanly. */
function trackChild(child: ChildProcess): () => Promise<void> {
  ensureExitHook();
  liveChildren.add(child);
  child.once('exit', () => liveChildren.delete(child));
  return () =>
    new Promise<void>((resolve) => {
      liveChildren.delete(child);
      if (child.exitCode != null || child.signalCode != null) return resolve();
      child.once('exit', () => resolve());
      killChild(child);
    });
}

export interface SpawnCliTunnelOptions {
  /** Executable to spawn (e.g. `cloudflared`, `ngrok`). */
  readonly cmd: string;
  /** Arguments passed to the executable. */
  readonly args: ReadonlyArray<string>;
  /** Matches the assigned public URL in a chunk of the CLI's stdout/stderr. */
  readonly urlRegex: RegExp;
  /** How long to wait for the URL before giving up. Default 30s. */
  readonly timeoutMs?: number;
  /** Human-readable name used in error messages. Defaults to `cmd`. */
  readonly name?: string;
}

/** A spawned CLI tunnel: the public-URL handle plus the child's pid. */
export interface CliTunnelHandle extends TunnelHandle {
  /** Spawned process id (-1 if the platform didn't assign one). */
  readonly pid: number;
}

const DEFAULT_TUNNEL_URL_TIMEOUT_MS = 30_000;

/**
 * Spawn a CLI tunnel, parse the assigned public URL out of its output, and
 * resolve a {@link CliTunnelHandle}. The child is tracked so it is killed on
 * `close()`, on tunnel-switch, and on process exit (no orphans). Rejects on
 * timeout, spawn error, or premature exit (the child is killed in every reject
 * path). This is the single spawn-and-parse implementation behind the
 * cloudflared/ngrok tunnel providers and the webhooks tunnel.
 */
export function spawnCliTunnel(opts: SpawnCliTunnelOptions): Promise<CliTunnelHandle> {
  const { cmd, args, urlRegex } = opts;
  const name = opts.name ?? cmd;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TUNNEL_URL_TIMEOUT_MS;

  return new Promise<CliTunnelHandle>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(cmd, args as string[], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(
        new Error(
          `failed to spawn ${name} — is it installed? (${err instanceof Error ? err.message : String(err)})`,
        ),
      );
      return;
    }

    const untrack = trackChild(child);
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void untrack();
      reject(new Error(`${name}: timed out after ${timeoutMs}ms waiting for the tunnel URL`));
    }, timeoutMs);
    timer.unref?.();

    // 'data' events are not line-buffered: the assigned URL can straddle two
    // chunk boundaries (large URL, fragmented flush). Match against a rolling
    // accumulation rather than each lone chunk, capped so a chatty tunnel that
    // never prints a URL can't grow this unboundedly while we wait.
    const MAX_BUF = 8192;
    let acc = '';
    const onData = (buf: Buffer): void => {
      if (settled) return; // drain quietly once resolved so the pipe never fills
      acc += buf.toString('utf8');
      if (acc.length > MAX_BUF) acc = acc.slice(acc.length - MAX_BUF);
      const url = urlRegex.exec(acc)?.[0] ?? null;
      if (!url) return;
      settled = true;
      acc = '';
      clearTimeout(timer);
      resolve({ url, pid: child.pid ?? -1, close: untrack });
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void untrack();
      reject(err);
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`${name} exited (code ${code ?? 'null'}) before emitting a URL`));
    });
  });
}

/**
 * Probe whether a tunnel CLI is installed and runnable (`<cmd> --version`
 * exits 0). Used as the `isAvailable()` gate by CLI-backed tunnel providers.
 */
export function isCliTunnelAvailable(cmd: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = spawn(cmd, ['--version'], { stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });
}
