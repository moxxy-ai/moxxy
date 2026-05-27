import { spawn } from 'node:child_process';
import { defineTunnelProvider, type TunnelHandle } from '@moxxy/sdk';
import { trackChild } from './child-cleanup.js';

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
 * the surface falls back to the local URL. Child is tracked → no orphans.
 */
export const ngrokTunnel = defineTunnelProvider({
  name: 'ngrok',
  isAvailable: () =>
    new Promise<boolean>((resolve) => {
      const child = spawn('ngrok', ['--version']);
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
    }),
  open: ({ port }) =>
    new Promise<TunnelHandle>((resolve, reject) => {
      const child = spawn('ngrok', ['http', String(port), '--log', 'stdout', '--log-format', 'json']);
      const untrack = trackChild(child);
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        void untrack();
        reject(new Error('ngrok: timed out waiting for the tunnel URL'));
      }, URL_TIMEOUT_MS);
      timer.unref?.();

      const onData = (buf: Buffer): void => {
        if (settled) return;
        const url = parseNgrokUrl(buf.toString('utf8'));
        if (!url) return;
        settled = true;
        clearTimeout(timer);
        resolve({ url, close: untrack });
      };

      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
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
        reject(new Error(`ngrok exited (code ${code}) before emitting a URL`));
      });
    }),
});
