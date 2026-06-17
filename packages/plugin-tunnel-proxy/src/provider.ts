/**
 * The `proxy` tunnel provider — a native-Node replacement for the cloudflared/
 * ngrok subprocess providers.
 *
 * Several channels (the mobile bridge, the web preview, the webhooks listener)
 * can be exposed at once under ONE keypair-derived subdomain: a process-singleton
 * {@link ProxyHub} owns a single control connection per identity and a
 * `target → local port` map. Each `open({ port, host, label })` registers a
 * target and returns `https://<uuid>.<host>/<label>`. For every inbound peer the
 * relay signals (`open { connId, target }`), the hub opens a `/data` WebSocket
 * and pipes its raw bytes to that target's port — protocol-agnostic, so the bytes
 * may be a phone's (E2E-wrapped) WebSocket or a browser's HTTP.
 *
 * The control connection self-heals with capped exponential backoff; because the
 * uuid derives from the (stable) public key, the public URL never changes.
 */
import { connect as netConnect, type Socket } from 'node:net';
import {
  base64urlDecode,
  base64urlEncode,
  deriveUuid,
  fingerprint,
  sign,
  type Identity,
} from '@moxxy/e2e';
import { loadOrCreateIdentity } from '@moxxy/e2e/node';
import { defineTunnelProvider, type TunnelHandle, type TunnelProviderDef } from '@moxxy/sdk';
import { WebSocket } from 'ws';
import {
  CONTROL_PATH,
  DATA_PATH,
  DEFAULT_PROXY_HOST,
  PROXY_PROTOCOL_VERSION,
  decodeControlServerMsg,
  encodeJson,
  publicUrl,
  relayControlHost,
  type ControlClientMsg,
  type DataAttachMsg,
} from './protocol.js';

export interface ProxyLogger {
  info?(msg: string, meta?: Record<string, unknown>): void;
  warn?(msg: string, meta?: Record<string, unknown>): void;
}

export interface ProxyTunnelOptions {
  /** Public base host. Default: `MOXXY_PROXY_HOST` env, else `proxy.moxxy.ai`. */
  readonly baseHost?: string;
  /** Override the control/data WS base (e.g. `ws://127.0.0.1:PORT` in tests). */
  readonly controlUrl?: string;
  /** Override the identity key path (defaults to `~/.moxxy/proxy-identity.key`). */
  readonly identityPath?: string;
  readonly logger?: ProxyLogger;
}

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

function resolveBaseHost(opts: ProxyTunnelOptions): string {
  return (opts.baseHost ?? process.env.MOXXY_PROXY_HOST ?? DEFAULT_PROXY_HOST).trim();
}

/** `ws://relay.<host>` / `wss://relay.<host>` unless an explicit controlUrl is given. */
function resolveControlBase(opts: ProxyTunnelOptions, baseHost: string): string {
  if (opts.controlUrl) return opts.controlUrl.replace(/\/$/, '');
  return `wss://${relayControlHost(baseHost)}`;
}

interface TargetEntry {
  readonly host: string;
  readonly port: number;
}

/**
 * One per (controlBase, identity): owns the control connection and the
 * `target → port` map, multiplexing every channel's exposure under one uuid.
 */
class ProxyHub {
  private identity: Identity | null = null;
  private uuid: string | null = null;
  private control: WebSocket | null = null;
  private registering: Promise<string> | null = null;
  private readonly targets = new Map<string, TargetEntry>();
  private readonly dataConns = new Set<WebSocket>();
  private readonly localSockets = new Set<Socket>();
  private closed = false;
  private reconnectMs = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly controlBase: string,
    private readonly baseHost: string,
    private readonly identityPath: string | undefined,
    private readonly logger: ProxyLogger | undefined,
    private readonly onEmpty: () => void,
  ) {}

  /** Register a target and return its public URL + a remove() handle. */
  async addTarget(label: string, host: string, port: number): Promise<TunnelHandle> {
    const uuid = await this.ensureRegistered();
    this.targets.set(label, { host, port });
    this.logger?.info?.('proxy: target added', { uuid, label, port });
    return {
      url: publicUrl(uuid, this.baseHost, label),
      close: () => {
        this.removeTarget(label);
        return Promise.resolve();
      },
    };
  }

  private removeTarget(label: string): void {
    this.targets.delete(label);
    if (this.targets.size === 0) this.close();
  }

  /** Connect + register once; later callers reuse the resolved uuid. */
  private async ensureRegistered(): Promise<string> {
    if (this.uuid && this.control) return this.uuid;
    if (this.registering) return this.registering;
    if (!this.identity) this.identity = await loadOrCreateIdentity(this.identityPath);
    this.registering = this.connectControl();
    try {
      return await this.registering;
    } finally {
      this.registering = null;
    }
  }

  private connectControl(): Promise<string> {
    const identity = this.identity as Identity;
    const expected = deriveUuid(identity.publicKey);
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(`${this.controlBase}${CONTROL_PATH}`);
      this.control = ws;

      ws.on('message', (raw) => {
        let msg;
        try {
          msg = decodeControlServerMsg(raw.toString());
        } catch {
          return;
        }
        switch (msg.t) {
          case 'challenge': {
            const reply: ControlClientMsg = {
              t: 'register',
              v: PROXY_PROTOCOL_VERSION,
              pubkey: base64urlEncode(identity.publicKey),
              sig: base64urlEncode(sign(base64urlDecode(msg.nonce), identity.secretKey)),
            };
            ws.send(encodeJson(reply));
            return;
          }
          case 'registered': {
            if (msg.uuid !== expected) {
              // A buggy or hostile relay handed back a uuid our key didn't derive.
              if (!settled) {
                settled = true;
                reject(
                  new Error(`proxy: relay returned uuid '${msg.uuid}', expected '${expected}'`),
                );
              }
              this.close();
              return;
            }
            this.uuid = msg.uuid;
            this.reconnectMs = RECONNECT_MIN_MS;
            if (!settled) {
              settled = true;
              resolve(msg.uuid);
            }
            return;
          }
          case 'open':
            this.openDataConn(msg.connId, msg.target);
            return;
          case 'error':
            this.logger?.warn?.('proxy: relay error', { message: msg.message });
            return;
        }
      });

      ws.on('close', () => {
        if (this.control === ws) this.control = null;
        if (!settled) {
          settled = true;
          reject(new Error('proxy: control connection closed before registration'));
        }
        this.scheduleReconnect();
      });
      ws.on('error', (err) => {
        this.logger?.warn?.('proxy: control connection error', { err: String(err) });
        // 'close' follows and drives reconnect / rejection.
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer || this.targets.size === 0) return;
    const delay = this.reconnectMs;
    this.reconnectMs = Math.min(this.reconnectMs * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closed) return;
      this.connectControl()
        .then(() => this.logger?.info?.('proxy: control reconnected'))
        .catch(() => {
          /* 'close' reschedules */
        });
    }, delay);
    this.reconnectTimer.unref?.();
  }

  /** Pipe one inbound peer (raw bytes over a `/data` WS) to its target's port. */
  private openDataConn(connId: string, target: string): void {
    if (this.closed) return;
    const entry = this.targets.get(target);
    if (!entry) {
      this.logger?.warn?.('proxy: open for unknown target; dropping', { target });
      return; // relay's attach timeout tears down the waiting ingress
    }
    const ws = new WebSocket(`${this.controlBase}${DATA_PATH}`);
    const local = netConnect({ host: entry.host, port: entry.port });
    this.dataConns.add(ws);
    this.localSockets.add(local);

    let attached = false;
    const localOutbox: Uint8Array[] = [];
    const cleanup = (): void => {
      this.dataConns.delete(ws);
      this.localSockets.delete(local);
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      } catch {
        /* ignore */
      }
      try {
        local.destroy();
      } catch {
        /* ignore */
      }
    };

    ws.on('open', () => {
      const attach: DataAttachMsg = { t: 'attach', v: PROXY_PROTOCOL_VERSION, connId };
      ws.send(encodeJson(attach));
      attached = true;
      for (const chunk of localOutbox.splice(0)) ws.send(chunk, { binary: true });
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) local.write(data as Buffer);
    });
    local.on('data', (buf: Buffer) => {
      if (attached && ws.readyState === WebSocket.OPEN) ws.send(buf, { binary: true });
      else localOutbox.push(buf);
    });
    ws.on('close', cleanup);
    ws.on('error', cleanup);
    local.on('close', cleanup);
    local.on('error', cleanup);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const ws of this.dataConns) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    for (const s of this.localSockets) {
      try {
        s.destroy();
      } catch {
        /* ignore */
      }
    }
    this.dataConns.clear();
    this.localSockets.clear();
    this.targets.clear();
    try {
      this.control?.close();
    } catch {
      /* ignore */
    }
    this.control = null;
    this.onEmpty();
  }
}

/** Process-wide hub registry, so all channels share one control conn per identity. */
const hubs = new Map<string, ProxyHub>();

function hubKey(controlBase: string, identityPath: string | undefined): string {
  return `${controlBase} ${identityPath ?? ''}`;
}

/** Build a `proxy` tunnel provider (factory form, for config/tests). */
export function createProxyTunnel(opts: ProxyTunnelOptions = {}): TunnelProviderDef {
  return defineTunnelProvider({
    name: 'proxy',
    open: async ({ port, host, label }): Promise<TunnelHandle> => {
      const baseHost = resolveBaseHost(opts);
      const controlBase = resolveControlBase(opts, baseHost);
      const key = hubKey(controlBase, opts.identityPath);
      let hub = hubs.get(key);
      if (!hub) {
        hub = new ProxyHub(controlBase, baseHost, opts.identityPath, opts.logger, () =>
          hubs.delete(key),
        );
        hubs.set(key, hub);
      }
      const handle = await hub.addTarget(label ?? '', host, port);
      // Surface the pinned fingerprint once per process for the QR/debugging.
      const identity = await loadOrCreateIdentity(opts.identityPath);
      opts.logger?.info?.('proxy: exposed', {
        url: handle.url,
        fingerprint: fingerprint(identity.publicKey),
      });
      return handle;
    },
  });
}

/** The default `proxy` provider (reads `MOXXY_PROXY_HOST` at open time). */
export const proxyTunnel: TunnelProviderDef = createProxyTunnel();
