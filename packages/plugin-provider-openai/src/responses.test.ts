import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { defineTool, type ProviderEvent } from '@moxxy/sdk';
import { z } from 'zod/v3';
import { openaiProviderDef } from './index.js';

let server: Server | undefined;
let body: Record<string, unknown>;
let url: string | undefined;
async function endpoint(events: unknown[], status = 200, holdOpen = false): Promise<string> {
  server = createServer(async (req, res) => {
    url = req.url;
    let raw = '';
    for await (const chunk of req) raw += chunk;
    body = JSON.parse(raw);
    if (status !== 200) {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Rate limit', type: 'rate_limit_error' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (!holdOpen) res.end('data: [DONE]\n\n');
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
const completed = (output: unknown[] = [], extra = {}) => ({
  type: 'response.completed',
  response: { status: 'completed', output, usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 40 } }, ...extra },
});
async function run(events: unknown[], request = {}, status = 200): Promise<ProviderEvent[]> {
  const baseURL = await endpoint(events, status);
  const provider = openaiProviderDef.createClient({ apiKey: 'sk-test', baseURL, maxRetries: 0 });
  const result: ProviderEvent[] = [];
  for await (const event of provider.stream({ model: 'gpt-6-sol', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }], ...request })) result.push(event);
  return result;
}

describe('OpenAI Responses through the real SDK', () => {
  it('streams text and cached usage through /responses with the local conversation as input', async () => {
    const events = await run([
      { type: 'response.output_text.delta', delta: 'Hello' },
      completed(),
    ], { system: 'Be concise', maxTokens: 256, fast: true, reasoning: { effort: 'low' } });
    expect(url).toBe('/v1/responses');
    expect(body).toMatchObject({ model: 'gpt-6-sol', stream: true, store: false, max_output_tokens: 256, service_tier: 'priority', reasoning: { effort: 'low', summary: 'auto' } });
    expect(body).not.toHaveProperty('messages');
    expect(body.input).toEqual([{ role: 'system', content: 'Be concise' }, { role: 'user', content: [{ type: 'input_text', text: 'hello' }] }]);
    expect(events).toEqual([
      { type: 'message_start', model: 'gpt-6-sol' },
      { type: 'text_delta', delta: 'Hello' },
      { type: 'message_end', stopReason: 'end_turn', usage: { inputTokens: 60, outputTokens: 10, cacheReadTokens: 40 } },
    ]);
  });
  it('keeps parallel function calls distinct and replays tool results, images and PDFs', async () => {
    const a = { type: 'function_call', id: 'fc_a', call_id: 'call_a', name: 'Read', arguments: '' };
    const b = { type: 'function_call', id: 'fc_b', call_id: 'call_b', name: 'Read', arguments: '{"path":"b"}' };
    const events = await run([
      { type: 'response.output_item.added', output_index: 0, item: a },
      { type: 'response.output_item.added', output_index: 1, item: b },
      { type: 'response.function_call_arguments.delta', output_index: 0, item_id: 'fc_a', delta: '{"path":"a"}' },
      { type: 'response.output_item.done', output_index: 1, item: b },
      { type: 'response.output_item.done', output_index: 0, item: { ...a, arguments: '{"path":"a"}' } },
      completed(),
    ], {
      tools: [defineTool({ name: 'Read', description: 'Read a file', inputSchema: z.object({ path: z.string() }), handler: async () => 'unused' })],
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'old', name: 'Read', input: { path: 'old' } }] },
        { role: 'tool_result', content: [
          { type: 'tool_result', toolUseId: 'old', content: 'result' },
          { type: 'image', mediaType: 'image/png', data: 'aW1n' },
          { type: 'document', mediaType: 'application/pdf', data: 'cGRm', name: 'report.pdf' },
        ] },
      ],
    });
    expect(body.input).toEqual([
      { type: 'function_call', call_id: 'old', name: 'Read', arguments: '{"path":"old"}' },
      { type: 'function_call_output', call_id: 'old', output: 'result' },
      { role: 'user', content: [
        { type: 'input_image', image_url: 'data:image/png;base64,aW1n', detail: 'auto' },
        { type: 'input_file', file_data: 'data:application/pdf;base64,cGRm', filename: 'report.pdf' },
      ] },
    ]);
    expect(body.tools).toEqual([expect.objectContaining({ type: 'function', name: 'Read', strict: false, parameters: expect.objectContaining({ type: 'object' }) })]);
    expect(events.filter(e => e.type === 'tool_use_end')).toEqual([
      { type: 'tool_use_end', id: 'call_a', input: { path: 'a' } },
      { type: 'tool_use_end', id: 'call_b', input: { path: 'b' } },
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'message_end', stopReason: 'tool_use' });
  });

  it.each([
    ['lost connection', [{ type: 'response.output_text.delta', delta: 'partial' }]],
    ['failed response', [{ type: 'response.failed', response: { error: { message: 'Backend failed' } } }]],
    ['stream error', [{ type: 'error', message: 'Backend failed', code: 'server_error' }]],
    ['bad JSON', [{ type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', call_id: 'broken', name: 'Read', arguments: '{' } }, completed()]],
  ])('reports %s as a failure and never ends a tool call', async (_name, frames) => {
    const events = await run(frames);
    expect(events.some(e => e.type === 'error')).toBe(true);
    expect(events.some(e => e.type === 'tool_use_end')).toBe(false);
    expect(events.some(e => e.type === 'message_end' && e.stopReason !== 'error')).toBe(false);
  });
  it('reports the output cap and usage without running a partial function call', async () => {
    const events = await run([
      { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: 'c', name: 'Read', arguments: '{' } },
      { type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 12, output_tokens: 20, input_tokens_details: { cached_tokens: 4 } } } },
    ]);
    expect(events.some(e => e.type === 'tool_use_end')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'message_end', stopReason: 'max_tokens', usage: {
      inputTokens: 8, outputTokens: 20, cacheReadTokens: 4,
    } });
  });

  it('streams reasoning and preserves encrypted reasoning for a stateless tool continuation', async () => {
    const item = { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'Check the files' }], encrypted_content: 'opaque' };
    const events = await run([
      { type: 'response.reasoning_summary_text.delta', delta: 'Check the files' },
      { type: 'response.output_item.done', output_index: 0, item },
      completed(),
    ], { reasoning: true, messages: [{ role: 'assistant', content: [{ type: 'reasoning', text: '', replayItems: [{ provider: 'openai', item }] }] }] });
    expect(body.include).toContain('reasoning.encrypted_content');
    expect(body.input).toEqual([item]);
    expect(events).toContainEqual({ type: 'reasoning_delta', delta: 'Check the files' });
    expect(events).toContainEqual({ type: 'reasoning_signature', replayItem: { provider: 'openai', item } });
  });

  it('cancels an active response without reporting a successful completion', async () => {
    const baseURL = await endpoint([{ type: 'response.output_text.delta', delta: 'first' }], 200, true);
    const controller = new AbortController();
    const provider = openaiProviderDef.createClient({ apiKey: 'sk-test', baseURL, maxRetries: 0 });
    const stream = provider.stream({ model: 'gpt-6-sol', messages: [], signal: controller.signal })[Symbol.asyncIterator]();
    expect((await stream.next()).value).toMatchObject({ type: 'message_start' });
    expect((await stream.next()).value).toEqual({ type: 'text_delta', delta: 'first' });
    controller.abort();
    expect((await stream.next()).value).toEqual({ type: 'error', message: 'aborted', retryable: false });
    expect((await stream.next()).done).toBe(true);
  });
  it('reports an API rate limit as retryable', async () => {
    const events = await run([], {}, 429);
    expect(events.at(-1)).toMatchObject({ type: 'error', retryable: true });
  });

});
