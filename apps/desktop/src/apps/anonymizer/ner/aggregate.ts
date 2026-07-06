import type { PiiCategory, PiiSpan } from '@moxxy/anonymizer';
import { assertDefined } from '@/lib/assert';

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
  if (m) {
    const bio = m[1];
    const type = m[2];
    assertDefined(bio, 'BIO capture group is present when the label matches');
    assertDefined(type, 'type capture group is present when the label matches');
    return { bio, type };
  }
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

/** True when `text[i]` (or a position past either end) is NOT a word char, i.e.
 *  a word boundary sits at offset `i`. Treats out-of-range as a boundary. Uses a
 *  Unicode-aware "letter or number" notion so accented names count as word
 *  chars. */
function isBoundaryAt(text: string, i: number): boolean {
  if (i < 0 || i >= text.length) return true;
  const ch = text[i];
  assertDefined(ch, 'char index within text bounds');
  return !/[\p{L}\p{N}]/u.test(ch);
}

/** True when the half-open range `[start, end)` is bounded by non-word chars (or
 *  the string edges) on both sides — i.e. it isn't a substring buried inside a
 *  larger word like `Al` inside `Alabama`. */
function isWordAligned(text: string, start: number, end: number): boolean {
  return isBoundaryAt(text, start - 1) && isBoundaryAt(text, end);
}

/** Try to find `surface` (or a whitespace/punctuation-tolerant variant of it) at
 *  a WORD-ALIGNED position at or after `from`. Returns the first such match, or
 *  null. */
function findAligned(text: string, surface: string, from: number): { start: number; end: number } | null {
  // 1) Exact, then case-insensitive, scanning successive occurrences until one
  //    is word-aligned (so `Al` is not matched inside `Alabama`).
  for (const hay of [text, text.toLowerCase()]) {
    const needle = hay === text ? surface : surface.toLowerCase();
    let idx = hay.indexOf(needle, from);
    while (idx >= 0) {
      if (isWordAligned(text, idx, idx + needle.length)) {
        return { start: idx, end: idx + needle.length };
      }
      idx = hay.indexOf(needle, idx + 1);
    }
  }
  // 2) The tokenizer normalizes the surface (diacritic stripping, hyphen/
  //    apostrophe → space, WordPiece/SentencePiece spacing), so the literal
  //    needle can be absent even though the entity is present. Match the
  //    surface's word PARTS separated by ZERO-or-more non-word chars, anchored on
  //    word boundaries, so a span is recovered (and redacted) instead of silently
  //    dropped. The separator is `*` (not `+`) because SentencePiece models
  //    (XLM-R) decode each sub-word independently with no marker — an
  //    agglutinated surname like `Kowalski` arrives as parts ['Kowal','ski'] with
  //    NO separator between them, and `+` would fail to rejoin it (→ name leak).
  const parts = surface.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(escapeRegExp);
  if (parts.length > 0) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${parts.join('[^\\p{L}\\p{N}]*')}(?![\\p{L}\\p{N}])`, 'iu');
    const m = re.exec(text.slice(from));
    if (m && m.index != null) {
      return { start: from + m.index, end: from + m.index + m[0].length };
    }
  }
  // 3) Diacritic mismatch: BERT tokenizers strip accents, so the surface `Zoe`
  //    can't be found in the original `Zoë`. Fold accents off BOTH sides and
  //    retry the part match against the folded text, then map the (length-
  //    preserving) folded offset straight back to the original. NFD + combining-
  //    mark removal preserves code-unit count for the Latin accents NER emits, so
  //    offsets line up.
  const foldedText = stripDiacritics(text);
  if (foldedText !== text && foldedText.length === text.length) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${parts.join('[^\\p{L}\\p{N}]*')}(?![\\p{L}\\p{N}])`, 'iu');
    const m = re.exec(foldedText.slice(from));
    if (m && m.index != null) {
      return { start: from + m.index, end: from + m.index + m[0].length };
    }
  }
  return null;
}

/** Remove combining diacritical marks (NFD then drop the combining range). Used
 *  only for length-preserving accent-insensitive matching — the original text's
 *  offsets are what we return. */
function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Find an entity's char range in the original text, advancing a cursor so
 *  repeated surfaces map to successive occurrences. Tolerant of case, whitespace,
 *  punctuation and diacritic differences the tokenizer introduces.
 *
 *  CORRECTNESS/SAFETY: a raw `indexOf` can land the surface INSIDE a larger word
 *  (e.g. NER tags the person `Al`, but `indexOf('Al')` hits `Alabama`), which
 *  would redact the wrong text and leave the real PII exposed. So we only accept
 *  a WORD-ALIGNED match (from `from` onward); if none exists from the cursor we
 *  retry from 0 (the cursor is a best-effort de-dup hint, not a hard floor — a
 *  missed alignment must never cause an entity to be dropped and leak). */
function locate(
  text: string,
  surface: string,
  from: number,
): { start: number; end: number } | null {
  return findAligned(text, surface, from) ?? (from > 0 ? findAligned(text, surface, 0) : null);
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
