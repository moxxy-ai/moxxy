import { describe, expect, it } from 'vitest';
import { aggregate, type NerToken } from './aggregate';

function tok(entity: string, word: string, index = 0): NerToken {
  return { entity, word, index, score: 0.99 };
}

describe('aggregate', () => {
  it('merges B-/I- tokens into one span with the right category + offsets', () => {
    const text = 'Alice Smith met Bob';
    const tokens: NerToken[] = [tok('B-PER', 'Alice'), tok('I-PER', 'Smith')];
    const spans = aggregate(tokens, text);
    expect(spans).toEqual([{ category: 'person', start: 0, end: 11, value: 'Alice Smith' }]);
  });

  it('joins WordPiece ## sub-words and recovers the offset', () => {
    const text = 'Microsoft ships it';
    const tokens: NerToken[] = [tok('B-ORG', 'Micro'), tok('I-ORG', '##soft')];
    const spans = aggregate(tokens, text);
    expect(spans).toEqual([{ category: 'org', start: 0, end: 9, value: 'Microsoft' }]);
  });

  it('maps LOC → location and ignores MISC/other types', () => {
    const text = 'Berlin is nice, said misc';
    const tokens: NerToken[] = [tok('B-LOC', 'Berlin'), tok('B-MISC', 'misc')];
    const spans = aggregate(tokens, text);
    expect(spans.map((s) => [s.category, s.value])).toEqual([['location', 'Berlin']]);
  });

  it('maps repeated surfaces to successive occurrences via the cursor', () => {
    const text = 'Bob and Bob';
    const tokens: NerToken[] = [tok('B-PER', 'Bob'), tok('B-PER', 'Bob')];
    const spans = aggregate(tokens, text);
    expect(spans.map((s) => s.start)).toEqual([0, 8]);
  });
});
