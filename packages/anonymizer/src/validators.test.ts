import { describe, expect, it } from 'vitest';
import {
  luhnValid,
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

// NOTE: every "valid" vector below is SYNTHETIC (fabricated) but constructed to
// satisfy the real checksum, so these tests pin the checksum math itself.

describe('luhn / credit card / IMEI', () => {
  it('luhn', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
  });
  it('credit card length + luhn', () => {
    expect(isCreditCard('4111 1111 1111 1111')).toBe(true);
    expect(isCreditCard('4111 1111 1111 1112')).toBe(false);
    expect(isCreditCard('411111')).toBe(false); // too short
  });
  it('IMEI is 15 digits + luhn', () => {
    expect(isImei('490154203237518')).toBe(true);
    expect(isImei('490154203237519')).toBe(false); // bad check
    expect(isImei('4901542032375')).toBe(false); // wrong length
  });
});

describe('iban (mod-97 + length)', () => {
  it('accepts valid, rejects bad check / wrong length', () => {
    expect(ibanValid('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(ibanValid('GB82WEST12345698765433')).toBe(false); // bad check digit
    expect(ibanValid('GB82WEST123456987654')).toBe(false); // wrong length for GB
  });
});

describe('ip', () => {
  it('ipv4 octet range', () => {
    expect(isIpv4('192.168.1.255')).toBe(true);
    expect(isIpv4('999.1.1.1')).toBe(false);
  });
  it('ipv6 vs mac', () => {
    expect(isIpv6('fe80::1')).toBe(true);
    expect(isIpv6('01:23:45:67:89:ab')).toBe(false);
  });
});

describe('us ssn / phone', () => {
  it('ssn sanity', () => {
    expect(isSsn('123-45-6789')).toBe(true);
    expect(isSsn('000-45-6789')).toBe(false);
    expect(isSsn('900-45-6789')).toBe(false);
  });
  it('phone rejects dates', () => {
    expect(isPhone('+1 415 555 2671')).toBe(true);
    expect(isPhone('2020-01-02')).toBe(false);
  });
});

describe('Poland: PESEL', () => {
  it('valid 20th + 21st century, rejects bad checksum and bad date', () => {
    expect(isPesel('44051401359')).toBe(true); // 1944-05-14
    expect(isPesel('00210100004')).toBe(true); // 2000-01-01 (month +20)
    expect(isPesel('44051401358')).toBe(false); // bad control digit
    expect(isPesel('44131401357')).toBe(false); // month 13 → invalid date
  });
});

describe('Poland: NIP', () => {
  it('valid, optional PL prefix + separators, rejects bad checksum', () => {
    expect(isNip('1234563218')).toBe(true);
    expect(isNip('PL 123-456-32-18')).toBe(true);
    expect(isNip('1234563210')).toBe(false);
  });
});

describe('Poland: REGON', () => {
  it('REGON-9 and REGON-14', () => {
    expect(isRegon('123456785')).toBe(true);
    expect(isRegon('12345678512347')).toBe(true);
    expect(isRegon('123456789')).toBe(false);
  });
});

describe('UK: NHS number', () => {
  it('mod-11, rejects bad check', () => {
    expect(isNhsNumber('943 476 5919')).toBe(true);
    expect(isNhsNumber('9434765918')).toBe(false);
  });
});

describe('US: ABA routing', () => {
  it('weighted mod-10', () => {
    expect(isAbaRouting('011000015')).toBe(true);
    expect(isAbaRouting('011000016')).toBe(false);
  });
});

describe('Global: VIN', () => {
  it('ISO 3779 check digit', () => {
    expect(isVin('1HGCM82633A004352')).toBe(true);
    expect(isVin('1HGCM82613A004352')).toBe(false); // bad check digit
    expect(isVin('1HGCM82633A00435I')).toBe(false); // illegal letter I
  });
});

describe('all-zeros / degenerate guards', () => {
  it('rejects all-zeros runs that satisfy the raw mod math', () => {
    expect(isCreditCard('0000000000000000')).toBe(false);
    expect(isImei('000000000000000')).toBe(false);
    expect(isNip('0000000000')).toBe(false);
    expect(isRegon('000000000')).toBe(false);
    expect(isAbaRouting('000000000')).toBe(false);
  });
});

describe('US: ITIN / EIN', () => {
  it('ITIN starts with 9, rejects bad leading digit / zero serial', () => {
    expect(isItin('911701234')).toBe(true);
    expect(isItin('811701234')).toBe(false);
    expect(isItin('911700000')).toBe(false);
  });
  it('EIN prefix-set membership', () => {
    expect(isEin('123456789')).toBe(true); // prefix 12 valid
    expect(isEin('071234567')).toBe(false); // prefix 07 invalid
    expect(isEin('001234567')).toBe(false); // prefix 00 invalid
  });
});

describe('Poland: dowód / passport / NRB', () => {
  it('dowód osobisty check digit', () => {
    expect(isDowodOsobisty('ABA300000')).toBe(true);
    expect(isDowodOsobisty('ABA300001')).toBe(false);
  });
  it('passport check digit', () => {
    expect(isPlPassport('AB4123456')).toBe(true);
    expect(isPlPassport('AB4123457')).toBe(false);
  });
  it('NRB via mod-97 (with or without PL prefix)', () => {
    expect(isPlNrb('PL39101010230000261295100000')).toBe(true);
    expect(isPlNrb('39101010230000261295100000')).toBe(true);
    expect(isPlNrb('PL00101010230000261295100000')).toBe(false);
  });
});

describe('UK: UTR', () => {
  it('mod-11 with the check digit FIRST (optional trailing K)', () => {
    expect(isUtr('2234567890')).toBe(true);
    expect(isUtr('32468 01357K'.replace(/\s|K/g, ''))).toBe(true);
    expect(isUtr('1234567890')).toBe(false);
  });
});
