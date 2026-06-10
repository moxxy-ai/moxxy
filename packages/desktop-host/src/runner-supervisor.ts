/**
 * Owns the lifecycle of the connection to a moxxy runner.
 *
 *   1. Resolve the moxxy CLI. If absent → `cli-missing` phase with a
 *      clear hint; never silently waits forever.
 *   2. Probe the canonical runner socket. If a `moxxy serve` is
 *      already alive (e.g. user has `moxxy tui` open), adopt it.
 *      Otherwise spawn one ourselves and supervise it.
 *   3. Connect a {@link RemoteSession} client via `@moxxy/runner`
 *      and surface it. No custom JSON-RPC plumbing — the moxxy
 *      runner package owns the wire format.
 *   4. Self-heal: if the connection drops or the spawned child dies,
 *      we transition to `reconnecting` and loop back to resolution.
 *
 * Every state transition emits a `change` event so the IPC layer can
 * forward it to the renderer without polling. A `snapshot()` accessor
 * still exists for late mounts.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Socket } from 'node:net';

import { deleteSession } from '@moxxy/core';
import {
  connectRemoteSession,
  isNamedPipe,
  isProtocolMismatchError,
  platformSocket,
  RUNNER_PROTOCOL_VERSION,
  type RemoteSession,
} from '@moxxy/runner';

import type {
  ConnectionPhase,
  ConnectionSnapshot,
} from '@moxxy/desktop-ipc-contract';
import { augmentedPaths, resolveMoxxyCli, spawnCli, type CliInvocation } from './cli-resolver';
import { redactSecrets } from './security';

const PROBE_TIMEOUT_MS = 250;
const SOCKET_WAIT_MS = 20_000;
const SOCKET_POLL_MS = 200;
const RECONNECT_BACKOFF_MS = 2_000;
const LOG_RING_SIZE = 200;

export class RunnerSupervisor extends EventEmitter {
  private currentPhase: ConnectionPhase = { phase: 'idle' };
  private cliPath: string | null = null;
  private attempts = 0;
  private logRing: Array<{ stream: 'stdout' | 'stderr'; line: string }> = [];
  private session: RemoteSession | null = null;
  private child: ChildProcess | null = null;
  private retryNotify: () => void = () => {};
  private stopped = false;
  /**
   * How many times we've hard-killed a "stale" runner on a protocol mismatch
   * and respawned. A respawn from our PINNED bundled CLI yields the SAME
   * version, so a mismatch that survives one recovery is unrecoverable here —
   * we then surface the terminal `protocol-incompatible` phase rather than
   * loop "Reconnecting…" forever (the desktop hot-update skew bug). Reset on
   * any successful connect.
   */
  private mismatchRecoveries = 0;
  /**
   * Currently active desk's cwd. The supervisor passes this as the
   * spawned moxxy serve's cwd so moxxy's config loader picks up the
   * desk's project-local `moxxy.config.yaml` + scopes its session
   * log there. Switching desks calls [`setCwd`] which restarts.
   */
  private cwd: string | null = null;

  constructor(
    // The pool passes socketFor() explicitly; this default keeps a bare
    // supervisor correct too. platformSocket() gives a named pipe on Windows
    // (a raw .sock can't bind there, so `moxxy serve` would exit → "lost the
    // runner").
    private readonly socketPath: string = process.env.MOXXY_RUNNER_SOCKET ??
      platformSocket('serve', path.join(homedir(), '.moxxy', 'serve.sock')),
    /**
     * Sticky session id for the spawned runner (resume-if-present). The pool
     * passes the workspace's desk id so the runner resumes that workspace's
     * conversation + model context across app restarts. Forwarded to `serve`
     * as `MOXXY_SESSION_ID`. Undefined → the runner mints a fresh id (the old
     * behavior, and what a bare supervisor uses).
     */
    private readonly sessionId?: string,
  ) {
    super();
  }

  /**
   * Tell the supervisor which directory the runner should treat as
   * its cwd. If we're already attached, tear down and reconnect so
   * the new desk's config + session files take effect.
   */
  async setCwd(cwd: string | null): Promise<void> {
    if (this.cwd === cwd) return;
    this.cwd = cwd;
    if (this.session) {
      // Close the session — the run loop will then attempt to spawn
      // a fresh runner in the new directory.
      const session = this.session;
      this.session = null;
      try {
        await session.close();
      } catch {
        /* ignore */
      }
      if (this.child) {
        // Graceful SIGTERM→SIGKILL: a bare kill() returns before the child has
        // released its socket, so the run loop's immediate respawn would race
        // it and hit EADDRINUSE. terminateChild waits for the child to go.
        await terminateChild(this.child);
        this.child = null;
      }
      this.forceRetry();
    }
  }

  /**
   * Start a fresh conversation for this workspace (the `/new` command). With
   * sticky sessions the runner resumes `~/.moxxy/sessions/<sessionId>.jsonl`
   * every launch, so "new" must (1) tear the runner down, (2) delete that
   * persisted log, and (3) respawn — the run loop comes back up and
   * sticky-resume finds no file, yielding an empty session under the same id.
   * Wiping the file (not just the in-memory log) is what makes the reset
   * durable across the next app restart. The renderer clears its own transcript
   * separately.
   */
  async resetSession(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (session) {
      try {
        await session.close();
      } catch {
        /* ignore */
      }
    }
    if (this.child) {
      // Wait for the child to release its socket before deleting + respawning,
      // mirroring setCwd — a bare kill races the respawn into EADDRINUSE.
      await terminateChild(this.child);
      this.child = null;
    }
    if (this.sessionId) {
      try {
        await deleteSession(this.sessionId);
      } catch {
        // Best-effort: a missing file just means there was nothing to clear.
      }
    }
    this.forceRetry();
  }

  /** The directory the runner treats as its cwd (null when unbound). Used to
   *  authorize attachment paths against the workspace root. */
  getCwd(): string | null {
    return this.cwd;
  }

  snapshot(): ConnectionSnapshot {
    return {
      phase: this.currentPhase,
      cliPath: this.cliPath,
      attempts: this.attempts,
      log: this.logRing.slice(),
    };
  }

  /** The connected `RemoteSession`, or null. Used by IPC handlers to
   *  forward turns / setProvider / setMode calls. */
  remote(): RemoteSession | null {
    return this.session;
  }

  /**
   * Re-read the runner's session info and re-emit the `connected` phase, so
   * the renderer sees state that changed mid-session — notably `activeProvider`
   * after a `setProvider` (the runner boots with no provider during onboarding;
   * without this re-emit the app's `connectedWithoutProvider` gate never clears
   * and onboarding loops). No-op unless currently connected.
   */
  refreshConnectedInfo(): void {
    if (!this.session || this.currentPhase.phase !== 'connected') return;
    try {
      const info = this.session.getInfo();
      this.setPhase({
        phase: 'connected',
        socket: this.socketPath,
        sessionId: String(info.sessionId ?? '(unknown)'),
        activeProvider: info.activeProvider ?? null,
        activeMode: info.activeMode ?? null,
      });
    } catch {
      /* session torn down mid-refresh — the run loop re-derives the phase */
    }
  }

  /** Kick the loop out of a backoff wait so the user's Retry button
   *  is responsive. No-op when already trying. */
  forceRetry(): void {
    this.retryNotify();
  }

  /** Tear down the current runner (if any) and loop back to re-resolve
   *  the CLI + respawn — used after the CLI is updated so the new
   *  binary is picked up immediately, without a relaunch. */
  async restart(): Promise<void> {
    if (this.session) {
      const s = this.session;
      this.session = null;
      try {
        await s.close();
      } catch {
        /* ignore */
      }
    }
    if (this.child) {
      // Same graceful SIGTERM→SIGKILL wait as setCwd/resetSession/stop: a bare
      // kill() returns before the child has released its socket, so the run
      // loop's immediate respawn would race the dying process and hit
      // EADDRINUSE — the exact race every other teardown path guards against.
      await terminateChild(this.child);
      this.child = null;
    }
    this.forceRetry();
  }

  /** Run the supervision loop. Returns immediately; the loop runs
   *  in the background for the lifetime of the process. */
  async run(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.attempt();
      } catch (err) {
        // attempt() sets the phase itself for known TERMINAL failures
        // (cli-missing, protocol-incompatible) and the recoverable mismatch
        // path. This catch is the safety net for unexpected throws.
        if (!isTerminalPhase(this.currentPhase.phase)) {
          const msg = err instanceof Error ? err.message : String(err);
          this.attempts += 1;
          this.setPhase({
            phase: 'reconnecting',
            reason: msg,
            attempt: this.attempts,
          });
        }
      }
      // A terminal phase means there is nothing a retry can fix — stop the loop
      // instead of spinning forever (the desktop hot-update reconnect loop).
      if (isTerminalPhase(this.currentPhase.phase)) break;
      await this.waitForRetry();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.retryNotify();
    if (this.session) {
      try {
        await this.session.close();
      } catch {
        /* ignore */
      }
      this.session = null;
    }
    if (this.child) {
      await terminateChild(this.child);
      this.child = null;
    }
  }

  // ------- internals -------

  private async attempt(): Promise<void> {
    this.setPhase({ phase: 'resolving-cli' });
    const cli = resolveMoxxyCli({ extraPaths: augmentedPaths() });
    if (!cli) {
      this.cliPath = null;
      this.setPhase({
        phase: 'cli-missing',
        hint:
          'moxxy CLI not found on PATH. Run `npm install -g @moxxy/cli` or set MOXXY_CLI_ENTRY.',
      });
      throw new Error('cli missing');
    }
    this.cliPath = displayPath(cli);

    // If a workspace is bound, we MUST own the runner so its cwd is
    // the workspace directory — adopting whatever serve is already on
    // the socket would inherit the wrong cwd and silently leak file
    // writes outside the workspace.
    const adopt = this.cwd === null ? await this.probeSocket() : false;

    if (!adopt) {
      // Kill the foreign serve if one is on the socket so we can take
      // over. Without this the bind below would race with the
      // existing listener.
      if (this.cwd !== null && (await this.probeSocket())) {
        this.pushLog(
          'stderr',
          'workspace bound — refusing to adopt foreign serve; replacing it',
        );
      }
      this.ensureSocketDir();
      this.cleanupStaleSocket();
      const child = this.spawnServe(cli);
      this.child = child;
      const pid = child.pid;
      this.setPhase({
        phase: 'spawning',
        cliPath: this.cliPath,
        socket: this.socketPath,
        ...(typeof pid === 'number' ? { pid } : {}),
      });
      child.on('exit', (code, signal) => {
        this.pushLog('stderr', `child exited code=${code} signal=${signal}`);
      });
    } else {
      this.setPhase({
        phase: 'adopting',
        socket: this.socketPath,
      });
    }

    // Pass the spawned child (null when adopting) so a serve that dies
    // before binding fails fast instead of waiting out the 20 s poll.
    await this.waitForSocket(this.child);

    this.setPhase({
      phase: 'attaching',
      socket: this.socketPath,
    });
    let session: RemoteSession;
    try {
      session = await connectRemoteSession({
        role: 'desktop',
        socketPath: this.socketPath,
        // Skip the full-history replay (protocol v6): the renderer's
        // transcript comes from the NDJSON chat log (chat.loadSegment), never
        // from this mirror, so replaying thousands of events (mostly
        // assistant_chunk) on every app start / desk switch / reconnect only
        // delayed the composer-ready gate. Live events still stream in. An
        // older bundled CLI ignores the option and replays in full — correct,
        // just slower.
        replay: 'none',
      });
    } catch (err) {
      // Only a GENUINELY-INCOMPATIBLE client (below the server's compatibility
      // floor) throws a protocol mismatch now — additive skew is tolerated by
      // the server and attaches cleanly. The classic recoverable case is an
      // older `moxxy serve` daemon left bound to the socket: kill it, sweep the
      // socket, respawn our own bundled serve. But our bundled CLI is PINNED,
      // so if a SECOND attach still mismatches, respawning can't help — surface
      // a terminal error instead of looping "Reconnecting…" forever (the
      // hot-update skew bug: a JS bundle whose client outran the CLI's runner).
      if (isProtocolMismatchError(err)) {
        const msg = err instanceof Error ? err.message : String(err);
        if (this.mismatchRecoveries >= 1) {
          this.setPhase(protocolIncompatiblePhase(msg));
          // Returning (not throwing) leaves the phase terminal; the run loop
          // sees it and stops retrying.
          return;
        }
        this.mismatchRecoveries += 1;
        this.pushLog(
          'stderr',
          `protocol mismatch on attach (${msg}); killing stale runner and respawning (recovery ${this.mismatchRecoveries})`,
        );
        await this.killForeignRunner();
        throw new Error(`stale runner replaced (${msg})`);
      }
      throw err;
    }
    this.session = session;
    // A clean attach clears the recovery counter so a later, unrelated stale
    // daemon still gets its one recovery attempt.
    this.mismatchRecoveries = 0;

    const info = session.getInfo();
    this.setPhase({
      phase: 'connected',
      socket: this.socketPath,
      sessionId: String(info.sessionId ?? '(unknown)'),
      activeProvider: info.activeProvider ?? null,
      activeMode: info.activeMode ?? null,
    });

    // Block here until the session drops. `onClose` fires exactly once
    // (per RemoteSession's docs) when the runner link tears down.
    await new Promise<void>((resolve) => {
      session.onClose(() => resolve());
    });

    this.attempts += 1;
    this.setPhase({
      phase: 'reconnecting',
      reason: 'runner disconnected',
      attempt: this.attempts,
    });
    this.session = null;
    if (this.child) {
      // Same as setCwd: wait for the child to actually exit before the loop
      // respawns, so the new serve can bind the socket without colliding.
      await terminateChild(this.child);
      this.child = null;
    }
  }

  private probeSocket(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const socket = new Socket();
      const done = (alive: boolean): void => {
        socket.destroy();
        resolve(alive);
      };
      socket.setTimeout(PROBE_TIMEOUT_MS);
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.once('timeout', () => done(false));
      socket.connect(this.socketPath);
    });
  }

  private ensureSocketDir(): void {
    // Named pipes (Windows) have no parent directory — `mkdirSync('\\.\pipe')`
    // would throw. Nothing to create.
    if (isNamedPipe(this.socketPath)) return;
    const dir = path.dirname(this.socketPath);
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch (e) {
        this.pushLog('stderr', `could not create socket dir ${dir}: ${(e as Error).message}`);
      }
    }
  }

  private cleanupStaleSocket(): void {
    // Named pipes (Windows) aren't filesystem entries and self-clean when the
    // owning process exits — there's nothing to unlink.
    if (isNamedPipe(this.socketPath)) return;
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
        this.pushLog('stderr', `removed stale socket ${this.socketPath}`);
      } catch (e) {
        this.pushLog(
          'stderr',
          `could not remove stale socket: ${(e as Error).message}`,
        );
      }
    }
  }

  private spawnServe(cli: CliInvocation): ChildProcess {
    const proc = spawnCli(cli, ['serve'], {
      env: {
        MOXXY_RUNNER_SOCKET: this.socketPath,
        // Desktop owns the UI; we don't need the co-attached web
        // surface, and binding its fixed port (4040) breaks the moment
        // a second workspace runner spawns.
        MOXXY_NO_WEB_SURFACE: '1',
        // Hide the Tier-2 self_update_core_* tools: patching @moxxy/core
        // (git clone + build + dist overlay + restart) can't work inside a
        // read-only packaged .app. Tier-1 (author/swap plugins + skills under
        // ~/.moxxy) stays fully available — that's how the desktop "patches"
        // itself.
        MOXXY_NO_CORE_UPDATE: '1',
        // Resume this workspace's conversation across restarts (see ctor).
        ...(this.sessionId ? { MOXXY_SESSION_ID: this.sessionId } : {}),
      },
      ...(this.cwd ? { cwd: this.cwd } : {}),
    });
    proc.stdout?.on('data', (chunk) => this.consumeLog('stdout', chunk));
    proc.stderr?.on('data', (chunk) => this.consumeLog('stderr', chunk));
    return proc;
  }

  /** Find and SIGTERM whatever process is bound to our socket, then
   *  unlink the file so the next spawn binds cleanly. macOS / Linux. */
  private async killForeignRunner(): Promise<void> {
    if (process.platform === 'win32') return;
    const pid = await new Promise<number | null>((resolve) => {
      let out = '';
      try {
        const child = spawn('lsof', ['-t', this.socketPath], {
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        child.stdout.on('data', (b) => {
          out += b.toString();
        });
        child.on('error', () => resolve(null));
        child.on('close', () => {
          const parsed = parseInt(out.trim().split('\n')[0] ?? '', 10);
          resolve(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
        });
      } catch {
        resolve(null);
      }
    });
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 400));
      try {
        process.kill(pid, 0);
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already dead */
      }
    }
    try {
      const fs = await import('node:fs');
      fs.unlinkSync(this.socketPath);
    } catch {
      /* fine */
    }
  }

  private async waitForSocket(child: ChildProcess | null = null): Promise<void> {
    // Detect a child that dies before binding via its 'exit' EVENT rather than
    // by polling child.exitCode: the event fires the moment Node observes the
    // exit, closing the race where the process is already gone but exitCode
    // hasn't been set yet at the instant we happen to poll.
    let exited: { code: number | null; signal: NodeJS.Signals | null } | null =
      child && (child.exitCode !== null || child.signalCode !== null)
        ? { code: child.exitCode, signal: child.signalCode }
        : null;
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      exited = { code, signal };
    };
    child?.once('exit', onExit);
    try {
      const deadline = Date.now() + SOCKET_WAIT_MS;
      while (Date.now() < deadline) {
        if (await this.probeSocket()) return;
        // The serve we spawned died before binding — no point polling for
        // 20 s; surface it now so the run loop retries / reports.
        if (exited) {
          throw new Error(
            `moxxy serve exited before binding ${this.socketPath} ` +
              `(code=${exited.code} signal=${exited.signal})`,
          );
        }
        await sleep(SOCKET_POLL_MS);
      }
      throw new Error(
        `moxxy serve did not bind ${this.socketPath} within ${SOCKET_WAIT_MS} ms`,
      );
    } finally {
      child?.removeListener('exit', onExit);
    }
  }

  private async waitForRetry(): Promise<void> {
    if (this.stopped) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, RECONNECT_BACKOFF_MS);
      this.retryNotify = () => {
        clearTimeout(t);
        resolve();
      };
    });
    this.retryNotify = () => {};
  }

  private setPhase(phase: ConnectionPhase): void {
    this.currentPhase = phase;
    this.emit('change', this.snapshot());
  }

  private consumeLog(stream: 'stdout' | 'stderr', chunk: Buffer): void {
    const lines = chunk.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line) this.pushLog(stream, line);
    }
  }

  private pushLog(stream: 'stdout' | 'stderr', line: string): void {
    // Redact before buffering: this ring is shipped to the renderer in
    // every snapshot() and shown in the connection diagnostics, so a
    // secret a plugin echoed to stdout must never make it across.
    this.logRing.push({ stream, line: redactSecrets(line) });
    if (this.logRing.length > LOG_RING_SIZE) {
      this.logRing.splice(0, this.logRing.length - LOG_RING_SIZE);
    }
  }
}

function displayPath(cli: CliInvocation): string {
  return cli.kind === 'direct' ? cli.bin : cli.entry;
}

/** Phases the run loop must NOT retry past — there is nothing a respin can
 *  fix. `protocol-incompatible` joins the existing terminal phases so a
 *  persistent runner-protocol mismatch stops the loop instead of looping. */
function isTerminalPhase(phase: ConnectionPhase['phase']): boolean {
  return phase === 'failed' || phase === 'cli-missing' || phase === 'protocol-incompatible';
}

/** Extract the two protocol versions from the runner's mismatch message
 *  (`runner protocol mismatch: server vX, client vY`). Returns null per field
 *  when unparseable so the renderer still shows the raw message. */
function parseMismatchVersions(msg: string): { server: number | null; client: number | null } {
  const m = /server v(\d+),\s*client v(\d+)/i.exec(msg);
  if (!m) return { server: null, client: null };
  return { server: Number.parseInt(m[1] ?? '', 10), client: Number.parseInt(m[2] ?? '', 10) };
}

/** Build the terminal `protocol-incompatible` phase from a mismatch error. The
 *  CLIENT version is what this app's bundled @moxxy/runner speaks; the SERVER
 *  version is what the reachable (pinned, bundled) CLI's runner speaks. */
function protocolIncompatiblePhase(msg: string): ConnectionPhase {
  const { server, client } = parseMismatchVersions(msg);
  return {
    phase: 'protocol-incompatible',
    serverVersion: server,
    clientVersion: client ?? RUNNER_PROTOCOL_VERSION,
    detail: msg,
    hint: 'This app version needs a newer moxxy CLI. Update the CLI (or reinstall the app) to continue.',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SIGKILL_GRACE_MS = 2_000;

/**
 * SIGTERM the child, then SIGKILL if it hasn't exited within the grace
 * window — so a wedged `moxxy serve` can't survive as a zombie holding
 * the socket after the desktop quits. Resolves once the child is gone or
 * the grace elapses.
 */
function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      } catch {
        /* already dead */
      }
      resolve();
    }, SIGKILL_GRACE_MS);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}
