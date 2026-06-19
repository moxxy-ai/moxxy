/**
 * PeerSupervisor — spawns and reaps the separate `moxxy agent` runner
 * processes that make up the team. Each peer boots its own Session in its own
 * cwd (a git worktree) and connects to the hub via env. The supervisor owns
 * their lifecycle: spawn, capture stderr for diagnostics, and a graceful
 * SIGTERM → force-kill shutdown that also fires on the coordinator's abort.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { COLLAB_ENV } from '@moxxy/plugin-collab';
import type { RosterEntry } from '@moxxy/plugin-collab';
import { COLLAB_MAX_ITERATIONS_ENV, peerSocketPath } from './constants.js';

const FORCE_KILL_GRACE_MS = 4000;
const STDERR_RING = 40;
// Trim the stderr ring only once it grows to this watermark (then back to
// STDERR_RING) so a chatty/crash-looping child doesn't pay an O(n) array shift
// on every chunk; the buffer is only ever read as `.slice(-6)`, so retaining up
// to 2x the cap between trims is harmless.
const STDERR_RING_HIGH = STDERR_RING * 2;

export interface PeerSupervisorOptions {
  readonly runId: string;
  readonly hubSocket: string;
  readonly coordinatorSessionId: string;
  readonly parentTask: string;
  readonly defaultModel?: string;
  /** Per-peer iteration cap, forwarded to the spawned agent loop via env. */
  readonly peerMaxIterations?: number;
  /** Explicit CLI entrypoint to re-invoke as `moxxy agent`. Defaults to
   *  `process.argv[1]`; injectable for hosts that don't set it (packaged/Electron)
   *  or for tests. */
  readonly cliEntry?: string;
  readonly signal: AbortSignal;
}

export interface SpawnPeerArgs {
  readonly entry: RosterEntry;
  readonly cwd: string;
  readonly mode: string;
  /** Path to this agent's architect-authored charter file (read at boot into the
   *  peer's system prompt). Only the PATH crosses env, never the charter body. */
  readonly charterFile?: string;
}

/**
 * The lifecycle surface the coordinator depends on. Implemented by
 * {@link PeerSupervisor} for real processes; a different implementation can be
 * injected (tests, or a future remote/cloud executor — an extension seam).
 */
export interface Supervisor {
  spawn(args: SpawnPeerArgs): { socket: string };
  stop(agentId: string): Promise<void>;
  shutdownAll(reason?: string): Promise<void>;
  stderrOf(agentId: string): ReadonlyArray<string>;
  /** True once the child process has exited (cleanly, by signal, or because the
   *  spawn itself failed). Lets the coordinator fail fast instead of polling the
   *  wall-clock for an agent whose process is already gone. */
  hasExited(agentId: string): boolean;
}

interface PeerProc {
  readonly child: ChildProcess;
  readonly stderr: string[];
  exited: boolean;
}

export class PeerSupervisor implements Supervisor {
  private readonly peers = new Map<string, PeerProc>();
  private shuttingDown = false;
  private readonly cliEntry: string;

  constructor(private readonly opts: PeerSupervisorOptions) {
    // Resolve the CLI entry to re-invoke as `moxxy agent` ONCE, up front. Falling
    // back to `process.argv[1] ?? ''` would silently spawn `node '' agent` (boots
    // nothing / the wrong thing) under a host that omits argv[1] — every peer then
    // "fails" with an opaque diagnostic and the run produces nothing. Fail loudly
    // here instead, where the cause is clear.
    const entry = opts.cliEntry ?? process.argv[1];
    if (!entry || !entry.trim()) {
      throw new Error(
        'PeerSupervisor: cannot locate the moxxy CLI entrypoint to spawn peers (process.argv[1] is empty); pass cliEntry explicitly',
      );
    }
    this.cliEntry = entry;
    opts.signal.addEventListener('abort', () => void this.shutdownAll('coordinator aborted'), {
      once: true,
    });
  }

  /** Spawn one peer process. Returns the peer's own runner socket path. */
  spawn(args: SpawnPeerArgs): { socket: string } {
    const socket = peerSocketPath(this.opts.runId, args.entry.id);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      [COLLAB_ENV.Hub]: this.opts.hubSocket,
      [COLLAB_ENV.AgentId]: args.entry.id,
      [COLLAB_ENV.Role]: args.entry.role,
      [COLLAB_ENV.Subtask]: args.entry.subtask,
      [COLLAB_ENV.ParentTask]: this.opts.parentTask,
      [COLLAB_ENV.RunnerSocket]: socket,
      ...(args.charterFile ? { [COLLAB_ENV.CharterFile]: args.charterFile } : {}),
      MOXXY_SESSION_ID: `${this.opts.coordinatorSessionId}::${args.entry.id}`,
      MOXXY_MODE: args.mode,
    };
    const model = args.entry.model ?? this.opts.defaultModel;
    if (model) env.MOXXY_MODEL = model;
    if (this.opts.peerMaxIterations) env[COLLAB_MAX_ITERATIONS_ENV] = String(this.opts.peerMaxIterations);

    // Re-invoke this same CLI entrypoint as `moxxy agent`. `detached: false`
    // ties the child to the coordinator's process group so it can't outlive us.
    const child = spawn(process.execPath, [this.cliEntry, 'agent'], {
      cwd: args.cwd,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: false,
    });

    const proc: PeerProc = { child, stderr: [], exited: false };
    this.peers.set(args.entry.id, proc);
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (line.trim()) proc.stderr.push(line);
      }
      if (proc.stderr.length > STDERR_RING_HIGH) proc.stderr.splice(0, proc.stderr.length - STDERR_RING);
    });
    child.on('exit', () => {
      proc.exited = true;
    });
    // A failed spawn (bad path, ENOENT — plausible when re-invoking the CLI
    // under a packaged/Electron host) emits 'error'; with NO listener Node
    // re-throws it as an uncaught exception that takes down the whole
    // coordinator/runner. Capture it as a normal exit + stderr line so the
    // coordinator surfaces it and fails fast instead of crashing.
    child.on('error', (err: Error) => {
      proc.exited = true;
      proc.stderr.push(`spawn error: ${err.message}`);
    });
    return { socket };
  }

  /** True once the child has exited or its spawn failed. */
  hasExited(agentId: string): boolean {
    const proc = this.peers.get(agentId);
    // No entry → never spawned (treat as not-exited); a tracked proc reports
    // its real exit/spawn-failure state.
    return proc ? proc.exited : false;
  }

  /** Last stderr lines from a peer — used to diagnose a crash. */
  stderrOf(agentId: string): ReadonlyArray<string> {
    return this.peers.get(agentId)?.stderr ?? [];
  }

  /** Stop a single peer and AWAIT its real exit (with a force-kill fallback), so
   *  callers — e.g. the sequential fallback — can rely on the workspace being
   *  free before the next agent starts. */
  async stop(agentId: string): Promise<void> {
    const proc = this.peers.get(agentId);
    if (!proc || proc.exited) return;
    try {
      proc.child.kill('SIGTERM');
    } catch {
      // already gone
    }
    await new Promise<void>((resolve) => {
      if (proc.exited) return resolve();
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      proc.child.once('exit', done);
      const timer = setTimeout(() => {
        try {
          proc.child.kill('SIGKILL');
        } catch {
          // already gone
        }
        done();
      }, FORCE_KILL_GRACE_MS);
      timer.unref?.();
    });
  }

  async shutdownAll(_reason?: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    const live = [...this.peers.values()].filter((p) => !p.exited);
    for (const p of live) {
      try {
        p.child.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
    if (live.length === 0) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, FORCE_KILL_GRACE_MS);
      timer.unref?.();
    });
    for (const p of this.peers.values()) {
      if (!p.exited) {
        try {
          p.child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    }
  }
}
