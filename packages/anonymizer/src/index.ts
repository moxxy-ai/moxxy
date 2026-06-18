/**
 * @moxxy/anonymizer — pure, dependency-free, network-free PII detection + redaction.
 *
 * The engine never touches the network or the filesystem; its only inputs are
 * strings and options. That is the load-bearing offline guarantee (asserted by
 * `offline.test.ts`) and is what lets it run inside the locked-down desktop
 * renderer, where CSP `connect-src 'self'` already blocks all egress.
 */

export { detect } from './detect.js';
export { redact } from './redact.js';
export { shortHash } from './hash.js';
export { ALL_CATEGORIES, STRUCTURED_CATEGORIES } from './types.js';
export type {
  PiiCategory,
  PiiSpan,
  RedactionMode,
  DetectOptions,
  RedactOptions,
  PiiCounts,
  RedactionReport,
  RedactResult,
} from './types.js';
