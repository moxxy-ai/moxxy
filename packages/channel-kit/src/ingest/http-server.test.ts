import { afterEach, describe, expect, it } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { IngestHttpServer, respondJson } from './http-server.js';

const EVENTS = '/test/events';
const HEALTH = '/test/health';

interface Harness {
  server: IngestHttpServer;
  base: string;
  received: Array<{ body: string; headers: Record<string, unknown> }>;
  stop(): Promise<void>;
}

async function makeServer(
  over: Partial<{
    verifyOk: boolean;
    maxBodyBytes: number;
    handleVerified: (raw: Buffer, req: IncomingMessage, res: ServerResponse) => Promise<void>;
  }> = {},
): Promise<Harness> {
  const received: Harness['received'] = [];
  const server = new IngestHttpServer({
    eventsPath: EVENTS,
    healthPath: HEALTH,
    healthBody: () => ({ status: 'ok', listener: 'test' }),
    label: 'test',
    ...(over.maxBodyBytes !== undefined ? { maxBodyBytes: over.maxBodyBytes } : {}),
    verify: () =>
      (over.verifyOk ?? true) ? { ok: true } : { ok: false, reason: 'bad signature' },
    handleVerified:
      over.handleVerified ??
      (async (raw, req, res) => {
        received.push({ body: raw.toString('utf8'), headers: { ...req.headers } });
        respondJson(res, 200, { status: 'ok' });
      }),
  });
  const bound = await server.start();
  return {
    server,
    base: `http://${bound.host}:${bound.port}`,
    received,
    stop: () => server.stop(),
  };
}

describe('IngestHttpServer', () => {
  let h: Harness;
  afterEach(async () => {
    await h?.stop();
  });

  it('serves the health probe', async () => {
    h = await makeServer();
    const res = await fetch(`${h.base}${HEALTH}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', listener: 'test' });
  });

  it('404s anything that is not POST on the events path', async () => {
    h = await makeServer();
    expect((await fetch(`${h.base}${EVENTS}`, { method: 'GET' })).status).toBe(404);
    expect((await fetch(`${h.base}/other`, { method: 'POST', body: '{}' })).status).toBe(404);
  });

  it('hands the verified raw body to handleVerified', async () => {
    h = await makeServer();
    const body = JSON.stringify({ hello: 'world' });
    const res = await fetch(`${h.base}${EVENTS}`, { method: 'POST', body });
    expect(res.status).toBe(200);
    expect(h.received).toHaveLength(1);
    expect(h.received[0]?.body).toBe(body);
  });

  it('401s when verification fails, before handleVerified', async () => {
    h = await makeServer({ verifyOk: false });
    const res = await fetch(`${h.base}${EVENTS}`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'verification_failed' });
    expect(h.received).toHaveLength(0);
  });

  it('rejects an oversized body without reaching handleVerified', async () => {
    h = await makeServer({ maxBodyBytes: 16 });
    // readRequestBody may destroy the socket at the cap, so accept 413 or a
    // dropped connection — what MUST hold is that the handler never ran.
    let status = 0;
    try {
      const res = await fetch(`${h.base}${EVENTS}`, {
        method: 'POST',
        body: 'x'.repeat(500),
      });
      status = res.status;
    } catch {
      status = -1;
    }
    expect([413, -1]).toContain(status);
    expect(h.received).toHaveLength(0);
  });

  it('a throwing handler becomes a 500, never an uncaught exception', async () => {
    h = await makeServer({
      handleVerified: async () => {
        throw new Error('boom');
      },
    });
    const res = await fetch(`${h.base}${EVENTS}`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal' });
  });

  it('start is idempotent and stop unbinds', async () => {
    h = await makeServer();
    const again = await h.server.start();
    expect(again.port).toBe(h.server.port);
    await h.stop();
    await expect(fetch(`${h.base}${HEALTH}`)).rejects.toThrow();
    h = { stop: async () => {} } as Harness;
  });
});
