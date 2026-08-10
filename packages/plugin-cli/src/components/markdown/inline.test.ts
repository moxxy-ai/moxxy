import { describe, expect, it } from 'vitest';
import { formatLinkHint } from './inline.js';

describe('formatLinkHint', () => {
  it('shows a short host instead of the full URL', () => {
    expect(
      formatLinkHint(
        'https://news.google.com/rss/articles/a-very-long-token-that-must-not-enter-the-transcript',
      ),
    ).toBe(' ↗ news.google.com');
  });

  it('keeps non-web destinations bounded', () => {
    expect(formatLinkHint('mailto:hello@example.com')).toBe(' ↗ email');
    expect(formatLinkHint('/relative/path')).toBe(' ↗');
  });
});
