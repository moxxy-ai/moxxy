import { describe, expect, it } from 'vitest';
import { detect } from './detect.js';
import { required } from './assert.js';

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
      const cur = required(spans[i], 'span at index i');
      const prev = required(spans[i - 1], 'span at index i - 1');
      expect(cur.start).toBeGreaterThanOrEqual(prev.end);
    }
  });

  it('keeps the higher-priority category when two detectors overlap', () => {
    // A Luhn-valid 16-digit card whose digits a phone pattern could also grab.
    const text = 'pay 4111-1111-1111-1111 now';
    const spans = detect(text, { categories: ['creditCard', 'phone'] });
    expect(spans).toHaveLength(1);
    expect(required(spans[0], 'first detected span').category).toBe('creditCard');
  });

  it('offsets slice back to the matched value', () => {
    const text = 'contact John.Doe@example.com here';
    const [span] = detect(text);
    const found = required(span, 'detect returns at least one span');
    expect(text.slice(found.start, found.end)).toBe(found.value);
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

  it('resolves a chain of overlapping extraSpans by priority, keeping survivors sorted', () => {
    // person(0..11) overlaps email(5..16); email outranks person → email wins.
    // A non-overlapping later org(20..23) survives independently. The result must
    // stay sorted by start and be non-overlapping.
    const text = 'John smith@x.com here Foo elsewhere';
    const spans = detect(text, {
      categories: ['email'],
      extraSpans: [
        { category: 'person', start: 0, end: 11, value: text.slice(0, 11) },
        { category: 'org', start: 22, end: 25, value: text.slice(22, 25) },
      ],
    });
    expect(spans.map((s) => [s.category, s.start, s.end])).toEqual([
      ['email', 5, 16],
      ['org', 22, 25],
    ]);
    for (let i = 1; i < spans.length; i++) {
      const cur = required(spans[i], 'span at index i');
      const prev = required(spans[i - 1], 'span at index i - 1');
      expect(cur.start).toBeGreaterThanOrEqual(prev.end);
    }
  });

  it('resolves a large fully-disjoint span set without quadratic blowup', () => {
    // 40k non-overlapping custom hits is the pathological case for overlap
    // resolution: a linear-scan resolver is O(n²) (multiple seconds and rising
    // steeply); the binary-search resolver is O(n log n) (tens of ms). The bound
    // is generous (3s) so it never flakes on a slow CI box yet still trips if the
    // quadratic scan is reintroduced (which blows past it well before this size).
    const term = 'zz';
    const text = Array.from({ length: 40_000 }, () => term).join(' ');
    const t0 = Date.now();
    const spans = detect(text, { categories: [], customTerms: [term] });
    expect(spans).toHaveLength(40_000);
    expect(Date.now() - t0).toBeLessThan(3_000);
    // Sorted + non-overlapping.
    for (let i = 1; i < spans.length; i++) {
      const cur = required(spans[i], 'span at index i');
      const prev = required(spans[i - 1], 'span at index i - 1');
      expect(cur.start).toBeGreaterThanOrEqual(prev.end);
    }
  });
});
