/**
 * Redaction: detect PII, then rewrite each span according to the chosen mode and
 * return both the redacted text and a per-category report.
 */

import { detect } from './detect.js';
import { shortHash } from './hash.js';
import type {
  PiiCategory,
  PiiSpan,
  RedactionMode,
  RedactOptions,
  RedactResult,
} from './types.js';

/** Human-facing label per category (also the pseudonym/hash prefix). */
const LABELS: Record<PiiCategory, string> = {
  email: 'EMAIL',
  phone: 'PHONE',
  creditCard: 'CARD',
  ssn: 'SSN',
  nationalId: 'ID',
  ipv4: 'IP',
  ipv6: 'IP',
  mac: 'MAC',
  iban: 'IBAN',
  url: 'URL',
  date: 'DATE',
  person: 'PERSON',
  org: 'ORG',
  location: 'LOCATION',
  custom: 'REDACTED',
};

function emptyCounts(): Record<PiiCategory, number> {
  return {
    email: 0,
    phone: 0,
    creditCard: 0,
    ssn: 0,
    nationalId: 0,
    ipv4: 0,
    ipv6: 0,
    mac: 0,
    iban: 0,
    url: 0,
    date: 0,
    person: 0,
    org: 0,
    location: 0,
    custom: 0,
  };
}

/**
 * Redact PII in `text`. Default mode is `label`. Pseudonyms are numbered in
 * document order and are consistent within the call (same value → same token).
 */
export function redact(text: string, opts: RedactOptions = {}): RedactResult {
  const spans = detect(text, opts);
  const mode: RedactionMode = opts.mode ?? 'label';

  // Compute the replacement string per span LEFT-TO-RIGHT so pseudonym numbers
  // follow reading order. Key the memo + counter by the visible LABEL, not the
  // category: distinct categories that share a label (ipv4/ipv6 → 'IP') must
  // share one IP_n sequence so two different values never collapse to one token.
  const counters = new Map<string, number>();
  const memo = new Map<string, string>(); // `${label}:${lower(value)}` → token
  const replacementFor = (span: PiiSpan): string => {
    const label = LABELS[span.category];
    if (mode === 'label') return `[${label}]`;
    const key = `${label}:${span.value.toLowerCase()}`;
    const existing = memo.get(key);
    if (existing) return existing;
    let token: string;
    if (mode === 'hash') {
      token = `[${label}:${shortHash(span.value.toLowerCase(), opts.hashSalt ?? '')}]`;
    } else {
      const n = (counters.get(label) ?? 0) + 1;
      counters.set(label, n);
      token = `${label}_${n}`;
    }
    memo.set(key, token);
    return token;
  };
  const replacements = spans.map(replacementFor);

  // ...then rebuild the output in a single LEFT-TO-RIGHT pass: append the gap
  // before each span and its replacement, then the trailing tail, and join once.
  // `detect()` returns spans sorted by start and non-overlapping, so prevEnd is
  // monotonic. This is O(docLength + numSpans) — slicing per span and
  // re-concatenating the whole (growing) string would be O(numSpans * docLength)
  // and freezes the renderer on a document full of PII.
  const parts: string[] = [];
  let prevEnd = 0;
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]!;
    parts.push(text.slice(prevEnd, span.start), replacements[i]!);
    prevEnd = span.end;
  }
  parts.push(text.slice(prevEnd));
  const out = parts.join('');

  const counts = emptyCounts();
  for (const s of spans) counts[s.category] += 1;

  return { text: out, report: { counts, total: spans.length, spans } };
}
