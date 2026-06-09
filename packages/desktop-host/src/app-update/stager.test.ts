import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { generateKeyPairSync, createHash, sign as cryptoSign, createPrivateKey } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import os from 'node:os';

import { buildAppBundle } from './build';
import { canonicalManifestBytes, type AppManifest } from './manifest';
import { checkForUpdate, downloadAndStage, isAllowedUpdateHost } from './stager';
import { bundleRoot, markBad, readBadVersions, readActiveVersion, type ShellInfo } from './resolve';

const SHELL: ShellInfo = { electron: '33.4.11', nodeAbi: '115' };
const keys = generateKeyPairSync('ed25519');
const PUBKEY = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PRIVKEY = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

/** Build a signed bundle the OLD way — WITHOUT the ESM `package.json` marker the
 *  current `buildAppBundle` injects — to exercise the stager's safety-net for
 *  already-published bundles that predate the fix. */
function buildLegacyBundle(
  version: string,
  files: Record<string, Buffer>,
  bundleUrl: string,
): { manifest: AppManifest; bundleGz: Buffer } {
  const filesB64: Record<string, string> = {};
  for (const [rel, buf] of Object.entries(files)) filesB64[rel] = buf.toString('base64');
  const bundleGz = gzipSync(Buffer.from(JSON.stringify({ version, files: filesB64 }), 'utf8'));
  const sha256 = createHash('sha256').update(bundleGz).digest('hex');
  const signed = { version, minElectron: '33.0.0', nodeAbi: '', sha256, bundleUrl };
  const signature = cryptoSign(
    null,
    canonicalManifestBytes(signed),
    createPrivateKey(PRIVKEY),
  ).toString('base64');
  return { manifest: { ...signed, signature }, bundleGz };
}

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

  it('refuses to stage when the extracted files do not match the signed per-file map', async () => {
    // A manifest whose gzip sha256 matches the served payload but whose signed
    // per-file map disagrees with the extracted bytes (a build/sign pipeline
    // signing the wrong tree). The download hash passes; the post-extraction
    // per-file check must catch it BEFORE activation.
    const files = {
      'dist/index.html': Buffer.from('x'),
      'dist-electron/main/index.js': Buffer.from('// main'),
      'package.json': Buffer.from('{ "type": "module" }\n'),
    };
    const filesB64: Record<string, string> = {};
    for (const [rel, buf] of Object.entries(files)) filesB64[rel] = buf.toString('base64');
    const bundleGz = gzipSync(Buffer.from(JSON.stringify({ version: '0.0.6', files: filesB64 }), 'utf8'));
    const signed = {
      version: '0.0.6',
      minElectron: '33.0.0',
      nodeAbi: '',
      sha256: createHash('sha256').update(bundleGz).digest('hex'),
      bundleUrl: GH,
      // Wrong hash for the main — signed over a DIFFERENT tree than the payload.
      files: { 'dist-electron/main/index.js': 'a'.repeat(64) },
    };
    const signature = cryptoSign(
      null,
      canonicalManifestBytes(signed),
      createPrivateKey(PRIVKEY),
    ).toString('base64');
    const manifest: AppManifest = { ...signed, signature };

    const fetchImpl = (async () => new Response(new Uint8Array(bundleGz))) as unknown as typeof fetch;
    await expect(
      downloadAndStage({ userDataDir: tmp, manifest, publicKeyPem: PUBKEY }, { fetchImpl }),
    ).rejects.toThrow(/integrity/i);
    // nothing got activated
    expect(existsSync(bundleRoot(tmp, '0.0.6'))).toBe(false);
    expect(readActiveVersion(tmp)).toBeNull();
  });

  it('writes a type:module marker for a legacy bundle that omits its own package.json', async () => {
    // Reproduces the production "Cannot use import statement outside a module"
    // failure: a published bundle whose ESM main has no package.json above it.
    const url = 'https://github.com/moxxy-ai/moxxy/releases/download/desktop-v0.0.7/b.json.gz';
    const { manifest, bundleGz } = buildLegacyBundle(
      '0.0.7',
      { 'dist/index.html': Buffer.from('x'), 'dist-electron/main/index.js': Buffer.from('// main') },
      url,
    );
    const fetchImpl = (async () => new Response(new Uint8Array(bundleGz))) as unknown as typeof fetch;

    await downloadAndStage(
      { userDataDir: tmp, manifest, publicKeyPem: PUBKEY, bundleUrl: url },
      { fetchImpl },
    );

    const pkg = JSON.parse(
      readFileSync(path.join(bundleRoot(tmp, '0.0.7'), 'package.json'), 'utf8'),
    );
    expect(pkg.type).toBe('module'); // the staged tree now loads as ESM
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
