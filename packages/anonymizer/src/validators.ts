/**
 * Pure validators — checksum / structural checks that turn loose regex
 * candidates into high-precision detections. No I/O, no state.
 *
 * A detector's regex only finds *candidates*; the validator is what keeps false
 * positives down (a Luhn check on a 16-digit run, mod-97 on an IBAN, the PESEL
 * weighted checksum, …). Every validator here is exercised directly by
 * `validators.test.ts` with synthetic-but-checksum-valid vectors.
 *
 * A recurring subtlety: pure weighted-mod schemes accept an all-zeros string
 * (sum 0 ⇒ control 0). Such strings are never real identifiers, so the relevant
 * validators reject all-zeros explicitly via {@link notAllZeros}.
 */

/** Strip everything but ASCII digits. */
export function digitsOnly(s: string): string {
  return s.replace(/[^0-9]/g, '');
}

/** Reject the degenerate all-zeros run that satisfies any weighted-mod check. */
function notAllZeros(digits: string): boolean {
  return /[1-9]/.test(digits);
}

/** Letter→number for ID checksums: A=10 … Z=35; digit = face value. */
function alnumValue(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 90) return code - 55;
  if (code >= 97 && code <= 122) return code - 87;
  return NaN;
}

/** Weighted sum of `digits` against `weights` (positionally aligned). */
function weightedSum(digits: string, weights: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += (digits.charCodeAt(i) - 48) * weights[i]!;
  return sum;
}

// ── Luhn (credit cards, IMEI) ────────────────────────────────────────────────
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function isCreditCard(m: string): boolean {
  const d = digitsOnly(m);
  return d.length >= 13 && d.length <= 19 && notAllZeros(d) && luhnValid(d);
}

/** IMEI: exactly 15 digits, Luhn-valid (the 15th is the Luhn check digit). */
export function isImei(m: string): boolean {
  const d = digitsOnly(m);
  return d.length === 15 && notAllZeros(d) && luhnValid(d);
}

// ── IBAN (mod-97) ────────────────────────────────────────────────────────────
/**
 * Per-country IBAN length table (ISO 13616). Used so a `XX99…` run of the wrong
 * length for its country is rejected before the (also-checked) mod-97 pass.
 */
export const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29,
  BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29,
  ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28,
  HR: 21, HU: 28, IE: 22, IL: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28,
  LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27,
  MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24,
  RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, TN: 24, TR: 26, UA: 29,
  VA: 22, VG: 24, XK: 20,
};

export function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s+/g, '').toUpperCase();
  if (s.length < 15 || s.length > 34) return false;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false;
  const expected = IBAN_LENGTHS[s.slice(0, 2)];
  if (expected != null && s.length !== expected) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const val = code >= 65 ? code - 55 : code - 48; // A-Z → 10..35, 0-9 → 0..9
    remainder = (remainder * (val > 9 ? 100 : 10) + val) % 97;
  }
  return remainder === 1;
}

/** Polish NRB (26 digits) — the body of a PL IBAN. Normalize, prepend `PL` if
 *  absent, then mod-97 (PL IBANs are 28 chars: `PL` + 26-digit NRB). */
export function isPlNrb(raw: string): boolean {
  const s = raw.replace(/[ \t-]/g, '').toUpperCase();
  const withPL = s.startsWith('PL') ? s : `PL${s}`;
  if (!/^PL\d{26}$/.test(withPL)) return false;
  return ibanValid(withPL);
}

// ── IPv4 / IPv6 ──────────────────────────────────────────────────────────────
export function isIpv4(m: string): boolean {
  const parts = m.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

export function isIpv6(m: string): boolean {
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

// ── US SSN ───────────────────────────────────────────────────────────────────
export function isSsn(m: string): boolean {
  const parts = m.split('-');
  if (parts.length !== 3) return false;
  const [area, group, serial] = parts as [string, string, string];
  if (area === '000' || area === '666' || Number(area) >= 900) return false;
  if (group === '00') return false;
  if (serial === '0000') return false;
  return true;
}

// ── US ITIN ──────────────────────────────────────────────────────────────────
/** ITIN: 9-digit, starts with 9, group (4th-5th) in {50-65,70-88,90-92,94-99}.
 *  No checksum — the regex encodes the ranges; reject an all-zero serial. */
export function isItin(m: string): boolean {
  const d = digitsOnly(m);
  if (d.length !== 9 || d[0] !== '9') return false;
  if (d.slice(5) === '0000') return false;
  return true;
}

// ── US EIN ───────────────────────────────────────────────────────────────────
const EIN_INVALID_PREFIXES = new Set([
  '00', '07', '08', '09', '17', '18', '19', '28', '29', '49', '69', '70', '78',
  '79', '89', '96', '97',
]);
/** EIN: `PP-NNNNNNN`; the two-digit IRS campus prefix must be a valid one. */
export function isEin(m: string): boolean {
  const d = digitsOnly(m);
  if (d.length !== 9) return false;
  if (EIN_INVALID_PREFIXES.has(d.slice(0, 2))) return false;
  return notAllZeros(d.slice(2));
}

// ── Phone ────────────────────────────────────────────────────────────────────
export function isPhone(m: string): boolean {
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(m)) return false; // ISO-ish date
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(m)) return false; // D/M/Y date
  const d = digitsOnly(m);
  return d.length >= 7 && d.length <= 15;
}

// ── Poland: PESEL ────────────────────────────────────────────────────────────
const PESEL_WEIGHTS = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3] as const;
/** PESEL: 11 digits, weighted checksum (control = (10 − sum mod 10) mod 10) and a
 *  sane embedded birth date (month carries the century offset). */
export function isPesel(m: string): boolean {
  const d = digitsOnly(m);
  if (d.length !== 11) return false;
  const sum = weightedSum(d, PESEL_WEIGHTS);
  const control = (10 - (sum % 10)) % 10;
  if (control !== d.charCodeAt(10) - 48) return false;
  return peselDateValid(d);
}

function peselDateValid(d: string): boolean {
  const yy = Number(d.slice(0, 2));
  const mmRaw = Number(d.slice(2, 4));
  const dd = Number(d.slice(4, 6));
  // Month field encodes the century: +0 → 1900s, +20 → 2000s, +40 → 2100s,
  // +60 → 2200s, +80 → 1800s.
  const centuries: Record<number, number> = { 0: 1900, 20: 2000, 40: 2100, 60: 2200, 80: 1800 };
  const offset = mmRaw - (((mmRaw - 1) % 20) + 1); // 0/20/40/60/80
  const century = centuries[offset];
  if (century == null) return false;
  const month = mmRaw - offset;
  if (month < 1 || month > 12) return false;
  if (dd < 1 || dd > 31) return false;
  const daysInMonth = new Date(century + yy, month, 0).getDate();
  return dd <= daysInMonth;
}

// ── Poland: NIP (tax id) ─────────────────────────────────────────────────────
const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const;
export function isNip(m: string): boolean {
  const d = digitsOnly(m.replace(/^PL/i, ''));
  if (d.length !== 10 || !notAllZeros(d)) return false;
  const sum = weightedSum(d, NIP_WEIGHTS);
  const control = sum % 11;
  if (control === 10) return false; // never a valid NIP
  return control === d.charCodeAt(9) - 48;
}

// ── Poland: REGON (statistical/business id) ──────────────────────────────────
const REGON9_WEIGHTS = [8, 9, 2, 3, 4, 5, 6, 7] as const;
const REGON14_WEIGHTS = [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8] as const;
export function isRegon(m: string): boolean {
  const d = digitsOnly(m);
  if (!notAllZeros(d)) return false;
  if (d.length === 9) return regonCheck(d, REGON9_WEIGHTS, 8);
  if (d.length === 14) return regonCheck(d, REGON14_WEIGHTS, 13);
  return false;
}
function regonCheck(d: string, weights: readonly number[], checkIdx: number): boolean {
  const control = (weightedSum(d, weights) % 11) % 10;
  return control === d.charCodeAt(checkIdx) - 48;
}

// ── Poland: dowód osobisty (ID card) ─────────────────────────────────────────
const DOWOD_WEIGHTS = [7, 3, 1, 9, 7, 3, 1, 7, 3] as const;
/** ID card: 3 letters + 6 digits (c[3] is the check digit). Letters A=10…Z=35,
 *  weighted by {@link DOWOD_WEIGHTS}; valid iff sum mod 10 === 0. */
export function isDowodOsobisty(m: string): boolean {
  const s = m.toUpperCase();
  if (!/^[A-Z]{3}\d{6}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const v = alnumValue(s[i]!);
    if (Number.isNaN(v)) return false;
    sum += v * DOWOD_WEIGHTS[i]!;
  }
  return sum % 10 === 0;
}

// ── Poland: passport ─────────────────────────────────────────────────────────
const PL_PASSPORT_WEIGHTS = [7, 3, 9, 1, 7, 3, 1, 7, 3] as const;
/** Passport: 2 letters + 7 digits (c[2] is the check digit). */
export function isPlPassport(m: string): boolean {
  const s = m.toUpperCase();
  if (!/^[A-Z]{2}\d{7}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const v = alnumValue(s[i]!);
    if (Number.isNaN(v)) return false;
    sum += v * PL_PASSPORT_WEIGHTS[i]!;
  }
  return sum % 10 === 0;
}

// ── UK: NHS number ───────────────────────────────────────────────────────────
/** NHS number: 10 digits, Modulus-11 (weights 10..2 on the first 9; check digit
 *  = 11 − (sum mod 11), 11→0, 10→invalid). */
export function isNhsNumber(m: string): boolean {
  const d = digitsOnly(m);
  if (d.length !== 10) return false;
  const weights = [10, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = weightedSum(d, weights);
  let check = 11 - (sum % 11);
  if (check === 11) check = 0;
  if (check === 10) return false;
  return check === d.charCodeAt(9) - 48;
}

// ── UK: UTR (tax) ─────────────────────────────────────────────────────────────
const UTR_WEIGHTS = [6, 7, 8, 9, 10, 5, 4, 3, 2] as const;
const UTR_LOOKUP = [2, 1, 9, 8, 7, 6, 5, 4, 3, 2, 1] as const;
/** UTR: 10 digits (optional trailing K). Modulus-11 with the check digit FIRST. */
export function isUtr(m: string): boolean {
  const d = digitsOnly(m);
  if (d.length !== 10) return false;
  const sum = weightedSum(d.slice(1), UTR_WEIGHTS);
  const expected = UTR_LOOKUP[sum % 11]!;
  return expected === d.charCodeAt(0) - 48;
}

// ── US: ABA routing number ───────────────────────────────────────────────────
export function isAbaRouting(m: string): boolean {
  const d = digitsOnly(m);
  if (d.length !== 9 || !notAllZeros(d)) return false;
  const w = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  return weightedSum(d, w) % 10 === 0;
}

// ── Global: VIN (vehicle) ────────────────────────────────────────────────────
const VIN_TRANSLIT: Readonly<Record<string, number>> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5,
  P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2] as const;
/** ISO 3779 VIN check digit (position 9): transliterate, weight, mod 11 (X=10). */
export function isVin(m: string): boolean {
  const v = m.toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = v[i]!;
    const val = /\d/.test(ch) ? ch.charCodeAt(0) - 48 : VIN_TRANSLIT[ch];
    if (val == null) return false;
    sum += val * VIN_WEIGHTS[i]!;
  }
  const remainder = sum % 11;
  const expected = remainder === 10 ? 'X' : String(remainder);
  return v[8] === expected;
}
