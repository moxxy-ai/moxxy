/**
 * High-precision, validator-backed detectors — one per structured PII category.
 *
 * Each detector returns the spans it finds; correctness over recall is the
 * priority, so every category that can be cheaply validated is (Luhn for cards,
 * mod-97 for IBANs, octet range for IPv4, area/group sanity for SSNs). This
 * keeps false positives low without any model or network call.
 */

import type { PiiCategory, PiiSpan } from './types.js';

/**
 * Hard ceiling on the substring any single regex pass scans at once. Above this,
 * the input is processed in overlapping windows (see {@link scan}). This is a
 * defence-in-depth DoS bound: even if a detector regex is super-linear on some
 * adversarial shape, per-pass cost stays bounded by a constant rather than
 * scaling with total document length and freezing the renderer thread.
 *
 * Sized so the worst built-in regex stays comfortably sub-millisecond per pass
 * while remaining far larger than any legitimate single PII match.
 */
const MAX_SCAN_LEN = 16_384;

/**
 * Overlap between consecutive scan windows, in chars. A real match split by a
 * window boundary reappears whole in the next window (which starts {@link
 * SCAN_OVERLAP} chars before the previous window ended), so chunking never
 * hides a match shorter than this. Comfortably exceeds the longest plausible
 * structured PII value (e.g. an IBAN ≤ 34, an email ≤ ~320).
 *
 * The one detector with no length cap is `url` (`[^…]+` runs to whitespace), so
 * a single URL can exceed even {@link MAX_SCAN_LEN}. The overlap alone can't
 * recover those; edge-touching matches are instead re-matched whole against the
 * full text (see {@link scan} / `recoverFromEdge`).
 */
const SCAN_OVERLAP = 1_024;

/** Run a global regex over `text`, optionally filtering matches with `accept`.
 *
 *  When `accept` rejects a greedy candidate we do NOT skip past the whole
 *  consumed region (which would hide a valid PII value glued to an invalid
 *  prefix — a silent false negative, the worst failure for a redactor). Instead
 *  we rewind to one char past the candidate's start and re-scan, so a valid
 *  sub-match immediately following the rejected prefix is still found. An empty
 *  match always advances by one to guarantee termination.
 *
 *  For inputs longer than {@link MAX_SCAN_LEN} the scan runs over overlapping
 *  windows so worst-case time stays bounded (ReDoS hardening); spans are
 *  deduplicated by absolute start offset across windows. */
function scan(
  text: string,
  re: RegExp,
  category: PiiCategory,
  accept?: (match: string) => boolean,
): PiiSpan[] {
  if (text.length <= MAX_SCAN_LEN) return scanWindow(text, 0, re, category, accept, true);

  // Overlapping windows: each starts SCAN_OVERLAP chars before the previous one
  // ended, so any match clipped by a window's right edge is re-found whole in the
  // next window. Dedup by absolute start (a match can surface in two windows).
  const byStart = new Map<number, PiiSpan>();
  const step = MAX_SCAN_LEN - SCAN_OVERLAP;
  for (let pos = 0; pos < text.length; pos += step) {
    const end = Math.min(pos + MAX_SCAN_LEN, text.length);
    const isLast = end >= text.length;
    const slice = text.slice(pos, end);
    for (const span of scanWindow(slice, pos, re, category, accept, isLast)) {
      // A match touching the right edge of a non-final window may be truncated.
      // The next (overlapping) window normally re-finds it whole — but only if
      // its true length is below the overlap. An UNBOUNDED detector (URL has no
      // length cap) can produce a match longer than any window, which would then
      // touch the right edge of EVERY non-final window and be dropped forever — a
      // silent false negative that leaks the value un-redacted. So when a match
      // touches a non-final edge, recover its complete form by re-matching once
      // against the full text anchored at the match's absolute start. This is a
      // single linear pass (the built-in unbounded regex, URL, is non-backtracking
      // `[^…]+`), not a per-position rescan, so it cannot reintroduce O(n²).
      if (!isLast && span.end >= end) {
        const recovered = recoverFromEdge(text, re, category, span.start, accept);
        if (recovered && !byStart.has(recovered.start)) byStart.set(recovered.start, recovered);
        continue;
      }
      if (!byStart.has(span.start)) byStart.set(span.start, span);
    }
    if (isLast) break;
  }
  return [...byStart.values()].sort((a, b) => a.start - b.start);
}

/** Recover the COMPLETE match that begins at absolute offset `from` in the full
 *  `text`, used when a window clipped it at its right edge. Runs the regex once
 *  anchored at `from` (single linear pass) and accepts it only if it actually
 *  starts there and passes `accept`. Returns null if nothing valid begins there
 *  (e.g. a bounded detector's clipped fragment that the next window handles). */
function recoverFromEdge(
  text: string,
  re: RegExp,
  category: PiiCategory,
  from: number,
  accept?: (match: string) => boolean,
): PiiSpan | null {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  g.lastIndex = from;
  const m = g.exec(text);
  if (!m || m.index !== from) return null; // must begin exactly at the clipped start
  const value = m[0] ?? '';
  if (!value) return null;
  if (accept && !accept(value)) return null;
  return { category, start: from, end: from + value.length, value };
}

/** Scan a single window `slice` (whose first char is at absolute offset `base`
 *  in the original text) and return spans with absolute offsets. */
function scanWindow(
  slice: string,
  base: number,
  re: RegExp,
  category: PiiCategory,
  accept: ((match: string) => boolean) | undefined,
  _isLast: boolean,
): PiiSpan[] {
  const out: PiiSpan[] = [];
  // The fast path (no validator) keeps matchAll; matches can't be sub-recovered.
  if (!accept) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of slice.matchAll(g)) {
      const value = m[0] ?? '';
      const start = m.index ?? -1;
      if (!value || start < 0) continue;
      out.push({ category, start: base + start, end: base + start + value.length, value });
    }
    return out;
  }
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = g.exec(slice)) !== null) {
    const value = m[0] ?? '';
    const start = m.index;
    if (!value) {
      g.lastIndex += 1; // zero-width match: force progress
      continue;
    }
    if (!accept(value)) {
      g.lastIndex = start + 1; // rewind to recover a valid suffix sub-match
      continue;
    }
    out.push({ category, start: base + start, end: base + start + value.length, value });
    g.lastIndex = start + value.length;
  }
  return out;
}

// ── email ──────────────────────────────────────────────────────────────────
// Both the local part and the domain label count are BOUNDED. The unbounded
// local part `[...]+` was the real ReDoS source: on `'x@'+'a.'.repeat(n)` the
// engine restarts at every label char and scans the whole `a.a.a.…` run forward
// looking for an `@` that never comes — O(n) work at each of n positions = O(n²),
// which froze the renderer thread. Capping the local part at the RFC-5321 max of
// 64 chars bounds that forward scan to a constant per position (→ linear), and
// the `{1,32}` label cap (no domain has more) keeps the trailing-TLD failure from
// re-trying an unbounded label chain. Happy-path matching is unchanged.
const EMAIL_RE =
  /\b[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.){1,32}[A-Za-z]{2,24}\b/g;

// ── url ────────────────────────────────────────────────────────────────────
// Stop at whitespace and trailing sentence punctuation/brackets.
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]}]+/g;

// ── ipv4 ───────────────────────────────────────────────────────────────────
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
function isIpv4(m: string): boolean {
  const parts = m.split('.');
  if (parts.length !== 4) return false;
  // Reject zero-padded octets ('010', '00') — ambiguous (some parsers read a
  // leading-zero octet as octal), so a dotted-quad like '010.020.030.040' is
  // not unambiguously an address.
  return parts.every((p) => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255);
}

// ── ipv6 ───────────────────────────────────────────────────────────────────
// Broad candidate (≥3 colon-separated hex groups), then a strict validator.
const IPV6_RE = /[0-9A-Fa-f]{0,4}(?::[0-9A-Fa-f]{0,4}){2,7}/g;
function isIpv6(m: string): boolean {
  if (!/^[0-9A-Fa-f:]+$/.test(m)) return false;
  if ((m.match(/::/g) ?? []).length > 1) return false; // at most one '::'
  if (/:::/.test(m)) return false;
  // A bare leading/trailing single colon is malformed (':' only legal at an edge
  // as part of '::'). Without this, the broad candidate regex glues a stray
  // leading ':' to a valid suffix and emits e.g. ':fe80::1' instead of 'fe80::1'.
  if ((m.startsWith(':') && !m.startsWith('::')) || (m.endsWith(':') && !m.endsWith('::'))) {
    return false;
  }
  const hasDouble = m.includes('::');
  const groups = m.split(':').filter((g) => g.length > 0);
  if (groups.some((g) => !/^[0-9A-Fa-f]{1,4}$/.test(g))) return false;
  // Without compression an address needs exactly 8 groups; with '::' it needs
  // fewer (so a 6-group MAC like 01:23:45:67:89:ab is NOT a valid IPv6).
  return hasDouble ? groups.length >= 1 && groups.length <= 7 : groups.length === 8;
}

// ── mac ────────────────────────────────────────────────────────────────────
const MAC_RE = /\b[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5}\b/g;

// ── credit card ────────────────────────────────────────────────────────────
const CC_RE = /\b\d(?:[ -]?\d){12,18}\b/g;
function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}
function isCreditCard(m: string): boolean {
  const digits = m.replace(/[^0-9]/g, '');
  return digits.length >= 13 && digits.length <= 19 && luhnValid(digits);
}

// ── ssn (US) ───────────────────────────────────────────────────────────────
// Hyphenated form only — a bare 9-digit run is too ambiguous to claim.
const SSN_RE = /\b(\d{3})-(\d{2})-(\d{4})\b/g;
function isSsn(m: string): boolean {
  const [area, group, serial] = m.split('-');
  if (!area || !group || !serial) return false;
  if (area === '000' || area === '666' || Number(area) >= 900) return false;
  if (group === '00') return false;
  if (serial === '0000') return false;
  return true;
}

// ── iban ───────────────────────────────────────────────────────────────────
// Compact or single-space-grouped; validated by mod-97.
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g;
function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s+/g, '').toUpperCase();
  if (s.length < 15 || s.length > 34) return false;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const val = code >= 65 ? code - 55 : code - 48; // A-Z → 10..35, 0-9 → 0..9
    remainder = (remainder * (val > 9 ? 100 : 10) + val) % 97;
  }
  return remainder === 1;
}

// ── phone ──────────────────────────────────────────────────────────────────
// Requires separators between digit groups (so a bare ID number isn't a phone),
// then validates 7–15 digits and rejects date-shaped matches.
const PHONE_RE =
  /(?<![\w.])(?:\+\d{1,3}[ .-]?)?(?:\(\d{1,4}\)[ .-]?)?\d{2,4}(?:[ .-]\d{2,4}){1,5}(?![\w])/g;
function isPhone(m: string): boolean {
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(m)) return false; // ISO-ish date
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(m)) return false; // D/M/Y date
  const digits = m.replace(/[^0-9]/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

// ── date (opt-in; high false-positive rate) ──────────────────────────────────
const DATE_RE =
  /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/gi;

/** Built-in detectors keyed by category. Categories absent here (`person`,
 *  `org`, `location`, `nationalId`) have no regex detector and only appear via
 *  `extraSpans`. */
export const DETECTORS: Partial<Record<PiiCategory, (text: string) => PiiSpan[]>> = {
  email: (t) => scan(t, EMAIL_RE, 'email'),
  url: (t) => scan(t, URL_RE, 'url'),
  ipv4: (t) => scan(t, IPV4_RE, 'ipv4', isIpv4),
  ipv6: (t) => scan(t, IPV6_RE, 'ipv6', isIpv6),
  mac: (t) => scan(t, MAC_RE, 'mac'),
  creditCard: (t) => scan(t, CC_RE, 'creditCard', isCreditCard),
  ssn: (t) => scan(t, SSN_RE, 'ssn', isSsn),
  iban: (t) => scan(t, IBAN_RE, 'iban', ibanValid),
  phone: (t) => scan(t, PHONE_RE, 'phone', isPhone),
  date: (t) => scan(t, DATE_RE, 'date'),
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compiled custom-term regexes, memoized by trimmed term to avoid recompiling
 *  on every keystroke. Bounded so a huge or churning term list can't grow the
 *  cache without limit (a slow memory leak on a long-lived renderer). A `null`
 *  cache entry marks a term we deliberately refuse to compile (see below) so we
 *  don't re-attempt it on every call. */
const CUSTOM_RE_CACHE = new Map<string, RegExp | null>();
const CUSTOM_RE_CACHE_MAX = 2048;

/**
 * Upper bound on a custom term's length. A term this long is never a real
 * name/address, and feeding one into `new RegExp(...)` risks V8's "regular
 * expression too large" error — which, unguarded, throws out of the whole
 * `detect()`/`redact()` call and crashes the redactor on hostile/pasted input.
 * A redactor must degrade, never crash, so an over-length term is simply skipped.
 */
const MAX_CUSTOM_TERM_LEN = 1_024;

/** Compile (and memoize) the boundary regex for `term`, or return null if the
 *  term is too long or the engine rejects the pattern. Never throws. */
function customTermRegex(term: string): RegExp | null {
  const cached = CUSTOM_RE_CACHE.get(term);
  if (cached !== undefined) return cached; // hit (a real regex OR a cached null)
  let re: RegExp | null = null;
  if (term.length <= MAX_CUSTOM_TERM_LEN) {
    // Unicode-aware boundaries: \w is ASCII-only, which mishandles accented/CJK
    // custom terms (over- or under-redaction). \p{L}\p{N}_ with the 'u' flag
    // treats any Unicode letter/number as a word char. Wrapped in try/catch:
    // some engines defer compilation, so an over-large pattern can throw here OR
    // at first use — either way we degrade to "no match" rather than crashing.
    try {
      const compiled = new RegExp(
        `(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`,
        'giu',
      );
      compiled.test(''); // force lazy compile now so a throw is caught here, not later
      re = compiled;
    } catch {
      re = null;
    }
  }
  if (CUSTOM_RE_CACHE.size >= CUSTOM_RE_CACHE_MAX) {
    // Evict the oldest entry (Map preserves insertion order) to stay bounded.
    const oldest = CUSTOM_RE_CACHE.keys().next().value;
    if (oldest !== undefined) CUSTOM_RE_CACHE.delete(oldest);
  }
  CUSTOM_RE_CACHE.set(term, re);
  return re;
}

/** Literal, case-insensitive, word-boundary matches of user-supplied terms.
 *  Hostile input (empty, whitespace, or absurdly long terms) is skipped, never
 *  fatal. */
export function detectCustom(text: string, terms: readonly string[]): PiiSpan[] {
  const spans: PiiSpan[] = [];
  for (const term of terms) {
    const t = term.trim();
    if (!t) continue;
    const re = customTermRegex(t);
    if (!re) continue; // term too long / uncompilable — skip rather than crash
    re.lastIndex = 0; // cached regexes are stateful ('g' flag) — reset per use
    for (const m of text.matchAll(re)) {
      const value = m[0] ?? '';
      const start = m.index ?? -1;
      if (!value || start < 0) continue;
      spans.push({ category: 'custom', start, end: start + value.length, value });
    }
  }
  return spans;
}

// Exposed for unit tests.
export const _internals = { luhnValid, ibanValid, isIpv4, isIpv6, isSsn, isPhone };
