import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import type { Transport, TransportServer } from './transport.js';
import { isRunnerUp } from './socket-path.js';

/** Minimal logging surface the transport needs (structurally matches
 *  `@moxxy/core`'s `Logger`, so `session.logger` plugs straight in). */
export interface SocketLogger {
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

const stderrLogger: SocketLogger = {
  warn: (msg, meta) => process.stderr.write(`[moxxy-runner] WARN ${msg} ${meta ? JSON.stringify(meta) : ''}\n`),
  error: (msg, meta) => process.stderr.write(`[moxxy-runner] ERROR ${msg} ${meta ? JSON.stringify(meta) : ''}\n`),
};

/**
 * NDJSON framing over a single `net.Socket`: one JSON value per line. Safe
 * because `JSON.stringify` never emits a raw newline, so `\n` is an
 * unambiguous frame delimiter. Sockets are set to UTF-8 so base64 attachment
 * payloads ride through as text intact.
 */
class NdjsonTransport implements Transport {
  private buffer = '';
  private frameHandler: ((frame: unknown) => void) | undefined;
  private closeHandler: ((err?: Error) => void) | undefined;
  private closedEmitted = false;

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.onData(chunk));
    socket.on('close', () => this.emitClose());
    socket.on('error', (err) => this.emitClose(err));
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    // Walk frame boundaries with a cursor and slice the unconsumed remainder
    // exactly once at the end. Re-slicing the buffer per frame is O(k·L) when a
    // single chunk carries k frames (each slice copies the whole remainder); a
    // cursor keeps the per-chunk cost O(L).
    let start = 0;
    let newline = this.buffer.indexOf('\n', start);
    while (newline >= 0) {
      const line = this.buffer.slice(start, newline);
      start = newline + 1;
      if (line.trim().length > 0) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          // Drop malformed frames rather than tearing the link down.
          parsed = undefined;
        }
        if (parsed !== undefined) this.frameHandler?.(parsed);
      }
      newline = this.buffer.indexOf('\n', start);
    }
    this.buffer = start > 0 ? this.buffer.slice(start) : this.buffer;
  }

  private emitClose(err?: Error): void {
    if (this.closedEmitted) return;
    this.closedEmitted = true;
    this.closeHandler?.(err);
  }

  send(frame: unknown): void {
    if (this.socket.destroyed) return;
    this.socket.write(`${JSON.stringify(frame)}\n`);
  }

  onFrame(handler: (frame: unknown) => void): void {
    this.frameHandler = handler;
  }

  onClose(handler: (err?: Error) => void): void {
    this.closeHandler = handler;
  }

  close(): void {
    this.socket.end();
  }
}

/**
 * Listen on a local socket (unix domain socket, or named pipe on Windows).
 *
 * Stale-socket recovery: a crashed runner leaves the socket file behind on
 * unix. We probe it - if nothing answers (`ECONNREFUSED`), it's stale and we
 * unlink before binding. If something *does* answer, the address is genuinely
 * in use and we surface `EADDRINUSE`. Named pipes self-clean, so this only
 * runs on non-Windows.
 */
export async function createUnixSocketServer(
  socketPath: string,
  logger: SocketLogger = stderrLogger,
): Promise<TransportServer> {
  if (process.platform !== 'win32') {
    await reclaimStaleSocket(socketPath);
    // Secure the parent directory to 0700 BEFORE binding. The socket inherits
    // the umask at bind time and is only chmod'd 0600 after `listen` returns,
    // so without this there is a window where another local user could connect
    // to a world-accessible socket. A 0700 parent closes that window
    // structurally: the socket is unreachable by other users from birth,
    // regardless of chmod timing. (The path LAYOUT is owned by the callers -
    // desktop-host hardcodes ~/.moxxy/serve.sock and
    // ~/.moxxy/desktop/sockets/serve-<id>.sock - so we tighten the existing
    // dirs in place rather than moving the socket.)
    secureSocketDir(path.dirname(socketPath), logger);
  } else {
    // Windows named pipes get NO explicit ACL here (Node's `net` cannot set a
    // SECURITY_ATTRIBUTES DACL). The default DACL on a named pipe grants full
    // control to the creating user, SYSTEM and Administrators, while Everyone
    // and the anonymous logon get READ access only - so a foreign non-admin
    // local user cannot WRITE (i.e. cannot issue JSON-RPC requests), but the
    // pipe namespace (`\\.\pipe\`) is machine-global, not session-scoped, and
    // we are relying on that default rather than enforcing an explicit ACL.
    warnWindowsPipeAclOnce(logger, socketPath);
  }

  // Single connection handler, last-write-wins — consistent with this file's
  // Transport.onFrame/onClose (also single-handler) and the TransportServer
  // contract (RunnerServer registers exactly one). An array would imply a
  // fan-out semantic nothing supports: two consumers would each wrap every
  // accepted socket in its own JsonRpcPeer.
  let connectionHandler: ((t: Transport) => void) | undefined;
  const server = net.createServer((socket) => {
    const transport = new NdjsonTransport(socket);
    connectionHandler?.(transport);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  // Restrict the socket itself to the owning user. Belt-and-braces: the 0700
  // parent dir (above) is what actually prevents cross-user access; this just
  // tightens the socket node too. No-op on Windows (named pipes, see above).
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(socketPath, 0o600);
    } catch (err) {
      // Some filesystems reject chmod on sockets - the 0700 parent dir still
      // protects the socket, but say so LOUDLY instead of swallowing it.
      logger.error('failed to chmod runner socket to 0600', {
        socketPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    address: socketPath,
    onConnection(handler) {
      connectionHandler = handler;
    },
    close() {
      return new Promise<void>((resolve) => {
        server.close(() => {
          if (process.platform !== 'win32') {
            try {
              fs.unlinkSync(socketPath);
            } catch {
              // already gone
            }
          }
          resolve();
        });
      });
    },
  };
}

/**
 * Default bound for a single connect attempt. A half-open named pipe, or a
 * unix socket whose server is bound but not accepting, can leave `net.connect`
 * emitting neither `'connect'` nor `'error'` — without this the returned
 * Promise would hang forever and strand `connectWithRetry`'s whole loop (no
 * backoff fires because the prior attempt never settled).
 */
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

/** Connect to a runner's socket, returning a {@link Transport} once open. */
export function connectUnixSocket(
  socketPath: string,
  opts: { timeoutMs?: number } = {},
): Promise<Transport> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  return new Promise<Transport>((resolve, reject) => {
    const socket = net.connect(socketPath);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Destroying with an error also fires 'error' on some platforms; the
      // `settled` guard makes the reject idempotent either way.
      socket.destroy(new Error(`connect timeout after ${timeoutMs}ms: ${socketPath}`));
      reject(new Error(`connect timeout after ${timeoutMs}ms: ${socketPath}`));
    }, timeoutMs);
    const onError = (err: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    };
    socket.once('error', onError);
    socket.once('connect', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener('error', onError);
      resolve(new NdjsonTransport(socket));
    });
  });
}

/**
 * Make the socket's parent directory private (0700) before the socket is
 * created inside it. A freshly created dir is born 0700 (no chmod race at
 * all); a pre-existing dir we own is tightened in place - still before
 * `listen`, so the socket is never reachable by other users. Failures are
 * loud: a socket dir we cannot secure is a real security signal, not noise.
 */
function secureSocketDir(dir: string, logger: SocketLogger): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    const st = fs.statSync(dir);
    if ((st.mode & 0o077) === 0) return; // already private
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
      // A shared dir we don't own (e.g. /tmp in tests): chmod would fail with
      // EPERM. The post-listen chmod 0600 of the socket itself is the only
      // protection there - flag it rather than pretend it's secured.
      logger.warn(
        'runner socket directory is accessible to other users and not owned by this process; cannot tighten to 0700',
        { dir },
      );
      return;
    }
    fs.chmodSync(dir, 0o700);
  } catch (err) {
    logger.error('failed to restrict runner socket directory to 0700', {
      dir,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

let warnedWindowsPipeAcl = false;

/** One-time honesty log for the documented win32 gap (see the listen site). */
function warnWindowsPipeAclOnce(logger: SocketLogger, pipePath: string): void {
  if (warnedWindowsPipeAcl) return;
  warnedWindowsPipeAcl = true;
  logger.warn(
    'runner named pipe relies on the Windows default DACL (creator/SYSTEM/Administrators: full control; Everyone: read-only) - no explicit ACL is applied',
    { pipePath },
  );
}

async function reclaimStaleSocket(socketPath: string): Promise<void> {
  if (!fs.existsSync(socketPath)) return;
  // Reuse the canonical liveness probe (isRunnerUp) so the "is something
  // answering this address" definition lives in exactly one place.
  const alive = await isRunnerUp(socketPath);
  if (!alive) {
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // racing another reclaimer - fine
    }
  }
}
