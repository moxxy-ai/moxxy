import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { pairWithGatewayCode } from '../mobile/src/pairingClient';

describe('mobile pairing client', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    server = undefined;
  });

  it('refreshes the current pairing code when a scanned QR contains a stale one-time code', async () => {
    const requests: Array<{ path: string; body?: unknown }> = [];
    server = createServer(async (req, res) => {
      const path = req.url ?? '/';
      if (req.method === 'GET' && path === '/mobile/v1/pairing') {
        requests.push({ path });
        return sendJson(res, 200, { code: '393541' });
      }
      if (req.method === 'POST' && path === '/mobile/v1/pair') {
        const body = await readJson(req);
        requests.push({ path, body });
        if (body.code === '393541') return sendJson(res, 200, { token: 'fresh-token' });
        return sendJson(res, 401, { error: 'invalid_pairing_code' });
      }
      return sendJson(res, 404, { error: 'not_found' });
    });
    await listen(server);

    const result = await pairWithGatewayCode(serverUrl(server), '495730', { refreshOnInvalid: true });

    expect(result).toEqual({ ok: true, token: 'fresh-token', code: '393541' });
    expect(requests).toEqual([
      { path: '/mobile/v1/pair', body: { code: '495730' } },
      { path: '/mobile/v1/pairing' },
      { path: '/mobile/v1/pair', body: { code: '393541' } },
    ]);
  });

  it('keeps manual pairing strict when the typed code is invalid', async () => {
    server = createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/mobile/v1/pair') {
        await readJson(req);
        return sendJson(res, 401, { error: 'invalid_pairing_code' });
      }
      return sendJson(res, 404, { error: 'not_found' });
    });
    await listen(server);

    const result = await pairWithGatewayCode(serverUrl(server), '495730', { refreshOnInvalid: false });

    expect(result).toEqual({ ok: false, error: 'Invalid pairing code' });
  });
});

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}

function serverUrl(server: Server): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
