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

  it('locates a short entity at a WORD-ALIGNED offset, not inside a larger word', () => {
    // Regression: a raw indexOf('Al') would land inside 'Alabama' (offset 0),
    // redacting non-PII and leaving the real person 'Al' exposed. The span must
    // land on the standalone 'Al'.
    const text = 'Alabama is where Al lives';
    const spans = aggregate([tok('B-PER', 'Al')], text);
    expect(spans).toEqual([{ category: 'person', start: 17, end: 19, value: 'Al' }]);
  });

  it('recovers a hyphen-joined surface the tokenizer split into spaced parts', () => {
    // 'Jean-Pierre' tokenizes to Jean / - / Pierre → surface 'Jean - Pierre',
    // which indexOf can't find. The span must still be recovered (else the name
    // leaks unredacted).
    const text = 'Jean-Pierre called';
    const spans = aggregate([tok('B-PER', 'Jean'), tok('I-PER', '-'), tok('I-PER', 'Pierre')], text);
    expect(spans).toEqual([{ category: 'person', start: 0, end: 11, value: 'Jean-Pierre' }]);
  });

  it('recovers an accented name whose tokenized surface had diacritics stripped', () => {
    // BERT tokenizers strip accents, so the surface is 'Zoe' but the source is
    // 'Zoë'. The span (with the ORIGINAL accented value) must be recovered.
    const text = 'hi Zoë there';
    const spans = aggregate([tok('B-PER', 'Zoe')], text);
    expect(spans).toEqual([{ category: 'person', start: 3, end: 6, value: 'Zoë' }]);
  });

  it('does not leak by dropping a found entity when the cursor overshot', () => {
    // If an earlier group consumed text past a later entity's only occurrence,
    // the cursor must not strand the later entity (which would leak). Here both
    // 'Sam' occurrences are word-aligned; the second resolves correctly.
    const text = 'Sam emailed Sam';
    const spans = aggregate([tok('B-PER', 'Sam'), tok('B-PER', 'Sam')], text);
    expect(spans.map((s) => s.start)).toEqual([0, 12]);
  });

  it('rejoins SentencePiece (XLM-R) sub-words that decode WITHOUT a marker', () => {
    // XLM-RoBERTa decodes each sub-word independently, so an agglutinated Polish
    // surname 'Kowalski' arrives as bare parts ['Kowal','ski'] with NO '##' marker
    // and NO separator in the source text. The whole name must still be recovered
    // (a `+`-separator part match would drop 'ski' and leak the surname).
    const text = 'pacjent Anna Kowalski zgłosił';
    const tokens: NerToken[] = [tok('B-PER', 'Anna'), tok('I-PER', 'Kowal'), tok('I-PER', 'ski')];
    const spans = aggregate(tokens, text);
    expect(spans).toEqual([{ category: 'person', start: 8, end: 21, value: 'Anna Kowalski' }]);
  });
});
