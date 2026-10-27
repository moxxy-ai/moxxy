import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import type { LLMProvider } from '@moxxy/sdk';
import { zaiProviderDef } from './index.js';

// Z.ai documents only Chat Completions, and checks the key before the route,
// so a Responses attempt cannot be shown safe without a real account: Z.ai
// goes straight to Chat Completions. The vendor server is the boundary.
it('talks to Z.ai over Chat Completions only, never trying the Responses route', async () => {
  const paths: string[] = [];
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    paths.push(req.url ?? '');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta: object, finish: string | null) => ({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'glm-4.6', choices: [{ index: 0, delta, finish_reason: finish }] });
    res.end(`data: ${JSON.stringify(chunk({ role: 'assistant', content: 'hello' }, null))}\n\ndata: ${JSON.stringify(chunk({}, 'stop'))}\n\ndata: [DONE]\n\n`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test server');
    const client = zaiProviderDef.createClient({ apiKey: 'zai-test', baseURL: `http://127.0.0.1:${address.port}/api/paas/v4`, maxRetries: 0 }) as LLMProvider;
    let text = '';
    for await (const event of client.stream({ model: 'glm-4.6', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })) {
      if (event.type === 'text_delta') text += event.delta;
    }
    expect(text).toBe('hello');
    expect(paths).toEqual(['/api/paas/v4/chat/completions']);
  } finally {
    const closing = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closing;
  }
});
