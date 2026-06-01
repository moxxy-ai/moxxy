import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

import { buildAppBundle } from './build';
import { checkForUpdate, downloadAndStage, isAllowedUpdateHost } from './stager';
import { bundleRoot, markBad, readBadVersions, readActiveVersion, type ShellInfo } from './resolve';

const SHELL: ShellInfo = { electron: '33.4.11', nodeAbi: '115' };
const keys = generateKeyPairSync('ed25519');
const PUBKEY = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PRIVKEY = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'app-stager-'));
});

describe('isAllowedUpdateHost', () => {
  it('allows GitHub (api/web) + its release-asset CDN over https only', () => {
    expect(isAllowedUpdateHost('https://github.com/o/r/releases/download/desktop-v1/m.json')).toBe(true);
    expect(isAllowedUpdateHost('https://api.github.com/repos/o/r/releases')).toBe(true);
    expect(isAllowedUpdateHost('https://objects.githubusercontent.com/x')).toBe(true);
    expect(isAllowedUpdateHost('https://release-assets.githubusercontent.com/x')).toBe(true);
  });

  it('rejects other hosts, http, and junk', () => {
    expect(isAllowedUpdateHost('https://evil.test/m.json')).toBe(false);
    expect(isAllowedUpdateHost('https://github.com.evil.test/m.json')).toBe(false);
    expect(isAllowedUpdateHost('http://github.com/x')).toBe(false);
    expect(isAllowedUpdateHost('not a url')).toBe(false);
  });
});

describe('checkForUpdate', () => {
  it('reports an error (not silent "up to date") when the release API is unreachable', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const res = await checkForUpdate(
      { repo: 'moxxy-ai/moxxy', currentVersion: '0.0.5', publicKeyPem: PUBKEY, shell: SHELL },
      { fetchImpl },
    );
    expect(res.available).toBe(false);
    expect(res.error).toBeTruthy(); // a real failure, surfaced — not masked as up-to-date
  });

  it('discovers the newest desktop-v* release via the API and offers its manifest', async () => {
    const { manifest, manifestJson, bundleGz } = buildAppBundle({
      version: '0.0.9',
      minElectron: '33.0.0',
      nodeAbi: '',
      bundleUrl: 'https://github.com/moxxy-ai/moxxy/releases/download/desktop-v0.0.9/moxxy-app-bundle-0.0.9.json.gz',
      privateKeyPem: PRIVKEY,
      files: { 'dist/index.html': Buffer.from('x') },
    });
    const manifestAssetUrl =
      'https://github.com/moxxy-ai/moxxy/releases/download/desktop-v0.0.9/moxxy-app-manifest.json';
    const releasesJson = JSON.stringify([
      // an unrelated, newer npm-package release (the one that breaks releases/latest)
      { tag_name: '@moxxy/cli@9.9.9', draft: false, prerelease: false, assets: [] },
      {
        tag_name: 'desktop-v0.0.8',
        draft: false,
        prerelease: false,
        assets: [{ name: 'moxxy-app-manifest.json', browser_download_url: 'https://github.com/x/old' }],
      },
      {
        tag_name: 'desktop-v0.0.9',
        draft: false,
        prerelease: false,
        assets: [
          { name: 'moxxy-app-manifest.json', browser_download_url: manifestAssetUrl },
          { name: 'moxxy-app-bundle-0.0.9.json.gz', browser_download_url: manifest.bundleUrl },
        ],
      },
    ]);
    const fetchImpl = (async (url: string | URL): Promise<Response> => {
      const u = String(url);
      if (u.startsWith('https://api.github.com/')) return new Response(releasesJson);
      if (u === manifestAssetUrl) return new Response(manifestJson);
      if (u === manifest.bundleUrl) return new Response(new Uint8Array(bundleGz));
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const res = await checkForUpdate(
      { repo: 'moxxy-ai/moxxy', currentVersion: '0.0.7', publicKeyPem: PUBKEY, shell: SHELL },
      { fetchImpl },
    );
    expect(res.available).toBe(true);
    expect(res.latestVersion).toBe('0.0.9'); // highest desktop-v*, not the cli release
    expect(res.bundleUrl).toBe(manifest.bundleUrl);
    expect(res.error).toBeUndefined();
  });
});

describe('downloadAndStage hardening', () => {
  const GH = 'https://github.com/moxxy-ai/moxxy/releases/latest/download/b.json.gz';

  it('refuses a bundle whose URL is not on an allowed host', async () => {
    const { manifest } = buildAppBundle({
      version: '0.0.6',
      minElectron: '33.0.0',
      nodeAbi: '',
      bundleUrl: 'https://evil.test/b.json.gz',
      privateKeyPem: PRIVKEY,
      files: { 'dist/index.html': Buffer.from('x') },
    });
    await expect(
      downloadAndStage({ userDataDir: tmp, manifest, publicKeyPem: PUBKEY }),
    ).rejects.toThrow(/allowed origin/i);
  });

  it('refuses a bundle containing a path-traversal entry (defense in depth)', async () => {
    const { manifest, bundleGz } = buildAppBundle({
      version: '0.0.6',
      minElectron: '33.0.0',
      nodeAbi: '',
      bundleUrl: GH,
      privateKeyPem: PRIVKEY,
      files: { '../escape.js': Buffer.from('pwned'), 'dist/index.html': Buffer.from('x') },
    });
    const fetchImpl = (async () => new Response(new Uint8Array(bundleGz))) as unknown as typeof fetch;
    await expect(
      downloadAndStage({ userDataDir: tmp, manifest, publicKeyPem: PUBKEY }, { fetchImpl }),
    ).rejects.toThrow(/unsafe path/i);
    // nothing got activated
    expect(existsSync(bundleRoot(tmp, '0.0.6'))).toBe(false);
  });

  it('refuses to stage when the manifest signature is invalid', async () => {
    const { manifest, bundleGz } = buildAppBundle({
      version: '0.0.6',
      minElectron: '33.0.0',
      nodeAbi: '',
      bundleUrl: GH,
      privateKeyPem: PRIVKEY,
      files: { 'dist/index.html': Buffer.from('x') },
    });
    const otherKey = generateKeyPairSync('ed25519')
      .publicKey.export({ type: 'spki', format: 'pem' })
      .toString();
    const fetchImpl = (async () => new Response(new Uint8Array(bundleGz))) as unknown as typeof fetch;
    await expect(
      downloadAndStage({ userDataDir: tmp, manifest, publicKeyPem: otherKey }, { fetchImpl }),
    ).rejects.toThrow(/signature/i);
  });

  it('clears a prior poison mark on the version it installs (un-wedges a reinstall)', async () => {
    const { manifest, bundleGz } = buildAppBundle({
      version: '0.0.6',
      minElectron: '33.0.0',
      nodeAbi: '',
      bundleUrl: GH,
      privateKeyPem: PRIVKEY,
      files: {
        'dist/index.html': Buffer.from('x'),
        'dist-electron/main/index.js': Buffer.from('// main'),
      },
    });
    // A prior failed boot poisoned this version; without un-poisoning, the
    // freshly re-staged copy would be rejected on the next launch forever.
    markBad(tmp, '0.0.6');
    expect(readBadVersions(tmp).has('0.0.6')).toBe(true);

    const fetchImpl = (async () => new Response(new Uint8Array(bundleGz))) as unknown as typeof fetch;
    const { version } = await downloadAndStage(
      { userDataDir: tmp, manifest, publicKeyPem: PUBKEY },
      { fetchImpl },
    );

    expect(version).toBe('0.0.6');
    expect(readBadVersions(tmp).has('0.0.6')).toBe(false); // poison cleared
    expect(readActiveVersion(tmp)).toBe('0.0.6'); // and activated
  });
});
