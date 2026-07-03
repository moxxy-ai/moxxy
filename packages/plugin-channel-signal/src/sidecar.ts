import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { sleepWithAbort } from '@moxxy/sdk';
import { SignalRpcClient, type RpcStream } from './jsonrpc.js';

/**
 * signal-cli sidecar lifecycle — the plugin owns the external `signal-cli`
 * process the way `@moxxy/plugin-browser` owns its Playwright sidecar:
 * spawn on channel `start()`, health-check before use, SIGTERM→SIGKILL grace
 * on stop (via the sdk's `sleepWithAbort`, the runner-supervisor pattern).
 *
 * Transport: `signal-cli -a <account> daemon --socket <path>` — JSON-RPC over
 * a UNIX socket. Chosen over `--tcp`/`--http` because a filesystem socket is
 * never remotely reachable and needs no port/auth story; the socket lives in a
 * fresh per-process temp path so two channels can't collide.
 *
 * signal-cli keeps the actual Signal protocol store (identity keys, sessions,
 * message queue) in ITS OWN data dir — `$XDG_DATA_HOME/signal-cli/`
 * (`~/.local/share/signal-cli/` by default). moxxy never touches those files;
 * attachments land in `<dataDir>/attachments/<id>`.
 */

export interface SidecarLogger {
  info?(msg: string, meta?: Record<string, unknown>): void;
  warn?(msg: string, meta?: Record<string, unknown>): void;
}

/** The slice of `child_process.ChildProcess` the sidecar manager needs. */
export interface SpawnedProcess {
  readonly pid?: number | undefined;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', listener: (code: number | null) => void): unknown;
  once(event: 'error', listener: (err: Error) => void): unknown;
  readonly stderr?: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  readonly stdout?: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
}

export type SpawnFn = (command: string, args: ReadonlyArray<string>) => SpawnedProcess;

export type ConnectFn = (socketPath: string) => Promise<RpcStream>;

const defaultSpawn: SpawnFn = (command, args) =>
  spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });

const defaultConnect: ConnectFn = (socketPath) =>
  new Promise<RpcStream>((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.once('connect', () => resolve(socket));
    socket.once('error', (err) => reject(err));
  });

/** `$XDG_DATA_HOME/signal-cli` (defaults to `~/.local/share/signal-cli`). */
export function signalCliDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env['XDG_DATA_HOME']?.trim();
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'signal-cli');
}

/** Where the daemon writes received attachments (voice notes live here). */
export function signalCliAttachmentsDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(signalCliDataDir(env), 'attachments');
}

/**
 * Cheap PATH probe for the `signal-cli` binary — a directory scan with an
 * exec-bit check, NO process spawn (signal-cli is a JVM app; spawning it takes
 * seconds and `isAvailable` runs on every `moxxy channels list` / `doctor`).
 * Returns the resolved path or null. Never throws: a missing/odd PATH must
 * not crash discovery.
 */
export function findSignalCliOnPath(env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    const raw = env['PATH'] ?? '';
    const names = process.platform === 'win32' ? ['signal-cli.bat', 'signal-cli.cmd', 'signal-cli.exe', 'signal-cli'] : ['signal-cli'];
    for (const dir of raw.split(path.delimiter)) {
      if (!dir) continue;
      for (const name of names) {
        const candidate = path.join(dir, name);
        try {
          fs.accessSync(candidate, fs.constants.X_OK);
          if (fs.statSync(candidate).isFile()) return candidate;
        } catch {
          /* not here — keep scanning */
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** One-line install guidance surfaced when the binary is missing. */
export const SIGNAL_CLI_INSTALL_HINT =
  'signal-cli not found on PATH. Install it: `brew install signal-cli` (macOS), ' +
  'or see https://github.com/AsamK/signal-cli/wiki/Quickstart for Linux/Windows packages.';

export interface SignalSidecarOptions {
  /** E.164 account the daemon serves (`-a <account>`). */
  readonly account: string;
  /** Binary path/name. Default `signal-cli` (resolved by the OS from PATH). */
  readonly binary?: string;
  /** Socket path override (tests). Default: fresh path under the OS tmpdir. */
  readonly socketPath?: string;
  /** How long to wait for the daemon socket + health check. Default 45s —
   *  signal-cli is a JVM app and cold-starts slowly. */
  readonly bootTimeoutMs?: number;
  /** SIGTERM grace before SIGKILL. Default 5s. */
  readonly killGraceMs?: number;
  readonly logger?: SidecarLogger;
  readonly spawnFn?: SpawnFn;
  readonly connectFn?: ConnectFn;
}

/** Poll cadence while waiting for the daemon socket to accept connections. */
const CONNECT_POLL_MS = 250;

export class SignalSidecar {
  private readonly opts: SignalSidecarOptions;
  private child: SpawnedProcess | null = null;
  private exited = false;
  private exitCode: number | null = null;
  private client: SignalRpcClient | null = null;
  private readonly recentStderr: string[] = [];
  private readonly exitListeners = new Set<(code: number | null) => void>();
  readonly socketPath: string;

  constructor(opts: SignalSidecarOptions) {
    this.opts = opts;
    this.socketPath =
      opts.socketPath ?? path.join(os.tmpdir(), `moxxy-signal-${process.pid}-${Date.now().toString(36)}.sock`);
  }

  /** Fires when the daemon exits (clean stop AND crash). */
  onExit(listener: (code: number | null) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  get rpc(): SignalRpcClient | null {
    return this.client;
  }

  /**
   * Spawn the daemon and wait until it is actually serving: the socket accepts
   * a connection AND a `version` JSON-RPC round-trips. Rejects (and reaps the
   * child) when the child dies early or the boot deadline passes, carrying the
   * daemon's stderr tail so the CAUSE ("User +… is not registered") surfaces
   * instead of a bare timeout.
   */
  async start(): Promise<SignalRpcClient> {
    if (this.client) return this.client;
    const binary = this.opts.binary ?? 'signal-cli';
    const spawnFn = this.opts.spawnFn ?? defaultSpawn;
    const connectFn = this.opts.connectFn ?? defaultConnect;
    const bootTimeoutMs = this.opts.bootTimeoutMs ?? 45_000;

    // A stale socket file from a crashed previous run would make the daemon
    // fail to bind; the path is per-process+time so this is belt-and-braces.
    try {
      fs.rmSync(this.socketPath, { force: true });
    } catch {
      /* best-effort */
    }

    const args = ['-a', this.opts.account, 'daemon', '--socket', this.socketPath, '--receive-mode', 'on-start'];
    this.opts.logger?.info?.('signal: spawning signal-cli daemon', {
      binary,
      socket: this.socketPath,
    });
    let child: SpawnedProcess;
    try {
      child = spawnFn(binary, args);
    } catch (err) {
      throw new Error(`failed to spawn ${binary}: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.child = child;
    this.exited = false;
    this.watchStderr(child);
    child.once('error', (err) => {
      // spawn-level failure (ENOENT etc.) — recorded like an exit so the boot
      // loop below stops waiting on a process that never started.
      this.recentStderr.push(`spawn error: ${err.message}`);
      this.markExited(null);
    });
    child.once('exit', (code) => this.markExited(code));

    const deadline = Date.now() + bootTimeoutMs;
    let stream: RpcStream | null = null;
    while (Date.now() < deadline) {
      if (this.exited) {
        throw new Error(this.describeEarlyExit());
      }
      try {
        stream = await connectFn(this.socketPath);
        break;
      } catch {
        await sleepWithAbort(CONNECT_POLL_MS);
      }
    }
    if (!stream) {
      await this.stop();
      throw new Error(
        `signal-cli daemon did not open its socket within ${bootTimeoutMs}ms` + this.stderrTailSuffix(),
      );
    }

    const client = new SignalRpcClient({
      stream,
      ...(this.opts.logger ? { logger: this.opts.logger } : {}),
    });
    // Health check: a cheap RPC proves the JSON-RPC dispatcher is live (the
    // socket can accept before the daemon is ready to serve).
    try {
      await client.request('version', {});
    } catch (err) {
      client.close();
      await this.stop();
      throw new Error(
        `signal-cli daemon failed its health check: ${err instanceof Error ? err.message : String(err)}` +
          this.stderrTailSuffix(),
      );
    }
    this.client = client;
    this.opts.logger?.info?.('signal: daemon healthy', { pid: child.pid ?? null });
    return client;
  }

  /**
   * Graceful shutdown: close the RPC stream, SIGTERM, wait `killGraceMs` for a
   * clean exit (aborting the wait the moment `exit` fires — the sdk's
   * `sleepWithAbort` pattern from the runner supervisor), then SIGKILL a
   * holdout so a wedged JVM can never outlive the channel as an orphan.
   */
  async stop(): Promise<void> {
    const child = this.child;
    this.client?.close();
    this.client = null;
    if (!child || this.exited) {
      this.child = null;
      this.removeSocketFile();
      return;
    }
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    const graceMs = this.opts.killGraceMs ?? 5_000;
    if (!(await this.waitForExit(child, graceMs))) {
      this.opts.logger?.warn?.('signal: daemon ignored SIGTERM; escalating to SIGKILL');
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      await this.waitForExit(child, 2_000);
    }
    this.child = null;
    this.removeSocketFile();
  }

  /** Resolves true when the child exits within `ms`, false on timeout. */
  private waitForExit(child: SpawnedProcess, ms: number): Promise<boolean> {
    if (this.exited) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const ac = new AbortController();
      child.once('exit', () => ac.abort());
      if (this.exited) {
        resolve(true);
        return;
      }
      sleepWithAbort(ms, ac.signal).then(
        () => resolve(false), // timer ran out — still alive
        () => resolve(true), // aborted — the child exited
      );
    });
  }

  private markExited(code: number | null): void {
    if (this.exited) return;
    this.exited = true;
    this.exitCode = code;
    this.client?.close();
    this.client = null;
    for (const listener of this.exitListeners) {
      try {
        listener(code);
      } catch {
        /* listener errors must not break teardown */
      }
    }
  }

  private watchStderr(child: SpawnedProcess): void {
    let buf = '';
    child.stderr?.on('data', (chunk: Buffer | string) => {
      buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) {
          this.recentStderr.push(line);
          if (this.recentStderr.length > 24) this.recentStderr.shift();
        }
      }
      if (buf.length > 64 * 1024) buf = buf.slice(-64 * 1024);
    });
  }

  private describeEarlyExit(): string {
    return (
      `signal-cli daemon exited during startup (code=${this.exitCode ?? 'null'})` + this.stderrTailSuffix()
    );
  }

  private stderrTailSuffix(): string {
    const tail = this.recentStderr.slice(-6).join('\n').trim();
    return tail ? `:\n${tail}` : '';
  }

  private removeSocketFile(): void {
    try {
      fs.rmSync(this.socketPath, { force: true });
    } catch {
      /* best-effort */
    }
  }
}

// ---------------------------------------------------------------------------
// One-shot signal-cli invocations (link flow, account listing)
// ---------------------------------------------------------------------------

export interface LinkProcessHandle {
  /** Resolves with the `sgnl://linkdevice…` URI to render as a QR. */
  readonly uri: Promise<string>;
  /** Resolves when the phone completed the link (process exited 0). Carries the
   *  linked account number when signal-cli printed it. Rejects on failure. */
  readonly completed: Promise<{ account: string | null }>;
  cancel(): void;
}

/** Matches both the current `sgnl://linkdevice?...` URI and the legacy `tsdevice:/?...` form. */
const LINK_URI_RE = /(sgnl:\/\/linkdevice\S+|tsdevice:\/?\?\S+)/;
/** signal-cli prints `Associated with: +49… (device id: N)` on success. */
const ASSOCIATED_RE = /Associated with:\s*(\+\d{7,15})/;

/**
 * Run `signal-cli link -n <deviceName>`: it prints the linking URI, then blocks
 * until the phone scans it (or the QR expires, at which point it exits
 * non-zero). Separate from the daemon — linking happens BEFORE an account
 * exists locally, so the daemon (which requires one) can't do it.
 */
export function startLinkProcess(opts: {
  readonly deviceName: string;
  readonly binary?: string;
  readonly spawnFn?: SpawnFn;
  readonly logger?: SidecarLogger;
}): LinkProcessHandle {
  const spawnFn = opts.spawnFn ?? defaultSpawn;
  const binary = opts.binary ?? 'signal-cli';
  let child: SpawnedProcess;
  let output = '';

  let resolveUri: (uri: string) => void;
  let rejectUri: (err: Error) => void;
  const uri = new Promise<string>((resolve, reject) => {
    resolveUri = resolve;
    rejectUri = reject;
  });
  let resolveCompleted: (r: { account: string | null }) => void;
  let rejectCompleted: (err: Error) => void;
  const completed = new Promise<{ account: string | null }>((resolve, reject) => {
    resolveCompleted = resolve;
    rejectCompleted = reject;
  });
  // The two promises settle independently of consumption order (a caller may
  // only await `uri` and cancel later) — pre-attach no-op catches so an
  // unobserved rejection is never an unhandledRejection.
  uri.catch(() => undefined);
  completed.catch(() => undefined);

  try {
    child = spawnFn(binary, ['link', '-n', opts.deviceName]);
  } catch (err) {
    const e = new Error(`failed to spawn ${binary} link: ${err instanceof Error ? err.message : String(err)}`);
    rejectUri!(e);
    rejectCompleted!(e);
    return { uri, completed, cancel: () => undefined };
  }

  let uriSettled = false;
  const scan = (chunk: Buffer | string): void => {
    output += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (output.length > 256 * 1024) output = output.slice(-256 * 1024);
    if (!uriSettled) {
      const m = LINK_URI_RE.exec(output);
      if (m?.[1]) {
        uriSettled = true;
        resolveUri!(m[1]);
      }
    }
  };
  child.stdout?.on('data', scan);
  child.stderr?.on('data', scan);
  child.once('error', (err) => {
    const e = new Error(`signal-cli link failed to start: ${err.message}`);
    if (!uriSettled) {
      uriSettled = true;
      rejectUri!(e);
    }
    rejectCompleted!(e);
  });
  child.once('exit', (code) => {
    if (code === 0) {
      const account = ASSOCIATED_RE.exec(output)?.[1] ?? null;
      resolveCompleted!({ account });
    } else {
      const tail = output.split('\n').slice(-4).join('\n').trim();
      const e = new Error(
        `signal-cli link exited with code ${code ?? 'null'} (QR expired or linking rejected)` +
          (tail ? `:\n${tail}` : ''),
      );
      if (!uriSettled) {
        uriSettled = true;
        rejectUri!(e);
      }
      rejectCompleted!(e);
    }
  });

  return {
    uri,
    completed,
    cancel: () => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    },
  };
}

/**
 * List the accounts registered in the local signal-cli store (a one-shot
 * `signal-cli --output=json listAccounts` spawn). Used at channel start to
 * decide "linked already?" — NOT in `isAvailable` (JVM spawns are too slow for
 * a discovery probe). Parses JSON output and falls back to scraping `+<digits>`
 * so an older plain-text signal-cli still works.
 */
export async function listSignalAccounts(opts: {
  readonly binary?: string;
  readonly spawnFn?: SpawnFn;
  readonly timeoutMs?: number;
} = {}): Promise<string[]> {
  const spawnFn = opts.spawnFn ?? defaultSpawn;
  const binary = opts.binary ?? 'signal-cli';
  const timeoutMs = opts.timeoutMs ?? 30_000;
  let child: SpawnedProcess;
  try {
    child = spawnFn(binary, ['--output=json', 'listAccounts']);
  } catch (err) {
    throw new Error(`failed to spawn ${binary}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let out = '';
  child.stdout?.on('data', (chunk: Buffer | string) => {
    out += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (out.length > 1024 * 1024) out = out.slice(-1024 * 1024);
  });
  const exited = await new Promise<boolean>((resolve) => {
    const ac = new AbortController();
    child.once('exit', () => ac.abort());
    child.once('error', () => ac.abort());
    sleepWithAbort(timeoutMs, ac.signal).then(
      () => resolve(false),
      () => resolve(true),
    );
  });
  if (!exited) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    throw new Error(`signal-cli listAccounts timed out after ${timeoutMs}ms`);
  }
  const accounts = new Set<string>();
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const collect = (entry: unknown): void => {
        const number = (entry as { number?: unknown })?.number;
        if (typeof number === 'string' && number.startsWith('+')) accounts.add(number);
      };
      if (Array.isArray(parsed)) parsed.forEach(collect);
      else collect(parsed);
    } catch {
      const m = /(\+\d{7,15})/.exec(trimmed);
      if (m?.[1]) accounts.add(m[1]);
    }
  }
  return [...accounts];
}
