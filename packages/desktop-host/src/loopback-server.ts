/**
 * A tiny, hardened static file server bound to loopback (127.0.0.1) that
 * serves the packaged renderer's `dist/` over `http://127.0.0.1:<port>`
 * instead of `file://`.
 *
 * WHY this exists: the Clerk web SDK (and OAuth in general) refuses a
 * `file://` origin — clerk-js derives its OAuth redirect from
 * `window.location`, and Clerk rejects the `file://` scheme
 * (`prohibited_redirect_url`). A loopback `http://127.0.0.1` origin is a
 * Chromium *secure context* (so `crypto.subtle` etc. work without TLS) and
 * an allowed redirect scheme, which makes the prebuilt `clerk.openSignIn()`
 * modal + OAuth popup behave exactly as they do on the web. Serving the
 * renderer this way is the no-backend, ecosystem-standard fix for desktop
 * Clerk auth.
 *
 * Threat model: the only legitimate client is our own renderer (and the
 * OAuth popup), both on the same machine. The server is reachable by any
 * local process and — via DNS-rebinding — potentially by a remote page that
 * resolves a hostname to 127.0.0.1. So the handler is deliberately strict:
 * loopback bind only, GET/HEAD only, a Host-header allow-list (rebind
 * defense), and a hard path-traversal containment check so nothing outside
 * the served `dist/` can ever be read. It serves static bytes only — there
 * is no dynamic surface to exploit.
 *
 * Kept free of any `electron` import so it stays unit-testable in plain Node
 * (mirrors {@link ./security.ts}).
 */

import { createReadStream, promises as fsp, realpathSync } from 'node:fs';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import path from 'node:path';

export interface LoopbackServer {
  /** Origin to load + allow-list in Clerk, e.g. `http://127.0.0.1:51789`. */
  readonly origin: string;
  /** The bound port. */
  readonly port: number;
  /** Build a full URL under the served root, e.g. `url('index.html')`. */
  url(pathname: string): string;
  /** Idempotent graceful shutdown; resolves once sockets drain or a short
   *  grace elapses (keep-alive sockets otherwise wedge `server.close()`). */
  close(): Promise<void>;
}

export interface LoopbackServerOptions {
  /** Absolute path to the `dist/` root to serve (the active bundle's
   *  renderer). Resolved + canonicalised once; nothing outside it is served. */
  readonly root: string;
  /** Ordered candidate ports; the first that binds wins. Each must be
   *  allow-listed in Clerk (origins are exact-match incl. port), so keep the
   *  list short and stable. */
  readonly ports?: readonly number[];
  /** SPA entry served for extensionless / unknown routes (so the OAuth
   *  callback route renders the app). Defaults to `index.html`. */
  readonly spaIndex?: string;
}

/** Default loopback ports. High, unprivileged, and unlikely to collide; the
 *  whole list is load-bearing — every entry must be allow-listed in Clerk. */
export const DEFAULT_LOOPBACK_PORTS = [51789, 51790, 51791, 51792] as const;

/** extension → MIME. Deliberately small + explicit (no third-party `mime`
 *  dependency); unknown extensions fall back to octet-stream. */
const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

function contentType(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Reject any request whose `Host` isn't a loopback name on the bound port.
 * This is the DNS-rebinding defense: a remote page that resolves
 * `evil.example` → 127.0.0.1 still sends `Host: evil.example`, so it never
 * matches. Our own renderer always sends `127.0.0.1:<port>`; `localhost` is
 * accepted too since Clerk dashboards conventionally list it.
 */
function hostAllowed(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const expected = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  return expected.has(host);
}

/**
 * Map a request pathname to a concrete file under `root`, or `null` to fall
 * through to the SPA index. Returns `false` when the path escapes `root`
 * (caller answers 403) — the containment check is the security boundary.
 */
async function resolveFile(
  root: string,
  pathname: string,
  spaIndex: string,
): Promise<string | null | false> {
  // Decode + reject NUL (a classic truncation trick) before touching disk.
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (decoded.includes('\0')) return false;

  // Resolve against root and CONFIRM containment. `path.resolve` collapses
  // `..` / absolute segments, so the only thing that can sit under `root`
  // is a legitimate descendant — anything else (`../`, `/etc/...`,
  // encoded traversal) resolves outside and is refused.
  const candidate = path.resolve(root, '.' + (decoded.startsWith('/') ? decoded : '/' + decoded));
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return false;

  const existing = await statFileOrNull(candidate);
  if (existing === 'file') {
    // Symlink-escape insurance: canonicalise and re-check containment. This is
    // belt-and-braces on top of the lexical containment check above (which is
    // the actual security boundary); the packaged dist/ has no symlinks. If
    // realpath isn't available (e.g. an asar virtual path on the floor),
    // proceed on the already-validated lexical path rather than failing closed
    // — failing closed would 403 every file served from inside the asar.
    try {
      const real = realpathSync(candidate);
      if (real !== root && !real.startsWith(root + path.sep)) return false;
    } catch {
      /* realpath unavailable — trust the lexical containment check above */
    }
    return candidate;
  }

  // Not a file (missing, or a directory). An asset-like path — one with a
  // file extension, e.g. `/assets/index-abc.js` — that doesn't exist is a
  // genuine 404 (`null`); masking it behind index.html would yield confusing
  // HTML-where-JS-expected MIME errors. Extensionless routes (`/`,
  // `/sso-callback`) are SPA routes → serve the index.
  if (path.extname(decoded) !== '') return null;
  return path.join(root, spaIndex);
}

async function statFileOrNull(p: string): Promise<'file' | 'dir' | null> {
  try {
    const st = await fsp.stat(p);
    return st.isFile() ? 'file' : 'dir';
  } catch {
    return null;
  }
}

export async function startLoopbackServer(opts: LoopbackServerOptions): Promise<LoopbackServer> {
  // Canonicalise the root up front so the per-request realpath containment
  // check compares like-for-like. Without this, a root under a symlinked
  // prefix (e.g. macOS `/var` → `/private/var`) fails its OWN containment
  // check and 403s every real file.
  const resolvedRoot = path.resolve(opts.root);
  let root: string;
  try {
    root = realpathSync(resolvedRoot);
  } catch {
    root = resolvedRoot;
  }
  const spaIndex = opts.spaIndex ?? 'index.html';
  const ports = opts.ports && opts.ports.length ? opts.ports : DEFAULT_LOOPBACK_PORTS;

  const sockets = new Set<Socket>();

  const server: Server = createServer((req, res) => {
    void handle(req, res, root, spaIndex, boundPort).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  let boundPort = 0;
  for (const port of ports) {
    try {
      await listen(server, port);
      // Read the ACTUAL bound port from the socket — this is the source of
      // truth (and resolves `0`, which the OS expands to a free port, used
      // by tests).
      const addr = server.address();
      boundPort = typeof addr === 'object' && addr ? addr.port : port;
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') continue;
      throw err; // a non-collision listen error is fatal
    }
  }
  if (!boundPort) {
    throw new Error(`loopback server: all candidate ports in use (${ports.join(', ')})`);
  }

  const origin = `http://127.0.0.1:${boundPort}`;
  let closePromise: Promise<void> | null = null;

  return {
    origin,
    port: boundPort,
    url(pathname: string): string {
      return `${origin}/${pathname.replace(/^\/+/, '')}`;
    },
    close(): Promise<void> {
      if (closePromise) return closePromise;
      closePromise = new Promise<void>((resolve) => {
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          resolve();
        };
        server.close(() => finish());
        // Idle keep-alive sockets keep `server.close()` pending forever;
        // destroy them after a short grace, then resolve regardless.
        const t = setTimeout(() => {
          for (const s of sockets) s.destroy();
          finish();
        }, 300);
        t.unref();
      });
      return closePromise;
    },
  };
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    // Bind loopback ONLY — never 0.0.0.0. The server must not be reachable
    // off-box.
    server.listen(port, '127.0.0.1');
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
  spaIndex: string,
  port: number,
): Promise<void> {
  // Only ever serve safe, read-only methods.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  // DNS-rebinding defense.
  if (!hostAllowed(req.headers.host, port)) {
    res.writeHead(403);
    res.end();
    return;
  }

  const pathname = new URL(req.url ?? '/', `http://127.0.0.1:${port}`).pathname;
  const resolved = await resolveFile(root, pathname, spaIndex);
  if (resolved === false) {
    res.writeHead(403);
    res.end();
    return;
  }

  // resolveFile returned null → an asset-like miss (genuine 404).
  const filePath = resolved ?? null;
  if (filePath === null) {
    res.writeHead(404);
    res.end();
    return;
  }

  let size: number;
  try {
    size = (await fsp.stat(filePath)).size;
  } catch {
    res.writeHead(404);
    res.end();
    return;
  }

  // Fingerprinted assets are immutable; HTML must never be cached so a
  // hot-updated bundle's fresh index.html is always picked up.
  const cacheControl = pathname.startsWith('/assets/')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
  const headers: Record<string, string> = {
    'Content-Type': contentType(filePath),
    'Content-Length': String(size),
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
  };

  if (req.method === 'HEAD') {
    res.writeHead(200, headers);
    res.end();
    return;
  }

  res.writeHead(200, headers);
  createReadStream(filePath)
    .on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    })
    .pipe(res);
}
