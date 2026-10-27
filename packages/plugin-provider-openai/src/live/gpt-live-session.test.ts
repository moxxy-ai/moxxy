import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GPT_LIVE_MODEL, GptLiveSessionClient } from './gpt-live-session.js';

const OFFER = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n';
const ANSWER = 'v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\n';

interface Seen {
  readonly path: string | undefined;
  readonly authorization: string | undefined;
  readonly body: Record<string, unknown>;
}

/** OpenAI's `/v1/live/sessions` as a loopback server, the one external
 *  boundary; the OpenAI SDK under test is the real one. */
async function startOpenAi(reply: { status: number; body: unknown }) {
  const seen: Seen[] = [];
  const server: Server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8'); });
    request.on('end', () => {
      seen.push({ path: request.url, authorization: request.headers.authorization, body: JSON.parse(raw) as Record<string, unknown> });
      response.writeHead(reply.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseURL: `http://127.0.0.1:${port}/v1`, seen };
}

describe('GptLiveSessionClient', () => {
  let openai: Awaited<ReturnType<typeof startOpenAi>> | null = null;

  beforeEach(() => { openai = null; });
  afterEach(async () => {
    if (openai) await new Promise<void>((resolve) => openai?.server.close(() => resolve()));
  });

  it('starts a WebRTC session on the official API with the API key, client delegation and history', async () => {
    openai = await startOpenAi({
      status: 201,
      body: { session: { id: 'live_123' }, transport: { type: 'webrtc', sdp: ANSWER } },
    });
    const client = new GptLiveSessionClient({ resolveApiKey: async () => 'sk-test', baseURL: openai.baseURL });

    const answer = await client.start({
      sdp: OFFER,
      instructions: 'Be Moxxy Voice.',
      history: [
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'hi there' },
      ],
    });

    expect(answer).toEqual({ sdp: ANSWER, callId: 'live_123' });
    const request = openai.seen[0];
    expect(request?.path).toBe('/v1/live/sessions');
    expect(request?.authorization).toBe('Bearer sk-test');
    expect(request?.body).toEqual({
      session: {
        model: GPT_LIVE_MODEL,
        instructions: 'Be Moxxy Voice.',
        delegation: { type: 'client' },
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi there' }] },
        ],
      },
      transport: { type: 'webrtc', sdp: OFFER },
    });
    expect(GPT_LIVE_MODEL).toBe('gpt-live-1');
  });

  it('sends no history field when the chat is empty', async () => {
    openai = await startOpenAi({
      status: 201,
      body: { session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: ANSWER } },
    });
    const client = new GptLiveSessionClient({ resolveApiKey: async () => 'sk-test', baseURL: openai.baseURL });

    await client.start({ sdp: OFFER, instructions: 'x', history: [] });

    expect(openai.seen[0]?.body.session).not.toHaveProperty('input');
  });

  it('asks for an OpenAI API key, and calls nothing, when none is saved', async () => {
    openai = await startOpenAi({ status: 500, body: {} });
    const client = new GptLiveSessionClient({ resolveApiKey: async () => null, baseURL: openai.baseURL });

    await expect(client.start({ sdp: OFFER, instructions: 'x', history: [] }))
      .rejects.toThrow(/OpenAI API key/);
    expect(openai.seen).toHaveLength(0);
  });

  it('reports what OpenAI said when it refuses the session', async () => {
    openai = await startOpenAi({
      status: 400,
      body: { error: { message: 'Failed to parse offer', type: 'invalid_request_error', code: 'invalid_offer' } },
    });
    const client = new GptLiveSessionClient({ resolveApiKey: async () => 'sk-test', baseURL: openai.baseURL });

    await expect(client.start({ sdp: OFFER, instructions: 'x', history: [] }))
      .rejects.toThrow(/Failed to parse offer/);
  });

  it('rejects an offer that is not SDP before calling OpenAI', async () => {
    openai = await startOpenAi({ status: 500, body: {} });
    const client = new GptLiveSessionClient({ resolveApiKey: async () => 'sk-test', baseURL: openai.baseURL });

    await expect(client.start({ sdp: 'not sdp', instructions: 'x', history: [] }))
      .rejects.toThrow(/Invalid GPT-Live offer SDP/);
    expect(openai.seen).toHaveLength(0);
  });
});
