import { describe, expect, it } from 'vitest';
import { parseIsoAt } from './handlers.js';

describe('parseIsoAt', () => {
  it('accepts a full ISO-8601 instant with Z', () => {
    expect(parseIsoAt('2026-07-01T09:00:00Z')).toBe(Date.parse('2026-07-01T09:00:00Z'));
  });

  it('accepts an offset and a date-only form', () => {
    expect(parseIsoAt('2026-07-01T09:00:00+02:00')).toBe(Date.parse('2026-07-01T09:00:00+02:00'));
    expect(parseIsoAt('2026-07-01')).toBe(Date.parse('2026-07-01'));
  });

  it('rejects impossible calendar values that bare Date.parse would coerce', () => {
    // '2026-13-99' has a valid ISO *shape* but is not a real date — Date.parse
    // returns NaN for it, so parseIsoAt rejects it.
    expect(parseIsoAt('2026-13-99')).toBeUndefined();
  });

  it('rejects locale / free-form strings (no implementation-defined parsing)', () => {
    expect(parseIsoAt('next tuesday')).toBeUndefined();
    expect(parseIsoAt('July 1 2026')).toBeUndefined();
    expect(parseIsoAt('07/01/2026')).toBeUndefined();
    expect(parseIsoAt('')).toBeUndefined();
    expect(parseIsoAt('   ')).toBeUndefined();
  });
});
