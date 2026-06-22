/**
 * The proxy client↔relay wire protocol (v1). This is the single coupling point
 * between this provider (open source) and the private relay repo, which mirrors
 * these shapes. See PROTOCOL.md in the relay repo for the prose spec.
 *
 * Two long-lived agent→relay WebSockets, both to `wss://relay.<baseHost>`:
 *   - `/control` — registration (keypair proof-of-possession) + "new inbound
 *     connection" signalling. One per agent.
 *   - `/data?...` — one per inbound connection; after a one-line `attach`, it
 *     carries the raw tunnelled bytes as binary frames.
 *
 * Public peers (phone, browser) reach the agent at `https://<uuid>.<baseHost>/<target>`;
 * the relay terminates TLS, routes by the SNI subdomain to the agent, reads the
 * first path segment as the `target`, and pipes the raw byte stream over a fresh
 * `/data` connection. The agent maps `target` → a local port (several channels
 * multiplex under one uuid). The provider is otherwise a dumb byte pipe — it
 * doesn't parse whether the bytes are WebSocket or HTTP.
 */

export const PROXY_PROTOCOL_VERSION = 1;

/** Default public base host; the agent dials `relay.<host>`, peers reach `<uuid>.<host>`. */
export const DEFAULT_PROXY_HOST = 'proxy.moxxy.ai';

/** WebSocket paths on the relay control host. */
export const CONTROL_PATH = '/control';
export const DATA_PATH = '/data';

/** Relay → agent, on the control connection. */
export type ControlServerMsg =
  /** Sent first: a random base64url nonce the agent must sign to prove key ownership. */
  | { readonly t: 'challenge'; readonly v: number; readonly nonce: string }
  /** Sent after a valid registration: the derived subdomain + the public base host. */
  | { readonly t: 'registered'; readonly uuid: string; readonly host: string }
  /** A new inbound peer connection; the agent must open a `/data` conn with this
   *  id. `target` is the first path segment of the peer's request (e.g. `mobile`,
   *  `web`), naming which local service the agent pipes it to. */
  | { readonly t: 'open'; readonly connId: string; readonly target: string }
  /** Fatal: the relay is rejecting/closing the control connection. */
  | { readonly t: 'error'; readonly message: string };

/** Agent → relay, on the control connection. */
export type ControlClientMsg =
  /** Register: present the Ed25519 public key + a signature over the challenge nonce. */
  {
    readonly t: 'register';
    readonly v: number;
    /** base64url(Ed25519 public key). */
    readonly pubkey: string;
    /** base64url(Ed25519 signature over the raw nonce bytes). */
    readonly sig: string;
  };

/** Agent → relay, the first (text) frame on a `/data` connection. */
export interface DataAttachMsg {
  readonly t: 'attach';
  readonly v: number;
  /** The single-use capability id the relay sent in the matching `open`. */
  readonly connId: string;
}

/** The host the agent dials for control/data (covered by the `*.<host>` cert). */
export function relayControlHost(baseHost: string): string {
  return `relay.${baseHost}`;
}

/** The public URL a peer uses to reach this agent (optionally a routing target). */
export function publicUrl(uuid: string, baseHost: string, target?: string): string {
  const base = `https://${uuid}.${baseHost}`;
  return target ? `${base}/${target}` : base;
}

export function encodeJson(msg: unknown): string {
  return JSON.stringify(msg);
}

export function decodeControlServerMsg(raw: string): ControlServerMsg {
  const parsed = JSON.parse(raw) as { t?: unknown };
  if (typeof parsed.t !== 'string') throw new Error('proxy: control message missing type');
  return parsed as ControlServerMsg;
}
