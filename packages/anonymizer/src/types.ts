/**
 * Public types for the anonymizer engine.
 *
 * Everything here is plain data — no classes, no I/O — so the engine stays a
 * pure, dependency-free leaf that bundles into the desktop renderer unchanged.
 */

/**
 * A class of personally-identifiable information.
 *
 * `email`..`date` are detected by built-in regex/validator detectors.
 * `person | org | location` come from an external NER pass (the desktop bundles
 * an on-device model and feeds its spans in via {@link DetectOptions.extraSpans});
 * the engine itself never does NER. `custom` is literal user-supplied terms
 * (names, addresses) the user wants redacted. `nationalId` is reserved for
 * region-specific detectors and has no default built-in (off unless provided as
 * an extra span).
 */
export type PiiCategory =
  | 'email'
  | 'phone'
  | 'creditCard'
  | 'ssn'
  | 'nationalId'
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

/** A detected PII occurrence: a half-open `[start, end)` char range in the source. */
export interface PiiSpan {
  readonly category: PiiCategory;
  /** Inclusive UTF-16 char offset. */
  readonly start: number;
  /** Exclusive UTF-16 char offset. */
  readonly end: number;
  /** The exact matched substring (`text.slice(start, end)`). */
  readonly value: string;
}

/**
 * How a detected span is rewritten:
 *  - `label`      → `[EMAIL]` (clearest for a human reviewing what was removed)
 *  - `pseudonym`  → `EMAIL_1` (same value → same token within a doc, so it stays coherent)
 *  - `hash`       → `[EMAIL:a1b2c3d4]` (compact + consistent, less readable)
 */
export type RedactionMode = 'label' | 'pseudonym' | 'hash';

export interface DetectOptions {
  /** Which built-in detectors to run. Defaults to {@link STRUCTURED_CATEGORIES}. */
  readonly categories?: readonly PiiCategory[];
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

/**
 * The built-in detectors that run by default. `date` is omitted (high
 * false-positive rate — opt-in), as are `nationalId` (region-specific) and the
 * NER-only `person`/`org`/`location`/`custom` categories.
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
