import type { ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { MoxxyError, waitFor, type WakeSource } from '@moxxy/sdk';
import { SIGKILL_GRACE_MS, killTree, spawnShell } from './shell.js';
import { dropDanglingSurrogate } from './util.js';

/** Output a job keeps in memory; older output is trimmed from the head. */
const RETAIN_CHARS = 200_000;
/** Output one report shows; the most recent part wins. */
const REPORT_CHARS = 30_000;
/** Running jobs one session may hold, so a looping model can't flood the host. */
export const MAX_RUNNING_JOBS = 16;

export type JobState = 'running' | 'exited' | 'stopped' | 'failed';

/**
 * A shell command left running after the Bash call that started it. Output
 * from stdout and stderr is kept interleaved, and every change (new output, the
 * process ending) wakes whoever waits on {@link BackgroundJob.onChange}.
 */
export class BackgroundJob {
  state: JobState = 'running';
  private exitCode: number | null = null;
  private exitSignal: NodeJS.Signals | null = null;
  private failure: string | undefined;
  private stopRequested = false;
  private output = '';
  /** Chars trimmed from the head of `output` so far. */
  private trimmed = 0;
  /** Absolute offset of the first char no report has shown yet. */
  private readTo = 0;
  private endedAt: number | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly id: string,
    readonly sessionId: string,
    readonly command: string,
    private readonly child: ChildProcess,
    private readonly startedAt = Date.now(),
  ) {}

  readonly onChange: WakeSource = (wake) => {
    this.listeners.add(wake);
    return () => this.listeners.delete(wake);
  };

  append(chunk: string): void {
    if (chunk.length === 0) return;
    this.output += chunk;
    const excess = this.output.length - RETAIN_CHARS;
    if (excess > 0) {
      this.output = dropDanglingSurrogate(this.output.slice(excess));
      this.trimmed += excess;
    }
    this.notify();
  }

  ended(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.state !== 'running') return;
    this.state = this.stopRequested ? 'stopped' : 'exited';
    this.exitCode = code;
    this.exitSignal = signal;
    this.endedAt = Date.now();
    this.notify();
  }

  failed(error: Error): void {
    if (this.state !== 'running') return;
    this.state = 'failed';
    this.failure = error.message;
    this.endedAt = Date.now();
    this.notify();
  }

  /** Output printed since the last report. */
  unread(): string {
    return this.output.slice(Math.max(0, this.readTo - this.trimmed));
  }

  /** SIGTERM the job's whole process tree, then SIGKILL it after a grace period. */
  kill(): void {
    if (this.state !== 'running') return;
    this.stopRequested = true;
    killTree(this.child, 'SIGTERM');
    setTimeout(() => {
      if (this.state === 'running') killTree(this.child, 'SIGKILL');
    }, SIGKILL_GRACE_MS).unref();
  }

  /** Kill without waiting — for a host that is exiting right now. */
  killNow(): void {
    if (this.state === 'running') killTree(this.child, 'SIGKILL');
  }

  /** A status line plus the output since the last report, which it marks read. */
  report(headline = this.headline()): string {
    const skipped = Math.max(0, this.trimmed - this.readTo);
    let text = this.unread();
    this.readTo = this.trimmed + this.output.length;
    let dropped = skipped;
    if (text.length > REPORT_CHARS) {
      dropped += text.length - REPORT_CHARS;
      text = dropDanglingSurrogate(text.slice(text.length - REPORT_CHARS));
    }
    const lines = [`[${headline}]`];
    if (dropped > 0) lines.push(`... [${dropped} earlier chars not shown]`);
    if (text.trim().length > 0) lines.push(text.trimEnd());
    return lines.join('\n');
  }

  headline(): string {
    const took = `after ${(((this.endedAt ?? Date.now()) - this.startedAt) / 1000).toFixed(1)}s`;
    switch (this.state) {
      case 'running':
        return `job ${this.id} is still running (${took})`;
      case 'stopped':
        return `job ${this.id} stopped ${took}`;
      case 'failed':
        return `job ${this.id} failed to start: ${this.failure ?? 'unknown error'}`;
      case 'exited':
        return this.exitSignal !== null
          ? `job ${this.id} was killed by ${this.exitSignal} ${took}`
          : `job ${this.id} exited with code ${this.exitCode ?? 'null'} ${took}`;
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/** Every background job this process runs, each owned by one session. */
export class BackgroundJobs {
  private readonly jobs = new Map<string, BackgroundJob>();
  private seq = 0;
  private exitHookInstalled = false;

  start(
    sessionId: string,
    command: string,
    opts: { readonly cwd: string; readonly env?: Readonly<Record<string, string>> },
  ): BackgroundJob {
    if (this.running(sessionId).length >= MAX_RUNNING_JOBS) {
      throw new MoxxyError({
        code: 'TOOL_ERROR',
        message: `Bash: ${MAX_RUNNING_JOBS} background jobs are already running — StopJob one first.`,
      });
    }
    this.installExitHook();
    const child = spawnShell(command, opts);
    this.seq += 1;
    const job = new BackgroundJob(`bg-${this.seq}`, sessionId, command, child);
    const out = new StringDecoder('utf8');
    const err = new StringDecoder('utf8');
    child.stdout.on('data', (b: Buffer) => job.append(out.write(b)));
    child.stderr.on('data', (b: Buffer) => job.append(err.write(b)));
    child.on('error', (e: Error) => job.failed(e));
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      job.append(out.end() + err.end());
      job.ended(code, signal);
    });
    this.jobs.set(job.id, job);
    return job;
  }

  find(sessionId: string, id: string): BackgroundJob {
    const job = this.jobs.get(id);
    if (job === undefined || job.sessionId !== sessionId) {
      const known = this.list(sessionId).map((j) => j.id);
      throw new MoxxyError({
        code: 'TOOL_ERROR',
        message: `No background job "${id}" in this session.${known.length > 0 ? ` Known jobs: ${known.join(', ')}.` : ''}`,
      });
    }
    return job;
  }

  list(sessionId: string): BackgroundJob[] {
    return [...this.jobs.values()].filter((job) => job.sessionId === sessionId);
  }

  running(sessionId: string): BackgroundJob[] {
    return this.list(sessionId).filter((job) => job.state === 'running');
  }

  /** Kill a job and wait (bounded) until its process is gone. */
  async stop(job: BackgroundJob): Promise<void> {
    job.kill();
    await waitFor(() => (job.state === 'running' ? undefined : job.state), {
      wakeOn: [job.onChange],
      timeoutMs: SIGKILL_GRACE_MS + 2_000,
    });
  }

  /** Stop and forget every job a session started — its conversation is over. */
  async stopSession(sessionId: string): Promise<void> {
    const jobs = this.list(sessionId);
    await Promise.all(jobs.map((job) => this.stop(job)));
    for (const job of jobs) this.jobs.delete(job.id);
  }

  /** Detached process groups outlive their parent, so reap them when the host exits. */
  private installExitHook(): void {
    if (this.exitHookInstalled) return;
    this.exitHookInstalled = true;
    process.once('exit', () => {
      for (const job of this.jobs.values()) job.killNow();
    });
  }
}

export const backgroundJobs = new BackgroundJobs();
