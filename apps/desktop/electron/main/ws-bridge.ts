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
 * Beyond the LAN, the gateway also exposes itself through the self-hosted
 * `proxy` relay with end-to-end encryption (a Noise responder shim in front of
 * the loopback bridge — the relay only ever sees ciphertext, and the bearer
 * token never crosses it), so the QR works off the local network. When the
 * relay is up the advertised connectUrl is the remote `wss://<uuid>.proxy…/mobile`
 * URL + pinned fingerprint; if the relay is unreachable it falls back to the LAN
 * URL. `MOXXY_MOBILE_NO_PROXY=1` forces LAN-only.
 *
 * Hardening defaults (see `WebSocketBridgeOptions`): browser-Origin upgrades
 * are rejected, the legacy `?t=` query credential is off (clients present the
 * token via header/subprotocol; `MOXXY_WS_ALLOW_QUERY_TOKEN=1` re-enables it
 * for legacy clients), and connection-cap/backpressure limits apply.
 */

import path from 'node:path';

import { resolveChannelToken, rotateChannelToken } from '@moxxy/sdk/server';
import {
  advertisedHost,
  advertisedOrigins,
  buildConnectUrl,
  connectUrlOrigin,
} from '@moxxy/plugin-channel-mobile/pairing';
import type {
  E2EProxyHandle,
  OpenMobileProxyOptions,
} from '@moxxy/plugin-channel-mobile/e2e-proxy';
import type { WebSocketBridgeOptions, WebSocketBridgeServer } from '@moxxy/ipc-server-ws';
import type { MobileGatewayStatus } from '@moxxy/desktop-ipc-contract';

const DEFAULT_PORT = 8765;
const TOKEN_FILE = 'ws-token';

/** True when `MOXXY_WS_TOKEN` pins the gateway token at its source. A pinned
 *  token wins at every `resolveChannelToken` call, so it cannot be rotated from
 *  here — the file-persisted token rotate path would re-key the live server to a
 *  fresh secret while the advertised connectUrl still showed the env token,
 *  bricking pairing (or vice versa). Rotation is a coherent no-op while pinned. */
function envTokenPinned(): boolean {
  return Boolean(process.env.MOXXY_WS_TOKEN?.trim());
}

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
 * immediately. Returns the rotation outcome so the host can re-display pairing
 * info or surface why nothing changed.
 *
 * COHERENCE: if `MOXXY_WS_TOKEN` pins the token, the env source wins at every
 * resolve, so rotating the FILE token here would diverge the live server's
 * accepted token from the advertised one. We therefore refuse to rotate while
 * pinned (a no-op with `pinned: true`) — the operator must rotate the env var at
 * its source and restart. When NOT pinned, the file token is rotated and the
 * live server is re-keyed in lockstep so the next `status()` advertises exactly
 * the token the server now accepts.
 */
export function rotateWsBridgeToken(
  userDataDir: string,
  server: WebSocketBridgeServer | null,
): { rotated: boolean; pinned: boolean; token: string } {
  if (envTokenPinned()) {
    // Can't rotate a pinned token — report the live (env) token unchanged.
    const token = resolveChannelToken({
      envVar: 'MOXXY_WS_TOKEN',
      fileName: TOKEN_FILE,
      dir: userDataDir,
    });
    console.warn(
      '[moxxy] mobile gateway: cannot rotate the pairing token while MOXXY_WS_TOKEN is set — ' +
        'rotate it at the env source and restart.',
    );
    return { rotated: false, pinned: true, token };
  }
  const token = rotateChannelToken({ fileName: TOKEN_FILE, dir: userDataDir });
  server?.rotateAuthToken(token);
  return { rotated: true, pinned: false, token };
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
  /**
   * Open the E2E `proxy` relay exposure for the loopback bridge. Injected (the
   * main wires `openMobileProxyTunnel` from `@moxxy/plugin-channel-mobile`) so
   * the relay/crypto stack stays out of this Electron-free module and tests can
   * substitute a fake. When omitted, the gateway is LAN-only.
   */
  readonly openProxyTunnel?: (opts: OpenMobileProxyOptions) => Promise<E2EProxyHandle>;
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
  /**
   * The end-to-end-encrypted `proxy` relay exposure, when it could be opened.
   * Present → the advertised connectUrl is the remote `wss://<uuid>.proxy…/mobile`
   * URL (+ pinned fingerprint) that works off-LAN; null → LAN-only fallback (the
   * relay was unreachable). The shim it owns terminates Noise in front of the
   * loopback bridge, so the relay only ever sees ciphertext.
   */
  private proxy: E2EProxyHandle | null = null;
  /**
   * Serializes every lifecycle mutation (start/stop/setEnabled/rotate/resume).
   * Concurrent toggles from the Settings tab — a rapid off→on, or a resume
   * racing a user toggle — would otherwise interleave their awaits: two `start`s
   * could both pass the `if (this.server)` guard and double-bind the port, or a
   * `stop` could null `this.server` out from under an in-flight `start`, leaking
   * a LAN-bound listener nobody tracks. Chaining each op onto the previous one's
   * settle makes the start/stop/rotate sequence atomic.
   */
  private lifecycle: Promise<unknown> = Promise.resolve();

  constructor(private readonly rt: BridgeRuntime) {}

  /** Run `op` after every previously-queued lifecycle op settles, so the
   *  start/stop/rotate sequence can't interleave. A throw rejects this call but
   *  does not poison the chain (the next op still runs). */
  private runExclusive<T>(op: () => Promise<T>): Promise<T> {
    const run = this.lifecycle.then(op, op);
    // Keep the chain alive regardless of this op's outcome.
    this.lifecycle = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

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
    // iOS React Native presents the dialed URL's origin at the upgrade —
    // allow-list the URLs we advertise (QR / Settings tab) or iPhones are
    // rejected by the Origin default-deny.
    server.setAllowedOrigins(advertisedOrigins(host, port));
  }

  /**
   * Re-start the gateway on boot iff the persisted preference says it was on.
   * Best-effort: a start failure is swallowed (logged) so a transient port
   * clash can't brick boot — the user can re-toggle from Settings. Serialized
   * with start/stop/rotate so a user toggle that races boot can't double-bind.
   */
  async resume(): Promise<void> {
    await this.runExclusive(async () => {
      let enabled = false;
      try {
        enabled = await this.rt.readEnabledPref();
      } catch {
        enabled = false;
      }
      if (!enabled || this.server) return;
      try {
        await this.startLocked();
      } catch (e) {
        console.error('[moxxy] mobile gateway: failed to resume on boot:', e);
      }
    });
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
    // When the proxy relay is up, advertise the remote (E2E, off-LAN) URL with
    // the pinned fingerprint; otherwise fall back to the LAN URL.
    const connectUrl = this.proxy
      ? buildConnectUrl({
          tunnelUrl: this.proxy.url,
          localHost: host,
          port: this.boundPort,
          token,
          fingerprint: this.proxy.fingerprint,
        })
      : buildConnectUrl({
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

  /** Start the bridge (idempotent — returns the current status if already up).
   *  Serialized so concurrent toggles can't double-bind the port. */
  async start(): Promise<MobileGatewayStatus> {
    return this.runExclusive(() => this.startLocked());
  }

  /** Start implementation — runs only while the lifecycle lock is held. */
  private async startLocked(): Promise<MobileGatewayStatus> {
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
    // iOS React Native presents the dialed URL's origin at the upgrade —
    // allow-list the URLs we advertise (QR / Settings tab) or iPhones are
    // rejected by the Origin default-deny. Set post-bind so an ephemeral
    // port (0) resolves to the real one.
    this.server.setAllowedOrigins(advertisedOrigins(host, this.boundPort));
    console.log(`[moxxy] mobile gateway listening on ${this.server.address}`);
    // Expose it beyond the LAN through the E2E proxy relay (best-effort).
    await this.openProxy(token);
    return this.status();
  }

  /**
   * Try to expose the running bridge through the self-hosted `proxy` relay with
   * end-to-end encryption, so the QR works off-LAN (`wss://<uuid>.proxy…/mobile`
   * + pinned fingerprint). Best-effort: a relay that's down/unreachable leaves
   * the gateway LAN-only (`this.proxy` stays null) rather than failing the start.
   * Set `MOXXY_MOBILE_NO_PROXY=1` to force LAN-only (no relay dependency).
   */
  private async openProxy(token: string): Promise<void> {
    const open = this.rt.openProxyTunnel;
    if (!open) return; // host didn't wire the relay stack — LAN-only
    if (process.env.MOXXY_MOBILE_NO_PROXY === '1') return;
    if (!this.server || this.boundPort === null) return;
    try {
      this.proxy = await open({
        bridgePort: this.boundPort,
        bridgeHost: '127.0.0.1',
        token,
        logger: {
          info: (msg, meta) => console.log(`[moxxy] ${msg}`, meta ?? ''),
          warn: (msg, meta) => console.warn(`[moxxy] ${msg}`, meta ?? ''),
        },
      });
      // iOS RN presents the dialed (relay) origin at the upgrade — allow-list it
      // alongside the LAN origins so the phone isn't Origin-denied.
      this.server.setAllowedOrigins([
        ...advertisedOrigins(this.boundHost ?? '0.0.0.0', this.boundPort),
        connectUrlOrigin(this.proxy.url),
      ]);
      console.log(`[moxxy] mobile gateway proxy relay: ${this.proxy.url}`);
    } catch (e) {
      console.warn(
        '[moxxy] mobile gateway: proxy relay unavailable — pairing is LAN-only:',
        e instanceof Error ? e.message : e,
      );
      this.proxy = null;
    }
  }

  /** Tear down the proxy tunnel + E2E shim if open. */
  private async closeProxy(): Promise<void> {
    const proxy = this.proxy;
    this.proxy = null;
    if (proxy) await proxy.close().catch(() => undefined);
  }

  /** Stop the bridge: close the listener + terminate every connected client.
   *  Serialized so a stop can't null the server out from under an in-flight
   *  start (and vice versa). */
  async stop(): Promise<MobileGatewayStatus> {
    return this.runExclusive(() => this.stopLocked());
  }

  /** Stop implementation — runs only while the lifecycle lock is held. */
  private async stopLocked(): Promise<MobileGatewayStatus> {
    const server = this.server;
    this.server = null;
    this.boundHost = null;
    this.boundPort = null;
    // Tear the relay tunnel + shim down first so no orphaned control connection
    // or loopback listener survives the bridge it fronted.
    await this.closeProxy();
    if (server) {
      try {
        await server.close();
      } catch {
        /* best effort — the listener is gone regardless */
      }
    }
    return this.status();
  }

  /** Toggle on/off, persist the preference, and notify the renderer. The whole
   *  toggle (start/stop + persist) runs under one lifecycle turn, so a rapid
   *  off→on can't race the bind. */
  async setEnabled(enabled: boolean): Promise<MobileGatewayStatus> {
    return this.runExclusive(async () => {
      const status = enabled ? await this.startLocked() : await this.stopLocked();
      try {
        await this.rt.writeEnabledPref(enabled);
      } catch (e) {
        console.error('[moxxy] mobile gateway: failed to persist preference:', e);
      }
      this.rt.onChange(status);
      return status;
    });
  }

  /** Rotate the pairing token (no-op when off or when MOXXY_WS_TOKEN pins it),
   *  re-key the live server (terminating existing clients), and notify the
   *  renderer. Serialized so a rotate can't race a concurrent stop/start. */
  async rotateToken(): Promise<MobileGatewayStatus> {
    return this.runExclusive(async () => {
      if (!this.server) return this.status();
      // Rotation is coherent with an env-pinned token (no-op + warn) — see
      // rotateWsBridgeToken. status() reads the LIVE accepted token either way.
      const { rotated } = rotateWsBridgeToken(this.rt.userDataDir, this.server);
      // The E2E shim checks the bearer against the token it was created with, so
      // a real rotation must rebuild the proxy with the new token or the relay
      // path would reject the freshly-paired phone. The uuid is key-derived, so
      // the public URL is unchanged across the reopen.
      if (rotated && this.proxy) {
        const token = resolveChannelToken({
          envVar: 'MOXXY_WS_TOKEN',
          fileName: TOKEN_FILE,
          dir: this.rt.userDataDir,
        });
        await this.closeProxy();
        await this.openProxy(token);
      }
      const status = this.status();
      this.rt.onChange(status);
      return status;
    });
  }
}
