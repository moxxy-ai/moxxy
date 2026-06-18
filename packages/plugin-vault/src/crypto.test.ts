import { describe, expect, it } from 'vitest';
import { decrypt, deriveKey, encrypt, generateSalt, randomCode } from './crypto.js';

describe('crypto primitives', () => {
  it('round-trips plaintext through encrypt/decrypt', () => {
    const salt = generateSalt();
    const key = deriveKey('hunter2', salt);
    const blob = encrypt('secret value', key);
    expect(decrypt(blob, key)).toBe('secret value');
  });

  it('fails to decrypt with wrong key', () => {
    const salt = generateSalt();
    const key1 = deriveKey('one', salt);
    const key2 = deriveKey('two', salt);
    const blob = encrypt('secret', key1);
    expect(() => decrypt(blob, key2)).toThrow();
  });

  it('produces different ciphertext for the same plaintext', () => {
    const key = deriveKey('p', generateSalt());
    const a = encrypt('same', key);
    const b = encrypt('same', key);
    expect(a.data).not.toBe(b.data);
    expect(a.iv).not.toBe(b.iv);
  });

  it('randomCode produces zero-padded fixed-length digit strings', () => {
    for (let i = 0; i < 20; i++) {
      const code = randomCode(6);
      expect(code).toMatch(/^\d{6}$/);
    }
    expect(randomCode(4)).toMatch(/^\d{4}$/);
  });

  it('randomCode does not cap the leading digit for wide codes (u114-3)', () => {
    // The old 4-byte draw overflowed for digits >= 10, so the leading digits
    // were always '0'. Confirm a 12-digit code can produce a non-zero lead.
    const leads = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = randomCode(12);
      expect(code).toMatch(/^\d{12}$/);
      leads.add(code[0]!);
    }
    // The old uint32 draw pinned every leading digit to '0' for digits >= 10.
    expect([...leads].some((d) => d !== '0')).toBe(true);
  });

  it('randomCode is not grossly biased at 6 digits (u114-3)', () => {
    // Chi-square-lite: the leading digit should spread across 0-9, not cluster.
    const counts = new Array(10).fill(0) as number[];
    for (let i = 0; i < 2000; i++) {
      counts[Number(randomCode(6)[0])]! += 1;
    }
    for (const c of counts) {
      // Expected ~200 per bucket; a wide tolerance still catches a stuck/biased draw.
      expect(c).toBeGreaterThan(80);
    }
  });

  it('randomCode rejects invalid widths', () => {
    expect(() => randomCode(0)).toThrow();
    expect(() => randomCode(-1)).toThrow();
    expect(() => randomCode(1.5)).toThrow();
  });
});
