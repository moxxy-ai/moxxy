import { describe, expect, it } from 'vitest';
import { toResponsesInput } from './translate.js';

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
