import { spawn } from 'node:child_process';
import { defineTunnelProvider, type TunnelHandle } from '@moxxy/sdk';
import { trackChild } from './child-cleanup.js';

const TRYCLOUDFLARE_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const URL_TIMEOUT_MS = 30_000;

/** Extract the assigned quick-tunnel URL from a chunk of cloudflared output. */
export function parseTrycloudflareUrl(chunk: string): string | null {
  return TRYCLOUDFLARE_RE.exec(chunk)?.[0] ?? null;
}

/**
 * cloudflared quick-tunnel provider — zero-config, no account. Spawns
 * `cloudflared tunnel --url http://host:port`, parses the assigned
 * `https://*.trycloudflare.com` URL, and exposes it. The child is tracked so it
 * is killed on `close()`, on tunnel-switch, and on process exit (no orphans).
 */
export const cloudflaredTunnel = defineTunnelProvider({
  name: 'cloudflared',
  isAvailable: () =>
    new Promise<boolean>((resolve) => {
      const child = spawn('cloudflared', ['--version']);
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
    }),
  open: ({ port, host }) =>
    new Promise<TunnelHandle>((resolve, reject) => {
      const child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://${host}:${port}`]);
      const untrack = trackChild(child);
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        void untrack();
        reject(new Error('cloudflared: timed out waiting for the tunnel URL'));
      }, URL_TIMEOUT_MS);
      timer.unref?.();

      const onData = (buf: Buffer): void => {
        if (settled) return; // drain quietly once resolved so the pipe never fills
        const url = parseTrycloudflareUrl(buf.toString('utf8'));
        if (!url) return;
        settled = true;
        clearTimeout(timer);
        resolve({ url, close: untrack });
      };

      child.stderr?.on('data', onData);
      child.stdout?.on('data', onData);
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void untrack();
        reject(err);
      });
      child.on('exit', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`cloudflared exited (code ${code}) before emitting a URL`));
      });
    }),
});
