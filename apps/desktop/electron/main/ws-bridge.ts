/**
 * Optional WebSocket bridge config for the desktop main.
 *
 * The bridge exposes the SAME IPC contract the renderer uses to a remote client
 * (the mobile app), so it's OFF by default and gated behind `MOXXY_WS_BRIDGE=1`.
 * It is always token-authenticated via the SDK's shared channel-auth helper: an
 * explicit `MOXXY_WS_TOKEN` wins, otherwise a 256-bit token is generated once
 * and persisted (0600) under userData so the same pairing secret survives
 * restarts. Bind address defaults to loopback; `MOXXY_WS_HOST=0.0.0.0` opts
 * into LAN exposure (still token-gated).
 *
 * Hardening defaults (see `WebSocketBridgeOptions`): browser-Origin upgrades
 * are rejected, the legacy `?t=` query credential is off (clients present the
 * token via header/subprotocol; `MOXXY_WS_ALLOW_QUERY_TOKEN=1` re-enables it
 * for legacy clients), and connection-cap/backpressure limits apply.
 */

import path from 'node:path';

import { resolveChannelToken, rotateChannelToken } from '@moxxy/sdk';
import type { WebSocketBridgeOptions, WebSocketBridgeServer } from '@moxxy/ipc-server-ws';

const DEFAULT_PORT = 8765;
const TOKEN_FILE = 'ws-token';

/**
 * Returns the bridge options when enabled, or `null` when the bridge is off.
 * Resolving this does NOT start a server — the caller registers handlers onto a
 * `WebSocketCommandBus` first, then starts the server with these options.
 */
export function resolveWsBridgeConfig(userDataDir: string): WebSocketBridgeOptions | null {
  if (process.env.MOXXY_WS_BRIDGE !== '1') return null;
  const token = resolveChannelToken({
    envVar: 'MOXXY_WS_TOKEN',
    fileName: TOKEN_FILE,
    dir: userDataDir,
  });
  // An empty/whitespace MOXXY_WS_PORT means "unset" — Number('') is 0, which
  // would silently bind an ephemeral port nobody knows about.
  const rawPort = process.env.MOXXY_WS_PORT?.trim();
  const port = rawPort ? Number(rawPort) : DEFAULT_PORT;
  return {
    port: Number.isFinite(port) ? port : DEFAULT_PORT,
    authToken: token,
    ...(process.env.MOXXY_WS_HOST ? { host: process.env.MOXXY_WS_HOST } : {}),
    ...(process.env.MOXXY_WS_ALLOW_QUERY_TOKEN === '1' ? { allowQueryToken: true } : {}),
  };
}

/**
 * Rotate the bridge's pairing token: persist a fresh secret to the userData
 * token file and (when the bridge is running) re-key the live server, which
 * terminates every existing connection — a leaked token/QR stops working
 * immediately. Returns the new token so the host can re-display pairing info.
 * No UI calls this yet; it's the mechanism a settings surface would invoke.
 *
 * Note: if `MOXXY_WS_TOKEN` is set it takes precedence at next resolve — env
 * tokens must be rotated at their source.
 */
export function rotateWsBridgeToken(
  userDataDir: string,
  server: WebSocketBridgeServer | null,
): string {
  const token = rotateChannelToken({ fileName: TOKEN_FILE, dir: userDataDir });
  server?.rotateAuthToken(token);
  return token;
}

/** Absolute path of the persisted bridge token file (for diagnostics). */
export function wsBridgeTokenFile(userDataDir: string): string {
  return path.join(userDataDir, TOKEN_FILE);
}
