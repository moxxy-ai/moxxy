import { connect, type Socket } from 'node:net';

/**
 * Client for the desktop's browser bridge.
 *
 * When moxxy runs inside the desktop, the page the user is watching lives in
 * that app's process, not here. Driving our own Playwright browser instead
 * would mean the agent and the human are looking at two different documents —
 * so when the desktop offers a bridge, the tools go through it.
 *
 * The wire format is the sidecar's, deliberately: same request shape, same
 * reply shape, same method names. That is what lets one set of tools serve
 * either backend without knowing which one answered.
 */

/** Environment the desktop sets on the runner it spawns. */
export const BRIDGE_SOCKET_ENV = 'MOXXY_BROWSER_BRIDGE_SOCKET';
export const BRIDGE_TOKEN_ENV = 'MOXXY_BROWSER_BRIDGE_TOKEN';

/** Per-call ceiling, mirroring the sidecar's — a wedged page must not hang a turn. */
const CALL_TIMEOUT_MS = 150_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface BridgeAddress {
  readonly socketPath: string;
  readonly token: string;
}

/** Read the bridge address from the environment, or null when absent. */
export function bridgeAddressFromEnv(env: NodeJS.ProcessEnv = process.env): BridgeAddress | null {
  const socketPath = env[BRIDGE_SOCKET_ENV];
  const token = env[BRIDGE_TOKEN_ENV];
  if (!socketPath || !token) return null;
  return { socketPath, token };
}

export class BridgeClient {
  private socket: Socket | null = null;
  private connecting: Promise<void> | null = null;
  private buf = '';
  private seq = 0;
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly address: BridgeAddress) {}

  private async ensure(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = connect(this.address.socketPath);
      socket.setEncoding('utf8');
      socket.once('error', (err) => {
        this.connecting = null;
        reject(err);
      });
      socket.once('connect', () => {
        this.socket = socket;
        socket.on('data', (chunk: string) => this.onData(chunk));
        socket.on('close', () => this.onClose());
        // Present the token before anything else; the bridge hangs up on a
        // client that skips it.
        this.rawSend('hello', { token: this.address.token }).then(
          () => {
            this.connecting = null;
            resolve();
          },
          (err: Error) => {
            this.connecting = null;
            reject(err);
          },
        );
      });
    });
    return this.connecting;
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (!line.trim()) continue;
      let reply: { id?: string; ok?: boolean; result?: unknown; error?: { message?: string } };
      try {
        reply = JSON.parse(line) as typeof reply;
      } catch {
        continue;
      }
      const entry = this.pending.get(String(reply.id));
      if (!entry) continue;
      this.pending.delete(String(reply.id));
      clearTimeout(entry.timer);
      if (reply.ok) entry.resolve(reply.result);
      else entry.reject(new Error(reply.error?.message ?? 'browser bridge call failed'));
    }
  }

  /** The desktop went away mid-flight: fail everything rather than hang. */
  private onClose(): void {
    this.socket = null;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('browser bridge closed'));
    }
    this.pending.clear();
  }

  private rawSend(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.destroyed) return Promise.reject(new Error('browser bridge is not connected'));
    const id = `c${++this.seq}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`browser bridge call timed out after ${CALL_TIMEOUT_MS}ms: ${method}`));
      }, CALL_TIMEOUT_MS);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });

      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new Error('aborted'));
          return;
        }
        // Per-call abort: drops THIS request, leaves the connection and any
        // concurrent calls alone.
        signal.addEventListener(
          'abort',
          () => {
            const entry = this.pending.get(id);
            if (!entry) return;
            this.pending.delete(id);
            clearTimeout(entry.timer);
            entry.reject(new Error('aborted'));
          },
          { once: true },
        );
      }
      socket.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  async call(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<unknown> {
    await this.ensure();
    return this.rawSend(method, params, signal);
  }

  close(): void {
    this.socket?.destroy();
    this.socket = null;
  }
}
