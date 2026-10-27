import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { localProviderDef } from './index.js';

it('uses stateless Responses for an Ollama endpoint configured on a custom port', async () => {
  let requestPath: string | undefined;
  let body: Record<string, unknown> = {};
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' || req.url === '/api/show') { res.writeHead(404); res.end(); return; }
    requestPath = req.url;
    let raw = '';
    for await (const chunk of req) raw += chunk;
    body = JSON.parse(raw);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    // Ollama 0.13.3 reports these totals without input_tokens_details.
    res.end(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'hello' })}\n\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [], usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 } } })}\n\n`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test server');
    const client = localProviderDef.createClient({ api: 'responses', baseURL: `http://127.0.0.1:${address.port}/v1` });
    const events = [];
    for await (const event of client.stream({ model: 'qwen3:8b', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })) events.push(event);
    expect(requestPath).toBe('/v1/responses');
    expect(body).toMatchObject({ store: false, stream: true });
    expect(events).toContainEqual({ type: 'text_delta', delta: 'hello' });
    expect(events).toContainEqual({ type: 'message_end', stopReason: 'end_turn', usage: {
      inputTokens: 12, outputTokens: 3, cacheReadTokens: 0,
    } });
  } finally {
    const closing = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closing;
  }
});
