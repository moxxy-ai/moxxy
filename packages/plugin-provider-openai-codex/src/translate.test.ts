import { describe, expect, it } from 'vitest';
import { extractSystemText, toResponsesBody, toResponsesInput } from './translate.js';

describe('toResponsesInput', () => {
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

  it('maps maxTokens to max_output_tokens and drops temperature', () => {
    const body = toResponsesBody({ ...req, maxTokens: 999, temperature: 0.5 });
    expect(body.max_output_tokens).toBe(999);
    expect(body).not.toHaveProperty('temperature');
  });
});
