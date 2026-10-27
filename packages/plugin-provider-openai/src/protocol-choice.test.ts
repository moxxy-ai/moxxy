import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import OpenAI from 'openai';
import { afterEach, describe, expect, it } from 'vitest';
import type { LLMProvider, ProviderEvent } from '@moxxy/sdk';
import { defineOpenAICompatProvider } from './compat.js';
import { openaiProviderDef } from './index.js';
import { OpenAIProvider } from './provider.js';

// The vendor's HTTP server is the external boundary: the real OpenAI SDK talks
// to a loopback server that plays a server with or without the Responses route.
interface Route { readonly status: number; readonly error?: { message: string; type?: string; code?: string } }
let server: Server | undefined;
let hits: string[] = [];

async function endpoint(responses: Route): Promise<string> {
  hits = [];
  server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    const path = req.url ?? '';
    hits.push(path);
    if (path.endsWith('/responses')) {
      if (responses.status !== 200) {
        res.writeHead(responses.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: responses.error ?? { message: 'Not found' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'from responses' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1 } } })}\n\n`);
      res.end();
      return;
    }
    if (path.endsWith('/chat/completions')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunk = (delta: object, finish: string | null) => ({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] });
      res.write(`data: ${JSON.stringify(chunk({ role: 'assistant', content: 'from chat' }, null))}\n\n`);
      res.write(`data: ${JSON.stringify(chunk({}, 'stop'))}\n\n`);
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server');
  return `http://127.0.0.1:${address.port}/v1`;
}

afterEach(async () => {
  if (!server) return;
  const closing = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closing;
  server = undefined;
});

async function say(provider: LLMProvider): Promise<{ text: string; errors: string[]; starts: number }> {
  let text = '';
  const errors: string[] = [];
  let starts = 0;
  for await (const event of provider.stream({ model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }) as AsyncIterable<ProviderEvent>) {
    if (event.type === 'text_delta') text += event.delta;
    if (event.type === 'error') errors.push(event.message);
    if (event.type === 'message_start') starts += 1;
  }
  return { text, errors, starts };
}

const vendor = defineOpenAICompatProvider({ name: 'acme', baseURL: 'http://unused.invalid/v1', defaultModel: 'm', models: [] });
const compatClient = (baseURL: string, extra: Record<string, unknown> = {}) =>
  vendor.createClient({ apiKey: 'sk-test', baseURL, maxRetries: 0, ...extra }) as LLMProvider;

describe('OpenAI itself always uses the Responses API', () => {
  it('never falls back to Chat Completions on OpenAI\'s own address', async () => {
    const baseURL = await endpoint({ status: 404, error: { message: 'Not found' } });
    // No configured address means OpenAI's own; the SDK client only carries the
    // loopback transport.
    const provider = new OpenAIProvider({ client: new OpenAI({ apiKey: 'sk-test', baseURL, maxRetries: 0 }) });

    const result = await say(provider);

    expect(result.errors).toHaveLength(1);
    expect(hits).toEqual(['/v1/responses']);
  });

  it('treats an explicit api.openai.com address as OpenAI', async () => {
    const baseURL = await endpoint({ status: 404 });
    const provider = new OpenAIProvider({ baseURL: 'https://api.openai.com/v1', client: new OpenAI({ apiKey: 'sk-test', baseURL, maxRetries: 0 }) });

    await say(provider);

    expect(hits).toEqual(['/v1/responses']);
  });
});

describe('every other OpenAI-compatible server tries Responses, then Chat Completions', () => {
  it('uses Responses when the server has it', async () => {
    const baseURL = await endpoint({ status: 200 });
    const result = await say(compatClient(baseURL));
    expect(result).toEqual({ text: 'from responses', errors: [], starts: 1 });
    expect(hits).toEqual(['/v1/responses']);
  });

  it.each([404, 405])('falls back once on %i, answers the same request, and remembers it', async (status) => {
    const baseURL = await endpoint({ status });
    const provider = compatClient(baseURL);

    expect(await say(provider)).toEqual({ text: 'from chat', errors: [], starts: 1 });
    expect(await say(provider)).toEqual({ text: 'from chat', errors: [], starts: 1 });
    expect(hits).toEqual(['/v1/responses', '/v1/chat/completions', '/v1/chat/completions']);
  });

  it('falls back for the openai provider behind a custom address, such as a company proxy', async () => {
    const baseURL = await endpoint({ status: 404 });
    const provider = openaiProviderDef.createClient({ apiKey: 'sk-test', baseURL, maxRetries: 0 }) as LLMProvider;

    expect((await say(provider)).text).toBe('from chat');
    expect(hits).toEqual(['/v1/responses', '/v1/chat/completions']);
  });

  it.each([
    [400, { message: "Unsupported parameter: 'store'", type: 'invalid_request_error' }],
    [401, { message: 'Incorrect API key provided', type: 'invalid_request_error' }],
    [404, { message: 'The model `m` does not exist', type: 'invalid_request_error', code: 'model_not_found' }],
  ])('shows a real %i error instead of switching quietly', async (status, error) => {
    const baseURL = await endpoint({ status, error });
    const result = await say(compatClient(baseURL));

    expect(result.errors).toHaveLength(1);
    expect(hits).toEqual(['/v1/responses']);
  });

  it('keeps an explicit protocol from the config file', async () => {
    const baseURL = await endpoint({ status: 404 });
    expect((await say(compatClient(baseURL, { api: 'chat-completions' }))).text).toBe('from chat');
    expect((await say(compatClient(baseURL, { api: 'responses' }))).errors).toHaveLength(1);
    expect(hits).toEqual(['/v1/chat/completions', '/v1/responses']);
  });
});
