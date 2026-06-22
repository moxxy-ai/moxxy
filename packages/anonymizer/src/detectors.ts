/**
 * Backwards-compatible detector surface.
 *
 * The detectors now live in the {@link DICTIONARY} (see `dictionary.ts`), keyed
 * by id and grouped by category + region. This module preserves the original
 * category-keyed API (`DETECTORS[category](text)`) plus `detectCustom` and the
 * validator `_internals` that existing tests and callers depend on.
 */

import { DICTIONARY, detectCustom } from './dictionary.js';
import type { PiiCategory, PiiSpan } from './types.js';
import {
  luhnValid,
  ibanValid,
  isIpv4,
  isIpv6,
  isSsn,
  isPhone,
  isPesel,
  isNip,
  isRegon,
  isNhsNumber,
  isAbaRouting,
  isVin,
  isImei,
} from './validators.js';

export { detectCustom };

/** Category → a function running every dictionary detector of that category
 *  (all regions). Built once from the dictionary. */
export const DETECTORS: Partial<Record<PiiCategory, (text: string) => PiiSpan[]>> = (() => {
  const byCategory = new Map<PiiCategory, Array<(t: string) => PiiSpan[]>>();
  for (const d of DICTIONARY) {
    const list = byCategory.get(d.category) ?? [];
    list.push(d.detect);
    byCategory.set(d.category, list);
  }
  const out: Partial<Record<PiiCategory, (text: string) => PiiSpan[]>> = {};
  for (const [cat, fns] of byCategory) {
    out[cat] = (text: string) => fns.flatMap((fn) => fn(text));
  }
  return out;
})();

/** Validators exposed for unit tests. */
export const _internals = {
  luhnValid,
  ibanValid,
  isIpv4,
  isIpv6,
  isSsn,
  isPhone,
  isPesel,
  isNip,
  isRegon,
  isNhsNumber,
  isAbaRouting,
  isVin,
  isImei,
};
