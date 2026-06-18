import { describe, expect, it } from 'vitest';

import { parseOutputFormat } from './prompt.js';

describe('parseOutputFormat', () => {
  it('defaults to text when the flag is unset', () => {
    expect(parseOutputFormat(undefined)).toBe('text');
  });

  it.each(['text', 'json', 'stream-json'] as const)('accepts the valid format %s', (fmt) => {
    expect(parseOutputFormat(fmt)).toBe(fmt);
  });

  it('rejects unknown values instead of silently falling through to json', () => {
    // A typo like `--output-format=jsonl` previously coerced to JSON output;
    // now it is rejected so the caller can error with exit code 2.
    expect(parseOutputFormat('jsonl')).toBeNull();
    expect(parseOutputFormat('')).toBeNull();
    expect(parseOutputFormat('JSON')).toBeNull();
  });
});
