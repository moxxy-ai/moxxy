/**
 * The `mobile` channel. On start it stands up a {@link WebSocketCommandBus}
 * (from `@moxxy/ipc-server-ws`) backed by a {@link MobileSessionHost} over the
 * runner's single session, then listens on an authenticated WebSocket. The Expo
 * app connects with the printed URL + token and drives the chat loop through the
 * shared `@moxxy/client-core` hooks — the same client that talks to the desktop.
 */

import type {
  Channel,
  ChannelHandle,
  ChannelStartOptsBase,
  ClientSession,
  PermissionResolver,
} from '@moxxy/sdk';
import { WebSocketCommandBus, startWsBridge } from '@moxxy/ipc-server-ws';
import type { TunnelHandle } from '@moxxy/sdk';

import { MobileSessionHost } from './single-session-host.js';
import { resolveMobileToken, rotateMobileToken } from './token.js';
import {
  advertisedHost,
  advertisedOrigins,
  buildConnectUrl,
  connectUrlOrigin,
  isLoopbackHost,
  normalizeTunnelChoice,
  resolveBindHost,
  tunnelProviderFor,
  type TunnelChoice,
} from './tunnel.js';
import { printConnectInfo } from './qr.js';

export interface MobileStartOpts extends ChannelStartOptsBase {
  readonly session: ClientSession;
}

export interface MobileChannelOptions {
  /** TCP port (default 8765 — matches the desktop bridge + the Expo app's default). */
  readonly port?: number;
  /** Bind address (`MOXXY_MOBILE_HOST` env overrides). Loopback by default —
   *  good for simulators on this machine; `0.0.0.0` exposes on the LAN for a
   *  real phone (still token-gated). */
  readonly bindHost?: string;
  /** Bearer token. Falls back to env / a persisted secret (see resolveMobileToken). */
  readonly token?: string;
  /** Reachability: `localhost` (LAN only), or a `cloudflared`/`ngrok` public tunnel. */
  readonly tunnel?: TunnelChoice;
  /**
   * Accept the legacy `?t=<token>` URL credential (default `true` for back-compat
   * with older installed app builds; current apps authenticate via the
   * `Sec-WebSocket-Protocol` bearer). Set `false` — or `MOXXY_MOBILE_QUERY_TOKEN=0`
   * — to close the URL-token path, which leaks the bearer into tunnel/proxy logs
   * and shoulder-surfed/QR'd URLs. The env var, when set, overrides this option.
   */
  readonly allowQueryToken?: boolean;
  readonly logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    warn?(msg: string, meta?: Record<string, unknown>): void;
  };
}

const DEFAULT_PORT = 8765;

/** Resolve whether the legacy `?t=` URL credential path stays open. Env wins
 *  (`MOXXY_MOBILE_QUERY_TOKEN=0|false|off` closes it), then the option, then the
 *  back-compat default `true`. */
function resolveAllowQueryToken(opt: boolean | undefined): boolean {
  const env = process.env.MOXXY_MOBILE_QUERY_TOKEN?.trim().toLowerCase();
  if (env != null && env !== '') return !(env === '0' || env === 'false' || env === 'off' || env === 'no');
  return opt ?? true;
}

export class MobileChannel implements Channel<MobileStartOpts> {
  readonly name = 'mobile';
  readonly permissionResolver: PermissionResolver;

  private readonly port: number;
  private readonly bindHost: string;
  private token: string;
  private readonly tunnelChoice: TunnelChoice;
  private readonly allowQueryToken: boolean;
  /** True when the token came from `MOXXY_MOBILE_TOKEN` / config (not the
   *  rotatable persisted secret). Rotating then has no durable effect because
   *  `resolveMobileToken` keeps returning the pinned source on the next start. */
  private readonly tokenPinned: boolean;
  private readonly logger: MobileChannelOptions['logger'];
  private host: MobileSessionHost | null = null;
  private server: Awaited<ReturnType<typeof startWsBridge>> | null = null;
  private tunnel: TunnelHandle | null = null;
  private disconnectSweep: ReturnType<typeof setInterval> | null = null;

  constructor(opts: MobileChannelOptions = {}) {
    this.port = opts.port ?? DEFAULT_PORT;
    this.bindHost = resolveBindHost(opts.bindHost);
    this.token = resolveMobileToken(opts.token);
    this.tokenPinned =
      !!(process.env.MOXXY_MOBILE_TOKEN ?? '').trim() || !!opts.token?.trim();
    this.tunnelChoice = normalizeTunnelChoice(opts.tunnel);
    this.allowQueryToken = resolveAllowQueryToken(opts.allowQueryToken);
    this.logger = opts.logger;
    // The field `moxxy serve --all` reads to coordinate the session resolver.
    // Delegate to the live host (installed in start()); deny before any client.
    this.permissionResolver = {
      name: 'mobile',
      check: (call, ctx) =>
        this.host
          ? this.host.permissionResolver.check(call, ctx)
          : Promise.resolve({ mode: 'deny' }),
    };
  }

  /**
   * Rotate the pairing token: persist a fresh secret, re-key the live server
   * (every connected app is terminated — a leaked QR/token stops working
   * immediately), and return the new token so the caller can re-display
   * pairing info. The printed QR also documents the manual path (delete
   * `~/.moxxy/mobile-token` + restart). Env/config-supplied tokens take
   * precedence at resolve time and must be rotated at their source.
   */
  rotateToken(): string {
    // A pinned (env/config) token can't be rotated here: `rotateMobileToken`
    // only rewrites the persisted file, but `resolveMobileToken` returns the
    // pinned source on the next start — so rotating would diverge `this.token`
    // from what a restart resolves and silently revoke nothing durable. Refuse
    // and tell the caller to rotate at the source instead of faking success.
    if (this.tokenPinned) {
      this.logger?.warn?.(
        'mobile token is pinned via MOXXY_MOBILE_TOKEN / config — rotate it at the source; the persisted secret is not used',
      );
      return this.token;
    }
    this.token = rotateMobileToken();
    this.server?.rotateAuthToken(this.token);
    return this.token;
  }

  async start(startOpts: MobileStartOpts): Promise<ChannelHandle> {
    // The standalone `moxxy mobile` host is its OWN trust surface: it registers
    // exactly the curated single-session subset a mobile client drives (see
    // `MobileSessionHost.register`) and nothing else, so the bus's deny-by-
    // default remote allow-list (which targets the DESKTOP gateway, where the
    // full host IPC handler set is on the bus) would only over-restrict it.
    // `allowedCommands: null` keeps that curated subset authoritative here.
    const bus = new WebSocketCommandBus({ allowedCommands: null });
    const host = new MobileSessionHost(bus, startOpts.session, {
      logErr: (err) => this.logger?.warn?.('mobile host background error', { err: String(err) }),
    });
    this.host = host;
    host.register(); // populate the method map BEFORE accepting connections
    host.wire(); // stream events + install the ask resolvers

    // Everything after wire() can throw (port in use, tunnel open, QR print),
    // and wire() has already subscribed to session.log + installed the ask
    // resolvers on a session this channel may never own. On ANY failure here,
    // tear the host (and any opened tunnel/server) back down so we don't leak a
    // dead subscriber/resolver onto a live session.
    try {
    // iOS React Native sends an `Origin` header derived from the WS URL it
    // dials (Android/Node send none), so every URL this channel advertises
    // must have its origin allow-listed or real iPhones are rejected at the
    // upgrade. Local origins are known now; the tunnel origin is added below
    // once the tunnel URL is assigned.
    const localOrigins = advertisedOrigins(this.bindHost, this.port);
    const server = await startWsBridge(bus, {
      port: this.port,
      host: this.bindHost,
      authToken: this.token,
      allowedOrigins: localOrigins,
      // Back-compat: the QR this channel prints embeds the token as `?t=`
      // (pairing payload); current apps strip it and authenticate via the
      // Sec-WebSocket-Protocol bearer entry, but older installed builds still
      // connect with the token in the WS URL. Default-on for those installs;
      // closeable via the option / MOXXY_MOBILE_QUERY_TOKEN to stop leaking the
      // bearer into tunnel/proxy logs once apps no longer need it.
      allowQueryToken: this.allowQueryToken,
    });
    this.server = server;
    this.logger?.info?.('mobile channel listening', { address: server.address });

    // A network client is the EXPECTED-to-drop case (network loss, app killed
    // or backgrounded). The bridge exposes no per-disconnect event the host can
    // subscribe to (each transport's single onClose is already owned by its
    // JsonRpcPeer), so poll the connected-client count and, on the transition
    // back to zero AFTER at least one client connected, abort in-flight turns +
    // drain parked asks so an abandoned turn/ask can't strand the runner. The
    // timer is unref'd (never holds the process open) and cleared on teardown.
    //
    // The RISING edge is driven by `onConnection`, NOT the poll: a fast-crashing
    // client (the hostile case — connect, fire a turn, die within one poll
    // window) would read clientCount()===0 on both surrounding polls, so a
    // poll-only `sawClient` flag would never see the connect and never drain the
    // stranded turn/ask. `onConnection` marks `sawClient` synchronously the
    // instant a client attaches, so the next falling-edge poll still drains it.
    // `onConnection` is additive (the bridge already registered bus.attach), so
    // this doesn't disturb connection routing.
    let sawClient = false;
    server.onConnection(() => {
      sawClient = true;
    });
    this.disconnectSweep = setInterval(() => {
      const n = server.clientCount();
      if (n > 0) {
        sawClient = true;
        return;
      }
      if (sawClient) {
        sawClient = false;
        host.onAllClientsDisconnected();
      }
    }, 1000);
    if (typeof this.disconnectSweep?.unref === 'function') this.disconnectSweep.unref();

    // Optionally expose the bridge beyond the LAN via the user's chosen tunnel.
    let tunnelUrl: string | null = null;
    const provider = tunnelProviderFor(this.tunnelChoice);
    if (provider) {
      try {
        this.tunnel = await provider.open({ port: this.port, host: this.bindHost });
        tunnelUrl = this.tunnel.url;
        server.setAllowedOrigins([...localOrigins, connectUrlOrigin(tunnelUrl)]);
        this.logger?.info?.('mobile tunnel open', { provider: provider.name, url: tunnelUrl });
      } catch (err) {
        this.logger?.warn?.('mobile tunnel failed; using the local URL', {
          provider: provider.name,
          err: String(err),
        });
      }
    }

    // A QR (+ plain URL) the mobile app scans to connect — token embedded.
    // The URL only ever advertises an address the server is reachable on:
    // the tunnel URL, the LAN IP for a wildcard bind, or the bind host itself
    // (the loopback default advertises 127.0.0.1 — simulators on this machine).
    const connectUrl = buildConnectUrl({
      tunnelUrl,
      localHost: advertisedHost(this.bindHost),
      port: this.port,
      token: this.token,
    });
    const loopbackOnly = !tunnelUrl && isLoopbackHost(this.bindHost);
    await printConnectInfo(
      connectUrl,
      this.token,
      loopbackOnly
        ? 'Bound to loopback — this QR only works on THIS machine (e.g. an iOS/Android\n' +
          '  simulator). For a real phone: opt in to a LAN bind with MOXXY_MOBILE_HOST=0.0.0.0\n' +
          "  (or channels.mobile.bindHost in moxxy.config.ts), or use a tunnel\n" +
          "  (channels.mobile.tunnel: 'cloudflared' | 'ngrok', or MOXXY_MOBILE_TUNNEL)."
        : undefined,
    );
    } catch (err) {
      // Roll back the partial wiring: unsubscribe from session.log + clear the
      // ask resolvers (host.dispose), close anything we managed to open, and
      // null the fields back out so this channel owns nothing.
      host.dispose();
      if (this.disconnectSweep) {
        clearInterval(this.disconnectSweep);
        this.disconnectSweep = null;
      }
      if (this.tunnel) {
        await this.tunnel.close().catch(() => undefined);
        this.tunnel = null;
      }
      await this.server?.close().catch(() => undefined);
      this.server = null;
      this.host = null;
      throw err;
    }

    let resolveRunning!: () => void;
    const running = new Promise<void>((resolve) => {
      resolveRunning = resolve;
    });

    return {
      running,
      stop: async () => {
        host.dispose();
        if (this.disconnectSweep) {
          clearInterval(this.disconnectSweep);
          this.disconnectSweep = null;
        }
        if (this.tunnel) {
          await this.tunnel.close().catch(() => undefined);
          this.tunnel = null;
        }
        await this.server?.close();
        this.server = null;
        this.host = null;
        resolveRunning();
      },
    };
  }
}
