import { defineTunnelProvider, type TunnelHandle } from '@moxxy/sdk';
import { isCliTunnelAvailable, spawnCliTunnel } from '@moxxy/sdk/server';

const NGROK_URL_RE = /https:\/\/[a-z0-9-]+\.ngrok(?:-free)?\.(?:app|io|dev)/i;
const URL_TIMEOUT_MS = 30_000;

/** Extract the public URL from ngrok's JSON log output. */
export function parseNgrokUrl(chunk: string): string | null {
  return NGROK_URL_RE.exec(chunk)?.[0] ?? null;
}

/**
 * ngrok tunnel provider. Spawns `ngrok http PORT --log stdout --log-format json`
 * and parses the assigned public URL. Requires `ngrok` on PATH and a configured
 * authtoken (`ngrok config add-authtoken …`); without those `open` rejects and
 * the surface falls back to the local URL. The child is killed on `close()`,
 * on tunnel-switch, and on process exit (no orphans) via the shared
 * `spawnCliTunnel` helper.
 */
export const ngrokTunnel = defineTunnelProvider({
  name: 'ngrok',
  isAvailable: () => isCliTunnelAvailable('ngrok'),
  open: ({ port }): Promise<TunnelHandle> =>
    spawnCliTunnel({
      cmd: 'ngrok',
      args: ['http', String(port), '--log', 'stdout', '--log-format', 'json'],
      urlRegex: NGROK_URL_RE,
      timeoutMs: URL_TIMEOUT_MS,
      name: 'ngrok',
    }),
});
