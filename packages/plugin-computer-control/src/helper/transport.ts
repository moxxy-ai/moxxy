import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { JsonLineDecoder, MAX_FRAME_BYTES, controlCommandSchema, controlStateSchemaFor, responseSchemaFor } from './protocol.js';

/** A validated frame the helper emitted on its own (state changes, cursor moves, preview frames). */
export interface HelperEvent { readonly event: string; readonly [field: string]: unknown }

export interface HelperTransportOptions {
  readonly protocolVersion: number;
  readonly timeoutMs?: number;
  /** Schemas for uncorrelated events by name. `control_state` is built in; any other name fails closed. */
  readonly events?: Readonly<Record<string, z.ZodType<HelperEvent>>>;
  readonly onEvent?: (event: HelperEvent) => void;
}

const eventFrame = z.object({ event: z.string() }).passthrough();

interface Pending {
  id: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  dispose(): void;
  waiting(value: boolean): void;
}

/** One serial, non-retrying connection to a disposable native helper. */
export class HelperTransport {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly exited: Promise<void>;
  private pending: Pending | undefined;
  private stopped = false;
  private userStopped = false;
  private queue: Promise<unknown> = Promise.resolve();
  private stderrBytes = 0;
  get closed(): boolean { return this.stopped; }
  get stoppedByUser(): boolean { return this.userStopped; }

  private readonly version: number;
  private readonly timeoutMs: number;

  constructor(command: string, args: string[], options: HelperTransportOptions) {
    this.version = options.protocolVersion;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    const onEvent = options.onEvent ?? (() => undefined);
    const controlState = controlStateSchemaFor(this.version);
    const response = responseSchemaFor(this.version);
    this.child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.exited = new Promise((resolve) => this.child.once('close', () => resolve()));
    const decoder = new JsonLineDecoder(MAX_FRAME_BYTES);
    this.child.on('error', () => this.fail(new Error('Computer Use helper cannot start; reinstall the extension.')));
    this.child.stdin.on('error', () => this.fail(new Error('Computer Use pipe closed; action not retried.')));
    this.child.on('close', (code) => {
      if (code === 20) this.userStopped = true;
      this.fail(new Error(this.userStopped
        ? 'Computer Use stopped by user; action not retried.'
        : `Computer Use helper exited (${code}); action not retried.`));
    });
    this.child.stdout.on('data', (bytes: Buffer) => {
      try {
        for (const frame of decoder.push(bytes)) {
          const tagged = eventFrame.safeParse(frame);
          if (tagged.success && tagged.data.event === 'control_state') {
            const state = controlState.parse(frame);
            const pending = this.pending;
            if (!pending || state.id !== pending.id) throw new Error('Unmatched control state');
            pending.waiting(state.state === 'waiting_for_focus' || state.state === 'paused_by_user');
            onEvent(state);
            continue;
          }
          if (tagged.success) {
            const schema = options.events?.[tagged.data.event];
            if (!schema) throw new Error('Unregistered helper event');
            onEvent(schema.parse(frame));
            continue;
          }
          const reply = response.parse(frame);
          const pending = this.pending;
          if (!pending || pending.id !== reply.id) throw new Error('Unmatched response');
          this.pending = undefined;
          pending.dispose();
          if (reply.ok) pending.resolve(reply.result);
          else pending.reject(new Error(`${reply.error.code}: ${reply.error.message}`));
        }
      } catch {
        this.fail(new Error('Computer Use protocol mismatch or invalid response; update the extension. Action not retried.'));
      }
    });
    this.child.stdout.on('end', () => {
      try { decoder.finish(); } catch { this.fail(new Error('Computer Use incomplete response; action not retried.')); }
    });
    // Never echo native stderr: it can contain application text or secrets.
    this.child.stderr.on('data', (bytes: Buffer) => {
      this.stderrBytes += bytes.length;
      if (this.stderrBytes > 64_000) this.fail(new Error('Computer Use diagnostic output limit exceeded'));
    });
  }

  request(method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
    const next = this.queue.then(() => this.send(method, params, signal));
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Control uses the reader side of the helper, never its blocked request queue. */
  control(command: 'pause' | 'resume' | 'stop'): void {
    controlCommandSchema.parse(command);
    if (this.stopped) throw new Error('Computer Use connection closed');
    if (command === 'stop') {
      this.userStopped = true;
      this.fail(new Error('Computer Use stopped by user; action not retried.'));
      return;
    }
    this.child.stdin.write(JSON.stringify({version: this.version, control: command}) + '\n');
  }

  private send(method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
    if (this.stopped) return Promise.reject(new Error('Computer Use connection closed; observe again with a new connection.'));
    if (signal.aborted) return Promise.reject(new Error('Computer Use cancelled'));
    const id = randomUUID();
    const frame = JSON.stringify({ version: this.version, id, method, params }) + '\n';
    if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) return Promise.reject(new Error('Computer Use request limit exceeded'));
    return new Promise((resolve, reject) => {
      const abort = () => this.fail(new Error('Computer Use cancelled; action not retried.'));
      let remaining = this.timeoutMs;
      let started = performance.now();
      let waiting = false;
      const timeout = () => this.fail(new Error('Computer Use timed out; action not retried. Observe again.'));
      let timer = setTimeout(timeout, remaining);
      signal.addEventListener('abort', abort, { once: true });
      this.pending = { id, resolve, reject, waiting: (value) => {
        if (value === waiting) return;
        waiting = value;
        if (waiting) {
          clearTimeout(timer);
          remaining = Math.max(0, remaining - (performance.now() - started));
        } else {
          started = performance.now();
          timer = setTimeout(timeout, remaining);
        }
      }, dispose: () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      } };
      this.child.stdin.write(frame);
    });
  }

  private fail(error: Error): void {
    if (this.stopped) return;
    this.stopped = true;
    const pending = this.pending;
    this.pending = undefined;
    if (pending) { pending.dispose(); pending.reject(error); }
    // Closing stdin is the graceful shutdown signal (native watchdog releases input).
    this.child.stdin.end();
    const kill = setTimeout(() => this.child.kill('SIGKILL'), 500);
    kill.unref();
    void this.exited.then(() => clearTimeout(kill));
  }

  async close(): Promise<void> {
    this.fail(new Error('Computer Use connection closed'));
    await this.exited;
  }
}
