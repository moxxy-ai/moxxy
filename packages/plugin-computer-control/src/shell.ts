import { spawn } from 'node:child_process';
import { MoxxyError } from '@moxxy/sdk';

export const IS_DARWIN = process.platform === 'darwin';

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
}

/**
 * Build a uniform failure suffix that names a timeout/abort when the process
 * was force-killed, so a stuck `osascript` (etc.) is reported as a clear
 * cause rather than a bare `exit -1`. Returns '' for a normal exit.
 */
export function procFailureCause(proc: ProcResult, timeoutMs?: number): string {
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
    let settled = false;
    let timedOut = false;
    let aborted = false;

    const onAbort = (): void => {
      if (settled) return;
      aborted = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          if (settled) return;
          timedOut = true;
          try {
            child.kill('SIGTERM');
          } catch {
            /* ignore */
          }
        }, opts.timeoutMs)
      : null;

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({
        exitCode: code ?? -1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr,
        timedOut,
        aborted,
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
