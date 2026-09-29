import { once } from 'node:events';
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GPT_LIVE_MODEL,
  GptLiveCallClient,
  buildGptLiveCallsUrl,
} from './gpt-live-call.js';

// The ChatGPT realtime backend is an external network API, so these tests stand
// up a real loopback HTTP server in its place (the same seam the Codex
// transcriber uses). Everything on the moxxy side — URL, headers, body, SDP and
// Location parsing — runs for real.
interface Captured {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: unknown;
}

const OFFER = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';
const ANSWER = 'v=0\r\no=- 3 4 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\na=ice-lite\r\n';
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function startBackend(
  respond: (res: ServerResponse) => void,
): Promise<{ readonly baseUrl: string; readonly requests: Captured[] }> {
  const requests: Captured[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
    const raw = Buffer.concat(chunks).toString('utf8');
    requests.push({
      method: req.method ?? '',
      url: req.url ?? '',
      headers: req.headers,
      body: raw ? JSON.parse(raw) : null,
    });
    respond(res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  closers.push(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}/backend-api`, requests };
}

function answerWith(res: ServerResponse): void {
  res.writeHead(201, {
    'content-type': 'text/plain; charset=utf-8',
    location: '/v1/realtime/calls/rtc_u32_ETCRZp3oN5zeME7AqoW9SLcJTYbQ5Vvy',
  });
  res.end(ANSWER);
}

function client(baseUrl: string): GptLiveCallClient {
  return new GptLiveCallClient({
    baseUrl,
    sessionIdProvider: () => 'voice-session-1',
    resolveCredentials: async () => ({ accessToken: 'access-token-123', accountId: 'acct-9' }),
  });
}

describe('GptLiveCallClient', () => {
  it('negotiates a GPT-Live WebRTC call with the existing ChatGPT OAuth credentials', async () => {
    const backend = await startBackend(answerWith);

    const answer = await client(backend.baseUrl).start({
      sdp: OFFER,
      instructions: 'Answer the user yourself.',
      history: [
        { role: 'user', text: 'Sekretne słowo to pomarańcza.' },
        { role: 'assistant', text: 'Zapamiętałem.' },
      ],
    });

    expect(answer).toEqual({ sdp: ANSWER, callId: 'rtc_u32_ETCRZp3oN5zeME7AqoW9SLcJTYbQ5Vvy' });
    const [request] = backend.requests;
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas');
    expect(request?.headers).toMatchObject({
      authorization: 'Bearer access-token-123',
      'chatgpt-account-id': 'acct-9',
      'openai-alpha': 'quicksilver=v2',
      originator: 'codex_cli_rs',
      'x-session-id': 'voice-session-1',
      accept: 'application/sdp',
      'content-type': 'application/json',
    });
    expect(request?.body).toEqual({
      sdp: OFFER,
      session: {
        instructions: 'Answer the user yourself.',
        model: GPT_LIVE_MODEL,
        audio: { output: { voice: 'maple' } },
        delegation: { type: 'client' },
        initial_items: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Sekretne słowo to pomarańcza.' }] },
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Zapamiętałem.' }] },
        ],
      },
    });
  });

  it('omits initial items for an empty conversation', async () => {
    const backend = await startBackend(answerWith);

    await client(backend.baseUrl).start({ sdp: OFFER, instructions: 'Hi.', history: [] });

    const body = backend.requests[0]?.body as { session: Record<string, unknown> };
    expect(body.session).not.toHaveProperty('initial_items');
  });

  it('surfaces the backend rejection without leaking the bearer token', async () => {
    const backend = await startBackend((res) => {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end('{"detail":"Voice session access denied"}');
    });

    const failure = client(backend.baseUrl).start({ sdp: OFFER, instructions: 'x', history: [] });

    await expect(failure).rejects.toThrow(/403.*Voice session access denied/);
    await expect(failure).rejects.not.toThrow(/access-token-123/);
  });

  it('rejects an answer without a call location', async () => {
    const backend = await startBackend((res) => {
      res.writeHead(201, { 'content-type': 'text/plain' });
      res.end(ANSWER);
    });

    await expect(
      client(backend.baseUrl).start({ sdp: OFFER, instructions: 'x', history: [] }),
    ).rejects.toThrow(/Location/);
  });

  it('rejects an invalid offer before any credential leaves the process', async () => {
    const backend = await startBackend(answerWith);

    await expect(
      client(backend.baseUrl).start({ sdp: 'not-an-sdp', instructions: 'x', history: [] }),
    ).rejects.toThrow(/offer/);
    expect(backend.requests).toHaveLength(0);
  });
});

describe('buildGptLiveCallsUrl', () => {
  it('targets the ChatGPT backend by default', () => {
    expect(buildGptLiveCallsUrl()).toBe(
      'https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas',
    );
  });

  it('refuses to send OAuth credentials to any other origin', () => {
    expect(() => buildGptLiveCallsUrl('https://evil.example/backend-api')).toThrow(/Refusing/);
    expect(() => buildGptLiveCallsUrl('http://chatgpt.com/backend-api')).toThrow(/Refusing/);
  });
});
