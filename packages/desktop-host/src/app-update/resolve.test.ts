import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

import { type AppManifest, canonicalManifestBytes } from './manifest';
import {
  type ShellInfo,
  bundleRoot,
  appUpdateDir,
  resolveActiveBundle,
  setActiveVersion,
  readActiveVersion,
  markBad,
  readBadVersions,
  writeBreadcrumb,
  markConfirmed,
  recoverFromFailedBoot,
  isCompatible,
  compareSemver,
  isSafeVersion,
  pruneBundles,
} from './resolve';

let tmp: string;
const SHELL: ShellInfo = { electron: '33.4.11', nodeAbi: '115' };

const keys = generateKeyPairSync('ed25519');
const PUBKEY = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

function manifestFor(version: string, over: Partial<AppManifest> = {}): AppManifest {
  const base: Omit<AppManifest, 'signature'> = {
    version,
    minElectron: '33.0.0',
    nodeAbi: '115',
    sha256: 'a'.repeat(64),
    bundleUrl: 'https://example.com/b.json.gz',
    ...over,
  };
  const signature = cryptoSign(null, canonicalManifestBytes(base), keys.privateKey).toString(
    'base64',
  );
  return { ...base, signature };
}

/** Lay down a fully-valid installed bundle at `<userData>/app/<version>/`. */
function installBundle(version: string, over: Partial<AppManifest> = {}): void {
  const root = bundleRoot(tmp, version);
  mkdirSync(path.join(root, 'dist-electron', 'main'), { recursive: true });
  writeFileSync(path.join(root, 'dist-electron', 'main', 'index.js'), '// main');
  writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifestFor(version, over)));
  setActiveVersion(tmp, version);
}

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'app-resolve-'));
});

describe('resolveActiveBundle', () => {
  it('returns the installed bundle when signature + compat + layout all pass', () => {
    installBundle('0.0.6');
    const r = resolveActiveBundle({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL });
    expect(r).toEqual({ root: bundleRoot(tmp, '0.0.6'), version: '0.0.6' });
  });

  it('falls back to floor (null) when no key is configured', () => {
    installBundle('0.0.6');
    expect(resolveActiveBundle({ userDataDir: tmp, publicKeyPem: '', shell: SHELL })).toBeNull();
  });

  it('falls back when there is no active bundle', () => {
    expect(resolveActiveBundle({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL })).toBeNull();
  });

  it('falls back when the active version is poisoned', () => {
    installBundle('0.0.6');
    markBad(tmp, '0.0.6');
    expect(resolveActiveBundle({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL })).toBeNull();
  });

  it('rejects a bundle whose manifest is signed by a different key', () => {
    const other = generateKeyPairSync('ed25519');
    const otherPub = other.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    installBundle('0.0.6');
    expect(
      resolveActiveBundle({ userDataDir: tmp, publicKeyPem: otherPub, shell: SHELL }),
    ).toBeNull();
  });

  it('rejects when the manifest version does not match the active version', () => {
    const root = bundleRoot(tmp, '0.0.6');
    mkdirSync(path.join(root, 'dist-electron', 'main'), { recursive: true });
    writeFileSync(path.join(root, 'dist-electron', 'main', 'index.js'), '// main');
    // manifest says 9.9.9 but it lives in the 0.0.6 dir / active points at 0.0.6
    writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifestFor('9.9.9')));
    setActiveVersion(tmp, '0.0.6');
    expect(resolveActiveBundle({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL })).toBeNull();
  });

  it('rejects an incompatible bundle (needs a newer shell)', () => {
    installBundle('0.0.6', { minElectron: '40.0.0' });
    expect(resolveActiveBundle({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL })).toBeNull();
  });

  it('rejects on a Node ABI mismatch', () => {
    installBundle('0.0.6', { nodeAbi: '999' });
    expect(resolveActiveBundle({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL })).toBeNull();
  });

  it('rejects when the real main is missing on disk', () => {
    const root = bundleRoot(tmp, '0.0.6');
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifestFor('0.0.6')));
    setActiveVersion(tmp, '0.0.6');
    expect(resolveActiveBundle({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL })).toBeNull();
  });
});

describe('markBad', () => {
  it('adds to the bad set and clears active when it pointed there', () => {
    installBundle('0.0.6');
    markBad(tmp, '0.0.6');
    expect(readBadVersions(tmp).has('0.0.6')).toBe(true);
    expect(resolveActiveBundle({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL })).toBeNull();
  });
});

describe('recoverFromFailedBoot (boot-probe rollback)', () => {
  it('does nothing for a fresh install (no breadcrumb for the active version)', () => {
    installBundle('0.0.6'); // active = 0.0.6, no breadcrumb yet
    const r = recoverFromFailedBoot(tmp);
    expect(r.poisoned).toBeNull();
    expect(readActiveVersion(tmp)).toBe('0.0.6');
  });

  it('does nothing when the active version confirmed healthy', () => {
    installBundle('0.0.6');
    writeBreadcrumb(tmp, '0.0.6'); // it was attempted…
    markConfirmed(tmp, '0.0.6'); // …and confirmed
    expect(recoverFromFailedBoot(tmp).poisoned).toBeNull();
    expect(readActiveVersion(tmp)).toBe('0.0.6');
  });

  it('poisons a version that was attempted but never confirmed, falling to floor', () => {
    installBundle('0.0.6');
    writeBreadcrumb(tmp, '0.0.6'); // attempted last launch, no confirm
    const r = recoverFromFailedBoot(tmp);
    expect(r.poisoned).toBe('0.0.6');
    expect(r.rolledBackTo).toBeNull();
    expect(readBadVersions(tmp).has('0.0.6')).toBe(true);
    expect(readActiveVersion(tmp)).toBeNull(); // → floor
  });

  it('rolls back to the last confirmed-good bundle when one is still installed', () => {
    installBundle('0.0.6');
    markConfirmed(tmp, '0.0.6'); // 0.0.6 booted fine earlier
    installBundle('0.0.7'); // then user updated to 0.0.7 (active = 0.0.7)
    writeBreadcrumb(tmp, '0.0.7'); // 0.0.7 was attempted but white-screened
    const r = recoverFromFailedBoot(tmp);
    expect(r.poisoned).toBe('0.0.7');
    expect(r.rolledBackTo).toBe('0.0.6');
    expect(readActiveVersion(tmp)).toBe('0.0.6');
    // and the rolled-back-to bundle still resolves
    expect(resolveActiveBundle({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL })?.version).toBe(
      '0.0.6',
    );
  });
});

describe('helpers', () => {
  it('compareSemver orders by major.minor.patch', () => {
    expect(compareSemver('33.4.11', '33.0.0')).toBe(1);
    expect(compareSemver('33.0.0', '33.0.0')).toBe(0);
    expect(compareSemver('32.9.9', '33.0.0')).toBe(-1);
    expect(compareSemver('33.4.11-beta.1', '33.4.11')).toBe(0);
  });

  it('isCompatible needs both the Electron floor and an exact ABI', () => {
    const m = manifestFor('0.0.6');
    expect(isCompatible(m, SHELL)).toBe(true);
    expect(isCompatible(m, { electron: '32.0.0', nodeAbi: '115' })).toBe(false);
    expect(isCompatible(m, { electron: '33.4.11', nodeAbi: '116' })).toBe(false);
  });

  it('isCompatible treats an empty manifest nodeAbi as a wildcard', () => {
    const m = manifestFor('0.0.6', { nodeAbi: '' });
    expect(isCompatible(m, { electron: '33.4.11', nodeAbi: '115' })).toBe(true);
    expect(isCompatible(m, { electron: '33.4.11', nodeAbi: 'anything' })).toBe(true);
    expect(isCompatible(m, { electron: '32.0.0', nodeAbi: '115' })).toBe(false);
  });

  it('isSafeVersion blocks traversal + separators', () => {
    expect(isSafeVersion('0.0.6')).toBe(true);
    expect(isSafeVersion('1.2.3-rc.1')).toBe(true);
    expect(isSafeVersion('../etc')).toBe(false);
    expect(isSafeVersion('a/b')).toBe(false);
    expect(isSafeVersion('..')).toBe(false);
  });

  it('pruneBundles keeps the listed versions and removes other bundle dirs', () => {
    installBundle('0.0.5');
    installBundle('0.0.6');
    installBundle('0.0.7');
    pruneBundles(tmp, ['0.0.7', '0.0.6']);
    expect(existsSync(bundleRoot(tmp, '0.0.5'))).toBe(false);
    expect(existsSync(bundleRoot(tmp, '0.0.6'))).toBe(true);
    expect(existsSync(bundleRoot(tmp, '0.0.7'))).toBe(true);
  });

  it('pruneBundles never removes non-bundle dirs (no manifest.json)', () => {
    const stray = path.join(appUpdateDir(tmp), '0.0.9');
    mkdirSync(stray, { recursive: true });
    writeFileSync(path.join(stray, 'note.txt'), 'not a bundle');
    pruneBundles(tmp, []);
    expect(existsSync(stray)).toBe(true);
  });
});
