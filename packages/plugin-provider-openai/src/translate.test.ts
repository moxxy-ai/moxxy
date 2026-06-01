import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '@moxxy/sdk';
import { toOpenAIMessages, toOpenAITools } from './translate.js';

describe('toOpenAIMessages', () => {
  it('flattens text into role+content', () => {
    const out = toOpenAIMessages([
      { role: 'system', content: [{ type: 'text', text: 'be terse' }] },
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ]);
    expect(out).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('translates assistant tool_use into tool_calls', () => {
    const out = toOpenAIMessages([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'c1', name: 'Read', input: { path: '/a' } }],
      },
    ]);
    expect(out[0].role).toBe('assistant');
    expect(out[0].content).toBeNull();
    expect(out[0].tool_calls).toEqual([
      { id: 'c1', type: 'function', function: { name: 'Read', arguments: '{"path":"/a"}' } },
    ]);
  });

  it('translates tool_result into role: tool messages', () => {
    const out = toOpenAIMessages([
      {
        role: 'tool_result',
        content: [{ type: 'tool_result', toolUseId: 'c1', content: 'ok', isError: false }],
      },
    ]);
    expect(out).toEqual([{ role: 'tool', tool_call_id: 'c1', content: 'ok' }]);
  });

  it('emits a content parts array when a user message has an image', () => {
    const out = toOpenAIMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image', mediaType: 'image/png', data: 'AAAA' },
        ],
      },
    ]);
    expect(out).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        ],
      },
    ]);
  });

  it('emits a file content part when a user message has a document', () => {
    const out = toOpenAIMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'summarize this' },
          { type: 'document', mediaType: 'application/pdf', data: 'JVBERi0=', name: 'report.pdf' },
        ],
      },
    ]);
    expect(out).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'summarize this' },
          {
            type: 'file',
            file: { filename: 'report.pdf', file_data: 'data:application/pdf;base64,JVBERi0=' },
          },
        ],
      },
    ]);
  });

  it('keeps user content as plain text when no images are present', () => {
    const out = toOpenAIMessages([
      { role: 'user', content: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }] },
    ]);
    expect(out[0].content).toBe('hello\nworld');
  });

  it('handles assistant with both text and tool_calls', () => {
    const out = toOpenAIMessages([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'let me check' },
          { type: 'tool_use', id: 'c1', name: 'Read', input: {} },
        ],
      },
    ]);
    expect(out[0].content).toBe('let me check');
    expect(out[0].tool_calls).toHaveLength(1);
  });
});

describe('toOpenAITools', () => {
  it('wraps each tool in { type: function, function: { ... } }', () => {
    const tool = defineTool({
      name: 'Read',
      description: 'read file',
      inputSchema: z.object({ path: z.string() }),
      handler: () => null,
    });
    const out = toOpenAITools([tool]);
    expect(out[0].type).toBe('function');
    expect(out[0].function.name).toBe('Read');
    expect(out[0].function.description).toBe('read file');
    expect((out[0].function.parameters as { type: string }).type).toBe('object');
  });

  it('prefers inputJsonSchema when present', () => {
    const tool = defineTool({
      name: 'X',
      description: 'x',
      inputSchema: z.any(),
      inputJsonSchema: { type: 'object', properties: { custom: { type: 'integer' } } },
      handler: () => null,
    });
    const out = toOpenAITools([tool]);
    expect((out[0].function.parameters as { properties: { custom: unknown } }).properties.custom).toEqual({
      type: 'integer',
    });
  });
});
