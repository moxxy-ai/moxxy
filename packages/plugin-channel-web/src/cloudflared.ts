import { defineTunnelProvider, isCliTunnelAvailable, spawnCliTunnel, type TunnelHandle } from '@moxxy/sdk';

const TRYCLOUDFLARE_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const URL_TIMEOUT_MS = 30_000;

/** Extract the assigned quick-tunnel URL from a chunk of cloudflared output. */
export function parseTrycloudflareUrl(chunk: string): string | null {
  return TRYCLOUDFLARE_RE.exec(chunk)?.[0] ?? null;
}

/**
 * cloudflared quick-tunnel provider — zero-config, no account. Spawns
 * `cloudflared tunnel --url http://host:port`, parses the assigned
 * `https://*.trycloudflare.com` URL, and exposes it. The child is killed on
 * `close()`, on tunnel-switch, and on process exit (no orphans) via the shared
 * `spawnCliTunnel` helper.
 */
export const cloudflaredTunnel = defineTunnelProvider({
  name: 'cloudflared',
  isAvailable: () => isCliTunnelAvailable('cloudflared'),
  open: ({ port, host }): Promise<TunnelHandle> =>
    spawnCliTunnel({
      cmd: 'cloudflared',
      args: ['tunnel', '--no-autoupdate', '--url', `http://${host}:${port}`],
      urlRegex: TRYCLOUDFLARE_RE,
      timeoutMs: URL_TIMEOUT_MS,
      name: 'cloudflared',
    }),
});
