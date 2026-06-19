/**
 * Public types for the anonymizer engine.
 *
 * Everything here is plain data — no classes, no I/O — so the engine stays a
 * pure, dependency-free leaf that bundles into the desktop renderer unchanged.
 */

/**
 * A class of personally-identifiable information.
 *
 * Most categories are detected by built-in regex/validator detectors in the
 * {@link DICTIONARY}. `person | org | location` come from an external NER pass
 * (the desktop bundles an on-device model and feeds its spans in via
 * {@link DetectOptions.extraSpans}); the engine itself never does NER. `custom`
 * is literal user-supplied terms (names, addresses) the user wants redacted.
 *
 * Several categories are buckets that span many region-specific identifiers
 * distinguished by {@link PiiSpan.subtype} (e.g. `nationalId` covers Polish
 * PESEL, the UK National Insurance Number, …; `taxId` covers NIP/REGON/EIN/…).
 */
export type PiiCategory =
  | 'email'
  | 'phone'
  | 'creditCard'
  | 'ssn'
  | 'nationalId'
  | 'taxId'
  | 'healthId'
  | 'passport'
  | 'driverLicense'
  | 'postalCode'
  | 'bankAccount'
  | 'crypto'
  | 'deviceId'
  | 'vehicleId'
  | 'secret'
  | 'ipv4'
  | 'ipv6'
  | 'mac'
  | 'iban'
  | 'url'
  | 'date'
  | 'person'
  | 'org'
  | 'location'
  | 'custom';

/**
 * Market/jurisdiction a detector targets. `global` detectors are
 * language/country-independent (email, credit card, IBAN, crypto, …) and always
 * run; the rest are gated by {@link DetectOptions.regions}.
 */
export type Region = 'global' | 'PL' | 'UK' | 'US';

/** A detected PII occurrence: a half-open `[start, end)` char range in the source. */
export interface PiiSpan {
  readonly category: PiiCategory;
  /** Inclusive UTF-16 char offset. */
  readonly start: number;
  /** Exclusive UTF-16 char offset. */
  readonly end: number;
  /** The exact matched substring (`text.slice(start, end)`). */
  readonly value: string;
  /** Specific identifier name within the category (e.g. `'PESEL'`, `'NHS'`).
   *  Used as the redaction label so output is precise (`[PESEL]`, not `[ID]`). */
  readonly subtype?: string;
  /** Which market produced the span (for reporting); absent for NER/custom. */
  readonly region?: Region;
}

/**
 * How a detected span is rewritten:
 *  - `label`      → `[EMAIL]` (clearest for a human reviewing what was removed)
 *  - `pseudonym`  → `EMAIL_1` (same value → same token within a doc, so it stays coherent)
 *  - `hash`       → `[EMAIL:a1b2c3d4]` (compact + consistent, less readable)
 */
export type RedactionMode = 'label' | 'pseudonym' | 'hash';

export interface DetectOptions {
  /** Which built-in categories to run. Defaults to {@link DEFAULT_CATEGORIES}. */
  readonly categories?: readonly PiiCategory[];
  /** Which markets' region-specific detectors to run (PL/UK/US). `global`
   *  detectors always run regardless. Defaults to every region. */
  readonly regions?: readonly Region[];
  /** Explicit detector-id allow-list. When provided it takes precedence over
   *  `categories`/`regions` (only these detectors run) — the precise control the
   *  power-user UI / tests use. */
  readonly detectorIds?: readonly string[];
  /** Literal terms (case-insensitive, word-boundary) to redact as `custom` —
   *  the deterministic path for names/addresses the user types in. */
  readonly customTerms?: readonly string[];
  /** Externally-detected spans (e.g. on-device NER `person`/`org`/`location`)
   *  merged into the result through the same overlap-resolution pass. */
  readonly extraSpans?: readonly PiiSpan[];
}

export interface RedactOptions extends DetectOptions {
  /** Defaults to `label`. */
  readonly mode?: RedactionMode;
  /** Optional salt for `hash` mode so tokens differ across documents/users. */
  readonly hashSalt?: string;
}

/** Per-category occurrence counts; every category is present (0 when absent). */
export type PiiCounts = Readonly<Record<PiiCategory, number>>;

export interface RedactionReport {
  readonly counts: PiiCounts;
  readonly total: number;
  /** The non-overlapping spans that were redacted, in document order. */
  readonly spans: readonly PiiSpan[];
}

export interface RedactResult {
  readonly text: string;
  readonly report: RedactionReport;
}

/** Every category, in a stable order (handy for building UI checklists). */
export const ALL_CATEGORIES: readonly PiiCategory[] = [
  'email',
  'phone',
  'creditCard',
  'ssn',
  'nationalId',
  'taxId',
  'healthId',
  'passport',
  'driverLicense',
  'postalCode',
  'bankAccount',
  'crypto',
  'deviceId',
  'vehicleId',
  'secret',
  'ipv4',
  'ipv6',
  'mac',
  'iban',
  'url',
  'date',
  'person',
  'org',
  'location',
  'custom',
];

/** Every market, in a stable order. */
export const ALL_REGIONS: readonly Region[] = ['global', 'PL', 'UK', 'US'];

/**
 * Legacy structured set kept for backwards compatibility. The richer default is
 * {@link DEFAULT_CATEGORIES} (derived from the dictionary's `defaultOn` flags).
 */
export const STRUCTURED_CATEGORIES: readonly PiiCategory[] = [
  'email',
  'phone',
  'creditCard',
  'ssn',
  'ipv4',
  'ipv6',
  'mac',
  'iban',
  'url',
];
