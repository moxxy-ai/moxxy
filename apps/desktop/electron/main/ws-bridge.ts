/**
 * Optional WebSocket bridge config for the desktop main.
 *
 * The bridge exposes the SAME IPC contract the renderer uses to a remote client
 * (the mobile app), so it's OFF by default and gated behind `MOXXY_WS_BRIDGE=1`.
 * It is always token-authenticated: an explicit `MOXXY_WS_TOKEN` wins, otherwise
 * a 256-bit token is generated once and persisted (0600) under userData so the
 * same pairing secret survives restarts. Bind address defaults to loopback;
 * `MOXXY_WS_HOST=0.0.0.0` opts into LAN exposure (still token-gated).
 */

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { WebSocketBridgeOptions } from '@moxxy/ipc-server-ws';

const DEFAULT_PORT = 8765;
const TOKEN_FILE = 'ws-token';

function loadOrCreateToken(userDataDir: string): string {
  const file = path.join(userDataDir, TOKEN_FILE);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // not yet created
  }
  const token = randomBytes(32).toString('hex');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(file, token, { mode: 0o600 });
  return token;
}

/**
 * Returns the bridge options when enabled, or `null` when the bridge is off.
 * Resolving this does NOT start a server — the caller registers handlers onto a
 * `WebSocketCommandBus` first, then starts the server with these options.
 */
export function resolveWsBridgeConfig(userDataDir: string): WebSocketBridgeOptions | null {
  if (process.env.MOXXY_WS_BRIDGE !== '1') return null;
  const token = process.env.MOXXY_WS_TOKEN?.trim() || loadOrCreateToken(userDataDir);
  const port = Number(process.env.MOXXY_WS_PORT ?? DEFAULT_PORT);
  return {
    port: Number.isFinite(port) ? port : DEFAULT_PORT,
    authToken: token,
    ...(process.env.MOXXY_WS_HOST ? { host: process.env.MOXXY_WS_HOST } : {}),
  };
}
