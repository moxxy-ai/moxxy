import { describe, expect, it } from 'vitest';
import { detect } from './detect.js';

describe('detect', () => {
  it('returns non-overlapping spans in document order', () => {
    const text = 'mail a@b.com ip 10.0.0.1';
    const spans = detect(text);
    expect(spans.map((s) => [s.category, s.value])).toEqual([
      ['email', 'a@b.com'],
      ['ipv4', '10.0.0.1'],
    ]);
    // ascending, non-overlapping
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!.start).toBeGreaterThanOrEqual(spans[i - 1]!.end);
    }
  });

  it('keeps the higher-priority category when two detectors overlap', () => {
    // A Luhn-valid 16-digit card whose digits a phone pattern could also grab.
    const text = 'pay 4111-1111-1111-1111 now';
    const spans = detect(text, { categories: ['creditCard', 'phone'] });
    expect(spans).toHaveLength(1);
    expect(spans[0]!.category).toBe('creditCard');
  });

  it('offsets slice back to the matched value', () => {
    const text = 'contact John.Doe@example.com here';
    const [span] = detect(text);
    expect(text.slice(span!.start, span!.end)).toBe(span!.value);
  });

  it('merges extraSpans (e.g. NER) through overlap resolution', () => {
    const text = 'Alice Smith wrote a@b.com';
    const spans = detect(text, {
      extraSpans: [{ category: 'person', start: 0, end: 11, value: 'Alice Smith' }],
    });
    expect(spans.map((s) => s.category)).toEqual(['person', 'email']);
  });

  it('runs custom terms regardless of categories', () => {
    const spans = detect('secret-project launch', { categories: [], customTerms: ['secret-project'] });
    expect(spans.map((s) => s.value)).toEqual(['secret-project']);
  });
});
