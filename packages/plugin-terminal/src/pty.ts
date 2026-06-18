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
import { chmodSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as nodePath from 'node:path';

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

/** Add the executable bit (u+x,g+x,o+x) to a file if it lacks it. Returns true
 *  when the file now has it (was already +x, or we just set it). Exported for
 *  tests — the chmod logic is the load-bearing fix, so it's unit-tested directly
 *  without needing node-pty present. */
export function makeExecutable(filePath: string): boolean {
  try {
    const st = statSync(filePath);
    if (st.mode & 0o111) return true; // already executable
    chmodSync(filePath, st.mode | 0o111);
    return true;
  } catch {
    return false; // not present / not permitted — caller treats as best-effort
  }
}

/**
 * node-pty ships a prebuilt `spawn-helper` binary on macOS that it exec()s to
 * launch the shell inside the PTY. Several install/repack paths (notably
 * `npm install` into the desktop's writable CLI prefix, and pnpm's content store)
 * drop the executable bit on it — node-pty then loads fine but `pty.spawn`
 * throws `posix_spawnp failed`, which used to be swallowed into the (effectively
 * dead) piped fallback. So before we spawn, ensure the helper is executable.
 * Best-effort: never throws; the spawn itself is the real test.
 */
function ensureSpawnHelperExecutable(): void {
  if (process.platform === 'win32') return; // Windows uses conpty/winpty, no spawn-helper
  try {
    const root = nodePtyPackageRoot();
    if (!root) return;
    const candidates = [
      // prebuildify layout (the published npm package)
      nodePath.join(root, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
      // build-from-source layout (no prebuild for this platform)
      nodePath.join(root, 'build', 'Release', 'spawn-helper'),
    ];
    for (const c of candidates) makeExecutable(c);
  } catch {
    /* best-effort */
  }
}

/** Resolve node-pty's package directory (the one containing `prebuilds/`),
 *  resolving from THIS module so it works whether node-pty sits in a hoisted
 *  root, a nested, or a pnpm store layout. */
function nodePtyPackageRoot(): string | null {
  try {
    const require = createRequire(import.meta.url);
    try {
      return nodePath.dirname(require.resolve('node-pty/package.json'));
    } catch {
      // `exports` may hide package.json; resolve the entry and walk up to the
      // first ancestor that has a `prebuilds/` (or `build/`) dir.
      let dir = nodePath.dirname(require.resolve('node-pty'));
      for (let i = 0; i < 6; i += 1) {
        if (existsSync(nodePath.join(dir, 'prebuilds')) || existsSync(nodePath.join(dir, 'build'))) {
          return dir;
        }
        const parent = nodePath.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      return null;
    }
  } catch {
    return null;
  }
}

/** Pick the user's interactive shell per platform. */
function defaultShell(): string {
  if (process.platform === 'win32') return process.env['COMSPEC'] ?? 'powershell.exe';
  return process.env['SHELL'] ?? '/bin/bash';
}

/** Cap retained scrollback so a chatty process can't grow the buffer forever. */
const MAX_SCROLLBACK = 200_000;
/**
 * Hysteresis margin: let the live buffer grow this far past the cap before
 * trimming back down to it, so we amortize the (expensive) slice over many
 * chunks instead of copying ~MAX_SCROLLBACK bytes on every chunk once
 * saturated. `scrollback()` masks the slack by always returning the last
 * MAX_SCROLLBACK chars.
 */
const SCROLLBACK_SLACK = 100_000;

export type TerminalBackend = 'pty' | 'pipe';

export interface TerminalProcess {
  readonly backend: TerminalBackend;
  /** When `backend === 'pipe'`, the reason the real PTY couldn't start (so the
   *  surface can show an honest "degraded" status instead of a silently-dead
   *  box). Null when a real PTY is in use. */
  readonly ptyError: string | null;
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

/** Exported for tests: lets a suite drive `emitData`/`scrollback` directly
 *  without spawning a real shell. Not part of the plugin's public surface. */
export class TerminalProcessImpl implements TerminalProcess {
  private readonly dataListeners = new Set<(d: string) => void>();
  private readonly exitListeners = new Set<(c: number) => void>();
  private buffer = '';
  alive = true;

  constructor(
    readonly backend: TerminalBackend,
    private readonly pty: NodePtyProcess | null,
    private readonly child: ChildProcessWithoutNullStreams | null,
    readonly ptyError: string | null = null,
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
    // Append, and only trim when we exceed the cap by a hysteresis margin —
    // trimming all the way back to the cap. The previous code sliced the full
    // 200KB buffer on EVERY chunk once saturated (O(total_output * cap) churn);
    // amortizing the trim makes appends ~O(1). `scrollback()` always returns the
    // last MAX_SCROLLBACK chars, so the observable tail is unchanged.
    this.buffer += d;
    if (this.buffer.length > MAX_SCROLLBACK + SCROLLBACK_SLACK) {
      this.buffer = this.buffer.slice(-MAX_SCROLLBACK);
    }
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
    // The buffer may hold up to MAX_SCROLLBACK + SCROLLBACK_SLACK chars between
    // trims (see emitData); always hand back exactly the last MAX_SCROLLBACK so
    // a late-joining viewer sees the same tail as before the hysteresis change.
    return this.buffer.length > MAX_SCROLLBACK
      ? this.buffer.slice(-MAX_SCROLLBACK)
      : this.buffer;
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
  let ptyError: string | null = pty ? null : 'node-pty is not installed';
  if (pty) {
    const trySpawn = (): NodePtyProcess =>
      pty.spawn(shell, [], { name: 'xterm-256color', cols, rows, cwd, env });
    // Make sure the prebuilt spawn-helper is executable, then spawn. If the first
    // spawn still fails (e.g. the bit was only just lost), repair + retry ONCE
    // before giving up — most "posix_spawnp failed" cases clear on the retry.
    ensureSpawnHelperExecutable();
    try {
      return new TerminalProcessImpl('pty', trySpawn(), null);
    } catch {
      ensureSpawnHelperExecutable();
      try {
        return new TerminalProcessImpl('pty', trySpawn(), null);
      } catch (err2) {
        // Don't swallow it: record WHY so the surface can show an honest status
        // instead of a silently-dead piped terminal.
        ptyError = err2 instanceof Error ? err2.message : String(err2);
      }
    }
  }
  // Dependency-free fallback: an interactive shell with piped stdio. `-i` keeps
  // it from exiting immediately; non-Windows only — cmd/powershell are already
  // interactive when stdin is piped. NOTE: this has no TTY line discipline (a
  // viewer's `\r` is never turned into `\n`, nothing echoes), so it is NOT a
  // usable interactive terminal — `ptyError` is surfaced to the user so the pane
  // reports the degraded state rather than appearing to ignore every keystroke.
  const args = process.platform === 'win32' ? [] : ['-i'];
  const child = spawn(shell, args, {
    cwd,
    env: { ...env, PS1: '$ ' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return new TerminalProcessImpl('pipe', null, child, ptyError);
}
