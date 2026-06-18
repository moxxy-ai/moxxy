import { describe, expect, it } from 'vitest';
import { stripHtml, truncate } from './html.js';

describe('stripHtml', () => {
  it('strips tags and keeps text content', () => {
    expect(stripHtml('<b>bold</b> and <code>code</code>')).toBe('bold and code');
  });

  it('decodes the four named entities', () => {
    expect(stripHtml('a &lt; b &gt; c &amp; d &quot;e&quot;')).toBe('a < b > c & d "e"');
  });

  // u110-4: decoding &amp; LAST avoids double-decoding a literal escaped entity.
  it('does not double-decode a literal escaped entity (&amp;lt;)', () => {
    expect(stripHtml('a &amp;lt; b')).toBe('a &lt; b');
  });

  // u110-4: numeric/hex entities must be decoded, not leaked literally.
  it('decodes numeric and hex entities (e.g. apostrophes)', () => {
    expect(stripHtml('it&#39;s a &#x27;quote&#x27;')).toBe("it's a 'quote'");
  });

  it('combines tags, named, and numeric entities', () => {
    expect(stripHtml('<i>x</i> &amp; &#39;y&#39; &lt;z&gt;')).toBe("x & 'y' <z>");
  });

  it('leaves an out-of-range numeric entity as empty rather than throwing', () => {
    expect(() => stripHtml('&#999999999;')).not.toThrow();
  });
});

describe('truncate', () => {
  it('returns the string unchanged when within the limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates and appends an ellipsis past the limit', () => {
    expect(truncate('hello world', 5)).toBe('hello…');
  });
});
