/**
 * The shared terminal process behind the `terminal` surface + tool.
 *
 * Two backends, picked at open time:
 *   1. **node-pty** (preferred) — a real PTY, so interactive programs (vim, top,
 *      a REPL) and prompts render correctly. Lazy-loaded; absent in a default
 *      install (it is an OPTIONAL peer dep — native, so CI never has to build
 *      it).
 *   2. **piped child shell** (fallback, dependency-free) — spawns the user's
 *      shell with piped stdio. Commands run and output streams live, which is
 *      enough for "run a command for the user"; full TTY apps are degraded.
 *
 * One process is shared per cwd (a module singleton map), so the agent's
 * `terminal` tool and the desktop pane drive the SAME session — the user sees
 * the agent's commands appear live and can take over typing.
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';

/** Minimal slice of node-pty we use — declared locally so typecheck never needs
 *  `@types/node-pty` (the dep is optional). */
interface NodePtyModule {
  spawn(
    file: string,
    args: string[] | string,
    opts: { name?: string; cols?: number; rows?: number; cwd?: string; env?: NodeJS.ProcessEnv },
  ): NodePtyProcess;
}
interface NodePtyProcess {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

let nodePtyPromise: Promise<NodePtyModule | null> | undefined;
/** Lazy-load node-pty; resolves to null when it isn't installed/usable. */
function loadNodePty(): Promise<NodePtyModule | null> {
  if (!nodePtyPromise) {
    nodePtyPromise = import('node-pty' as string)
      .then((m) => (m?.spawn ? (m as unknown as NodePtyModule) : (m?.default ?? null) as NodePtyModule | null))
      .catch(() => null);
  }
  return nodePtyPromise;
}

/** Pick the user's interactive shell per platform. */
function defaultShell(): string {
  if (process.platform === 'win32') return process.env['COMSPEC'] ?? 'powershell.exe';
  return process.env['SHELL'] ?? '/bin/bash';
}

/** Cap retained scrollback so a chatty process can't grow the buffer forever. */
const MAX_SCROLLBACK = 200_000;

export type TerminalBackend = 'pty' | 'pipe';

export interface TerminalProcess {
  readonly backend: TerminalBackend;
  /** Subscribe to output (utf8). Returns an unsubscribe fn. */
  onData(cb: (data: string) => void): () => void;
  /** Subscribe to process exit. */
  onExit(cb: (code: number) => void): () => void;
  /** Recent output for a late-joining viewer. */
  scrollback(): string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  readonly alive: boolean;
}

class TerminalProcessImpl implements TerminalProcess {
  private readonly dataListeners = new Set<(d: string) => void>();
  private readonly exitListeners = new Set<(c: number) => void>();
  private buffer = '';
  alive = true;

  constructor(
    readonly backend: TerminalBackend,
    private readonly pty: NodePtyProcess | null,
    private readonly child: ChildProcessWithoutNullStreams | null,
  ) {
    if (pty) {
      pty.onData((d) => this.emitData(d));
      pty.onExit((e) => this.emitExit(e.exitCode));
    } else if (child) {
      child.stdout.on('data', (b: Buffer) => this.emitData(b.toString('utf8')));
      child.stderr.on('data', (b: Buffer) => this.emitData(b.toString('utf8')));
      child.on('exit', (code) => this.emitExit(code ?? 0));
      child.on('error', () => this.emitExit(1));
    }
  }

  private emitData(d: string): void {
    this.buffer = (this.buffer + d).slice(-MAX_SCROLLBACK);
    for (const cb of this.dataListeners) {
      try {
        cb(d);
      } catch {
        /* a bad viewer must not break the stream */
      }
    }
  }

  private emitExit(code: number): void {
    if (!this.alive) return;
    this.alive = false;
    for (const cb of this.exitListeners) {
      try {
        cb(code);
      } catch {
        /* ignore */
      }
    }
  }

  onData(cb: (d: string) => void): () => void {
    this.dataListeners.add(cb);
    return () => this.dataListeners.delete(cb);
  }

  onExit(cb: (c: number) => void): () => void {
    this.exitListeners.add(cb);
    return () => this.exitListeners.delete(cb);
  }

  scrollback(): string {
    return this.buffer;
  }

  write(data: string): void {
    if (!this.alive) return;
    if (this.pty) this.pty.write(data);
    else this.child?.stdin.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.pty && this.alive) {
      try {
        this.pty.resize(Math.max(1, cols), Math.max(1, rows));
      } catch {
        /* resize on a dead pty — ignore */
      }
    }
    // The piped fallback has no TTY to resize.
  }

  kill(): void {
    if (!this.alive) return;
    try {
      this.pty?.kill();
      this.child?.kill();
    } catch {
      /* already gone */
    }
    this.emitExit(0);
  }
}

/** Spawn a fresh shared terminal in `cwd`, preferring a real PTY. */
export async function createTerminalProcess(cwd: string): Promise<TerminalProcess> {
  const shell = defaultShell();
  const cols = 80;
  const rows = 24;
  const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color' };
  const pty = await loadNodePty();
  if (pty) {
    try {
      const proc = pty.spawn(shell, [], { name: 'xterm-256color', cols, rows, cwd, env });
      return new TerminalProcessImpl('pty', proc, null);
    } catch {
      // Fall through to the piped backend if the native spawn fails.
    }
  }
  // Dependency-free fallback: an interactive shell with piped stdio. `-i` keeps
  // it from exiting immediately; non-Windows only — cmd/powershell are already
  // interactive when stdin is piped.
  const args = process.platform === 'win32' ? [] : ['-i'];
  const child = spawn(shell, args, {
    cwd,
    env: { ...env, PS1: '$ ' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return new TerminalProcessImpl('pipe', null, child);
}
