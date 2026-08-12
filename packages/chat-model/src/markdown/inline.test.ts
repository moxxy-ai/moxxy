import { describe, expect, it } from 'vitest';
import { stripInline, tokenizeInline } from './inline.js';

describe('tokenizeInline', () => {
  it('parses the supported inline constructs without changing plain text', () => {
    expect(tokenizeInline('a `code` **bold** *italic* [link](https://example.com) z')).toEqual([
      { kind: 'text', value: 'a ' },
      { kind: 'code', value: 'code' },
      { kind: 'text', value: ' ' },
      { kind: 'bold', value: 'bold' },
      { kind: 'text', value: ' ' },
      { kind: 'italic', value: 'italic' },
      { kind: 'text', value: ' ' },
      { kind: 'link', label: 'link', url: 'https://example.com' },
      { kind: 'text', value: ' z' },
    ]);
  });

  it('handles long unmatched delimiters as literal text', () => {
    const input = '['.repeat(50_000) + '*'.repeat(50_001);
    expect(tokenizeInline(input)).toEqual([{ kind: 'text', value: input }]);
    expect(stripInline(input)).toBe(input);
  });
});
