import { describe, expect, it } from 'vitest';
import {
  fullUrl,
  maskSecret,
  normalizeVerification,
  secretFilePath,
  verificationInputSchema,
} from './shared.js';

describe('webhook tool shared helpers', () => {
  describe('fullUrl', () => {
    it('returns null when no public URL is set', () => {
      expect(fullUrl(undefined, 'abc')).toBeNull();
    });
    it('joins the public URL and trigger id, trimming a trailing slash', () => {
      expect(fullUrl('https://x.example.com/', 'abc')).toBe('https://x.example.com/webhook/abc');
      expect(fullUrl('https://x.example.com', 'abc')).toBe('https://x.example.com/webhook/abc');
    });
  });

  describe('maskSecret', () => {
    it('exposes only the first 4 chars', () => {
      expect(maskSecret('deadbeefcafef00d')).toBe('dead…');
    });
  });

  describe('secretFilePath', () => {
    it('builds <dir>/<name>.secret', () => {
      expect(secretFilePath('/tmp/secrets', 'gh-events')).toBe('/tmp/secrets/gh-events.secret');
    });
  });

  describe('normalizeVerification', () => {
    it('passes none through with no secret issued', () => {
      expect(normalizeVerification({ type: 'none' })).toEqual({
        verification: { type: 'none' },
        secretIssued: null,
      });
    });

    it('keeps a caller-supplied bearer secret without issuing one', () => {
      const r = normalizeVerification({ type: 'bearer', secret: 'caller-secret' });
      expect(r.verification).toEqual({ type: 'bearer', secret: 'caller-secret' });
      expect(r.secretIssued).toBeNull();
    });

    it('mints a strong bearer secret when omitted', () => {
      const r = normalizeVerification({ type: 'bearer' });
      expect(r.verification.type).toBe('bearer');
      expect(r.secretIssued).toHaveLength(64);
      if (r.verification.type !== 'bearer') throw new Error('expected bearer');
      expect(r.verification.secret).toBe(r.secretIssued);
    });

    it('builds hmac verification and issues a secret only when omitted', () => {
      const issued = normalizeVerification(
        verificationInputSchema.parse({
          type: 'hmac',
          signatureHeader: 'X-Sig',
          prefix: 'sha256=',
        }),
      );
      if (issued.verification.type !== 'hmac') throw new Error('expected hmac');
      expect(issued.verification.signatureHeader).toBe('X-Sig');
      expect(issued.verification.prefix).toBe('sha256=');
      expect(issued.verification.algorithm).toBe('sha256');
      expect(issued.verification.scheme).toBe('plain');
      expect(issued.secretIssued).toHaveLength(64);
      expect(issued.verification.secret).toBe(issued.secretIssued);

      const supplied = normalizeVerification(
        verificationInputSchema.parse({
          type: 'hmac',
          signatureHeader: 'X-Sig',
          secret: 'caller-provided-secret',
        }),
      );
      expect(supplied.secretIssued).toBeNull();
      if (supplied.verification.type !== 'hmac') throw new Error('expected hmac');
      expect(supplied.verification.secret).toBe('caller-provided-secret');
      // omitted prefix stays absent
      expect('prefix' in supplied.verification).toBe(false);
    });
  });
});
