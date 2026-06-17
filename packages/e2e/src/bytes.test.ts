import { describe, expect, it } from 'vitest';
import {
  base32Encode,
  base64urlDecode,
  base64urlEncode,
  concatBytes,
  constantTimeEqual,
  readU64be,
  u64be,
  utf8,
} from './bytes.js';

describe('concatBytes', () => {
  it('joins parts in order', () => {
    expect([...concatBytes(new Uint8Array([1, 2]), new Uint8Array([3]))]).toEqual([1, 2, 3]);
  });
  it('handles empty input', () => {
    expect(concatBytes().length).toBe(0);
  });
});

describe('constantTimeEqual', () => {
  it('is true for equal arrays', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
  });
  it('is false for different contents or lengths', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe('u64be / readU64be', () => {
  it('round-trips small and large values', () => {
    for (const n of [0, 1, 255, 256, 65535, 2 ** 32, 2 ** 32 + 7, Number.MAX_SAFE_INTEGER]) {
      expect(readU64be(u64be(n))).toBe(n);
    }
  });
  it('rejects out-of-range values', () => {
    expect(() => u64be(-1)).toThrow();
    expect(() => u64be(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
});

describe('base64url', () => {
  it('matches a known vector', () => {
    expect(base64urlEncode(utf8('foobar'))).toBe('Zm9vYmFy');
  });
  it('uses url-safe alphabet (- and _, no padding)', () => {
    const encoded = base64urlEncode(new Uint8Array([251, 255, 191, 255]));
    expect(encoded).not.toMatch(/[+/=]/);
  });
  it('round-trips arbitrary bytes of every length mod 3', () => {
    for (let len = 0; len < 35; len++) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 37 + 11) & 0xff);
      expect([...base64urlDecode(base64urlEncode(bytes))]).toEqual([...bytes]);
    }
  });
  it('rejects invalid characters', () => {
    expect(() => base64urlDecode('not valid!')).toThrow();
  });
});

describe('base32Encode', () => {
  it('matches a known lowercase vector', () => {
    expect(base32Encode(utf8('foobar'))).toBe('mzxw6ytboi');
  });
  it('produces only DNS-label-safe chars', () => {
    const out = base32Encode(new Uint8Array(40).map((_, i) => (i * 53) & 0xff));
    expect(out).toMatch(/^[a-z2-7]+$/);
  });
});
