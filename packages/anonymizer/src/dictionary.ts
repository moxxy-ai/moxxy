/**
 * The detector dictionary — the heart of the engine.
 *
 * Each {@link DetectorDef} pairs a candidate regex with an optional validator
 * (checksum / structural) and, for the loosest identifiers, an optional *context*
 * requirement (a nearby keyword such as `PESEL` / `NIP` / `NHS`). The regex finds
 * candidates; the validator and context keep precision high. A detector carries a
 * `region` (so the UI can scope to a market) and a `label` (the specific
 * identifier name used in redaction output, e.g. `[PESEL]`).
 *
 * The regexes and checksum algorithms here were assembled from official sources
 * (government / standards bodies) and adversarially cross-checked. Adding a
 * market identifier is a single entry here — nothing else changes.
 *
 * PRECISION CONTRACT (see `validators.ts` + `detect.ts`):
 *  - checksum-validated detectors (PESEL, NIP, REGON, NHS, UTR, ABA, Luhn,
 *    IBAN/NRB, VIN, dowód, passport) are safe to run unanchored;
 *  - no-checksum / bare-numeric / region-ambiguous detectors are context-gated
 *    (a keyword within {@link CONTEXT_WINDOW} chars) and/or `defaultOn:false`.
 */

import type { PiiCategory, PiiSpan, Region } from './types.js';
import {
  isCreditCard,
  isImei,
  ibanValid,
  isPlNrb,
  isIpv4,
  isIpv6,
  isSsn,
  isItin,
  isEin,
  isPhone,
  isPesel,
  isNip,
  isRegon,
  isDowodOsobisty,
  isPlPassport,
  isNhsNumber,
  isUtr,
  isAbaRouting,
  isVin,
} from './validators.js';

export interface DetectorDef {
  /** Stable kebab id, e.g. `pl-pesel`. */
  readonly id: string;
  readonly category: PiiCategory;
  readonly region: Region;
  /** Specific identifier name shown in output (`PESEL`, `NHS`, …). */
  readonly label: string;
  /** Whether this detector's category is part of the default profile. */
  readonly defaultOn: boolean;
  readonly detect: (text: string) => PiiSpan[];
}

/** How many chars on each side of a match we look in for a context keyword. */
const CONTEXT_WINDOW = 48;

interface DetectorSpec {
  readonly id: string;
  readonly category: PiiCategory;
  readonly region: Region;
  readonly label: string;
  readonly re: RegExp;
  /** Validate / reject a raw match. Defaults to accept-all. */
  readonly accept?: (match: string) => boolean;
  /** When set, a match only counts if this keyword appears within
   *  {@link CONTEXT_WINDOW} chars — cuts false positives on bare numeric IDs. */
  readonly context?: RegExp;
  /** Defaults to `true`. */
  readonly defaultOn?: boolean;
}

/** Build a detector from a spec, wiring the `category`/`region`/`label`/context. */
function make(spec: DetectorSpec): DetectorDef {
  const flags = spec.re.flags.includes('g') ? spec.re.flags : `${spec.re.flags}g`;
  return {
    id: spec.id,
    category: spec.category,
    region: spec.region,
    label: spec.label,
    defaultOn: spec.defaultOn ?? true,
    detect(text: string): PiiSpan[] {
      const re = new RegExp(spec.re.source, flags);
      const out: PiiSpan[] = [];
      for (const m of text.matchAll(re)) {
        const value = m[0] ?? '';
        const start = m.index ?? -1;
        if (!value || start < 0) continue;
        if (spec.accept && !spec.accept(value)) continue;
        if (spec.context && !hasContext(text, start, start + value.length, spec.context)) continue;
        out.push({
          category: spec.category,
          start,
          end: start + value.length,
          value,
          subtype: spec.label,
          region: spec.region,
        });
      }
      return out;
    },
  };
}

/** True when `keyword` appears within {@link CONTEXT_WINDOW} chars of the match. */
function hasContext(text: string, start: number, end: number, keyword: RegExp): boolean {
  const before = text.slice(Math.max(0, start - CONTEXT_WINDOW), start);
  const after = text.slice(end, end + CONTEXT_WINDOW);
  const re = new RegExp(keyword.source, keyword.flags.replace('g', ''));
  return re.test(before) || re.test(after);
}

// ── global structured ─────────────────────────────────────────────────────────
const GLOBAL: DetectorDef[] = [
  make({
    id: 'email',
    category: 'email',
    region: 'global',
    label: 'EMAIL',
    // Every quantifier is bounded (local ≤64 per RFC 5321; DNS labels ≤63; ≤32
    // sub-labels) so a hostile no-TLD-tail input like `x@a.a.a.…` cannot trigger
    // catastrophic backtracking (ReDoS) that freezes the renderer thread. The
    // bounds are far larger than any legitimate address, so recall is unaffected.
    re: /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,32}\.[A-Za-z]{2,24}\b/,
  }),
  make({
    id: 'url',
    category: 'url',
    region: 'global',
    label: 'URL',
    re: /\bhttps?:\/\/[^\s<>"')\]}]+/,
  }),
  make({
    id: 'ipv4',
    category: 'ipv4',
    region: 'global',
    label: 'IP',
    re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
    accept: isIpv4,
  }),
  make({
    id: 'ipv6',
    category: 'ipv6',
    region: 'global',
    label: 'IP',
    re: /[0-9A-Fa-f]{0,4}(?::[0-9A-Fa-f]{0,4}){2,7}/,
    accept: isIpv6,
  }),
  make({
    id: 'mac',
    category: 'mac',
    region: 'global',
    label: 'MAC',
    re: /\b[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5}\b/,
  }),
  make({
    id: 'credit-card',
    category: 'creditCard',
    region: 'global',
    label: 'CARD',
    re: /\b\d(?:[ -]?\d){12,18}\b/,
    accept: isCreditCard,
  }),
  make({
    id: 'iban',
    category: 'iban',
    region: 'global',
    label: 'IBAN',
    re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/,
    accept: ibanValid,
  }),
  make({
    id: 'phone',
    category: 'phone',
    region: 'global',
    label: 'PHONE',
    re: /(?<![\w.])(?:\+\d{1,3}[ .-]?)?(?:\(\d{1,4}\)[ .-]?)?\d{2,4}(?:[ .-]\d{2,4}){1,5}(?![\w])/,
    accept: isPhone,
  }),
  make({
    id: 'imei',
    category: 'deviceId',
    region: 'global',
    label: 'IMEI',
    defaultOn: false,
    re: /\b\d{2}[- ]?\d{6}[- ]?\d{6}[- ]?\d\b|\b\d{15}\b/,
    accept: isImei,
    context: /\bIMEI\b/i,
  }),
  make({
    id: 'vin',
    category: 'vehicleId',
    region: 'global',
    label: 'VIN',
    defaultOn: false,
    re: /\b[A-HJ-NPR-Z0-9]{17}\b/,
    accept: isVin,
  }),
  make({
    id: 'date',
    category: 'date',
    region: 'global',
    label: 'DATE',
    defaultOn: false,
    re: /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i,
  }),
];

// ── global crypto wallets (structural only — keeps the engine dependency-free) ─
const CRYPTO: DetectorDef[] = [
  make({
    id: 'btc-base58check',
    category: 'crypto',
    region: 'global',
    label: 'BTC',
    defaultOn: false,
    re: /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/,
  }),
  make({
    id: 'btc-bech32',
    category: 'crypto',
    region: 'global',
    label: 'BTC',
    defaultOn: false,
    re: /\b(?:bc|tb)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,87}\b/,
  }),
  make({
    id: 'ethereum-address',
    category: 'crypto',
    region: 'global',
    label: 'ETH',
    defaultOn: false,
    re: /\b0x[0-9a-fA-F]{40}\b/,
  }),
];

// ── global secrets / credentials (structural prefix match — low FP, high harm) ─
const SECRETS: DetectorDef[] = [
  make({
    id: 'aws-access-key-id',
    category: 'secret',
    region: 'global',
    label: 'AWS_KEY',
    re: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/,
  }),
  make({
    id: 'github-token',
    category: 'secret',
    region: 'global',
    label: 'GITHUB_TOKEN',
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59})\b/,
  }),
  make({
    id: 'stripe-secret-key',
    category: 'secret',
    region: 'global',
    label: 'STRIPE_KEY',
    re: /\b(?:sk|rk|pk)_(?:live|test|prod)_[A-Za-z0-9]{10,128}(?![A-Za-z0-9])/,
  }),
  make({
    id: 'google-api-key',
    category: 'secret',
    region: 'global',
    label: 'GOOGLE_API_KEY',
    re: /\bAIza[0-9A-Za-z_-]{35}\b/,
  }),
  make({
    id: 'slack-token',
    category: 'secret',
    region: 'global',
    label: 'SLACK_TOKEN',
    re: /\bxox[baprsoe]-(?:\d-)?[0-9A-Za-z]{8,48}(?:-[0-9A-Za-z]{8,48}){0,3}\b/,
  }),
  make({
    id: 'openai-api-key',
    category: 'secret',
    region: 'global',
    label: 'OPENAI_KEY',
    re: /\bsk-[A-Za-z0-9]{48}\b|\bsk-(?:(?:proj|svcacct|admin|None)-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}/,
  }),
  make({
    id: 'jwt',
    category: 'secret',
    region: 'global',
    label: 'JWT',
    re: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*(?![A-Za-z0-9_-])/,
  }),
  make({
    id: 'private-key-pem',
    category: 'secret',
    region: 'global',
    label: 'PRIVATE_KEY',
    // Match the whole PEM block when an END line is present (so the key material
    // is removed, not just the header); fall back to the header alone otherwise.
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----(?:[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----)?/,
  }),
];

// ── United States ─────────────────────────────────────────────────────────────
const US: DetectorDef[] = [
  make({
    id: 'us-ssn',
    category: 'ssn',
    region: 'US',
    label: 'SSN',
    re: /\b(\d{3})-(\d{2})-(\d{4})\b/,
    accept: isSsn,
  }),
  make({
    id: 'us-itin',
    category: 'taxId',
    region: 'US',
    label: 'ITIN',
    defaultOn: false,
    re: /\b9\d\d([- ]?)(?:5[0-9]|6[0-5]|7[0-9]|8[0-8]|9[0-24-9])\1\d{4}\b/,
    accept: isItin,
  }),
  make({
    id: 'us-ein',
    category: 'taxId',
    region: 'US',
    label: 'EIN',
    defaultOn: false,
    re: /\b(?:0[1-6]|1[0-6]|2[0-7]|3[0-9]|4[0-8]|5[0-9]|6[0-8]|7[1-7]|8[0-8]|9[0-5]|98|99)-\d{7}\b/,
    accept: isEin,
    context: /\bEIN\b|employer id/i,
  }),
  make({
    id: 'us-mbi',
    category: 'healthId',
    region: 'US',
    label: 'MBI',
    defaultOn: false,
    re: /\b[1-9][ACDEFGHJKMNPQRTUVWXY][0-9ACDEFGHJKMNPQRTUVWXY][0-9][ACDEFGHJKMNPQRTUVWXY][0-9ACDEFGHJKMNPQRTUVWXY][0-9][ACDEFGHJKMNPQRTUVWXY][ACDEFGHJKMNPQRTUVWXY][0-9][0-9]\b/,
  }),
  make({
    id: 'us-aba-routing',
    category: 'bankAccount',
    region: 'US',
    label: 'ROUTING',
    defaultOn: false,
    re: /\b(?:0[0-9]|1[0-2]|2[1-9]|3[0-2]|6[1-9]|7[0-2]|80)\d{7}\b/,
    accept: isAbaRouting,
    context: /\b(?:routing|aba|rtn)\b/i,
  }),
  make({
    id: 'us-bank-account',
    category: 'bankAccount',
    region: 'US',
    label: 'ACCOUNT',
    defaultOn: false,
    re: /\b\d{8}\b/,
    context: /\b(?:account|acct|a\/c)\b/i,
  }),
  make({
    id: 'us-passport',
    category: 'passport',
    region: 'US',
    label: 'PASSPORT',
    defaultOn: false,
    re: /\b(?:[A-Z][0-9]{8}|[0-9]{9})\b/,
    context: /\bpassport\b/i,
  }),
  make({
    id: 'us-zip',
    category: 'postalCode',
    region: 'US',
    label: 'ZIP',
    defaultOn: false,
    re: /\b\d{5}(?:-\d{4})?\b/,
    context: /\b(?:zip|postal)\b/i,
  }),
];

// ── Poland ─────────────────────────────────────────────────────────────────────
const PL: DetectorDef[] = [
  make({
    id: 'pl-pesel',
    category: 'nationalId',
    region: 'PL',
    label: 'PESEL',
    re: /\b\d{11}\b/,
    accept: isPesel,
  }),
  make({
    // Formatted NIP — a `PL` prefix or dashed grouping is itself strong evidence.
    id: 'pl-nip',
    category: 'taxId',
    region: 'PL',
    label: 'NIP',
    re: /\bPL\s?\d{10}\b|\b\d{3}-\d{2,3}-\d{2,3}-\d{2,3}\b/,
    accept: isNip,
  }),
  make({
    // Bare 10-digit NIP — needs a nearby `NIP` keyword (mod-11 alone is common).
    id: 'pl-nip-plain',
    category: 'taxId',
    region: 'PL',
    label: 'NIP',
    re: /\b\d{10}\b/,
    accept: isNip,
    context: /\bNIP\b/i,
  }),
  make({
    id: 'pl-regon',
    category: 'taxId',
    region: 'PL',
    label: 'REGON',
    defaultOn: false,
    re: /\b\d{9}\b|\b\d{14}\b/,
    accept: isRegon,
    context: /\bREGON\b/i,
  }),
  make({
    id: 'pl-dowod-osobisty',
    category: 'nationalId',
    region: 'PL',
    label: 'DOWOD',
    defaultOn: false,
    re: /(?<![0-9A-Za-z])[A-NP-Za-np-z]{3}[0-9]{6}(?![0-9A-Za-z])/,
    accept: isDowodOsobisty,
  }),
  make({
    id: 'pl-passport',
    category: 'passport',
    region: 'PL',
    label: 'PASSPORT',
    defaultOn: false,
    re: /(?<![0-9A-Za-z])[A-Za-z]{2}[0-9]{7}(?![0-9A-Za-z])/,
    accept: isPlPassport,
  }),
  make({
    id: 'pl-nrb-iban',
    category: 'bankAccount',
    region: 'PL',
    label: 'NRB',
    defaultOn: false,
    re: /(?<![0-9A-Za-z])(?:PL)?[0-9]{2}(?:[ \t-]?[0-9]{4}){6}(?![0-9])/i,
    accept: isPlNrb,
  }),
  make({
    id: 'pl-drivers-license',
    category: 'driverLicense',
    region: 'PL',
    label: 'DL',
    defaultOn: false,
    re: /(?<![0-9])[0-9]{5}\/[0-9]{2}\/[0-9]{4,7}(?![0-9])/,
    context: /prawo jazdy/i,
  }),
  make({
    id: 'pl-dowod-rejestracyjny',
    category: 'vehicleId',
    region: 'PL',
    label: 'REG_DOC',
    defaultOn: false,
    re: /(?<![0-9A-Za-z])DR\s*\/\s*BA[A-Z]\s*[0-9]{7}(?![0-9])/,
  }),
];

// ── United Kingdom ──────────────────────────────────────────────────────────────
const UK: DetectorDef[] = [
  make({
    id: 'uk-nino',
    category: 'nationalId',
    region: 'UK',
    label: 'NINO',
    defaultOn: false,
    re: /\b(?![DFIQUV])[A-CEGHJ-PR-TW-Z](?![DFIOQUV])[A-CEGHJ-NPR-TW-Z](?<!BG)(?<!GB)(?<!KN)(?<!NK)(?<!NT)(?<!TN)(?<!ZZ)\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/,
  }),
  make({
    id: 'uk-nhs-number',
    category: 'healthId',
    region: 'UK',
    label: 'NHS',
    defaultOn: false,
    re: /\b\d{3}[ -]?\d{3}[ -]?\d{4}\b/,
    accept: isNhsNumber,
    context: /\bNHS\b/i,
  }),
  make({
    id: 'uk-utr',
    category: 'taxId',
    region: 'UK',
    label: 'UTR',
    defaultOn: false,
    re: /\b\d{5}\s?\d{5}K?\b/i,
    accept: isUtr,
    context: /\bUTR\b|unique taxpayer/i,
  }),
  make({
    id: 'uk-postcode',
    category: 'postalCode',
    region: 'UK',
    label: 'POSTCODE',
    defaultOn: false,
    re: /\b(?:GIR ?0AA|(?:[A-PR-UWYZ][0-9]{1,2}|[A-PR-UWYZ][A-HK-Y][0-9]{1,2}|[A-PR-UWYZ][0-9][A-HJKPSTUW]|[A-PR-UWYZ][A-HK-Y][0-9][ABEHMNPRV-Y]) ?[0-9][ABD-HJLNP-UW-Z]{2})\b/i,
  }),
  make({
    id: 'uk-passport',
    category: 'passport',
    region: 'UK',
    label: 'PASSPORT',
    defaultOn: false,
    re: /\b[A-Z0-9]\d{8}\b/i,
    context: /\bpassport\b/i,
  }),
  make({
    id: 'uk-driving-licence',
    category: 'driverLicense',
    region: 'UK',
    label: 'DL',
    defaultOn: false,
    re: /\b[A-Z9]{5}[0-9]{6}[A-Z9]{2}[A-Z0-9]{3}\b/,
  }),
  make({
    id: 'uk-sort-code',
    category: 'bankAccount',
    region: 'UK',
    label: 'SORT_CODE',
    defaultOn: false,
    re: /\b\d{2}[- ]?\d{2}[- ]?\d{2}\b/,
    context: /sort code/i,
  }),
];

/** The full dictionary — every built-in detector. */
export const DICTIONARY: readonly DetectorDef[] = [
  ...GLOBAL,
  ...CRYPTO,
  ...SECRETS,
  ...US,
  ...PL,
  ...UK,
];

/** Detector lookup by id. */
export const DETECTOR_BY_ID: ReadonlyMap<string, DetectorDef> = new Map(
  DICTIONARY.map((d) => [d.id, d]),
);

/** Categories that have at least one `defaultOn` detector — the engine default. */
export const DEFAULT_CATEGORIES: readonly PiiCategory[] = [
  ...new Set(DICTIONARY.filter((d) => d.defaultOn).map((d) => d.category)),
];

/** Every category that has at least one built-in detector (any `defaultOn`).
 *  The UI derives its toggle list from this, so adding a detector surfaces its
 *  category automatically. */
export const DETECTABLE_CATEGORIES: readonly PiiCategory[] = [
  ...new Set(DICTIONARY.map((d) => d.category)),
];

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
