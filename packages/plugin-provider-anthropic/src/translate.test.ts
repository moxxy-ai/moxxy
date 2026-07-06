import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { assertDefined, defineTool } from '@moxxy/sdk';
import { toAnthropicMessages, toAnthropicTools } from './translate.js';

describe('toAnthropicMessages', () => {
  it('hoists system messages', () => {
    const { system, messages } = toAnthropicMessages([
      { role: 'system', content: [{ type: 'text', text: 'you are X' }] },
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ]);
    expect(system).toBe('you are X');
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
  });

  it('translates assistant tool_use blocks', () => {
    const { messages } = toAnthropicMessages([
      { role: 'user', content: [{ type: 'text', text: 'do it' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'c1', name: 'Read', input: { file_path: 'a' } }],
      },
    ]);
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content[0]).toMatchObject({ type: 'tool_use', id: 'c1', name: 'Read' });
  });

  it('translates an image block to a base64 image source', () => {
    const { messages } = toAnthropicMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image', mediaType: 'image/png', data: 'AAAA' },
        ],
      },
    ]);
    expect(messages[0].content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    });
  });

  it('translates a document block to a native base64 document with title', () => {
    const { messages } = toAnthropicMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'summarize this' },
          { type: 'document', mediaType: 'application/pdf', data: 'JVBERi0=', name: 'report.pdf' },
        ],
      },
    ]);
    expect(messages[0].content[1]).toEqual({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' },
      title: 'report.pdf',
    });
  });

  it('merges adjacent tool_result messages into a user message', () => {
    const { messages } = toAnthropicMessages([
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'T', input: {} }] },
      {
        role: 'tool_result',
        content: [{ type: 'tool_result', toolUseId: 'c1', content: 'ok', isError: false }],
      },
    ]);
    const last = messages[messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'c1',
      content: 'ok',
    });
  });

  it('places cache_control on the last block of a hinted message', () => {
    const { messages } = toAnthropicMessages(
      [
        { role: 'user', content: [{ type: 'text', text: 'a' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'b' }] },
        { role: 'user', content: [{ type: 'text', text: 'c' }] },
      ],
      { cacheMessageIndices: new Set([2]) },
    );
    const lastMsg = messages[messages.length - 1];
    assertDefined(lastMsg, 'messages non-empty');
    const marked = lastMsg.content[0];
    assertDefined(marked, 'content non-empty');
    expect(marked.cache_control).toEqual({ type: 'ephemeral' });
    // Unhinted messages stay unmarked.
    const firstMsg = messages[0];
    assertDefined(firstMsg, 'messages non-empty');
    const firstBlock = firstMsg.content[0];
    assertDefined(firstBlock, 'content non-empty');
    expect(firstBlock.cache_control).toBeUndefined();
  });

  it('adds no cache_control when no hints are given', () => {
    const { messages } = toAnthropicMessages([
      { role: 'user', content: [{ type: 'text', text: 'a' }] },
    ]);
    const firstMsg = messages[0];
    assertDefined(firstMsg, 'messages non-empty');
    const firstBlock = firstMsg.content[0];
    assertDefined(firstBlock, 'content non-empty');
    expect(firstBlock.cache_control).toBeUndefined();
  });

  it('joins all text blocks of a multi-block system message (does not drop the rest)', () => {
    const { system } = toAnthropicMessages([
      {
        role: 'system',
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ],
      },
    ]);
    expect(system).toBe('first\n\nsecond');
  });

  it('degrades an unsupported image media type to a text placeholder rather than forwarding bytes', () => {
    const { messages } = toAnthropicMessages([
      {
        role: 'user',
        content: [{ type: 'image', mediaType: 'image/tiff', data: 'AAAA' }],
      },
    ]);
    const firstMsg = messages[0];
    assertDefined(firstMsg, 'messages non-empty');
    const block = firstMsg.content[0];
    assertDefined(block, 'content non-empty');
    expect(block.type).toBe('text');
    expect((block as { text: string }).text).toContain('image/tiff');
  });

  it('degrades an unsupported document media type to a text placeholder', () => {
    const { messages } = toAnthropicMessages([
      {
        role: 'user',
        content: [{ type: 'document', mediaType: 'application/zip', data: 'AAAA' }],
      },
    ]);
    const firstMsg = messages[0];
    assertDefined(firstMsg, 'messages non-empty');
    const block = firstMsg.content[0];
    assertDefined(block, 'content non-empty');
    expect(block.type).toBe('text');
    expect((block as { text: string }).text).toContain('application/zip');
  });

  it('drops an unsigned/unredacted reasoning block instead of leaking it as assistant text', () => {
    const { messages } = toAnthropicMessages([
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'secret chain of thought' },
          { type: 'text', text: 'answer' },
        ],
      },
    ]);
    // The reasoning block is dropped; only the visible answer survives.
    const firstMsg = messages[0];
    assertDefined(firstMsg, 'messages non-empty');
    expect(firstMsg.content).toHaveLength(1);
    expect(firstMsg.content[0]).toMatchObject({ type: 'text', text: 'answer' });
  });
});

describe('toAnthropicTools', () => {
  it('emits name + description + json schema', () => {
    const tool = defineTool({
      name: 'Greet',
      description: 'Greet someone',
      inputSchema: z.object({ name: z.string() }),
      handler: () => null,
    });
    const out = toAnthropicTools([tool]);
    expect(out[0].name).toBe('Greet');
    expect(out[0].description).toBe('Greet someone');
    const schema = out[0].input_schema as Record<string, unknown>;
    expect(schema.type).toBe('object');
  });

  it('marks the last tool with cache_control when cacheLast is set', () => {
    const mk = (name: string) =>
      defineTool({ name, description: name, inputSchema: z.object({}), handler: () => null });
    const out = toAnthropicTools([mk('A'), mk('B')], { cacheLast: true });
    expect(out[0].cache_control).toBeUndefined();
    expect(out[1].cache_control).toEqual({ type: 'ephemeral' });
  });
});
