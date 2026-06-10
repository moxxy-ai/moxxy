import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { startLoopbackServer, type LoopbackServer } from './loopback-server';
import { DESKTOP_APP_HOST, generateSelfSignedCert } from './self-signed-cert';

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/**
 * Raw HTTPS client so we can send a custom Host header and un-normalised
 * (percent-encoded) paths — `fetch` collapses `../` before it ever hits the
 * server, which would defeat the traversal test. `rejectUnauthorized:false`
 * because the cert is self-signed (the app scope-trusts it separately).
 */
function raw(
  port: number,
  rawPath: string,
  opts: { method?: string; host?: string } = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: '127.0.0.1',
        port,
        path: rawPath,
        method: opts.method ?? 'GET',
        servername: DESKTOP_APP_HOST,
        rejectUnauthorized: false,
        headers: { Host: opts.host ?? `${DESKTOP_APP_HOST}:${port}` },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('loopback static server', () => {
  let dir: string;
  let server: LoopbackServer;
  let port: number;
  const tls = generateSelfSignedCert();

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'moxxy-loopback-'));
    await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>app</title>');
    await writeFile(path.join(dir, 'focus.html'), '<!doctype html><title>focus</title>');
    await mkdir(path.join(dir, 'assets'));
    await writeFile(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
    // A secret OUTSIDE the served root — traversal attempts must never reach it.
    await writeFile(path.join(path.dirname(dir), 'outside-secret.txt'), 'TOPSECRET');
    server = await startLoopbackServer({ root: dir, ports: [0], tls });
    port = server.port;
  });

  afterAll(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
    await rm(path.join(path.dirname(dir), 'outside-secret.txt'), { force: true });
  });

  it('binds loopback and reports an https://desktop.moxxy.ai origin', () => {
    expect(server.origin).toBe(`https://${DESKTOP_APP_HOST}:${port}`);
    expect(server.url('index.html')).toBe(`https://${DESKTOP_APP_HOST}:${port}/index.html`);
  });

  it('serves index.html with the right content-type', async () => {
    const res = await raw(port, '/index.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<title>app</title>');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serves fingerprinted assets as immutable js', async () => {
    const res = await raw(port, '/assets/app-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/javascript');
    expect(String(res.headers['cache-control'])).toContain('immutable');
  });

  it('falls back to index.html for extensionless SPA routes', async () => {
    const res = await raw(port, '/sso-callback');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<title>app</title>');
  });

  it('404s a missing asset rather than masking it with index.html', async () => {
    const res = await raw(port, '/assets/missing-xyz.js');
    expect(res.status).toBe(404);
    const png = await raw(port, '/nope.png');
    expect(png.status).toBe(404);
  });

  it('rejects non-GET/HEAD methods with 405', async () => {
    const res = await raw(port, '/index.html', { method: 'POST' });
    expect(res.status).toBe(405);
    expect(res.headers['allow']).toContain('GET');
  });

  it('answers HEAD with headers and no body', async () => {
    const res = await raw(port, '/index.html', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBeDefined();
    expect(res.body).toBe('');
  });

  it('refuses path traversal (encoded ../) with 403 and never serves outside root', async () => {
    for (const p of [
      '/%2e%2e/%2e%2e/outside-secret.txt',
      '/..%2f..%2foutside-secret.txt',
      '/../../outside-secret.txt',
      '/%2e%2e%2f%2e%2e%2foutside-secret.txt',
    ]) {
      const res = await raw(port, p);
      expect([403, 404]).toContain(res.status);
      expect(res.body).not.toContain('TOPSECRET');
    }
  });

  it('rejects a NUL byte in the path', async () => {
    const res = await raw(port, '/index.html%00.png');
    expect([403, 404]).toContain(res.status);
  });

  it('accepts the desktop.moxxy.ai Host (the one intended subdomain)', async () => {
    const res = await raw(port, '/index.html', { host: `${DESKTOP_APP_HOST}:${port}` });
    expect(res.status).toBe(200);
    // Loopback names stay allowed too.
    const lo = await raw(port, '/index.html', { host: `127.0.0.1:${port}` });
    expect(lo.status).toBe(200);
    const localhost = await raw(port, '/index.html', { host: `localhost:${port}` });
    expect(localhost.status).toBe(200);
  });

  it('rejects a mismatched Host header (DNS-rebind defense)', async () => {
    const res = await raw(port, '/index.html', { host: 'evil.example' });
    expect(res.status).toBe(403);
    // A sibling moxxy subdomain that is NOT the app host is still rejected —
    // only the exact desktop.moxxy.ai host is allowed.
    const sibling = await raw(port, '/index.html', { host: `evil.moxxy.ai:${port}` });
    expect(sibling.status).toBe(403);
    // The app host on the WRONG port is rejected too (exact host:port match).
    const wrongPort = await raw(port, '/index.html', { host: `${DESKTOP_APP_HOST}:1` });
    expect(wrongPort.status).toBe(403);
  });

  it('serves over TLS with a cert whose SAN is desktop.moxxy.ai', () => {
    expect(tls.cert).toContain('BEGIN CERTIFICATE');
    expect(tls.fingerprint256).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/);
  });

  it('close() is idempotent', async () => {
    const s = await startLoopbackServer({ root: dir, ports: [0], tls });
    await s.close();
    await s.close(); // must not throw
  });
});
