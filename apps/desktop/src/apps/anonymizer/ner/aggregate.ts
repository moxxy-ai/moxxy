import type { PiiCategory, PiiSpan } from '@moxxy/anonymizer';

/** One per-token classification result from transformers.js (BIO-tagged). */
export interface NerToken {
  readonly entity: string; // e.g. 'B-PER', 'I-LOC'
  readonly word: string; // decoded sub-word (may carry a '##' WordPiece prefix)
  readonly index: number;
  readonly score: number;
}

const TYPE_TO_CATEGORY: Readonly<Record<string, PiiCategory | undefined>> = {
  PER: 'person',
  PERSON: 'person',
  ORG: 'org',
  LOC: 'location',
};

function parseLabel(entity: string): { bio: string; type: string } {
  const m = /^([BILUES])-(.+)$/.exec(entity);
  if (m) return { bio: m[1]!, type: m[2]! };
  return { bio: 'B', type: entity };
}

/** Reconstruct an entity's surface string from its WordPiece tokens. */
function surfaceOf(words: readonly string[]): string {
  let s = '';
  for (const w of words) {
    if (w.startsWith('##')) s += w.slice(2);
    else s += (s ? ' ' : '') + w;
  }
  return s.trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Find an entity's char range in the original text, advancing a cursor so
 *  repeated surfaces map to successive occurrences. Tolerant of case and
 *  whitespace differences the tokenizer introduces. */
function locate(
  text: string,
  surface: string,
  from: number,
): { start: number; end: number } | null {
  let idx = text.indexOf(surface, from);
  if (idx >= 0) return { start: idx, end: idx + surface.length };
  idx = text.toLowerCase().indexOf(surface.toLowerCase(), from);
  if (idx >= 0) return { start: idx, end: idx + surface.length };
  const parts = surface.split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (parts.length > 1) {
    const re = new RegExp(parts.join('\\s+'), 'i');
    const m = re.exec(text.slice(from));
    if (m && m.index != null) return { start: from + m.index, end: from + m.index + m[0].length };
  }
  return null;
}

/**
 * Aggregate per-token BIO labels into entity spans with character offsets.
 *
 * transformers.js' token-classification pipeline returns per-token labels with
 * NO character offsets and does not merge sub-words, so we group consecutive
 * `B-`/`I-` tokens of the same type, rebuild each surface, and recover its
 * offset by searching the original text. Only `person`/`org`/`location` are
 * kept (MISC and any other type are dropped).
 */
export function aggregate(tokens: readonly NerToken[], text: string): PiiSpan[] {
  const groups: Array<{ type: string; words: string[] }> = [];
  let cur: { type: string; words: string[] } | null = null;
  for (const tok of tokens) {
    const { bio, type } = parseLabel(tok.entity);
    if (!TYPE_TO_CATEGORY[type]) {
      cur = null;
      continue;
    }
    if (bio === 'B' || !cur || cur.type !== type) {
      cur = { type, words: [tok.word] };
      groups.push(cur);
    } else {
      cur.words.push(tok.word);
    }
  }

  const spans: PiiSpan[] = [];
  let cursor = 0;
  for (const g of groups) {
    const category = TYPE_TO_CATEGORY[g.type];
    if (!category) continue;
    const surface = surfaceOf(g.words);
    if (!surface) continue;
    const at = locate(text, surface, cursor);
    if (!at) continue;
    spans.push({ category, start: at.start, end: at.end, value: text.slice(at.start, at.end) });
    cursor = at.end;
  }
  return spans;
}
