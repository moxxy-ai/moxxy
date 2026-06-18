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
import { peerSocketPath } from './constants.js';

const FORCE_KILL_GRACE_MS = 4000;
const STDERR_RING = 40;

export interface PeerSupervisorOptions {
  readonly runId: string;
  readonly hubSocket: string;
  readonly coordinatorSessionId: string;
  readonly parentTask: string;
  readonly defaultModel?: string;
  readonly signal: AbortSignal;
}

export interface SpawnPeerArgs {
  readonly entry: RosterEntry;
  readonly cwd: string;
  readonly mode: string;
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
}

interface PeerProc {
  readonly child: ChildProcess;
  readonly stderr: string[];
  exited: boolean;
}

export class PeerSupervisor implements Supervisor {
  private readonly peers = new Map<string, PeerProc>();
  private shuttingDown = false;

  constructor(private readonly opts: PeerSupervisorOptions) {
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
      MOXXY_SESSION_ID: `${this.opts.coordinatorSessionId}::${args.entry.id}`,
      MOXXY_MODE: args.mode,
    };
    const model = args.entry.model ?? this.opts.defaultModel;
    if (model) env.MOXXY_MODEL = model;

    // Re-invoke this same CLI entrypoint as `moxxy agent`. `detached: false`
    // ties the child to the coordinator's process group so it can't outlive us.
    const child = spawn(process.execPath, [process.argv[1] ?? '', 'agent'], {
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
      if (proc.stderr.length > STDERR_RING) proc.stderr.splice(0, proc.stderr.length - STDERR_RING);
    });
    child.on('exit', () => {
      proc.exited = true;
    });
    return { socket };
  }

  /** Last stderr lines from a peer — used to diagnose a crash. */
  stderrOf(agentId: string): ReadonlyArray<string> {
    return this.peers.get(agentId)?.stderr ?? [];
  }

  /** Best-effort: abort a single peer's in-flight turn via its runner, then kill. */
  async stop(agentId: string): Promise<void> {
    const proc = this.peers.get(agentId);
    if (!proc || proc.exited) return;
    try {
      proc.child.kill('SIGTERM');
    } catch {
      // already gone
    }
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
