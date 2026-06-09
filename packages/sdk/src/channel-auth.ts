/**
 * Standard auth toolkit for channels — so a new channel gets consistent
 * connection auth without re-rolling token handling. The pieces:
 *
 *   - {@link resolveChannelToken} — the standard `channels.<name>` token
 *     resolution (env → config → a generated, persisted secret). Never empty.
 *   - {@link rotateChannelToken} — replace the persisted secret with a fresh
 *     one (pairing-token rotation; old tokens stop authenticating).
 *   - {@link bearerGuard} — a pre-connection handler: a constant-time bearer
 *     check a channel runs at its accept point (a WebSocket handshake, an HTTP
 *     request) before admitting a client.
 *   - {@link encodeWsBearerProtocol} / {@link tokenFromWsProtocolHeader} — the
 *     `Sec-WebSocket-Protocol` token convention for WebSocket clients that
 *     cannot set an `Authorization` header (browser / React Native), so the
 *     secret stays out of the URL (query strings leak via logs and QR/stdout).
 *
 * Channels that expose a network surface (mobile WS bridge, HTTP, web) should
 * resolve their token with the former and gate connections with the latter,
 * so the `channels.<name>.token` config + `MOXXY_<NAME>_TOKEN` env conventions
 * are uniform across every channel.
 */

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { moxxyHome } from './fs-utils.js';
import { bearerTokenMatches } from './http-utils.js';

export interface ChannelTokenOptions {
  /** Explicit token from channel config (`channels.<name>.token`). */
  readonly configured?: string;
  /** Env var checked first, e.g. `MOXXY_MOBILE_TOKEN`. */
  readonly envVar?: string;
  /** File to persist a generated token, e.g. `mobile-token`. */
  readonly fileName: string;
  /** Directory the token file lives under. Defaults to the moxxy home dir;
   *  the desktop bridge passes its Electron `userData` dir here instead. */
  readonly dir?: string;
  /** Receives the stale-token warning (default: `console.warn`). */
  readonly warn?: (msg: string) => void;
}

/** Persisted tokens older than this trigger a rotation warning (soft only —
 *  silently breaking an existing pairing is worse than an old secret). */
const STALE_TOKEN_MS = 90 * 24 * 60 * 60 * 1000;

interface PersistedToken {
  readonly token: string;
  /** Epoch ms the token was created, when known (null for ageless reads). */
  readonly createdAtMs: number | null;
}

function tokenFilePath(opts: Pick<ChannelTokenOptions, 'dir' | 'fileName'>): string {
  return path.join(opts.dir ?? moxxyHome(), opts.fileName);
}

/** Read a persisted token. New files are JSON `{ token, createdAt }`; legacy
 *  files are the bare token (age falls back to the file mtime, best-effort). */
function readTokenFile(file: string): PersistedToken | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null; // not yet created
  }
  if (!raw) return null;
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as { token?: unknown; createdAt?: unknown };
      if (typeof parsed.token !== 'string' || !parsed.token) return null;
      const created = typeof parsed.createdAt === 'string' ? Date.parse(parsed.createdAt) : NaN;
      return { token: parsed.token, createdAtMs: Number.isFinite(created) ? created : null };
    } catch {
      return null; // corrupt — regenerate
    }
  }
  let createdAtMs: number | null = null;
  try {
    createdAtMs = fs.statSync(file).mtimeMs;
  } catch {
    // age unknown
  }
  return { token: raw, createdAtMs };
}

function writeTokenFile(file: string, token: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ token, createdAt: new Date().toISOString() })}\n`, {
    mode: 0o600,
  });
}

/**
 * Resolve a channel's auth token. Precedence: `envVar` → `configured` → a
 * 256-bit secret generated once and persisted (0600, JSON with a `createdAt`)
 * under `dir` (default: the moxxy home). Never returns an empty string — a
 * network-reachable channel must always be authenticated.
 *
 * A persisted token older than ~90 days logs a rotation hint (via `warn`);
 * there is no hard expiry, because silently breaking a pairing is worse.
 */
export function resolveChannelToken(opts: ChannelTokenOptions): string {
  const fromEnv = (opts.envVar ? process.env[opts.envVar] : undefined)?.trim();
  if (fromEnv) return fromEnv;
  if (opts.configured && opts.configured.trim()) return opts.configured.trim();

  const file = tokenFilePath(opts);
  const existing = readTokenFile(file);
  if (existing) {
    if (existing.createdAtMs !== null && Date.now() - existing.createdAtMs > STALE_TOKEN_MS) {
      const days = Math.floor((Date.now() - existing.createdAtMs) / (24 * 60 * 60 * 1000));
      (opts.warn ?? console.warn)(
        `[moxxy] channel token at ${file} is ${days} days old — consider rotating it ` +
          `(rotateChannelToken / delete the file to regenerate; clients must re-pair).`,
      );
    }
    return existing.token;
  }
  return rotateChannelToken(opts);
}

/**
 * Rotate the PERSISTED channel token: generate a fresh 256-bit secret, rewrite
 * the token file (old token stops authenticating new connections), and return
 * it. Callers that hold a live server must also re-key it and drop existing
 * connections (the WS bridge exposes `rotateAuthToken` for exactly this).
 *
 * Note: only the file-persisted token rotates — a token supplied via `envVar`
 * or channel config takes precedence at resolve time and must be rotated at
 * its source.
 */
export function rotateChannelToken(opts: Pick<ChannelTokenOptions, 'dir' | 'fileName'>): string {
  const token = randomBytes(32).toString('hex');
  writeTokenFile(tokenFilePath(opts), token);
  return token;
}

/**
 * A pre-connection auth handler: returns a guard that constant-time-compares a
 * presented bearer token against `expected`. An empty `expected` always denies
 * (never accidentally run an open surface).
 */
export function bearerGuard(expected: string): (presented: string | undefined | null) => boolean {
  return (presented) => (expected ? bearerTokenMatches(presented, expected) : false);
}

/** The moxxy WS application subprotocol a client requests (and the server
 *  selects) when it also smuggles its bearer token as a protocol entry. */
export const MOXXY_WS_SUBPROTOCOL = 'moxxy.v1';

/** Prefix of the `Sec-WebSocket-Protocol` entry that carries the bearer token:
 *  `moxxy.bearer.<rfc3986-strict-percent-encoded token>`. Percent-encoding
 *  keeps every output character a valid HTTP token char. */
export const MOXXY_WS_BEARER_PROTOCOL_PREFIX = 'moxxy.bearer.';

/** Encode a bearer token as the WS subprotocol entry a header-less WebSocket
 *  client (browser / React Native) sends alongside {@link MOXXY_WS_SUBPROTOCOL}. */
export function encodeWsBearerProtocol(token: string): string {
  const strict = encodeURIComponent(token).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${MOXXY_WS_BEARER_PROTOCOL_PREFIX}${strict}`;
}

/** Extract the bearer token from a `Sec-WebSocket-Protocol` request header
 *  (comma-separated offer list), or null when no bearer entry is present. */
export function tokenFromWsProtocolHeader(header: string | undefined): string | null {
  if (!header) return null;
  for (const entry of header.split(',')) {
    const candidate = entry.trim();
    if (!candidate.startsWith(MOXXY_WS_BEARER_PROTOCOL_PREFIX)) continue;
    try {
      return decodeURIComponent(candidate.slice(MOXXY_WS_BEARER_PROTOCOL_PREFIX.length));
    } catch {
      return null; // malformed escape — treat as unauthenticated
    }
  }
  return null;
}
