/**
 * High-precision, validator-backed detectors — one per structured PII category.
 *
 * Each detector returns the spans it finds; correctness over recall is the
 * priority, so every category that can be cheaply validated is (Luhn for cards,
 * mod-97 for IBANs, octet range for IPv4, area/group sanity for SSNs). This
 * keeps false positives low without any model or network call.
 */

import type { PiiCategory, PiiSpan } from './types.js';

/** Run a global regex over `text`, optionally filtering matches with `accept`. */
function scan(
  text: string,
  re: RegExp,
  category: PiiCategory,
  accept?: (match: string) => boolean,
): PiiSpan[] {
  const out: PiiSpan[] = [];
  for (const m of text.matchAll(re)) {
    const value = m[0] ?? '';
    const start = m.index ?? -1;
    if (!value || start < 0) continue;
    if (accept && !accept(value)) continue;
    out.push({ category, start, end: start + value.length, value });
  }
  return out;
}

// ── email ──────────────────────────────────────────────────────────────────
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}\b/g;

// ── url ────────────────────────────────────────────────────────────────────
// Stop at whitespace and trailing sentence punctuation/brackets.
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]}]+/g;

// ── ipv4 ───────────────────────────────────────────────────────────────────
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
function isIpv4(m: string): boolean {
  const parts = m.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => p.length <= 3 && Number(p) <= 255);
}

// ── ipv6 ───────────────────────────────────────────────────────────────────
// Broad candidate (≥3 colon-separated hex groups), then a strict validator.
const IPV6_RE = /[0-9A-Fa-f]{0,4}(?::[0-9A-Fa-f]{0,4}){2,7}/g;
function isIpv6(m: string): boolean {
  if (!/^[0-9A-Fa-f:]+$/.test(m)) return false;
  if ((m.match(/::/g) ?? []).length > 1) return false; // at most one '::'
  if (/:::/.test(m)) return false;
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

/** Literal, case-insensitive, word-boundary matches of user-supplied terms. */
export function detectCustom(text: string, terms: readonly string[]): PiiSpan[] {
  const spans: PiiSpan[] = [];
  for (const term of terms) {
    const t = term.trim();
    if (!t) continue;
    const re = new RegExp(`(?<!\\w)${escapeRegExp(t)}(?!\\w)`, 'gi');
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
