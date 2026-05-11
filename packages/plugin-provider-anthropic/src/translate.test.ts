import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '@moxxy/sdk';
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
});
