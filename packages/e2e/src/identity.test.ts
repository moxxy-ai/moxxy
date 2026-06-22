import { describe, expect, it } from 'vitest';
import {
  deriveUuid,
  fingerprint,
  generateIdentity,
  publicKeyFromFingerprint,
  publicKeyFromSecret,
  sign,
  UUID_LABEL_LENGTH,
  verify,
} from './identity.js';

describe('identity', () => {
  it('generates a 32-byte keypair whose public key derives from the secret', () => {
    const id = generateIdentity();
    expect(id.secretKey.length).toBe(32);
    expect(id.publicKey.length).toBe(32);
    expect([...publicKeyFromSecret(id.secretKey)]).toEqual([...id.publicKey]);
  });

  it('round-trips the fingerprint to the public key', () => {
    const id = generateIdentity();
    expect([...publicKeyFromFingerprint(fingerprint(id.publicKey))]).toEqual([...id.publicKey]);
  });

  it('rejects a malformed fingerprint', () => {
    expect(() => publicKeyFromFingerprint('AAAA')).toThrow();
  });

  it('derives a stable, DNS-safe, fixed-length uuid from the public key', () => {
    const id = generateIdentity();
    const uuid = deriveUuid(id.publicKey);
    expect(uuid).toBe(deriveUuid(id.publicKey)); // deterministic
    expect(uuid.length).toBe(UUID_LABEL_LENGTH);
    expect(uuid).toMatch(/^[a-z2-7]+$/);
  });

  it('gives distinct uuids for distinct keys', () => {
    expect(deriveUuid(generateIdentity().publicKey)).not.toBe(
      deriveUuid(generateIdentity().publicKey),
    );
  });

  it('signs and verifies, and rejects tampered messages/keys', () => {
    const id = generateIdentity();
    const msg = new Uint8Array([1, 2, 3, 4, 5]);
    const sig = sign(msg, id.secretKey);
    expect(verify(sig, msg, id.publicKey)).toBe(true);

    const tampered = new Uint8Array([1, 2, 3, 4, 6]);
    expect(verify(sig, tampered, id.publicKey)).toBe(false);
    expect(verify(sig, msg, generateIdentity().publicKey)).toBe(false);
  });
});
