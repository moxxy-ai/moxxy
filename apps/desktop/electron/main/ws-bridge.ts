/**
 * The desktop's WebSocket bridge — the "mobile gateway".
 *
 * The bridge exposes the SAME IPC contract the renderer uses to a remote client
 * (the mobile app), so a paired phone drives the host exactly like the TUI does.
 * It is always token-authenticated via the SDK's shared channel-auth helper: an
 * explicit `MOXXY_WS_TOKEN` wins, otherwise a 256-bit token is generated once
 * and persisted (0600) under userData so the same pairing secret survives
 * restarts.
 *
 * Two entry paths:
 *   - the env-gated BOOT path (`MOXXY_WS_BRIDGE=1`) — back-compat for power
 *     users / CI, started once at boot from {@link resolveWsBridgeConfig};
 *   - the runtime "mobile gateway" path — {@link MobileGatewayManager}, driven
 *     by the Settings → Mobile tab via IPC, which can START and STOP the bridge
 *     on demand and persists the on/off preference so it survives a restart.
 *
 * SECURITY — the runtime gateway binds the LAN by default (so a phone on the
 * same Wi-Fi can actually reach it), which is a deliberate local-network
 * exposure. It stays token-gated (bearer via the `Sec-WebSocket-Protocol`
 * subprotocol), browser Origins are default-denied, and connection caps /
 * backpressure limits apply (see `WebSocketBridgeOptions`). The gateway is OFF
 * by default and only starts on explicit user action.
 *
 * Hardening defaults (see `WebSocketBridgeOptions`): browser-Origin upgrades
 * are rejected, the legacy `?t=` query credential is off (clients present the
 * token via header/subprotocol; `MOXXY_WS_ALLOW_QUERY_TOKEN=1` re-enables it
 * for legacy clients), and connection-cap/backpressure limits apply.
 */

import path from 'node:path';

import { resolveChannelToken, rotateChannelToken } from '@moxxy/sdk';
import { advertisedHost, buildConnectUrl } from '@moxxy/plugin-channel-mobile/pairing';
import type { WebSocketBridgeOptions, WebSocketBridgeServer } from '@moxxy/ipc-server-ws';
import type { MobileGatewayStatus } from '@moxxy/desktop-ipc-contract';

const DEFAULT_PORT = 8765;
const TOKEN_FILE = 'ws-token';

/**
 * Returns the bridge options when the ENV bridge is enabled, or `null` when off.
 * Resolving this does NOT start a server — the caller registers handlers onto a
 * `WebSocketCommandBus` first, then starts the server with these options. Used
 * only by the env-gated boot path; the runtime gateway resolves its own options
 * in {@link MobileGatewayManager}.
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

/** The lazily-imported `@moxxy/ipc-server-ws` module + the bus the host already
 *  registered the IPC handlers onto. The main wires these in once at boot. */
export interface BridgeRuntime {
  /** The lazily-loaded bridge module (null if it failed to load — gateway off). */
  readonly wsBridge: typeof import('@moxxy/ipc-server-ws') | null;
  /** The WebSocketCommandBus the desktop IPC handlers are registered on. */
  readonly wsBus: import('@moxxy/ipc-server-ws').WebSocketCommandBus | null;
  /** Persisted-preference + userData accessors (Electron-owned). */
  readonly userDataDir: string;
  /** Read the persisted "gateway enabled" preference. */
  readonly readEnabledPref: () => Promise<boolean> | boolean;
  /** Persist the "gateway enabled" preference. */
  readonly writeEnabledPref: (enabled: boolean) => Promise<void>;
  /** Notify listeners (renderer) that the status changed. */
  readonly onChange: (status: MobileGatewayStatus) => void;
}

/**
 * Owns the runtime lifecycle of the mobile gateway: start, stop, status, and
 * token rotation, driven by the Settings → Mobile IPC commands. Implements the
 * desktop-host `MobileGatewayController` shape (structurally).
 *
 * The bridge binds the LAN-advertised interface (`0.0.0.0`) so a phone on the
 * same Wi-Fi can connect — the QR/connectUrl advertises the machine's real LAN
 * IP via the mobile-channel `advertisedHost` logic.
 */
export class MobileGatewayManager {
  private server: WebSocketBridgeServer | null = null;
  /** The host the bridge was bound to (wildcard for LAN exposure). */
  private boundHost: string | null = null;
  private boundPort: number | null = null;

  constructor(private readonly rt: BridgeRuntime) {}

  /** The current live server (if running) — exposed so the env-boot path can
   *  hand its already-started server in and so shutdown can close it. */
  get liveServer(): WebSocketBridgeServer | null {
    return this.server;
  }

  /** Adopt an already-running server (the env-gated boot path started one). */
  adopt(server: WebSocketBridgeServer, host: string, port: number): void {
    this.server = server;
    this.boundHost = host;
    this.boundPort = port;
  }

  /**
   * Re-start the gateway on boot iff the persisted preference says it was on.
   * Best-effort: a start failure is swallowed (logged) so a transient port
   * clash can't brick boot — the user can re-toggle from Settings.
   */
  async resume(): Promise<void> {
    let enabled = false;
    try {
      enabled = await this.rt.readEnabledPref();
    } catch {
      enabled = false;
    }
    if (!enabled || this.server) return;
    try {
      await this.start();
    } catch (e) {
      console.error('[moxxy] mobile gateway: failed to resume on boot:', e);
    }
  }

  /** Build the status snapshot. Reads the persisted token (the same secret a
   *  client must present) and the live client count when running. */
  status(): MobileGatewayStatus {
    if (!this.server || this.boundPort === null) {
      return { enabled: false, host: null, port: null, connectUrl: null, token: null };
    }
    const token = resolveChannelToken({
      envVar: 'MOXXY_WS_TOKEN',
      fileName: TOKEN_FILE,
      dir: this.rt.userDataDir,
    });
    const host = advertisedHost(this.boundHost ?? '0.0.0.0');
    const connectUrl = buildConnectUrl({
      tunnelUrl: null,
      localHost: host,
      port: this.boundPort,
      token,
    });
    const status: MobileGatewayStatus = {
      enabled: true,
      host,
      port: this.boundPort,
      connectUrl,
      token,
    };
    const count = this.server.clientCount?.();
    return typeof count === 'number' ? { ...status, clientCount: count } : status;
  }

  /** Start the bridge (idempotent — returns the current status if already up). */
  async start(): Promise<MobileGatewayStatus> {
    if (this.server) return this.status();
    if (!this.rt.wsBridge || !this.rt.wsBus) {
      throw new Error('the WebSocket bridge module is unavailable in this build');
    }
    const token = resolveChannelToken({
      envVar: 'MOXXY_WS_TOKEN',
      fileName: TOKEN_FILE,
      dir: this.rt.userDataDir,
    });
    // Bind the wildcard interface so the bridge is reachable from the LAN (a
    // phone on the same Wi-Fi). Still token-gated; Origins default-deny. The
    // env override lets a power user pin a specific interface.
    const host = process.env.MOXXY_WS_HOST?.trim() || '0.0.0.0';
    const rawPort = process.env.MOXXY_WS_PORT?.trim();
    const port = rawPort && Number.isFinite(Number(rawPort)) ? Number(rawPort) : DEFAULT_PORT;
    const opts: WebSocketBridgeOptions = {
      port,
      authToken: token,
      host,
      ...(process.env.MOXXY_WS_ALLOW_QUERY_TOKEN === '1' ? { allowQueryToken: true } : {}),
    };
    this.server = await this.rt.wsBridge.startWsBridge(this.rt.wsBus, opts);
    this.boundHost = host;
    // `address` is `ws://host:port` — recover the actual bound port (it may have
    // been an ephemeral 0).
    const m = /:(\d+)$/.exec(this.server.address);
    this.boundPort = m ? Number(m[1]) : port;
    console.log(`[moxxy] mobile gateway listening on ${this.server.address}`);
    return this.status();
  }

  /** Stop the bridge: close the listener + terminate every connected client. */
  async stop(): Promise<MobileGatewayStatus> {
    const server = this.server;
    this.server = null;
    this.boundHost = null;
    this.boundPort = null;
    if (server) {
      try {
        await server.close();
      } catch {
        /* best effort — the listener is gone regardless */
      }
    }
    return this.status();
  }

  /** Toggle on/off, persist the preference, and notify the renderer. */
  async setEnabled(enabled: boolean): Promise<MobileGatewayStatus> {
    const status = enabled ? await this.start() : await this.stop();
    try {
      await this.rt.writeEnabledPref(enabled);
    } catch (e) {
      console.error('[moxxy] mobile gateway: failed to persist preference:', e);
    }
    this.rt.onChange(status);
    return status;
  }

  /** Rotate the pairing token (no-op when off), persist + re-key the live
   *  server (terminating existing clients), and notify the renderer. */
  async rotateToken(): Promise<MobileGatewayStatus> {
    if (!this.server) return this.status();
    rotateWsBridgeToken(this.rt.userDataDir, this.server);
    const status = this.status();
    this.rt.onChange(status);
    return status;
  }
}
