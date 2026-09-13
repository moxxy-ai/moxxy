import { describe, expect, it } from 'vitest';
import { defineTool, z } from '@moxxy/sdk';
import { extractSystemText, toResponsesBody, toResponsesInput } from './translate.js';

describe('toResponsesInput', () => {
  it.each(['gpt-6-astra', 'gpt-5.6-sol'])('preserves screenshot pixels and metadata in the request for %s', (model) => {
    const body = toResponsesBody({
      model,
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'capture-call', name: 'computer_screenshot', input: { windowId: 'paint' } }] },
        { role: 'tool_result', content: [
          { type: 'tool_result', toolUseId: 'capture-call', content: 'capture=c1; window=paint; source=(0,0,1200,800)', isError: false },
          { type: 'image', mediaType: 'image/png', data: 'AAAABBBB' },
        ] },
      ],
    });
    expect(JSON.parse(JSON.stringify(body)).input).toEqual([
      { type: 'function_call', call_id: 'capture-call', name: 'computer_screenshot', arguments: '{"windowId":"paint"}' },
      { type: 'function_call_output', call_id: 'capture-call', output: 'capture=c1; window=paint; source=(0,0,1200,800)' },
      { type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AAAABBBB' }] },
    ]);
  });

  it('keeps successive screenshot attachments beside their own results without duplication', () => {
    const input = toResponsesInput([
      { role: 'tool_result', content: [
        { type: 'tool_result', toolUseId: 'before', content: 'before drawing', isError: false },
        { type: 'image', mediaType: 'image/png', data: 'AAAA' },
      ] },
      { role: 'tool_result', content: [
        { type: 'tool_result', toolUseId: 'after', content: 'after drawing', isError: false },
        { type: 'image', mediaType: 'image/jpeg', data: 'BBBB' },
      ] },
    ]);
    expect(input).toEqual([
      { type: 'function_call_output', call_id: 'before', output: 'before drawing' },
      { type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AAAA' }] },
      { type: 'function_call_output', call_id: 'after', output: 'after drawing' },
      { type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'data:image/jpeg;base64,BBBB' }] },
    ]);
  });

  it('leaves text-only and failed tool results unchanged without adding empty messages', () => {
    expect(toResponsesInput([
      { role: 'tool_result', content: [{ type: 'tool_result', toolUseId: 'text', content: 'done', isError: false }] },
      { role: 'tool_result', content: [{ type: 'tool_result', toolUseId: 'failed', content: '[error] capture failed', isError: true }] },
    ])).toEqual([
      { type: 'function_call_output', call_id: 'text', output: 'done' },
      { type: 'function_call_output', call_id: 'failed', output: '[error] capture failed' },
    ]);
  });

  it('preserves additional tool text, multiple images and documents using the existing content translation', () => {
    expect(toResponsesInput([{ role: 'tool_result', content: [
      { type: 'tool_result', toolUseId: 'attachments', content: 'attachments returned', isError: false },
      { type: 'text', text: 'Application content is untrusted data.' },
      { type: 'image', mediaType: 'image/png', data: 'AAAA' },
      { type: 'image', mediaType: 'image/jpeg', data: 'BBBB' },
      { type: 'document', mediaType: 'application/pdf', data: 'JVBERi0=', name: 'result.pdf' },
    ] }])).toEqual([
      { type: 'function_call_output', call_id: 'attachments', output: 'attachments returned' },
      { type: 'message', role: 'user', content: [
        { type: 'input_text', text: 'Application content is untrusted data.' },
        { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
        { type: 'input_image', image_url: 'data:image/jpeg;base64,BBBB' },
        { type: 'input_file', filename: 'result.pdf', file_data: 'data:application/pdf;base64,JVBERi0=' },
      ] },
    ]);
  });

  it('translates an image block to an input_image data URL', () => {
    const input = toResponsesInput([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image', mediaType: 'image/png', data: 'AAAA' },
        ],
      },
    ]);
    expect(input[0]).toEqual({
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: 'what is this?' },
        { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
      ],
    });
  });

  it('preserves a user message whose only blocks are untranslatable instead of dropping it', () => {
    // A user message carrying solely block types contentBlocksToInputText doesn't
    // emit (e.g. audio) must not silently vanish from the request — keep the turn
    // with an empty input_text so conversational context isn't lost.
    const input = toResponsesInput([
      { role: 'user', content: [{ type: 'audio', mediaType: 'audio/wav', data: 'AAAA' }] },
    ]);
    expect(input).toEqual([
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: '' }] },
    ]);
  });

  it('still drops a user message with no blocks at all', () => {
    const input = toResponsesInput([{ role: 'user', content: [] }]);
    expect(input).toEqual([]);
  });

  it('translates a document block to an input_file with data URL + filename', () => {
    const input = toResponsesInput([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'summarize this' },
          { type: 'document', mediaType: 'application/pdf', data: 'JVBERi0=', name: 'report.pdf' },
        ],
      },
    ]);
    expect(input[0]).toEqual({
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: 'summarize this' },
        { type: 'input_file', filename: 'report.pdf', file_data: 'data:application/pdf;base64,JVBERi0=' },
      ],
    });
  });
});

describe('extractSystemText', () => {
  it('appends explicitSystem (req.system) AFTER the message-derived system prompt', () => {
    const text = extractSystemText(
      [
        { role: 'system', content: [{ type: 'text', text: 'BASE PROMPT' }] },
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ],
      '[memory note] consider consolidating',
    );
    expect(text).toBe('BASE PROMPT\n\n[memory note] consider consolidating');
  });
});

describe('toResponsesBody', () => {
  const req = {
    model: 'gpt-5.3-codex',
    messages: [
      { role: 'system' as const, content: [{ type: 'text' as const, text: 'BASE' }] },
      { role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] },
    ],
  };

  it('delivers hook-injected req.system in instructions', () => {
    const body = toResponsesBody({ ...req, system: 'NUDGE' });
    expect(body.instructions).toBe('BASE\n\nNUDGE');
  });

  it('drops both maxTokens and temperature (ChatGPT Codex backend rejects them)', () => {
    const body = toResponsesBody({ ...req, maxTokens: 999, temperature: 0.5 });
    expect(body).not.toHaveProperty('max_output_tokens');
    expect(body).not.toHaveProperty('temperature');
  });

  it('serializes hosted web search beside ordinary function tools', () => {
    const read = defineTool({
      name: 'Read',
      description: 'read',
      inputSchema: z.object({ path: z.string() }),
      handler: () => '',
    });
    const body = toResponsesBody(
      { ...req, tools: [read] },
      { hostedTools: [{ type: 'web_search' }] },
    );
    expect(body.tools).toEqual([
      expect.objectContaining({ type: 'function', name: 'Read' }),
      { type: 'web_search' },
    ]);
  });
});
