/**
 * Standard auth toolkit for channels — so a new channel gets consistent
 * connection auth without re-rolling token handling. Two pieces:
 *
 *   - {@link resolveChannelToken} — the standard `channels.<name>` token
 *     resolution (env → config → a generated, persisted secret). Never empty.
 *   - {@link bearerGuard} — a pre-connection handler: a constant-time bearer
 *     check a channel runs at its accept point (a WebSocket handshake, an HTTP
 *     request) before admitting a client.
 *
 * Channels that expose a network surface (mobile WS bridge, HTTP, web) should
 * resolve their token with the former and gate connections with the latter,
 * so the `channels.<name>.token` config + `MOXXY_<NAME>_TOKEN` env conventions
 * are uniform across every channel.
 */

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { bearerTokenMatches } from './http-utils.js';

export interface ChannelTokenOptions {
  /** Explicit token from channel config (`channels.<name>.token`). */
  readonly configured?: string;
  /** Env var checked first, e.g. `MOXXY_MOBILE_TOKEN`. */
  readonly envVar?: string;
  /** File (under the moxxy home dir) to persist a generated token, e.g. `mobile-token`. */
  readonly fileName: string;
}

function moxxyHome(): string {
  return process.env.MOXXY_HOME?.trim() || path.join(os.homedir(), '.moxxy');
}

/**
 * Resolve a channel's auth token. Precedence: `envVar` → `configured` → a
 * 256-bit secret generated once and persisted (0600) under the moxxy home, so
 * the same pairing secret survives restarts. Never returns an empty string —
 * a network-reachable channel must always be authenticated.
 */
export function resolveChannelToken(opts: ChannelTokenOptions): string {
  const fromEnv = (opts.envVar ? process.env[opts.envVar] : undefined)?.trim();
  if (fromEnv) return fromEnv;
  if (opts.configured && opts.configured.trim()) return opts.configured.trim();

  const file = path.join(moxxyHome(), opts.fileName);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // not yet created
  }
  const token = randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, token, { mode: 0o600 });
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
