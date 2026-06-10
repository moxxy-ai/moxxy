import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DESKTOP_APP_HOST,
  generateSelfSignedCert,
  loadOrCreateSelfSignedCert,
  isTrustedLoopbackCert,
} from './self-signed-cert';

const PORTS = [51789, 51790, 51791, 51792] as const;

describe('generateSelfSignedCert', () => {
  it('mints a parseable cert for desktop.moxxy.ai with a matching SAN', () => {
    const c = generateSelfSignedCert();
    const x = new crypto.X509Certificate(c.cert);
    expect(x.subject).toContain(`CN=${DESKTOP_APP_HOST}`);
    expect(x.subjectAltName).toContain(`DNS:${DESKTOP_APP_HOST}`);
    expect(c.fingerprint256).toBe(x.fingerprint256);
    expect(c.key).toContain('PRIVATE KEY');
  });

  it('produces a distinct keypair each call', () => {
    expect(generateSelfSignedCert().fingerprint256).not.toBe(
      generateSelfSignedCert().fingerprint256,
    );
  });

  it('mints a cert whose validity is current (not yet expired, already valid)', () => {
    const x = new crypto.X509Certificate(generateSelfSignedCert().cert);
    const now = Date.now();
    expect(new Date(x.validFrom).getTime()).toBeLessThanOrEqual(now);
    expect(new Date(x.validTo).getTime()).toBeGreaterThan(now);
  });
});

describe('loadOrCreateSelfSignedCert', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'moxxy-cert-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('mints + persists on first run, then returns the cached cert', async () => {
    const first = await loadOrCreateSelfSignedCert(dir);
    const second = await loadOrCreateSelfSignedCert(dir);
    expect(second.fingerprint256).toBe(first.fingerprint256);
    // Persisted to disk.
    expect(await readFile(path.join(dir, 'loopback-cert.pem'), 'utf8')).toBe(first.cert);
  });

  it('writes the private key 0600', async () => {
    await loadOrCreateSelfSignedCert(dir);
    const mode = (await stat(path.join(dir, 'loopback-key.pem'))).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe('isTrustedLoopbackCert (scoped trust)', () => {
  const c = generateSelfSignedCert();
  const ok = (over: Partial<Parameters<typeof isTrustedLoopbackCert>[0]> = {}): boolean =>
    isTrustedLoopbackCert({
      url: `https://${DESKTOP_APP_HOST}:${PORTS[0]}/index.html`,
      fingerprint: c.fingerprint256,
      expectedFingerprint: c.fingerprint256,
      allowedPorts: PORTS,
      ...over,
    });

  it('trusts the right host + an allowed port + a matching fingerprint', () => {
    expect(ok()).toBe(true);
    for (const p of PORTS) {
      expect(ok({ url: `https://${DESKTOP_APP_HOST}:${p}/x` })).toBe(true);
    }
  });

  it('accepts Electron-style sha256/base64 fingerprints', () => {
    const b64 = Buffer.from(c.fingerprint256.replace(/:/g, ''), 'hex').toString('base64');
    expect(ok({ fingerprint: `sha256/${b64}` })).toBe(true);
  });

  it('rejects a fingerprint mismatch (different cert)', () => {
    expect(ok({ fingerprint: generateSelfSignedCert().fingerprint256 })).toBe(false);
    expect(ok({ fingerprint: undefined })).toBe(false);
    expect(ok({ fingerprint: 'sha256/not-base64-!!!' })).toBe(false);
  });

  it('rejects a foreign host even with a matching fingerprint', () => {
    expect(ok({ url: `https://evil.example:${PORTS[0]}/x` })).toBe(false);
    expect(ok({ url: `https://evil.moxxy.ai:${PORTS[0]}/x` })).toBe(false);
    expect(ok({ url: `https://moxxy.ai:${PORTS[0]}/x` })).toBe(false);
  });

  it('rejects an off-list port', () => {
    expect(ok({ url: `https://${DESKTOP_APP_HOST}:443/x` })).toBe(false);
    expect(ok({ url: `https://${DESKTOP_APP_HOST}/x` })).toBe(false); // default 443
  });

  it('rejects a non-https scheme and a malformed url', () => {
    expect(ok({ url: `http://${DESKTOP_APP_HOST}:${PORTS[0]}/x` })).toBe(false);
    expect(ok({ url: 'not a url' })).toBe(false);
  });
});
