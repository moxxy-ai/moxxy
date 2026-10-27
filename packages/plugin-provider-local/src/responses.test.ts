import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import type { ProviderEvent } from '@moxxy/sdk';
import { localProviderDef } from './index.js';

// The local model server is the external boundary; the provider and the real
// OpenAI SDK run unchanged against it, on a port other than Ollama's default.
async function talkTo(
  serve: (req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>) => void,
): Promise<{ paths: string[]; events: ProviderEvent[] }> {
  const paths: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' || req.url === '/api/show') { res.writeHead(404); res.end(); return; }
    paths.push(req.url ?? '');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    serve(req, res, JSON.parse(raw));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test server');
    const client = localProviderDef.createClient({ baseURL: `http://127.0.0.1:${address.port}/v1`, maxRetries: 0 });
    const events: ProviderEvent[] = [];
    for await (const event of client.stream({ model: 'qwen3:8b', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })) events.push(event);
    return { paths, events };
  } finally {
    const closing = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closing;
  }
}

it('uses stateless Responses for an Ollama endpoint configured on a custom port', async () => {
  let body: Record<string, unknown> = {};
  const { paths, events } = await talkTo((_req, res, sent) => {
    body = sent;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    // Ollama 0.13.3 reports these totals without input_tokens_details.
    res.end(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'hello' })}\n\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [], usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 } } })}\n\n`);
  });

  expect(paths).toEqual(['/v1/responses']);
  expect(body).toMatchObject({ store: false, stream: true });
  expect(events).toContainEqual({ type: 'text_delta', delta: 'hello' });
  expect(events).toContainEqual({ type: 'message_end', stopReason: 'end_turn', usage: {
    inputTokens: 12, outputTokens: 3, cacheReadTokens: 0,
  } });
});

it('falls back to Chat Completions for a local server without the Responses route, such as an older Ollama', async () => {
  const { paths, events } = await talkTo((req, res) => {
    if (req.url === '/v1/responses') { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404 page not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta: object, finish: string | null) => ({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'qwen3:8b', choices: [{ index: 0, delta, finish_reason: finish }] });
    res.end(`data: ${JSON.stringify(chunk({ role: 'assistant', content: 'hello' }, null))}\n\ndata: ${JSON.stringify(chunk({}, 'stop'))}\n\ndata: [DONE]\n\n`);
  });

  expect(paths).toEqual(['/v1/responses', '/v1/chat/completions']);
  expect(events).toContainEqual({ type: 'text_delta', delta: 'hello' });
  expect(events.filter((event) => event.type === 'error')).toEqual([]);
});
