import {
  defineTunnelProvider,
  isCliTunnelAvailable,
  spawnCliTunnel,
  type CliTunnelHandle,
  type TunnelProviderDef,
} from '@moxxy/sdk';

/**
 * Tunnel support for the webhooks listener.
 *
 * We pick cloudflared as the default because its quick tunnels
 * (`cloudflared tunnel --url http://localhost:PORT`) are free, anonymous (no
 * account required), and just print the public URL. That's exactly the UX a
 * non-technical user needs: agent runs the command, parses the URL, persists
 * it, done. `ngrok` is a fine alternative but requires an auth token from a
 * free signup.
 *
 * Both are expressed as the SDK's `TunnelProviderDef` contract — the same
 * abstraction the web channel uses — over the shared `spawnCliTunnel` helper
 * (single spawn-and-parse-URL implementation, with no-orphan child cleanup).
 */

export type TunnelKind = 'cloudflared' | 'ngrok';

const CLOUDFLARED_URL_RE = /https:\/\/[A-Za-z0-9.-]+\.trycloudflare\.com/;
const NGROK_URL_RE = /https:\/\/[A-Za-z0-9.-]+\.ngrok[a-z.-]*\.app/;

/** Per-kind spawn config shared by the provider def and the timeout-aware `startTunnel`. */
const SPAWN_CONFIG: Record<TunnelKind, { cmd: string; urlRegex: RegExp; args(port: number, host: string): string[] }> = {
  cloudflared: {
    cmd: 'cloudflared',
    urlRegex: CLOUDFLARED_URL_RE,
    args: (port, host) => ['tunnel', '--no-autoupdate', '--url', `http://${host}:${port}`],
  },
  ngrok: {
    cmd: 'ngrok',
    urlRegex: NGROK_URL_RE,
    args: (port) => ['http', String(port), '--log=stdout'],
  },
};

function openCliTunnel(kind: TunnelKind, port: number, host: string, timeoutMs?: number): Promise<CliTunnelHandle> {
  const cfg = SPAWN_CONFIG[kind];
  return spawnCliTunnel({
    cmd: cfg.cmd,
    args: cfg.args(port, host),
    urlRegex: cfg.urlRegex,
    name: kind,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
}

/** The webhooks tunnel providers, keyed by kind. */
export const webhookTunnelProviders: Record<TunnelKind, TunnelProviderDef> = {
  cloudflared: defineTunnelProvider({
    name: 'cloudflared',
    isAvailable: () => isCliTunnelAvailable('cloudflared'),
    open: ({ port, host }) => openCliTunnel('cloudflared', port, host),
  }),
  ngrok: defineTunnelProvider({
    name: 'ngrok',
    isAvailable: () => isCliTunnelAvailable('ngrok'),
    open: ({ port, host }) => openCliTunnel('ngrok', port, host),
  }),
};

export interface TunnelStartOptions {
  readonly kind: TunnelKind;
  readonly port: number;
  readonly host?: string;
  /** Timeout in ms to wait for the URL line. Default 30s. */
  readonly urlTimeoutMs?: number;
}

export interface RunningTunnel {
  readonly kind: TunnelKind;
  readonly url: string;
  readonly pid: number;
  readonly stop: () => Promise<void>;
}

/** Whether the named tunnel CLI is installed and runnable (`<cmd> --version` exits 0). */
export function isTunnelCliAvailable(kind: TunnelKind): Promise<boolean> {
  const provider = webhookTunnelProviders[kind];
  return provider.isAvailable ? provider.isAvailable() : Promise.resolve(false);
}

/**
 * Open a cloudflared/ngrok quick tunnel via the shared CLI-tunnel helper and
 * resolve once we've parsed the public URL out of its output. Mirrors the
 * registered `TunnelProviderDef.open()` for the default-timeout path, honoring
 * a per-call `urlTimeoutMs` override the contract's `open(opts)` can't carry.
 * The returned `stop` kills the child cleanly; not awaiting it leaks the
 * process, so the tools layer persists the PID and offers `webhook_tunnel_stop`.
 */
export async function startTunnel(opts: TunnelStartOptions): Promise<RunningTunnel> {
  const host = opts.host ?? '127.0.0.1';
  const handle = await openCliTunnel(opts.kind, opts.port, host, opts.urlTimeoutMs);
  return {
    kind: opts.kind,
    url: handle.url,
    pid: handle.pid,
    stop: () => handle.close(),
  };
}
