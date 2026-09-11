import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { JsonLineDecoder } from './protocol.js';
import { MAX_FRAME_BYTES, PROTOCOL_VERSION, responseSchema, controlStateSchema, type ControlState } from './contracts.js';

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
  private queue: Promise<unknown> = Promise.resolve();
  private stderrBytes = 0;
  get closed(): boolean { return this.stopped; }

  constructor(command: string, args: string[], private readonly timeoutMs = 15_000,
    private readonly onState: (state: ControlState) => void = () => undefined) {
    this.child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.exited = new Promise((resolve) => this.child.once('close', () => resolve()));
    const decoder = new JsonLineDecoder(MAX_FRAME_BYTES);
    this.child.on('error', () => this.fail(new Error('Computer Use helper cannot start; reinstall the extension.')));
    this.child.stdin.on('error', () => this.fail(new Error('Computer Use pipe closed; action not retried.')));
    this.child.on('close', (code) => this.fail(new Error(`Computer Use helper exited (${code}); action not retried.`)));
    this.child.stdout.on('data', (bytes: Buffer) => {
      try {
        for (const frame of decoder.push(bytes)) {
          const event = controlStateSchema.safeParse(frame);
          if (event.success) {
            const pending = this.pending;
            if (!pending || event.data.id !== pending.id) throw new Error('Unmatched control state');
            pending.waiting(event.data.state === 'waiting_for_focus' || event.data.state === 'paused_by_user');
            this.onState(event.data);
            continue;
          }
          const response = responseSchema.parse(frame);
          const pending = this.pending;
          if (!pending || pending.id !== response.id) throw new Error('Unmatched response');
          this.pending = undefined;
          pending.dispose();
          if (response.ok) pending.resolve(response.result);
          else pending.reject(new Error(`${response.error.code}: ${response.error.message}`));
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

  private send(method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
    if (this.stopped) return Promise.reject(new Error('Computer Use connection closed; observe again with a new connection.'));
    if (signal.aborted) return Promise.reject(new Error('Computer Use cancelled'));
    const id = randomUUID();
    const frame = JSON.stringify({ version: PROTOCOL_VERSION, id, method, params }) + '\n';
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
