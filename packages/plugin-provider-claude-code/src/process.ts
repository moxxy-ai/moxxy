import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface ClaudeSpawnOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
}

export type ClaudeSpawn = (
  executable: string,
  args: ReadonlyArray<string>,
  options: ClaudeSpawnOptions,
) => ChildProcessWithoutNullStreams;

export type ClaudeProcessFailure = 'aborted' | 'startup_timeout' | 'idle_timeout' | 'protocol';

export class ClaudeProcessError extends Error {
  constructor(readonly failure: ClaudeProcessFailure, message: string) {
    super(message);
    this.name = 'ClaudeProcessError';
  }
}

export interface ClaudeProcessOptions {
  readonly executable: string;
  readonly model: string;
  readonly prompt: string;
  readonly cwd: string;
  readonly nativeTools: boolean;
  readonly permissionMode?: string;
  readonly allowedTools: ReadonlyArray<string>;
  readonly signal?: AbortSignal;
  readonly spawn?: ClaudeSpawn;
  readonly startupTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly maxStderrChars?: number;
  readonly maxRecordChars?: number;
}

export interface ClaudeProcessResult {
  readonly exitCode: number;
  readonly stderr: string;
}

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_STDERR_CHARS = 2048;
const DEFAULT_MAX_RECORD_CHARS = 64 * 1024;
const KILL_GRACE_MS = 1_000;

type QueueItem = { readonly line: string } | { readonly error: Error } | { readonly done: true };

export async function* runClaudeProcess(
  options: ClaudeProcessOptions,
): AsyncGenerator<string, ClaudeProcessResult> {
  const args = buildArgs(options);
  const env = { ...process.env };
  // Claude refuses nested interactive sessions. Moxxy is the parent here, not a
  // nested Claude Code instance, even when it was launched from Claude Code.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const spawnImpl = options.spawn ?? ((file, childArgs, childOptions) => spawn(file, [...childArgs], {
    stdio: ['pipe', 'pipe', 'pipe'], env: childOptions.env, cwd: childOptions.cwd,
  }));

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawnImpl(options.executable, args, { env, cwd: options.cwd });
  } catch (error) {
    throw error;
  }

  const queue: QueueItem[] = [];
  let wake: (() => void) | undefined;
  let stdout = '';
  let stderr = '';
  let closed = false;
  let failure: Error | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const startupTimeoutMs = positive(options.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS);
  const idleTimeoutMs = positive(options.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS);
  const maxStderrChars = positive(options.maxStderrChars, DEFAULT_MAX_STDERR_CHARS);
  const maxRecordChars = positive(options.maxRecordChars, DEFAULT_MAX_RECORD_CHARS);

  const push = (item: QueueItem): void => {
    queue.push(item);
    const notify = wake;
    wake = undefined;
    notify?.();
  };
  const clearWatchdog = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const terminate = (): void => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, KILL_GRACE_MS);
    killTimer.unref?.();
  };
  const fail = (error: Error): void => {
    if (failure) return;
    failure = error;
    clearWatchdog();
    terminate();
    // Cancellation/failure is terminal: discard records received but not yet
    // consumed so no text can be emitted after the single error event.
    queue.length = 0;
    push({ error });
  };
  const arm = (kind: 'startup' | 'idle'): void => {
    clearWatchdog();
    const delay = kind === 'startup' ? startupTimeoutMs : idleTimeoutMs;
    timer = setTimeout(() => fail(new ClaudeProcessError(
      kind === 'startup' ? 'startup_timeout' : 'idle_timeout',
      kind === 'startup'
        ? `Claude CLI did not produce a stream record within ${delay}ms`
        : `Claude CLI stream was idle for ${delay}ms`,
    )), delay);
    timer.unref?.();
  };
  const onAbort = (): void => fail(new ClaudeProcessError('aborted', 'Claude CLI request aborted'));

  child.stdin.on('error', (error) => {
    // EPIPE commonly follows cancellation; the abort error is the useful one.
    if (!failure) fail(error);
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < maxStderrChars) stderr += chunk.slice(0, maxStderrChars - stderr.length);
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    if (failure) return;
    stdout += chunk;
    if (stdout.length > maxRecordChars && !stdout.includes('\n')) {
      fail(new ClaudeProcessError('protocol', `Claude CLI emitted a stream record larger than ${maxRecordChars} characters`));
      return;
    }
    let newline = stdout.indexOf('\n');
    while (newline >= 0 && !failure) {
      const line = stdout.slice(0, newline).replace(/\r$/, '');
      stdout = stdout.slice(newline + 1);
      if (line.length > maxRecordChars) {
        fail(new ClaudeProcessError('protocol', `Claude CLI emitted a stream record larger than ${maxRecordChars} characters`));
        return;
      }
      if (line.trim()) {
        arm('idle');
        push({ line });
      }
      newline = stdout.indexOf('\n');
    }
    if (stdout.length > maxRecordChars) {
      fail(new ClaudeProcessError('protocol', `Claude CLI emitted a stream record larger than ${maxRecordChars} characters`));
    }
  });

  const completion = new Promise<number>((resolve, reject) => {
    child.once('error', (error) => {
      fail(error);
      reject(error);
    });
    child.once('close', (code) => {
      closed = true;
      clearWatchdog();
      if (killTimer) clearTimeout(killTimer);
      killTimer = undefined;
      if (!failure && stdout.trim()) {
        if (stdout.length > maxRecordChars) {
          fail(new ClaudeProcessError('protocol', `Claude CLI emitted a stream record larger than ${maxRecordChars} characters`));
        } else {
          // A final JSON record need not end in a newline.
          push({ line: stdout.replace(/\r$/, '') });
        }
      }
      push({ done: true });
      resolve(code ?? 1);
    });
  });
  // A rejected completion is observed again in finally; prevent an early
  // child 'error' event from becoming an unhandled rejection first.
  void completion.catch(() => undefined);

  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  else arm('startup');
  if (!failure) child.stdin.end(options.prompt, 'utf8');

  try {
    while (true) {
      if (queue.length === 0) await new Promise<void>((resolve) => { wake = resolve; });
      const item = queue.shift();
      if (!item) continue;
      if ('error' in item) throw item.error;
      if ('done' in item) break;
      yield item.line;
    }
    const exitCode = await completion;
    return { exitCode, stderr: stderr.trim() };
  } finally {
    clearWatchdog();
    options.signal?.removeEventListener('abort', onAbort);
    terminate();
    try { await completion; } catch { /* surfaced through the queue */ }
    if (killTimer) clearTimeout(killTimer);
  }
}

function buildArgs(options: ClaudeProcessOptions): string[] {
  const args = ['--print', '--verbose', '--output-format', 'stream-json', '--include-partial-messages', '--model', options.model];
  if (options.nativeTools) {
    args.push('--tools', ...(options.allowedTools.length > 0 ? options.allowedTools : ['']));
    if (options.permissionMode) args.push('--permission-mode', options.permissionMode);
    if (options.allowedTools.length > 0) args.push('--allowedTools', ...options.allowedTools);
  } else {
    args.splice(args.length - 2, 0, '--tools', '');
  }
  return args;
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && value > 0 ? value : fallback;
}
