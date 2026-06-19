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

/**
 * Upper bound on output/exit listeners on a single shared process. A surface
 * whose `close()` never runs (the viewer disconnects abnormally, the desktop
 * crashes mid-stream) leaks its subscription for the life of the shared shell.
 * Past this many live listeners we warn once — a runaway count is a leak, not a
 * legitimate fan-out (only a handful of viewers + the per-command reader are
 * ever expected). The set is not hard-capped (dropping a real viewer's stream
 * is worse than the warning), but the diagnostic makes the leak visible.
 */
const LISTENER_WARN_THRESHOLD = 64;

/**
 * Grace period before escalating a kill() from SIGTERM to SIGKILL. An
 * interactive shell that ignores/handles SIGTERM (or is wedged) would otherwise
 * never die; after this we force it.
 */
const KILL_ESCALATION_MS = 2_000;

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

/**
 * Resolve a usable NodePtyModule from whatever `import('node-pty')` yields, or
 * null. Handles ESM/CJS interop (`.spawn` on the namespace OR on `.default`) and
 * — critically — REQUIRES a callable `spawn` on whichever we pick. A malformed /
 * partially-shimmed module (a `default` that lacks `spawn`, a non-function
 * `spawn`) must degrade to the piped fallback HERE rather than be returned and
 * blow up later as `pty.spawn is not a function` inside `createTerminalProcess`.
 * Exported for tests — the optional dep is never present in CI, so the
 * shape-resolution logic is unit-tested against hand-built module objects.
 */
export function resolveNodePtyModule(m: unknown): NodePtyModule | null {
  const hasSpawn = (v: unknown): v is NodePtyModule =>
    typeof v === 'object' && v !== null && typeof (v as { spawn?: unknown }).spawn === 'function';
  if (hasSpawn(m)) return m;
  const def = (m as { default?: unknown } | null | undefined)?.default;
  if (hasSpawn(def)) return def;
  return null;
}

let nodePtyPromise: Promise<NodePtyModule | null> | undefined;
/** Lazy-load node-pty; resolves to null when it isn't installed/usable. */
function loadNodePty(): Promise<NodePtyModule | null> {
  if (!nodePtyPromise) {
    nodePtyPromise = import('node-pty' as string)
      .then((m) => resolveNodePtyModule(m))
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

/** Upper bound on a PTY dimension. A viewer/relay could request an absurd
 *  cols/rows (off the wire, unvalidated upstream); node-pty/conpty allocates
 *  per-cell and can throw or wedge on extreme values, so cap to a generous but
 *  finite ceiling. Far larger than any real terminal. */
const MAX_DIMENSION = 10_000;

/** Floor to an integer and clamp into [1, MAX_DIMENSION]; non-finite → 1. */
function clampDimension(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_DIMENSION, Math.max(1, Math.floor(n)));
}

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
  private warnedListenerLeak = false;
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
      // The shared child is long-lived and may be (re)subscribed by several
      // viewers over its lifetime; make the intent explicit so Node never emits
      // a false-positive "possible EventEmitter memory leak detected" warning on
      // its streams. Our own fan-out Sets are the real bound (see addListener).
      child.stdout.setMaxListeners(0);
      child.stderr.setMaxListeners(0);
      child.stdin.setMaxListeners(0);
      child.setMaxListeners(0);
      child.stdout.on('data', (b: Buffer) => this.emitData(b.toString('utf8')));
      child.stderr.on('data', (b: Buffer) => this.emitData(b.toString('utf8')));
      child.on('exit', (code) => this.emitExit(code ?? 0));
      child.on('error', () => this.emitExit(1));
      // The child can exit (closing stdin) before the async 'exit' event flips
      // `alive` — a write in that window can emit a broken-pipe 'error' on
      // stdin. Swallow it here so it never goes unhandled and crashes the host.
      child.stdin.on('error', () => {
        /* broken pipe after shell exit — ignored */
      });
    }
  }

  /** Warn once when a listener Set grows past the leak threshold (a viewer whose
   *  close() never ran keeps its subscription for the shell's whole life). */
  private checkListenerLeak(): void {
    if (this.warnedListenerLeak) return;
    if (this.dataListeners.size + this.exitListeners.size > LISTENER_WARN_THRESHOLD) {
      this.warnedListenerLeak = true;
       
      console.warn(
        `[plugin-terminal] shared terminal has ${this.dataListeners.size} data + ` +
          `${this.exitListeners.size} exit listeners — likely a viewer that never closed.`,
      );
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
    this.checkListenerLeak();
    return () => this.dataListeners.delete(cb);
  }

  onExit(cb: (c: number) => void): () => void {
    this.exitListeners.add(cb);
    this.checkListenerLeak();
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
    try {
      if (this.pty) this.pty.write(data);
      else this.child?.stdin.write(data);
    } catch {
      // The child may have exited between `alive` flipping and now, leaving a
      // closed stdin pipe — a synchronous EPIPE here must not crash the host.
    }
  }

  resize(cols: number, rows: number): void {
    if (this.pty && this.alive) {
      // Coerce to a sane integer in [1, MAX_DIMENSION]. Callers SHOULD pre-validate
      // (terminal.ts isValidDimension), but a float/huge value reaching node-pty
      // can throw or wedge conpty, so clamp defensively here too.
      try {
        this.pty.resize(clampDimension(cols), clampDimension(rows));
      } catch {
        /* resize on a dead pty — ignore */
      }
    }
    // The piped fallback has no TTY to resize.
  }

  kill(): void {
    if (!this.alive) return;
    try {
      if (this.pty) {
        // node-pty kills the conpty/pty session; on POSIX it signals the shell.
        // Send SIGTERM, then escalate to SIGKILL after a grace period if the
        // shell ignores/handles it (a wedged shell would otherwise never die).
        this.pty.kill();
        const pty = this.pty;
        setTimeout(() => {
          try {
            pty.kill('SIGKILL');
          } catch {
            /* already gone */
          }
        }, KILL_ESCALATION_MS).unref?.();
      }
      if (this.child) this.killChildTree(this.child);
    } catch {
      /* already gone */
    }
    this.emitExit(0);
  }

  /**
   * Terminate the piped shell AND its descendants. The child is spawned
   * `detached` (its own process group), so a negative-pid signal reaches the
   * whole tree — otherwise a running grandchild (a `sleep`, a dev server, a
   * `tail -f`, a build) is reparented to init and leaks past session teardown,
   * holding ports/files. Escalate SIGTERM → SIGKILL after a grace period.
   */
  private killChildTree(child: ChildProcessWithoutNullStreams): void {
    const pid = child.pid;
    const signalGroup = (signal: NodeJS.Signals): void => {
      try {
        if (pid !== undefined && process.platform !== 'win32') {
          // Negative pid = the whole process group (requires detached spawn).
          process.kill(-pid, signal);
        } else {
          // Windows / unknown pid: node handles its own tree (taskkill /T-like).
          child.kill(signal);
        }
      } catch {
        // No such process group (already dead) or not permitted — fall back to
        // signaling just the child so we never leave it running.
        try {
          child.kill(signal);
        } catch {
          /* already gone */
        }
      }
    };
    signalGroup('SIGTERM');
    setTimeout(() => signalGroup('SIGKILL'), KILL_ESCALATION_MS).unref?.();
  }
}

/** Spawn a fresh shared terminal in `cwd`, preferring a real PTY. */
export async function createTerminalProcess(cwd: string): Promise<TerminalProcess> {
  const shell = defaultShell();
  const cols = 80;
  const rows = 24;
  // SECURITY: the shared shell deliberately inherits the runner's full
  // environment (API keys, tokens, MOXXY_* signing keys). This mirrors a real
  // user shell so the agent's commands behave as the user expects (a script
  // that needs $GITHUB_TOKEN works). The trade-off is that `env`/`printenv` can
  // surface secrets into captured output and scrollback — acceptable because the
  // terminal is a deliberately user-facing, user-controllable surface. Do NOT
  // strip vars here (it would silently break legitimate commands); gate any
  // scrubbing behind an explicit opt-in if ever needed.
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
    // Own process group (POSIX) so kill() can signal the WHOLE tree by negative
    // pid — otherwise grandchildren (a dev server, a `tail -f`, a build) outlive
    // the session. No-op semantics on Windows; node-pty handles its own tree.
    detached: process.platform !== 'win32',
  });
  return new TerminalProcessImpl('pipe', null, child, ptyError);
}
