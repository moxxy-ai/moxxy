import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { verifyPolicyBundle, type PolicyBundle } from './policy-bundle.js';

const keys = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    pem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    sign: (bytes: Uint8Array) => cryptoSign(null, Buffer.from(bytes), privateKey).toString('base64'),
  };
};

const bundle = (over: Partial<PolicyBundle> = {}): Uint8Array =>
  new Uint8Array(
    Buffer.from(
      JSON.stringify({
        version: 1,
        id: 'corp-baseline',
        revision: '2026-07-27.1',
        permissions: { deny: [{ name: 'Bash', reason: 'managed policy' }] },
        ...over,
      }),
    ),
  );

describe('verifyPolicyBundle', () => {
  it('accepts a bundle signed by the pinned key', () => {
    const k = keys();
    const bytes = bundle();

    const r = verifyPolicyBundle(bytes, k.sign(bytes), k.pem, 'corp-baseline');

    expect(r.ok).toBe(true);
    expect(r.bundle?.revision).toBe('2026-07-27.1');
    expect(r.bundle?.permissions?.deny).toEqual([{ name: 'Bash', reason: 'managed policy' }]);
  });

  it('rejects a bundle signed by a different key', () => {
    const mine = keys();
    const theirs = keys();
    const bytes = bundle();

    const r = verifyPolicyBundle(bytes, theirs.sign(bytes), mine.pem);

    expect(r.ok).toBe(false);
    expect(r.failure).toBe('bad-signature');
  });

  it('rejects bytes altered after signing', () => {
    const k = keys();
    const bytes = bundle();
    const sig = k.sign(bytes);
    const tampered = bundle({ permissions: { deny: [] } });

    expect(verifyPolicyBundle(tampered, sig, k.pem).ok).toBe(false);
  });

  it('rejects a validly signed bundle that is not the one this host subscribes to', () => {
    const k = keys();
    // Same publisher, different document: a signature proves who wrote it, not
    // which of their documents it is. Without the id check a publisher's other
    // bundle could be served here.
    const bytes = bundle({ id: 'other-team-baseline' });

    const r = verifyPolicyBundle(bytes, k.sign(bytes), k.pem, 'corp-baseline');

    expect(r.ok).toBe(false);
    expect(r.failure).toBe('id-mismatch');
  });

  it('refuses a bundle that tries to carry anything but permission rules', () => {
    const k = keys();
    // The whole point of the format: loosening security must not be reachable
    // from a document that arrives over the network.
    for (const extra of [
      { security: { enabled: false } },
      { plugins: { registryUrl: 'https://evil.example/index.json' } },
      { network: { proxy: 'http://evil.example:3128' } },
      { audit: { enabled: false } },
    ]) {
      const bytes = bundle(extra as Partial<PolicyBundle>);
      const r = verifyPolicyBundle(bytes, k.sign(bytes), k.pem);

      expect(r.ok, `${Object.keys(extra)[0]} must be refused`).toBe(false);
      expect(r.failure).toBe('schema');
    }
  });

  it('refuses a body too large to be a set of rules, before parsing it', () => {
    const k = keys();
    const huge = new Uint8Array(2 * 1024 * 1024);

    const r = verifyPolicyBundle(huge, k.sign(huge), k.pem);

    expect(r.ok).toBe(false);
    expect(r.failure).toBe('too-large');
  });

  it('refuses a future format version rather than reading part of it', () => {
    const k = keys();
    const bytes = bundle({ version: 2 as 1 });

    expect(verifyPolicyBundle(bytes, k.sign(bytes), k.pem).failure).toBe('schema');
  });

  it('treats an empty signature or key as a failure, never as a skip', () => {
    const k = keys();
    const bytes = bundle();

    expect(verifyPolicyBundle(bytes, '', k.pem).failure).toBe('bad-signature');
    expect(verifyPolicyBundle(bytes, k.sign(bytes), '').failure).toBe('bad-signature');
  });
});
