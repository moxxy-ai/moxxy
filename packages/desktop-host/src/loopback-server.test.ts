import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startLoopbackServer, type LoopbackServer } from './loopback-server';

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/**
 * Raw HTTP client so we can send a custom Host header and un-normalised
 * (percent-encoded) paths — `fetch` collapses `../` before it ever hits the
 * server, which would defeat the traversal test.
 */
function raw(
  port: number,
  rawPath: string,
  opts: { method?: string; host?: string } = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: rawPath,
        method: opts.method ?? 'GET',
        headers: { Host: opts.host ?? `127.0.0.1:${port}` },
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

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'moxxy-loopback-'));
    await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>app</title>');
    await writeFile(path.join(dir, 'focus.html'), '<!doctype html><title>focus</title>');
    await mkdir(path.join(dir, 'assets'));
    await writeFile(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
    // A secret OUTSIDE the served root — traversal attempts must never reach it.
    await writeFile(path.join(path.dirname(dir), 'outside-secret.txt'), 'TOPSECRET');
    server = await startLoopbackServer({ root: dir, ports: [0] });
    port = server.port;
  });

  afterAll(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
    await rm(path.join(path.dirname(dir), 'outside-secret.txt'), { force: true });
  });

  it('binds loopback and reports an http://127.0.0.1 origin', () => {
    expect(server.origin).toBe(`http://127.0.0.1:${port}`);
    expect(server.url('index.html')).toBe(`http://127.0.0.1:${port}/index.html`);
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

  it('rejects a mismatched Host header (DNS-rebind defense)', async () => {
    const res = await raw(port, '/index.html', { host: 'evil.example' });
    expect(res.status).toBe(403);
    const right = await raw(port, '/index.html', { host: `localhost:${port}` });
    expect(right.status).toBe(200); // localhost on the bound port is allowed
  });

  it('close() is idempotent', async () => {
    const s = await startLoopbackServer({ root: dir, ports: [0] });
    await s.close();
    await s.close(); // must not throw
  });
});
