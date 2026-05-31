import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

import {
  type AppManifest,
  canonicalManifestBytes,
  parseManifest,
  verifyManifestSignature,
} from './manifest';

/** Produce a signed manifest for an ad-hoc Ed25519 keypair. */
function signed(overrides: Partial<AppManifest> = {}): {
  manifest: AppManifest;
  publicKeyPem: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const base: Omit<AppManifest, 'signature'> = {
    version: '0.0.6',
    minElectron: '33.0.0',
    nodeAbi: '115',
    sha256: 'a'.repeat(64),
    bundleUrl: 'https://example.com/bundle.json.gz',
    ...overrides,
  };
  const signature = cryptoSign(null, canonicalManifestBytes(base), privateKey).toString('base64');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return { manifest: { ...base, signature }, publicKeyPem };
}

describe('verifyManifestSignature', () => {
  it('accepts a manifest signed by the matching key', () => {
    const { manifest, publicKeyPem } = signed();
    expect(verifyManifestSignature(manifest, publicKeyPem)).toBe(true);
  });

  it('rejects when a signed field is tampered after signing', () => {
    const { manifest, publicKeyPem } = signed();
    expect(verifyManifestSignature({ ...manifest, sha256: 'b'.repeat(64) }, publicKeyPem)).toBe(
      false,
    );
    expect(
      verifyManifestSignature({ ...manifest, bundleUrl: 'https://evil.test/x' }, publicKeyPem),
    ).toBe(false);
  });

  it('rejects a signature from a different key', () => {
    const { manifest } = signed();
    const { publicKeyPem: otherKey } = signed();
    expect(verifyManifestSignature(manifest, otherKey)).toBe(false);
  });

  it('rejects when no public key is configured (updates disabled)', () => {
    const { manifest } = signed();
    expect(verifyManifestSignature(manifest, '')).toBe(false);
  });

  it('never throws on a malformed key or signature', () => {
    const { manifest } = signed();
    expect(verifyManifestSignature({ ...manifest, signature: 'not-base64!!' }, 'garbage')).toBe(
      false,
    );
  });
});

describe('parseManifest', () => {
  it('parses a well-formed manifest and lowercases the hash', () => {
    const { manifest } = signed({ sha256: 'A'.repeat(64) });
    const parsed = parseManifest(JSON.stringify(manifest));
    expect(parsed?.version).toBe('0.0.6');
    expect(parsed?.sha256).toBe('a'.repeat(64));
  });

  it('keeps optional presentational fields', () => {
    const { manifest } = signed();
    const parsed = parseManifest(
      JSON.stringify({ ...manifest, releaseUrl: 'https://x.test', notes: 'hi' }),
    );
    expect(parsed?.releaseUrl).toBe('https://x.test');
    expect(parsed?.notes).toBe('hi');
  });

  it('returns null on bad json, missing fields, or a non-hex sha256', () => {
    expect(parseManifest('{')).toBeNull();
    expect(parseManifest('{}')).toBeNull();
    const { manifest } = signed();
    expect(parseManifest(JSON.stringify({ ...manifest, sha256: 'short' }))).toBeNull();
    expect(parseManifest(JSON.stringify({ ...manifest, version: '' }))).toBeNull();
  });
});
