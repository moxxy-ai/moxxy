import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { xaiProviderDef } from './index.js';

it('uses stateless Responses for xAI with the real SDK', async () => {
  let requestPath: string | undefined;
  let body: Record<string, unknown> = {};
  const server = createServer(async (req, res) => {
    requestPath = req.url;
    let raw = '';
    for await (const chunk of req) raw += chunk;
    body = JSON.parse(raw);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'hello' })}\n\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [] } })}\n\n`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test server');
    const client = xaiProviderDef.createClient({ apiKey: 'xai-test', baseURL: `http://127.0.0.1:${address.port}/v1` });
    const events = [];
    for await (const event of client.stream({ model: 'grok-4', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })) events.push(event);
    expect(requestPath).toBe('/v1/responses');
    expect(body).toMatchObject({ store: false, stream: true });
    expect(events).toContainEqual({ type: 'text_delta', delta: 'hello' });
  } finally {
    const closing = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closing;
  }
});
