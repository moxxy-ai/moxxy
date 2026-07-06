/**
 * Redaction: detect PII, then rewrite each span according to the chosen mode and
 * return both the redacted text and a per-category report.
 */

import { detect } from './detect.js';
import { shortHash } from './hash.js';
import { required } from './assert.js';
import type {
  PiiCategory,
  PiiSpan,
  RedactionMode,
  RedactOptions,
  RedactResult,
} from './types.js';

/** Coarse human-facing label per category. A span's specific {@link PiiSpan.subtype}
 *  (e.g. `PESEL`, `NHS`) overrides this so output stays precise. */
const LABELS: Record<PiiCategory, string> = {
  email: 'EMAIL',
  phone: 'PHONE',
  creditCard: 'CARD',
  ssn: 'SSN',
  nationalId: 'ID',
  taxId: 'TAX_ID',
  healthId: 'HEALTH_ID',
  passport: 'PASSPORT',
  driverLicense: 'LICENSE',
  postalCode: 'POSTCODE',
  bankAccount: 'BANK',
  crypto: 'CRYPTO',
  deviceId: 'DEVICE',
  vehicleId: 'VEHICLE',
  secret: 'SECRET',
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

/** The label to emit for a span: its specific subtype when present, else the
 *  coarse category label. */
function labelFor(span: PiiSpan): string {
  return span.subtype ?? LABELS[span.category];
}

function emptyCounts(): Record<PiiCategory, number> {
  return {
    email: 0,
    phone: 0,
    creditCard: 0,
    ssn: 0,
    nationalId: 0,
    taxId: 0,
    healthId: 0,
    passport: 0,
    driverLicense: 0,
    postalCode: 0,
    bankAccount: 0,
    crypto: 0,
    deviceId: 0,
    vehicleId: 0,
    secret: 0,
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
  // follow reading order, ...
  const counters = new Map<string, number>(); // label → next index
  const memo = new Map<string, string>(); // `${label}:${lower(value)}` → token
  const replacementFor = (span: PiiSpan): string => {
    const label = labelFor(span);
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

  // ...then splice RIGHT-TO-LEFT so earlier offsets stay valid as we go.
  let out = text;
  for (let i = spans.length - 1; i >= 0; i--) {
    const span = required(spans[i], 'loop index is within spans bounds');
    out = out.slice(0, span.start) + replacements[i] + out.slice(span.end);
  }

  const counts = emptyCounts();
  for (const s of spans) counts[s.category] += 1;

  return { text: out, report: { counts, total: spans.length, spans } };
}
