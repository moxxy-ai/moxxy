import { describe, expect, it } from 'vitest';
import { formatLinkHint, terminalHyperlinkParts, terminalHyperlinkText } from './inline.js';

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

  it('does not orphan a host after a long label on narrow terminals', () => {
    expect(formatLinkHint('https://www.ycombinator.com/blog/post', 62, 72)).toBe('');
    expect(formatLinkHint('https://www.ycombinator.com/blog/post', 20, 72)).toBe(
      ' ↗ ycombinator.com',
    );
  });
});

describe('terminalHyperlinkParts', () => {
  it('wraps a styled span in OSC 8 boundaries when hyperlinks are enabled', () => {
    expect(terminalHyperlinkParts('https://example.com/post', true)).toEqual({
      open: '\u001B]8;;https://example.com/post\u0007',
      close: '\u001B]8;;\u0007',
    });
  });

  it('keeps the clickable region and visual style in one terminal string', () => {
    expect(terminalHyperlinkText('Example', 'https://example.com/post', true)).toBe(
      '\u001B]8;;https://example.com/post\u0007' +
        '\u001B[4m\u001B[34mExample\u001B[39m\u001B[24m' +
        '\u001B]8;;\u0007',
    );
  });

  it('omits boundaries for pipes and unsafe protocols', () => {
    expect(terminalHyperlinkParts('https://example.com/post', false)).toEqual({ open: '', close: '' });
    expect(terminalHyperlinkParts('javascript:alert(1)', true)).toEqual({ open: '', close: '' });
    expect(terminalHyperlinkParts('https://example.com/\u0007escape', true)).toEqual({ open: '', close: '' });
  });
});
