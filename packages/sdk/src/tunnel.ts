/**
 * A swappable way to expose a locally-bound surface (the web channel, the mobile
 * bridge, the webhooks listener) to the user over the public internet — so an
 * agent on Telegram/TUI can hand the user a URL they can open. One provider is
 * active per session (registered via plugins, like every other block); core
 * seeds a `localhost` no-op provider so `getActive()` is non-null.
 *
 * The shipped provider is `@moxxy/plugin-tunnel-proxy` (the self-hosted proxy
 * relay). The old cloudflared/ngrok subprocess providers — and the
 * `spawnCliTunnel` helper that backed them — were removed.
 */

export interface TunnelOpenOptions {
  readonly port: number;
  readonly host: string;
  /**
   * Optional routing label for tunnels that multiplex several local services
   * under one public endpoint (the proxy relay): the returned URL is
   * `…/<label>` and inbound requests under that path segment route back to this
   * `host:port`. Providers that expose a single port (or none) ignore it.
   */
  readonly label?: string;
}

export interface TunnelHandle {
  /** The publicly reachable base URL (e.g. https://abc123.proxy.moxxy.ai/mobile). */
  readonly url: string;
  /** Tear the tunnel down (deregister the target / close the connection). */
  close(): Promise<void>;
}

export interface TunnelProviderDef {
  readonly name: string;
  /** Open a tunnel to `http://host:port`, resolving once the public URL is known. */
  open(opts: TunnelOpenOptions): Promise<TunnelHandle>;
  /** Optional readiness gate (e.g. the relay is reachable). */
  isAvailable?(): Promise<boolean>;
}
