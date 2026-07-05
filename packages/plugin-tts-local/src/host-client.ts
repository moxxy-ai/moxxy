/**
 * Parent-side manager for the sherpa sidecar: lazy-spawn on first synthesize,
 * a correlated request/reply protocol over the fork IPC channel, restart-once
 * on a crash, and a clean shutdown. The `fork` itself is injectable (a
 * {@link ForkLike}) so tests drive the whole protocol against a fake child with
 * no real process.
 */

import { fork } from 'node:child_process';

import type { HostReply, HostRequest } from './host-protocol.js';

/** The minimal child-process surface the client drives — satisfied by a real
 *  `ChildProcess` and by a test fake. */
export interface ChildHandle {
  send(message: unknown): boolean;
  on(event: 'message', listener: (message: unknown) => void): this;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

/** Fork the sidecar with the given env overrides. Injectable for tests. */
export type ForkLike = (modulePath: string, env: NodeJS.ProcessEnv) => ChildHandle;

/** Default fork: advanced serialization (Float32Array round-trip), an IPC
 *  channel, and inherited std streams so sherpa's own diagnostics reach the
 *  runner log. `env` already carries the platform loader-path var. */
export const defaultFork: ForkLike = (modulePath, env) =>
  fork(modulePath, [], {
    serialization: 'advanced',
    env,
    execArgv: [],
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  }) as unknown as ChildHandle;

export interface HostClientOptions {
  /** Absolute path to the built sidecar (`dist/sidecar.js`). */
  readonly hostPath: string;
  /** Env the child is forked with (platform loader path merged over process.env). */
  readonly env: NodeJS.ProcessEnv;
  /** Injected fork (tests). Defaults to {@link defaultFork}. */
  readonly forkImpl?: ForkLike;
  /** Per-request deadline. Default 120s (a long read-aloud on CPU). */
  readonly requestTimeoutMs?: number;
  /** Optional diagnostic sink. */
  readonly log?: (msg: string) => void;
}

/** The slice of a host the synthesizer depends on — lets tests swap a fake. */
export interface HostClientLike {
  synthesize(
    req: Omit<HostRequest, 'id' | 'type'>,
  ): Promise<{ samples: Float32Array; sampleRate: number }>;
  shutdown(): void;
}

/** Raised when the sidecar dies with a request in flight; drives the one retry. */
export class HostCrashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostCrashError';
  }
}

interface Pending {
  readonly resolve: (r: { samples: Float32Array; sampleRate: number }) => void;
  readonly reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export class HostClient implements HostClientLike {
  private readonly hostPath: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly forkImpl: ForkLike;
  private readonly timeoutMs: number;
  private readonly log: (msg: string) => void;

  private child: ChildHandle | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private disposed = false;

  constructor(opts: HostClientOptions) {
    this.hostPath = opts.hostPath;
    this.env = opts.env;
    this.forkImpl = opts.forkImpl ?? defaultFork;
    this.timeoutMs = opts.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.log = opts.log ?? (() => {});
  }

  /** Synthesize, restarting the sidecar ONCE if it crashes mid-request. */
  async synthesize(
    req: Omit<HostRequest, 'id' | 'type'>,
  ): Promise<{ samples: Float32Array; sampleRate: number }> {
    try {
      return await this.send(req);
    } catch (err) {
      if (err instanceof HostCrashError && !this.disposed) {
        this.log(`tts-local: sherpa sidecar crashed (${err.message}) — restarting once`);
        return await this.send(req); // a second crash propagates
      }
      throw err;
    }
  }

  private send(
    req: Omit<HostRequest, 'id' | 'type'>,
  ): Promise<{ samples: Float32Array; sampleRate: number }> {
    if (this.disposed) return Promise.reject(new Error('tts-local host is shut down'));
    const child = this.ensureChild();
    const id = this.nextId++;
    const message: HostRequest = { ...req, id, type: 'synthesize' };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // A hung synthesis is unrecoverable for this child — reset it so the
        // next call starts fresh.
        this.killChild();
        reject(new Error(`tts-local synthesis timed out after ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      try {
        child.send(message);
      } catch (err) {
        this.settle(id, () =>
          reject(err instanceof Error ? err : new Error(String(err))),
        );
      }
    });
  }

  private ensureChild(): ChildHandle {
    if (this.child) return this.child;
    const child = this.forkImpl(this.hostPath, this.env);
    this.child = child;
    child.on('message', (msg: unknown) => this.onMessage(msg));
    child.on('exit', (code, signal) => this.onExit(code, signal));
    child.on('error', (err) => this.onError(err));
    return child;
  }

  private onMessage(msg: unknown): void {
    const reply = msg as HostReply;
    if (!reply || typeof reply !== 'object' || typeof reply.id !== 'number') return;
    const p = this.pending.get(reply.id);
    if (!p) return;
    this.settle(reply.id, () => {
      if (reply.ok) p.resolve({ samples: reply.samples, sampleRate: reply.sampleRate });
      else p.reject(new Error(`tts-local sidecar ${reply.error.kind} error: ${reply.error.message}`));
    });
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.child = null;
    if (this.pending.size === 0) return;
    const why = `sidecar exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`;
    this.rejectAll(new HostCrashError(why));
  }

  private onError(err: Error): void {
    this.child = null;
    this.rejectAll(new HostCrashError(`sidecar spawn/runtime error: ${err.message}`));
  }

  /** Resolve/reject one pending request, clearing its timer and map entry. */
  private settle(id: number, run: () => void): void {
    const p = this.pending.get(id);
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    this.pending.delete(id);
    run();
  }

  private rejectAll(err: Error): void {
    for (const [id, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      this.pending.delete(id);
      p.reject(err);
    }
  }

  private killChild(): void {
    const child = this.child;
    this.child = null;
    if (child) {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }

  /** Kill the sidecar and fail any in-flight requests. Idempotent. */
  shutdown(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rejectAll(new Error('tts-local host shut down'));
    this.killChild();
  }
}
