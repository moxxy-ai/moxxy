import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
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
    // Bind BOTH loopback stacks. The redirect_uri uses `localhost`, which
    // Windows resolves to `::1` (IPv6) first while macOS/Linux use `127.0.0.1`
    // (IPv4). A v4-only listener therefore never receives the redirect on
    // Windows → the login hangs on "waiting for the browser". IPv4 is required;
    // IPv6 is best-effort (a host without it still works, since there
    // `localhost` is IPv4 anyway).
    const servers: Server[] = [];
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      // Single cleanup chokepoint: clear the timeout AND detach the abort
      // listener on every exit (success/timeout/abort/error), so neither a
      // dangling timer nor a lingering signal listener is left behind. Guard
      // each close()/fn() so a Server.close() that throws ERR_SERVER_NOT_RUNNING
      // (server pushed before its listen completed) can never strand the
      // remaining servers or skip the resolve/reject.
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      try {
        for (const s of servers) {
          try {
            s.close();
          } catch {
            /* not yet listening — nothing to close */
          }
        }
      } finally {
        fn();
      }
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

    // A signal that was ALREADY aborted before entry never fires `abort`, so
    // the listener above won't run — without this guard we'd bind two HTTP
    // servers and block for the full timeout, ignoring the cancel. (pollUntil
    // guards the same case.) settle() detaches the listener and skips binding.
    if (opts.signal?.aborted) {
      settle(() =>
        reject(
          new MoxxyError({
            code: 'NETWORK_ABORTED',
            message: 'OAuth flow was aborted.',
          }),
        ),
      );
      return;
    }

    const handleRequest = (req: IncomingMessage, res: ServerResponse): void => {
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
      settle(() => resolve(code));
    };

    const onFatalError = (e: NodeJS.ErrnoException): void => {
      if (e.code === 'EADDRINUSE') {
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
    };

    // IPv4 loopback — the required listener; its bind/port errors are fatal.
    const v4 = createServer(handleRequest);
    v4.on('error', onFatalError);
    v4.listen(opts.port, '127.0.0.1');
    servers.push(v4);

    // IPv6 loopback — Windows resolves `localhost` to ::1 first, so the
    // redirect lands here. Best-effort: swallow bind errors (host without IPv6,
    // or ::1 already bound), since the IPv4 listener above is the guaranteed
    // path and on such hosts `localhost` is IPv4 anyway.
    const v6 = createServer(handleRequest);
    v6.on('error', () => undefined);
    v6.listen(opts.port, '::1');
    servers.push(v6);
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
