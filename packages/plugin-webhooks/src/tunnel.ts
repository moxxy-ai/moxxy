import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';

/**
 * `cloudflared` integration. We pick cloudflared as the default because
 * its quick tunnels (`cloudflared tunnel --url http://localhost:PORT`)
 * are free, anonymous (no account required), and just print the public
 * URL on stderr. That's exactly the UX a non-technical user needs:
 * agent runs the command, parses the URL, persists it, done.
 *
 * `ngrok` is a fine alternative but requires an auth token from a free
 * signup. If the user already has it configured, the helper exposes a
 * `kind: 'ngrok'` mode; otherwise we default to cloudflared.
 */

export interface TunnelStartOptions {
  readonly kind: 'cloudflared' | 'ngrok';
  readonly port: number;
  readonly host?: string;
  /** Timeout in ms to wait for the URL line. Default 30s. */
  readonly urlTimeoutMs?: number;
  /** Optional extra args appended to the spawn. */
  readonly extraArgs?: ReadonlyArray<string>;
}

export interface RunningTunnel {
  readonly kind: 'cloudflared' | 'ngrok';
  readonly url: string;
  readonly pid: number;
  readonly stop: () => Promise<void>;
}

const CLOUDFLARED_URL_RE = /https:\/\/[A-Za-z0-9.-]+\.trycloudflare\.com/;
const NGROK_URL_RE = /https:\/\/[A-Za-z0-9.-]+\.ngrok[a-z.-]*\.app/;

export async function isTunnelCliAvailable(kind: 'cloudflared' | 'ngrok'): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(kind, ['--version'], { stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });
}

/**
 * Spawn a cloudflared/ngrok quick tunnel and resolve once we've parsed
 * the public URL out of its output. The returned `stop` kills the
 * child cleanly; not awaiting it leaks the process, so the tools layer
 * persists the PID and offers `webhook_tunnel_stop`.
 */
export async function startTunnel(opts: TunnelStartOptions): Promise<RunningTunnel> {
  const host = opts.host ?? '127.0.0.1';
  const target = `http://${host}:${opts.port}`;
  const args = opts.kind === 'cloudflared'
    ? ['tunnel', '--no-autoupdate', '--url', target, ...(opts.extraArgs ?? [])]
    : ['http', `${opts.port}`, '--log=stdout', ...(opts.extraArgs ?? [])];
  const timeoutMs = opts.urlTimeoutMs ?? 30_000;

  let child: ChildProcess;
  try {
    child = spawn(opts.kind, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    throw new Error(
      `failed to spawn ${opts.kind} — is it installed? (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const urlRe = opts.kind === 'cloudflared' ? CLOUDFLARED_URL_RE : NGROK_URL_RE;

  const urlPromise = new Promise<string>((resolve, reject) => {
    let settled = false;
    const onChunk = (buf: Buffer): void => {
      const match = urlRe.exec(buf.toString('utf8'));
      if (match && !settled) {
        settled = true;
        resolve(match[0]);
      }
    };
    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);
    child.once('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    child.once('exit', (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`${opts.kind} exited before printing a URL (code=${code ?? 'null'})`));
      }
    });
    setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`timed out waiting ${timeoutMs}ms for ${opts.kind} URL`));
      }
    }, timeoutMs).unref?.();
  });

  let url: string;
  try {
    url = await urlPromise;
  } catch (err) {
    try {
      child.kill('SIGTERM');
    } catch { /* ignore */ }
    throw err;
  }

  const pid = child.pid ?? -1;

  return {
    kind: opts.kind,
    url,
    pid,
    stop: async () => {
      if (!child.killed && child.exitCode === null) {
        child.kill('SIGTERM');
        try {
          await Promise.race([
            once(child, 'exit'),
            new Promise<void>((r) => setTimeout(r, 2000).unref?.()),
          ]);
        } catch { /* ignore */ }
        if (!child.killed && child.exitCode === null) {
          try { child.kill('SIGKILL'); } catch { /* ignore */ }
        }
      }
    },
  };
}
