/**
 * A swappable way to expose a locally-bound surface (the web channel) to the
 * user over the public internet — so an agent on Telegram/TUI can hand the user
 * a URL they can open. One provider is active per session (registered via
 * plugins, like every other block); core seeds a `localhost` no-op provider so
 * `getActive()` is non-null.
 */
export interface TunnelOpenOptions {
  readonly port: number;
  readonly host: string;
}

export interface TunnelHandle {
  /** The publicly reachable base URL (e.g. https://abc.trycloudflare.com). */
  readonly url: string;
  /** Tear the tunnel down (kill the subprocess, close the connection). */
  close(): Promise<void>;
}

export interface TunnelProviderDef {
  readonly name: string;
  /** Open a tunnel to `http://host:port`, resolving once the public URL is known. */
  open(opts: TunnelOpenOptions): Promise<TunnelHandle>;
  /** Optional readiness gate (e.g. the `cloudflared` binary is installed). */
  isAvailable?(): Promise<boolean>;
}
