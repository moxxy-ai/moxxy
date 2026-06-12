import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

import { type AppManifest, canonicalManifestBytes } from './manifest';
import {
  type ShellInfo,
  bundleRoot,
  setActiveVersion,
  markBad,
  resolveActiveBundleDetailed,
  listStagedVersions,
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
  const signature = cryptoSign(null, canonicalManifestBytes(base), keys.privateKey).toString('base64');
  return { ...base, signature };
}

function installBundle(version: string, over: Partial<AppManifest> = {}): void {
  const root = bundleRoot(tmp, version);
  mkdirSync(path.join(root, 'dist-electron', 'main'), { recursive: true });
  writeFileSync(path.join(root, 'dist-electron', 'main', 'index.js'), '// main');
  writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifestFor(version, over)));
  setActiveVersion(tmp, version);
}

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'app-resolve-detailed-'));
});

describe('resolveActiveBundleDetailed', () => {
  it('returns the bundle (no reason) on the happy path', () => {
    installBundle('0.0.6');
    const r = resolveActiveBundleDetailed({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL });
    expect(r.bundle).toEqual({ root: bundleRoot(tmp, '0.0.6'), version: '0.0.6' });
    expect(r.reason).toBeUndefined();
  });

  it('names "disabled" when no key is configured', () => {
    installBundle('0.0.6');
    expect(resolveActiveBundleDetailed({ userDataDir: tmp, publicKeyPem: '', shell: SHELL })).toEqual({
      bundle: null,
      reason: 'disabled',
    });
  });

  it('names "no-active" when nothing is staged', () => {
    expect(
      resolveActiveBundleDetailed({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL }).reason,
    ).toBe('no-active');
  });

  it('names "poisoned" for a bad version', () => {
    installBundle('0.0.6');
    markBad(tmp, '0.0.6');
    setActiveVersion(tmp, '0.0.6'); // markBad clears active; re-point to exercise the poison gate
    expect(
      resolveActiveBundleDetailed({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL }).reason,
    ).toBe('poisoned');
  });

  it('names "older-than-floor" when a fresh shell install supersedes the override', () => {
    // The live bug: user on 0.6 had a staged 0.6.2 override, installed the
    // full 0.7.0 app — and the new shell kept booting the stale 0.6.2 JS.
    installBundle('0.6.2');
    expect(
      resolveActiveBundleDetailed({
        userDataDir: tmp,
        publicKeyPem: PUBKEY,
        shell: SHELL,
        floorVersion: '0.7.0',
      }).reason,
    ).toBe('older-than-floor');
  });

  it('floor gate: an override EQUAL to the floor loses too (baked copy is the trusted one)', () => {
    installBundle('0.7.0');
    expect(
      resolveActiveBundleDetailed({
        userDataDir: tmp,
        publicKeyPem: PUBKEY,
        shell: SHELL,
        floorVersion: '0.7.0',
      }).reason,
    ).toBe('older-than-floor');
  });

  it('floor gate: a NEWER override still wins (the normal hot-update case)', () => {
    installBundle('0.7.1');
    const r = resolveActiveBundleDetailed({
      userDataDir: tmp,
      publicKeyPem: PUBKEY,
      shell: SHELL,
      floorVersion: '0.7.0',
    });
    expect(r.bundle?.version).toBe('0.7.1');
  });

  it('names "manifest-missing" when the manifest is absent', () => {
    const root = bundleRoot(tmp, '0.0.6');
    mkdirSync(path.join(root, 'dist-electron', 'main'), { recursive: true });
    writeFileSync(path.join(root, 'dist-electron', 'main', 'index.js'), '// main');
    setActiveVersion(tmp, '0.0.6');
    expect(
      resolveActiveBundleDetailed({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL }).reason,
    ).toBe('manifest-missing');
  });

  it('names "version-mismatch" when manifest.version ≠ active', () => {
    const root = bundleRoot(tmp, '0.0.6');
    mkdirSync(path.join(root, 'dist-electron', 'main'), { recursive: true });
    writeFileSync(path.join(root, 'dist-electron', 'main', 'index.js'), '// main');
    writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifestFor('9.9.9')));
    setActiveVersion(tmp, '0.0.6');
    expect(
      resolveActiveBundleDetailed({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL }).reason,
    ).toBe('version-mismatch');
  });

  it('names "bad-signature" when signed by a different key', () => {
    const other = generateKeyPairSync('ed25519');
    const otherPub = other.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    installBundle('0.0.6');
    expect(
      resolveActiveBundleDetailed({ userDataDir: tmp, publicKeyPem: otherPub, shell: SHELL }).reason,
    ).toBe('bad-signature');
  });

  it('names "incompatible" when the shell is too old', () => {
    installBundle('0.0.6', { minElectron: '99.0.0' });
    expect(
      resolveActiveBundleDetailed({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL }).reason,
    ).toBe('incompatible');
  });

  it('names "main-missing" when dist-electron/main/index.js is absent', () => {
    const root = bundleRoot(tmp, '0.0.6');
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifestFor('0.0.6')));
    setActiveVersion(tmp, '0.0.6');
    expect(
      resolveActiveBundleDetailed({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL }).reason,
    ).toBe('main-missing');
  });

  // Load-time per-file integrity (the signed `files` map).
  const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
  const MAIN_REL = 'dist-electron/main/index.js';

  it('accepts a bundle whose signed files map matches the bytes on disk', () => {
    installBundle('0.0.6', { files: { [MAIN_REL]: sha256('// main') } });
    const r = resolveActiveBundleDetailed({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL });
    expect(r.bundle?.version).toBe('0.0.6');
  });

  it('names "file-tampered" when a listed file is modified on disk', () => {
    installBundle('0.0.6', { files: { [MAIN_REL]: sha256('// main') } });
    writeFileSync(path.join(bundleRoot(tmp, '0.0.6'), MAIN_REL), '// EVIL main');
    expect(
      resolveActiveBundleDetailed({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL }).reason,
    ).toBe('file-tampered');
  });

  it('names "file-tampered" when a listed file is missing from disk', () => {
    installBundle('0.0.6', {
      files: { [MAIN_REL]: sha256('// main'), 'dist/index.html': sha256('<html>') },
    });
    expect(
      resolveActiveBundleDetailed({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL }).reason,
    ).toBe('file-tampered');
  });

  it('ignores EXTRA on-disk files not in the map (manifest.json always sits alongside)', () => {
    installBundle('0.0.6', { files: { [MAIN_REL]: sha256('// main') } });
    writeFileSync(path.join(bundleRoot(tmp, '0.0.6'), 'stray.js'), '// unlisted');
    const r = resolveActiveBundleDetailed({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL });
    expect(r.bundle?.version).toBe('0.0.6');
  });

  it('still accepts a tampered LEGACY bundle (no files map ⇒ no load-time check)', () => {
    // Documents the grandfathering: legacy manifests never signed per-file
    // hashes, so already-staged bundles keep loading — but get no protection.
    installBundle('0.0.6'); // manifestFor() emits no files map
    writeFileSync(path.join(bundleRoot(tmp, '0.0.6'), MAIN_REL), '// EVIL main');
    const r = resolveActiveBundleDetailed({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL });
    expect(r.bundle?.version).toBe('0.0.6');
  });
});

describe('listStagedVersions', () => {
  it('returns [] when nothing is installed', () => {
    expect(listStagedVersions(tmp)).toEqual([]);
  });

  it('lists installed bundle dirs (with a manifest), semver-sorted', () => {
    installBundle('0.0.6');
    installBundle('0.0.20');
    installBundle('0.0.9');
    expect(listStagedVersions(tmp)).toEqual(['0.0.6', '0.0.9', '0.0.20']);
  });

  it('ignores dirs without a manifest', () => {
    installBundle('0.0.6');
    mkdirSync(bundleRoot(tmp, '0.0.7'), { recursive: true }); // no manifest → not a bundle
    expect(listStagedVersions(tmp)).toEqual(['0.0.6']);
  });
});
