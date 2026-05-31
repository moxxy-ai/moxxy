import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

import { buildAppBundle } from './build';
import { checkForUpdate, downloadAndStage, type Progress } from './stager';
import { resolveActiveBundle, bundleRoot, type ShellInfo } from './resolve';

const SHELL: ShellInfo = { electron: '33.4.11', nodeAbi: '115' };
const MANIFEST_URL = 'https://github.com/moxxy-ai/moxxy/releases/latest/download/moxxy-app-manifest.json';
const BUNDLE_URL = 'https://github.com/moxxy-ai/moxxy/releases/latest/download/moxxy-app-bundle.json.gz';

const keys = generateKeyPairSync('ed25519');
const PUBKEY = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PRIVKEY = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const FILES = {
  'dist/index.html': Buffer.from('<!doctype html><title>moxxy</title>'),
  'dist/assets/app-abc.js': Buffer.from('console.log("hi")'),
  'dist/focus.html': Buffer.from('<!doctype html><title>focus</title>'),
  'dist-electron/main/index.js': Buffer.from('// the real main'),
  'dist-electron/preload/index.cjs': Buffer.from('// preload'),
};

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'app-roundtrip-'));
});

/** A fetch stub that serves the manifest + the gzipped bundle from memory. */
function stubFetch(manifestJson: string, bundleGz: Buffer): typeof fetch {
  return (async (url: string | URL): Promise<Response> => {
    const u = String(url);
    if (u === MANIFEST_URL) return new Response(manifestJson);
    if (u === BUNDLE_URL) return new Response(new Uint8Array(bundleGz));
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('build → stage → resolve round-trip', () => {
  it('installs a signed bundle that the loader then accepts', async () => {
    const { manifest, manifestJson, bundleGz } = buildAppBundle({
      version: '0.0.6',
      minElectron: '33.0.0',
      nodeAbi: '',
      bundleUrl: BUNDLE_URL,
      privateKeyPem: PRIVKEY,
      files: FILES,
      notes: 'New chat surface',
    });
    const fetchImpl = stubFetch(manifestJson, bundleGz);

    // check: a newer, compatible bundle is offered
    const check = await checkForUpdate(
      { manifestUrl: MANIFEST_URL, currentVersion: '0.0.5', publicKeyPem: PUBKEY, shell: SHELL },
      { fetchImpl },
    );
    expect(check.available).toBe(true);
    expect(check.compatible).toBe(true);
    expect(check.latestVersion).toBe('0.0.6');
    expect(check.notes).toBe('New chat surface');

    // apply: download, verify, extract, activate
    const phases: Progress['phase'][] = [];
    const { version } = await downloadAndStage(
      { userDataDir: tmp, manifest, publicKeyPem: PUBKEY, onProgress: (p) => phases.push(p.phase) },
      { fetchImpl },
    );
    expect(version).toBe('0.0.6');
    expect(new Set(phases)).toEqual(new Set(['download', 'verify', 'extract', 'activate']));

    // files landed with layout preserved + verified manifest written
    const root = bundleRoot(tmp, '0.0.6');
    expect(readFileSync(path.join(root, 'dist', 'index.html'), 'utf8')).toContain('moxxy');
    expect(readFileSync(path.join(root, 'dist-electron', 'main', 'index.js'), 'utf8')).toContain(
      'real main',
    );
    expect(existsSync(path.join(root, 'manifest.json'))).toBe(true);

    // the bootstrap gate accepts it
    expect(resolveActiveBundle({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL })).toEqual({
      root,
      version: '0.0.6',
    });
  });

  it('refuses to stage when the gzip hash does not match the signed manifest', async () => {
    const { manifest, manifestJson } = buildAppBundle({
      version: '0.0.6',
      minElectron: '33.0.0',
      nodeAbi: '',
      bundleUrl: BUNDLE_URL,
      privateKeyPem: PRIVKEY,
      files: FILES,
    });
    // Serve a DIFFERENT (tampered) gzip than the one the manifest is signed over.
    const tampered = buildAppBundle({
      version: '0.0.6',
      minElectron: '33.0.0',
      nodeAbi: '',
      bundleUrl: BUNDLE_URL,
      privateKeyPem: PRIVKEY,
      files: { ...FILES, 'dist-electron/main/index.js': Buffer.from('// EVIL main') },
    }).bundleGz;
    const fetchImpl = stubFetch(manifestJson, tampered);

    await expect(
      downloadAndStage({ userDataDir: tmp, manifest, publicKeyPem: PUBKEY }, { fetchImpl }),
    ).rejects.toThrow(/hash/i);
    // nothing activated
    expect(resolveActiveBundle({ userDataDir: tmp, publicKeyPem: PUBKEY, shell: SHELL })).toBeNull();
  });

  it('checkForUpdate reports incompatible (needs shell update) but not available for a JS swap', async () => {
    const { manifestJson, bundleGz } = buildAppBundle({
      version: '0.0.9',
      minElectron: '99.0.0',
      nodeAbi: '',
      bundleUrl: BUNDLE_URL,
      privateKeyPem: PRIVKEY,
      files: FILES,
    });
    const check = await checkForUpdate(
      { manifestUrl: MANIFEST_URL, currentVersion: '0.0.5', publicKeyPem: PUBKEY, shell: SHELL },
      { fetchImpl: stubFetch(manifestJson, bundleGz) },
    );
    expect(check.available).toBe(true);
    expect(check.compatible).toBe(false); // → Tier-2 shell update
  });
});
