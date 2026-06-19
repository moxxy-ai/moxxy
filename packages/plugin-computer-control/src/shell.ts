import { spawn } from 'node:child_process';
import { MoxxyError } from '@moxxy/sdk';

export const IS_DARWIN = process.platform === 'darwin';

/**
 * Hard ceiling on combined stdout+stderr a child may emit before it is
 * force-killed. The wall-clock timeout caps duration but not throughput —
 * a runaway or hostile child (e.g. `pbpaste` on a gigabyte clipboard, or an
 * `osascript` snippet that streams unbounded output) can accumulate hundreds
 * of MB well inside the timeout and OOM the host. 16 MB is far above any
 * legitimate tool output here (the screenshot path caps its own encoded file
 * separately) while still bounding worst-case memory.
 */
export const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/** Grace period after SIGTERM before escalating to SIGKILL. */
const SIGKILL_GRACE_MS = 2_500;

export interface ProcResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /**
   * True when the child was force-killed because it exceeded `timeoutMs`.
   * A timed-out child still resolves (via 'close') with `exitCode: -1`, so
   * this flag is the only reliable way for callers to distinguish a timeout
   * from a genuine non-zero exit and surface an actionable message.
   */
  readonly timedOut: boolean;
  /** True when the child was force-killed because `opts.signal` aborted. */
  readonly aborted: boolean;
  /**
   * True when the child was force-killed because its combined stdout+stderr
   * exceeded `MAX_OUTPUT_BYTES`. The captured output is whatever had been
   * read up to the cap.
   */
  readonly tooLarge: boolean;
}

/**
 * Build a uniform failure suffix that names a timeout/abort when the process
 * was force-killed, so a stuck `osascript` (etc.) is reported as a clear
 * cause rather than a bare `exit -1`. Returns '' for a normal exit.
 */
export function procFailureCause(proc: ProcResult, timeoutMs?: number): string {
  if (proc.tooLarge) return `output exceeded ${MAX_OUTPUT_BYTES} bytes (killed)`;
  if (proc.timedOut) {
    return timeoutMs ? `timed out after ${timeoutMs}ms` : 'timed out';
  }
  if (proc.aborted) return 'aborted (turn cancelled)';
  return '';
}

/**
 * Spawn a process with array-form args (no shell). Returns stdout +
 * stderr + exit code. Optional `input` is written to stdin. Optional
 * `signal` propagates aborts from the tool ctx so a stuck `osascript`
 * dies with the turn instead of hanging the parent.
 *
 * Never use this with string interpolation into a single command —
 * each argument MUST be a separate array entry. The `bash -c` shape
 * would re-introduce the shell-injection risk this helper exists to
 * eliminate.
 */
export function runProcess(
  cmd: string,
  args: ReadonlyArray<string>,
  opts: {
    readonly input?: string | Buffer;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  } = {},
): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    // Collect stdout chunks and concat ONCE at close — re-concatenating the
    // whole accumulated buffer on every 'data' event is O(n^2) and churns the
    // GC.
    const stdoutChunks: Buffer[] = [];
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let tooLarge = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    // Force the child to die: SIGTERM first, then escalate to SIGKILL after a
    // grace period for a child that traps/ignores SIGTERM (a wedged GUI helper
    // or an osascript stuck behind an Accessibility prompt). Without the
    // escalation the tool's timeout/abort isn't actually enforced — the parent
    // hangs until the child closes on its own, which may be never.
    const forceKill = (): void => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      if (killTimer) return;
      killTimer = setTimeout(() => {
        if (settled) return;
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, SIGKILL_GRACE_MS);
      killTimer.unref?.();
    };

    const onAbort = (): void => {
      if (settled) return;
      aborted = true;
      forceKill();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          if (settled) return;
          timedOut = true;
          forceKill();
        }, opts.timeoutMs)
      : null;

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      outputBytes += chunk.length;
      if (!tooLarge && outputBytes > MAX_OUTPUT_BYTES) {
        tooLarge = true;
        forceKill();
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      // Bound the retained stderr string too: once over the cap we stop
      // appending (the child is being killed) so a stderr flood can't OOM.
      if (!tooLarge) stderr += chunk.toString('utf8');
      if (!tooLarge && outputBytes > MAX_OUTPUT_BYTES) {
        tooLarge = true;
        forceKill();
      }
    });
    // A child that exits/closes stdin before our write completes makes the
    // stdin Writable emit 'error' (EPIPE/ECONNRESET). With no listener that
    // throws and surfaces as an unhandled rejection that can take down the
    // parent — swallow it; the child 'error'/'close' path reports the real
    // failure. Same defensiveness on stdout/stderr for symmetry.
    child.stdin.on('error', () => {});
    child.stdout.on('error', () => {});
    child.stderr.on('error', () => {});
    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      opts.signal?.removeEventListener('abort', onAbort);
    };
    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        exitCode: code ?? -1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr,
        timedOut,
        aborted,
        tooLarge,
      });
    });

    if (opts.input !== undefined) {
      child.stdin.end(opts.input);
    } else {
      child.stdin.end();
    }
  });
}

/** Throw a clear error when a tool is invoked on a non-darwin host. */
export function ensureDarwin(toolName: string): void {
  if (!IS_DARWIN) {
    throw new MoxxyError({
      code: 'TOOL_ERROR',
      message: `${toolName}: @moxxy/plugin-computer-control currently only supports macOS (process.platform = ${process.platform})`,
      context: { tool: toolName, platform: process.platform },
    });
  }
}
