import { describe, expect, it } from 'vitest';
import { DETECTORS, detectCustom, _internals } from './detectors.js';
import type { PiiCategory } from './types.js';

function values(category: PiiCategory, text: string): string[] {
  const fn = DETECTORS[category];
  if (!fn) throw new Error(`no detector for ${category}`);
  return fn(text).map((s) => s.value);
}

describe('email', () => {
  it('matches addresses with a TLD', () => {
    expect(values('email', 'reach me at John.Doe+tag@sub.example.co.uk please')).toEqual([
      'John.Doe+tag@sub.example.co.uk',
    ]);
  });
  it('ignores a bare @ handle with no domain', () => {
    expect(values('email', 'ping @johnny on chat')).toEqual([]);
  });
});

describe('credit card (Luhn)', () => {
  it('accepts a Luhn-valid number with spaces', () => {
    expect(values('creditCard', 'card 4111 1111 1111 1111 ok')).toEqual(['4111 1111 1111 1111']);
  });
  it('rejects a non-Luhn number', () => {
    expect(values('creditCard', 'order 4111 1111 1111 1112')).toEqual([]);
  });
  it('luhnValid math', () => {
    expect(_internals.luhnValid('4111111111111111')).toBe(true);
    expect(_internals.luhnValid('4111111111111112')).toBe(false);
  });
});

describe('ssn', () => {
  it('accepts a sane hyphenated SSN', () => {
    expect(values('ssn', 'SSN 123-45-6789.')).toEqual(['123-45-6789']);
  });
  it('rejects invalid area/group/serial', () => {
    expect(values('ssn', '000-45-6789 666-45-6789 900-45-6789 123-00-6789 123-45-0000')).toEqual(
      [],
    );
  });
});

describe('ipv4', () => {
  it('accepts in-range octets', () => {
    expect(values('ipv4', 'host 192.168.1.255')).toEqual(['192.168.1.255']);
  });
  it('rejects an out-of-range octet', () => {
    expect(values('ipv4', 'bad 999.1.1.1')).toEqual([]);
  });
});

describe('ipv6', () => {
  it('accepts full and compressed forms', () => {
    expect(values('ipv6', 'a 2001:0db8:85a3:0000:0000:8a2e:0370:7334 b fe80::1 c')).toEqual([
      '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
      'fe80::1',
    ]);
  });
  it('does not treat a MAC as IPv6', () => {
    expect(values('ipv6', '01:23:45:67:89:ab')).toEqual([]);
  });
});

describe('mac', () => {
  it('matches colon and dash separated MACs', () => {
    expect(values('mac', 'nic 01:23:45:67:89:AB and 01-23-45-67-89-ab')).toEqual([
      '01:23:45:67:89:AB',
      '01-23-45-67-89-ab',
    ]);
  });
});

describe('iban (mod-97)', () => {
  it('accepts a valid IBAN', () => {
    expect(values('iban', 'pay GB82WEST12345698765432 now')).toEqual(['GB82WEST12345698765432']);
  });
  it('rejects a bad check digit', () => {
    expect(values('iban', 'pay GB82WEST12345698765433 now')).toEqual([]);
  });
});

describe('phone', () => {
  it('matches grouped numbers, rejects bare digit runs and dates', () => {
    expect(values('phone', 'call +1 (415) 555-2671 today')).toEqual(['+1 (415) 555-2671']);
    expect(values('phone', 'ref 1234567890123456')).toEqual([]); // bare run, no separators
    expect(_internals.isPhone('2020-01-02')).toBe(false);
  });
});

describe('custom terms', () => {
  it('matches case-insensitively on word boundaries, including multi-word', () => {
    // Raw (unresolved): 'Jane' also matches inside 'JANE DOE'; dedup is detect()'s job.
    const spans = detectCustom('Jane and JANE DOE met Janet', ['jane doe', 'Jane']);
    expect(spans.map((s) => s.value).sort()).toEqual(['JANE', 'JANE DOE', 'Jane']);
  });
});
