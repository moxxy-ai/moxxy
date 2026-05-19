import { createServer, type Server } from 'node:http';
import { MoxxyError } from '@moxxy/sdk';

interface WaitForCallbackOpts {
  readonly port: number;
  readonly path: string;
  readonly expectedState: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export function waitForCallback(opts: WaitForCallbackOpts): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let server: Server | null = null;
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (server) server.close();
      fn();
    };

    const timer = setTimeout(() => {
      settle(() =>
        reject(
          new MoxxyError({
            code: 'OAUTH_FLOW_TIMEOUT',
            message: `OAuth callback timed out after ${Math.round(opts.timeoutMs / 1000)}s.`,
            hint: 'Re-run the login command and complete the consent screen before the timeout.',
            context: { port: opts.port, path: opts.path, timeout_ms: opts.timeoutMs },
          }),
        ),
      );
    }, opts.timeoutMs);
    timer.unref?.();

    const onAbort = (): void => {
      settle(() =>
        reject(
          new MoxxyError({
            code: 'NETWORK_ABORTED',
            message: 'OAuth flow was aborted.',
          }),
        ),
      );
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${opts.port}`);
      if (url.pathname !== opts.path) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      const err = url.searchParams.get('error');
      const errDesc = url.searchParams.get('error_description');
      if (err) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(htmlPage('OAuth error', `${err}${errDesc ? `: ${errDesc}` : ''}`));
        clearTimeout(timer);
        const denied = err === 'access_denied';
        settle(() =>
          reject(
            new MoxxyError({
              code: denied ? 'OAUTH_FLOW_DENIED' : 'AUTH_INVALID',
              message: denied
                ? 'You declined the authorization request.'
                : `Authorization server returned an error: ${err}${errDesc ? ` — ${errDesc}` : ''}.`,
              ...(denied
                ? { hint: 'Re-run the login command and approve the consent screen to continue.' }
                : {}),
              context: { provider_error: err, ...(errDesc ? { description: errDesc } : {}) },
            }),
          ),
        );
        return;
      }
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      if (!code || !returnedState) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(htmlPage('OAuth error', 'callback was missing code or state'));
        clearTimeout(timer);
        settle(() =>
          reject(
            new MoxxyError({
              code: 'AUTH_INVALID',
              message: 'OAuth callback was missing code or state — the upstream redirect is malformed.',
              hint: 'Re-run the login command. If this persists, the provider may have rejected the request.',
            }),
          ),
        );
        return;
      }
      if (returnedState !== opts.expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(htmlPage('OAuth error', 'state mismatch — possible CSRF, refusing'));
        clearTimeout(timer);
        settle(() =>
          reject(
            new MoxxyError({
              code: 'OAUTH_FLOW_STATE_MISMATCH',
              message: 'OAuth state mismatch — possible CSRF attempt, refusing to continue.',
              hint:
                'Make sure no other moxxy login is running at the same time, and re-run the command. ' +
                'If this keeps happening, your browser or a proxy may be tampering with redirects.',
            }),
          ),
        );
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlPage('Authorized', 'You can close this window — moxxy received the token.'));
      clearTimeout(timer);
      settle(() => resolve(code));
    });
    server.on('error', (e) => {
      clearTimeout(timer);
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE') {
        settle(() =>
          reject(
            new MoxxyError({
              code: 'OAUTH_FLOW_PORT_BUSY',
              message: `OAuth callback port ${opts.port} is already in use.`,
              hint:
                'Another moxxy login may already be running, or the port is occupied by something else. ' +
                `Stop the other process, or set a different port for this provider's redirect.`,
              context: { port: opts.port },
              cause: e,
            }),
          ),
        );
        return;
      }
      settle(() =>
        reject(
          MoxxyError.wrap(e, {
            code: 'INTERNAL',
            message: `OAuth callback server failed: ${e.message}`,
          }),
        ),
      );
    });
    server.listen(opts.port, '127.0.0.1');
  });
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#111;color:#eee;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0}h1{font-weight:300}</style>
</head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
