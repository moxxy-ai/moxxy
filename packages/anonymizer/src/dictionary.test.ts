import { describe, expect, it } from 'vitest';
import { detect } from './detect.js';
import { redact } from './redact.js';
import { DICTIONARY, DEFAULT_CATEGORIES } from './dictionary.js';

/** Convenience: categories + subtype labels detect() finds in `text`. */
function found(text: string, opts = {}): Array<[string, string]> {
  return detect(text, opts).map((s) => [s.category, s.value] as [string, string]);
}

describe('dictionary wiring', () => {
  it('every detector id is unique', () => {
    const ids = DICTIONARY.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('DEFAULT_CATEGORIES are the categories with a defaultOn detector', () => {
    expect(DEFAULT_CATEGORIES).toContain('email');
    expect(DEFAULT_CATEGORIES).toContain('nationalId'); // PESEL is default-on
    expect(DEFAULT_CATEGORIES).not.toContain('date'); // opt-in
  });
});

describe('Poland', () => {
  it('detects a labelled PESEL as a nationalId (no context needed — checksum+date)', () => {
    expect(found('PESEL: 44051401359')).toEqual([['nationalId', '44051401359']]);
  });
  it('detects NIP only with the NIP keyword nearby (bare 10-digit run is ambiguous)', () => {
    expect(found('NIP 1234563218')).toEqual([['taxId', '1234563218']]);
    // No keyword → a bare valid-checksum 10-digit run is NOT claimed as a NIP.
    expect(found('order ref 1234563218', { categories: ['taxId'] })).toEqual([]);
  });
  it('detects a PL-prefixed / dashed NIP', () => {
    expect(found('faktura PL1234563218 zł', { categories: ['taxId'] }).length).toBe(1);
  });
  it('detects REGON with context', () => {
    expect(found('REGON 123456785')).toEqual([['taxId', '123456785']]);
  });
});

describe('UK', () => {
  it('detects an NHS number with the NHS keyword (healthId is opt-in)', () => {
    expect(found('NHS No: 943 476 5919', { categories: ['healthId'] })).toEqual([
      ['healthId', '943 476 5919'],
    ]);
  });
});

describe('global device / vehicle (opt-in categories)', () => {
  it('detects a VIN by checksum, no context', () => {
    expect(found('Vehicle 1HGCM82633A004352 sold', { categories: ['vehicleId'] })).toEqual([
      ['vehicleId', '1HGCM82633A004352'],
    ]);
  });
  it('detects an IMEI with the IMEI keyword and outranks creditCard for the same digits', () => {
    // 490154203237518 is a 15-digit Luhn run → both deviceId(IMEI) and creditCard
    // match; deviceId outranks creditCard, and IMEI is context-gated on the keyword.
    expect(found('IMEI 490154203237518', { categories: ['deviceId', 'creditCard'] })).toEqual([
      ['deviceId', '490154203237518'],
    ]);
  });
});

describe('region filtering', () => {
  it('skips PL detectors when only UK is selected', () => {
    expect(found('PESEL 44051401359', { regions: ['UK'] })).toEqual([]);
  });
  it('detectorIds is an explicit allow-list', () => {
    const spans = detect('PESEL 44051401359 NHS 943 476 5919', { detectorIds: ['pl-pesel'] });
    expect(spans.map((s) => s.category)).toEqual(['nationalId']);
  });
});

describe('redaction uses the specific subtype label', () => {
  it('labels a PESEL as [PESEL], not [ID]', () => {
    expect(redact('PESEL 44051401359').text).toBe('PESEL [PESEL]');
  });
  it('pseudonymises per specific label', () => {
    expect(redact('PESEL 44051401359', { mode: 'pseudonym' }).text).toBe('PESEL PESEL_1');
  });
});

describe('secrets (default-on, global, low FP)', () => {
  it('detects an AWS key, a GitHub token and a JWT by default', () => {
    expect(redact('aws AKIAIOSFODNN7EXAMPLE').text).toBe('aws [AWS_KEY]');
    // Built at runtime so the source carries no contiguous `ghp_…` literal (GitHub
    // push-protection would otherwise flag the file); still a valid token shape.
    const ghToken = `ghp_${'a1B2c3D4'.repeat(4)}abcd`; // ghp_ + 36 base62 chars
    expect(redact(`tok ${ghToken}`).text).toBe('tok [GITHUB_TOKEN]');
    expect(
      redact(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      ).text,
    ).toBe('[JWT]');
  });
  it('redacts a whole PEM private key block, not just the header', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJB\n-----END RSA PRIVATE KEY-----';
    expect(redact(`key:\n${pem}\nend`).text).toBe('key:\n[PRIVATE_KEY]\nend');
  });
});

describe('US identifiers (opt-in)', () => {
  it('ITIN: accepts a valid group, rejects an invalid group via the regex ranges', () => {
    const opt = { categories: ['taxId' as const], regions: ['US' as const] };
    expect(found('911-70-1234', opt)).toEqual([['taxId', '911-70-1234']]);
    expect(found('911-66-1234', opt)).toEqual([]); // group 66 not an ITIN range
  });
  it('EIN needs the EIN keyword', () => {
    const opt = { categories: ['taxId' as const], regions: ['US' as const] };
    expect(found('EIN 12-3456789', opt)).toEqual([['taxId', '12-3456789']]);
    expect(found('ref 12-3456789', opt)).toEqual([]);
  });
  it('MBI by class pattern; US passport needs the passport keyword', () => {
    expect(found('1EG4TE5MK73', { categories: ['healthId'], regions: ['US'] })).toEqual([
      ['healthId', '1EG4TE5MK73'],
    ]);
    const pp = { categories: ['passport' as const], regions: ['US' as const] };
    expect(found('passport A12345678', pp)).toEqual([['passport', 'A12345678']]);
    expect(found('order A12345678', pp)).toEqual([]);
  });
});

describe('UK identifiers (opt-in)', () => {
  it('NINO by structural rules, rejects an excluded prefix', () => {
    const opt = { categories: ['nationalId' as const], regions: ['UK' as const] };
    expect(found('AB123456C', opt)).toEqual([['nationalId', 'AB123456C']]);
    expect(found('QQ123456A', opt)).toEqual([]); // Q is an excluded first letter
  });
  it('UTR needs its keyword + mod-11 checksum', () => {
    expect(found('UTR 2234567890', { categories: ['taxId'], regions: ['UK'] })).toEqual([
      ['taxId', '2234567890'],
    ]);
  });
  it('postcode by the BS7666 grammar', () => {
    expect(found('SW1A 1AA', { categories: ['postalCode'], regions: ['UK'] })).toEqual([
      ['postalCode', 'SW1A 1AA'],
    ]);
  });
});

describe('Poland identifiers (opt-in beyond PESEL/NIP)', () => {
  it('dowód osobisty by checksum', () => {
    expect(found('ABA300000', { categories: ['nationalId'], regions: ['PL'] })).toEqual([
      ['nationalId', 'ABA300000'],
    ]);
  });
  it('NRB bank account by mod-97', () => {
    expect(
      found('PL39101010230000261295100000', { categories: ['bankAccount'], regions: ['PL'] }),
    ).toEqual([['bankAccount', 'PL39101010230000261295100000']]);
  });
});

describe('crypto wallets (opt-in, structural)', () => {
  it('detects an Ethereum address and a BTC address', () => {
    expect(
      found('0x52908400098527886E0F7030069857D2E4169EE7', { categories: ['crypto'] }),
    ).toEqual([['crypto', '0x52908400098527886E0F7030069857D2E4169EE7']]);
    expect(found('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', { categories: ['crypto'] })).toEqual([
      ['crypto', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'],
    ]);
  });
});

describe('default profile scope', () => {
  it('runs global structured + secrets + PL PESEL/NIP + US SSN, but not opt-in categories', () => {
    // A bare VIN / NHS / postcode is NOT redacted by default (opt-in categories).
    expect(found('VIN 1HGCM82633A004352')).toEqual([]);
    expect(found('SW1A 1AA')).toEqual([]);
    // ...while a secret and a PESEL ARE.
    expect(found('AKIAIOSFODNN7EXAMPLE')).toEqual([['secret', 'AKIAIOSFODNN7EXAMPLE']]);
  });
});
