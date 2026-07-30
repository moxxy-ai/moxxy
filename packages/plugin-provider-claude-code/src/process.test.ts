import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeProcessError, runClaudeProcess, type ClaudeProcessOptions, type ClaudeSpawnOptions } from './process.js';

class ControlledChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdio = [this.stdin, this.stdout, this.stderr] as const;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kills: NodeJS.Signals[] = [];

  constructor(private readonly closeOn: NodeJS.Signals | undefined = 'SIGTERM') {
    super();
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.kills.push(signal);
    if (signal === this.closeOn) this.close(null, signal);
    return true;
  }

  close(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('close', code, signal);
  }

  asChild(): ChildProcessWithoutNullStreams {
    return this as unknown as ChildProcessWithoutNullStreams;
  }
}

const baseOptions: ClaudeProcessOptions = {
  executable: 'claude',
  model: 'claude-sonnet-5',
  prompt: 'hello',
  cwd: '/tmp',
  nativeTools: false,
  allowedTools: [],
};

function processWith(child: ControlledChild, overrides: Partial<ClaudeProcessOptions> = {}) {
  return runClaudeProcess({ ...baseOptions, ...overrides, spawn: () => child.asChild() });
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
    throw new Error('expected rejection');
  } catch (error) {
    return error as Error;
  }
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('runClaudeProcess lifecycle', () => {
  it('removes nested Claude environment markers without mutating the parent environment', async () => {
    const child = new ControlledChild();
    let spawnOptions: ClaudeSpawnOptions | undefined;
    const oldClaudeCode = process.env.CLAUDECODE;
    const oldEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT;
    process.env.CLAUDECODE = '1';
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';
    try {
      const lines = runClaudeProcess({
        ...baseOptions,
        spawn: (_file, _args, options) => {
          spawnOptions = options;
          return child.asChild();
        },
      });
      const pending = lines.next();
      child.close(0);
      await pending;
      expect(spawnOptions?.env.CLAUDECODE).toBeUndefined();
      expect(spawnOptions?.env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
      expect(process.env.CLAUDECODE).toBe('1');
      expect(process.env.CLAUDE_CODE_ENTRYPOINT).toBe('cli');
    } finally {
      if (oldClaudeCode === undefined) delete process.env.CLAUDECODE;
      else process.env.CLAUDECODE = oldClaudeCode;
      if (oldEntrypoint === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT;
      else process.env.CLAUDE_CODE_ENTRYPOINT = oldEntrypoint;
    }
  });

  it('cancels promptly with one abort error and leaves no timer or child alive', async () => {
    vi.useFakeTimers();
    const child = new ControlledChild();
    const controller = new AbortController();
    const lines = processWith(child, { signal: controller.signal });
    const pending = lines.next();
    controller.abort();
    const error = await rejection(pending);
    expect(error).toMatchObject({ failure: 'aborted' });
    expect(child.kills).toEqual(['SIGTERM']);
    expect(vi.getTimerCount()).toBe(0);
    expect(await lines.next()).toEqual({ done: true, value: undefined });
  });

  it('times out startup and clears all lifecycle timers', async () => {
    vi.useFakeTimers();
    const child = new ControlledChild();
    const errorPromise = rejection(processWith(child, { startupTimeoutMs: 50 }).next());
    await vi.advanceTimersByTimeAsync(50);
    const error = await errorPromise;
    expect(error).toMatchObject({ failure: 'startup_timeout' });
    expect(child.kills).toEqual(['SIGTERM']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resets the idle timeout on every non-empty record', async () => {
    vi.useFakeTimers();
    const child = new ControlledChild();
    const lines = processWith(child, { startupTimeoutMs: 100, idleTimeoutMs: 100 });
    const first = lines.next();
    await vi.advanceTimersByTimeAsync(90);
    child.stdout.write('{"type":"system"}\n');
    expect(await first).toMatchObject({ done: false });

    const second = lines.next();
    await vi.advanceTimersByTimeAsync(90);
    child.stdout.write('{"type":"system"}\n');
    expect(await second).toMatchObject({ done: false });

    const timedOut = rejection(lines.next());
    await vi.advanceTimersByTimeAsync(101);
    expect(await timedOut).toMatchObject({ failure: 'idle_timeout' });
    expect(child.kills).toEqual(['SIGTERM']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps stderr and accepts a final unterminated record within the cap', async () => {
    const child = new ControlledChild();
    const lines = processWith(child, { maxStderrChars: 5, maxRecordChars: 20 });
    const first = lines.next();
    child.stderr.write('abcdefgh');
    child.stdout.write('{"ok":true}');
    child.close(7);
    expect(await first).toEqual({ done: false, value: '{"ok":true}' });
    expect(await lines.next()).toEqual({ done: true, value: { exitCode: 7, stderr: 'abcde' } });
  });

  it('rejects an oversized unterminated record as a protocol failure', async () => {
    vi.useFakeTimers();
    const child = new ControlledChild();
    const lines = processWith(child, { maxRecordChars: 5 });
    const pending = lines.next();
    child.stdout.write('123456');
    expect(await rejection(pending)).toMatchObject({ failure: 'protocol' });
    expect(child.kills).toEqual(['SIGTERM']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('escalates SIGTERM to SIGKILL once even when cleanup requests termination again', async () => {
    vi.useFakeTimers();
    const child = new ControlledChild('SIGKILL');
    const controller = new AbortController();
    const errorPromise = rejection(processWith(child, { signal: controller.signal }).next());
    controller.abort();
    await flush();
    expect(child.kills).toEqual(['SIGTERM']);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await errorPromise).toMatchObject({ failure: 'aborted' });
    expect(child.kills).toEqual(['SIGTERM', 'SIGKILL']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('terminates immediately when the consumer returns early', async () => {
    vi.useFakeTimers();
    const child = new ControlledChild();
    const lines = processWith(child);
    const first = lines.next();
    child.stdout.write('record\n');
    expect(await first).toEqual({ done: false, value: 'record' });
    await lines.return({ exitCode: 0, stderr: '' });
    expect(child.kills).toEqual(['SIGTERM']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no child or timer after normal completion', async () => {
    vi.useFakeTimers();
    const child = new ControlledChild();
    const lines = processWith(child);
    const pending = lines.next();
    child.close(0);
    expect(await pending).toEqual({ done: true, value: { exitCode: 0, stderr: '' } });
    expect(child.kills).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves the typed process error identity', () => {
    expect(new ClaudeProcessError('protocol', 'bad')).toBeInstanceOf(Error);
  });
});
