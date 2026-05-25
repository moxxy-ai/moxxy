import { describe, expect, it } from 'vitest';

import { tailForViewport } from './StreamingPreview.js';

describe('tailForViewport', () => {
  it('is now an identity passthrough — truncation lives in the renderer', () => {
    const content = 'line 1\nline 2\nline 3';
    expect(tailForViewport(content)).toBe(content);
  });

  it('preserves long inputs untouched (StreamingPreview handles compact vs full rendering)', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    expect(tailForViewport(lines)).toBe(lines);
  });
});
