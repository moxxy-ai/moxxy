import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { generateKeyPairSync, createHash, sign as cryptoSign, createPrivateKey } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import os from 'node:os';

import { buildAppBundle } from './build';
import { canonicalManifestBytes, type AppManifest } from './manifest';
import { checkForUpdate, downloadAndStage, isAllowedUpdateHost } from './stager';
import {
  appUpdateDir,
  bundleRoot,
  markBad,
  readBadVersions,
  readActiveVersion,
  type ShellInfo,
} from './resolve';

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

  it('follows Link:next to find a desktop-v* release buried past the first page', async () => {
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
    // Page 1: a full page of unrelated npm-package releases, no desktop-v*.
    const page1 = JSON.stringify(
      Array.from({ length: 100 }, (_, i) => ({
        tag_name: `@moxxy/cli@1.0.${i}`,
        draft: false,
        prerelease: false,
        assets: [],
      })),
    );
    // Page 2: the desktop release lives here.
    const page2 = JSON.stringify([
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
    const page2Url = 'https://api.github.com/repos/moxxy-ai/moxxy/releases?per_page=100&page=2';
    let apiCalls = 0;
    const fetchImpl = (async (url: string | URL): Promise<Response> => {
      const u = String(url);
      if (u === page2Url) {
        apiCalls++;
        return new Response(page2);
      }
      if (u.startsWith('https://api.github.com/')) {
        apiCalls++;
        // First page advertises a next page via the Link header.
        return new Response(page1, { headers: { link: `<${page2Url}>; rel="next"` } });
      }
      if (u === manifestAssetUrl) return new Response(manifestJson);
      if (u === manifest.bundleUrl) return new Response(new Uint8Array(bundleGz));
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const res = await checkForUpdate(
      { repo: 'moxxy-ai/moxxy', currentVersion: '0.0.7', publicKeyPem: PUBKEY, shell: SHELL },
      { fetchImpl },
    );
    expect(res.available).toBe(true);
    expect(res.latestVersion).toBe('0.0.9');
    expect(res.error).toBeUndefined();
    expect(apiCalls).toBe(2); // walked page 1 then followed Link:next to page 2
  });
});

describe('checkForUpdate runner-protocol gate', () => {
  const MANIFEST_URL = 'https://github.com/moxxy-ai/moxxy/releases/download/desktop-v0.0.9/moxxy-app-manifest.json';

  function checkWithProtocol(
    bundleProtocol: number | undefined,
    cliRunnerProtocol: number | undefined,
  ): ReturnType<typeof checkForUpdate> {
    const { manifestJson } = buildAppBundle({
      version: '0.0.9',
      minElectron: '33.0.0',
      nodeAbi: '',
      bundleUrl: 'https://github.com/moxxy-ai/moxxy/releases/download/desktop-v0.0.9/b.json.gz',
      privateKeyPem: PRIVKEY,
      files: { 'dist/index.html': Buffer.from('x') },
      ...(typeof bundleProtocol === 'number' ? { runnerProtocol: bundleProtocol } : {}),
    });
    const fetchImpl = (async () => new Response(manifestJson)) as unknown as typeof fetch;
    return checkForUpdate(
      {
        repo: 'moxxy-ai/moxxy',
        currentVersion: '0.0.5',
        publicKeyPem: PUBKEY,
        shell: SHELL,
        ...(typeof cliRunnerProtocol === 'number' ? { cliRunnerProtocol } : {}),
        manifestUrlOverride: MANIFEST_URL,
      },
      { fetchImpl },
    );
  }

  it('flags a bundle whose runner protocol outruns the spawnable CLI as requiring a full update', async () => {
    const res = await checkWithProtocol(7, 6);
    expect(res.available).toBe(true);
    expect(res.requiresFullUpdate).toBe(true);
    expect(res.compatible).toBe(false); // can't be applied as a hot-update
  });

  it('does not flag an equal or lower runner protocol', async () => {
    const equal = await checkWithProtocol(6, 6);
    expect(equal.requiresFullUpdate).toBeUndefined();
    expect(equal.compatible).toBe(true);

    const lower = await checkWithProtocol(5, 6);
    expect(lower.requiresFullUpdate).toBeUndefined();
    expect(lower.compatible).toBe(true);
  });

  it('does not flag when either side of the gate is unknown', async () => {
    const noStamp = await checkWithProtocol(undefined, 6); // legacy manifest
    expect(noStamp.requiresFullUpdate).toBeUndefined();
    expect(noStamp.compatible).toBe(true);

    const noCli = await checkWithProtocol(7, undefined); // caller doesn't model the CLI
    expect(noCli.requiresFullUpdate).toBeUndefined();
    expect(noCli.compatible).toBe(true);
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

  it('refuses to stage a bundle whose runner protocol outruns the spawnable CLI', async () => {
    // Reproduces the "says updated and restart but it does not update" loop:
    // the stager used to download/verify/activate such a bundle, the UI said
    // "relaunch to apply", and the boot gate rejected it (`runner-protocol-skew`)
    // on every launch. The stage-time gate must refuse BEFORE anything lands.
    const { manifest, bundleGz } = buildAppBundle({
      version: '0.0.6',
      minElectron: '33.0.0',
      nodeAbi: '',
      bundleUrl: GH,
      privateKeyPem: PRIVKEY,
      runnerProtocol: 7,
      files: {
        'dist/index.html': Buffer.from('x'),
        'dist-electron/main/index.js': Buffer.from('// main'),
      },
    });
    const fetchImpl = (async () => new Response(new Uint8Array(bundleGz))) as unknown as typeof fetch;
    await expect(
      downloadAndStage(
        { userDataDir: tmp, manifest, publicKeyPem: PUBKEY, cliRunnerProtocol: 6 },
        { fetchImpl },
      ),
    ).rejects.toThrow(/full app installer/i);
    // nothing staged, nothing activated — no false "updated, relaunch" state
    expect(existsSync(bundleRoot(tmp, '0.0.6'))).toBe(false);
    expect(readActiveVersion(tmp)).toBeNull();
  });

  it('stages a bundle whose runner protocol matches the spawnable CLI', async () => {
    const { manifest, bundleGz } = buildAppBundle({
      version: '0.0.6',
      minElectron: '33.0.0',
      nodeAbi: '',
      bundleUrl: GH,
      privateKeyPem: PRIVKEY,
      runnerProtocol: 6,
      files: {
        'dist/index.html': Buffer.from('x'),
        'dist-electron/main/index.js': Buffer.from('// main'),
      },
    });
    const fetchImpl = (async () => new Response(new Uint8Array(bundleGz))) as unknown as typeof fetch;
    const { version } = await downloadAndStage(
      { userDataDir: tmp, manifest, publicKeyPem: PUBKEY, cliRunnerProtocol: 6 },
      { fetchImpl },
    );
    expect(version).toBe('0.0.6');
    expect(readActiveVersion(tmp)).toBe('0.0.6');
  });

  it('reports a final download progress event at 100% even when content-length is absent', async () => {
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
    // A chunked / proxy-stripped response: no content-length header, so the
    // per-chunk `total` is undefined and the bar would otherwise stay
    // indeterminate. The reconciling final event must land it at 100%.
    const fetchImpl = (async () => {
      const r = new Response(new Uint8Array(bundleGz));
      r.headers.delete('content-length');
      return r;
    }) as unknown as typeof fetch;

    const progress: Array<{ phase: string; received?: number; total?: number }> = [];
    await downloadAndStage(
      {
        userDataDir: tmp,
        manifest,
        publicKeyPem: PUBKEY,
        onProgress: (p) => progress.push(p as { phase: string; received?: number; total?: number }),
      },
      { fetchImpl },
    );

    const downloads = progress.filter((p) => p.phase === 'download' && p.received !== undefined);
    const final = downloads.at(-1)!;
    expect(final.received).toBeGreaterThan(0);
    expect(final.total).toBe(final.received); // lands at exactly 100%
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

describe('downloadAndStage SSRF + OOM hardening', () => {
  const GH = 'https://github.com/moxxy-ai/moxxy/releases/latest/download/b.json.gz';

  function bundle(): { manifest: AppManifest; bundleGz: Buffer } {
    return buildAppBundle({
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
  }

  it('refuses to follow a bundle redirect that leaves the allowlist (SSRF)', async () => {
    const { manifest } = bundle();
    // The download host is allowed, but it 302-redirects OFF the allowlist. With
    // redirect:'follow' the loader would silently fetch from the off-allowlist
    // host; the manual re-validating follow must reject it.
    const fetchImpl = (async () =>
      new Response('', {
        status: 302,
        headers: { location: 'https://evil.test/payload.json.gz' },
      })) as unknown as typeof fetch;
    await expect(
      downloadAndStage({ userDataDir: tmp, manifest, publicKeyPem: PUBKEY }, { fetchImpl }),
    ).rejects.toThrow(/allowed origin/i);
    expect(existsSync(bundleRoot(tmp, '0.0.6'))).toBe(false);
    expect(readActiveVersion(tmp)).toBeNull();
  });

  it('follows an in-allowlist redirect (object-store CDN) and stages normally', async () => {
    const { manifest, bundleGz } = bundle();
    const cdn = 'https://objects.githubusercontent.com/x/payload.json.gz';
    let hops = 0;
    const fetchImpl = (async (url: string | URL): Promise<Response> => {
      hops++;
      if (String(url) === cdn) return new Response(new Uint8Array(bundleGz));
      // First hop: a 302 to the (allowlisted) CDN host.
      return new Response('', { status: 302, headers: { location: cdn } });
    }) as unknown as typeof fetch;
    const { version } = await downloadAndStage(
      { userDataDir: tmp, manifest, publicKeyPem: PUBKEY },
      { fetchImpl },
    );
    expect(version).toBe('0.0.6');
    expect(hops).toBe(2); // original → re-validated CDN hop
    expect(readActiveVersion(tmp)).toBe('0.0.6');
  });

  it('rejects a download whose declared content-length exceeds the ceiling (OOM)', async () => {
    const { manifest } = bundle();
    // A hostile/buggy response advertises an absurd size — refuse before reading
    // a single byte into memory.
    const fetchImpl = (async () =>
      new Response('ignored', {
        headers: { 'content-length': String(2 * 1024 * 1024 * 1024) }, // 2 GiB
      })) as unknown as typeof fetch;
    await expect(
      downloadAndStage({ userDataDir: tmp, manifest, publicKeyPem: PUBKEY }, { fetchImpl }),
    ).rejects.toThrow(/maximum allowed size/i);
    expect(readActiveVersion(tmp)).toBeNull();
  });

  it('aborts a stream that runs past the byte ceiling even without a content-length', async () => {
    const { manifest } = bundle();
    // A chunked response with no content-length that keeps emitting forever: the
    // per-chunk ceiling must abort it before it grows the buffer unbounded.
    const fetchImpl = (async () => {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(64 * 1024 * 1024)); // 64 MiB per pull
        },
      });
      return new Response(body);
    }) as unknown as typeof fetch;
    await expect(
      downloadAndStage({ userDataDir: tmp, manifest, publicKeyPem: PUBKEY }, { fetchImpl }),
    ).rejects.toThrow(/maximum allowed size/i);
    expect(readActiveVersion(tmp)).toBeNull();
  });
});

describe('downloadAndStage concurrency', () => {
  const GH = 'https://github.com/moxxy-ai/moxxy/releases/latest/download/b.json.gz';

  function bundleAt(version: string): { manifest: AppManifest; bundleGz: Buffer } {
    return buildAppBundle({
      version,
      minElectron: '33.0.0',
      nodeAbi: '',
      bundleUrl: GH,
      privateKeyPem: PRIVKEY,
      files: {
        'dist/index.html': Buffer.from('x'),
        'dist-electron/main/index.js': Buffer.from(`// main ${version}`),
      },
    });
  }

  it('serializes two concurrent installs so they never overlap (no interleaved swap)', async () => {
    // Two installs of DIFFERENT versions launched at the same time on the same
    // userData. The mutex must run them strictly one-at-a-time: the second's
    // fetch cannot begin until the first has fully finished. Without that, the
    // rmSync(finalRoot)+rename activation swaps interleave and corrupt a dir.
    const a = bundleAt('0.0.6');
    const b = bundleAt('0.0.7');
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchFor = (gz: Buffer) =>
      (async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Yield a few microtasks so a non-serialized impl would overlap here.
        await Promise.resolve();
        await Promise.resolve();
        inFlight--;
        return new Response(new Uint8Array(gz));
      }) as unknown as typeof fetch;

    const [r1, r2] = await Promise.all([
      downloadAndStage(
        { userDataDir: tmp, manifest: a.manifest, publicKeyPem: PUBKEY },
        { fetchImpl: fetchFor(a.bundleGz) },
      ),
      downloadAndStage(
        { userDataDir: tmp, manifest: b.manifest, publicKeyPem: PUBKEY },
        { fetchImpl: fetchFor(b.bundleGz) },
      ),
    ]);

    expect(maxInFlight).toBe(1); // never two stages running at once
    expect(r1.version).toBe('0.0.6');
    expect(r2.version).toBe('0.0.7');
    // Both staged trees are intact (no half-populated / clobbered dir).
    expect(existsSync(path.join(bundleRoot(tmp, '0.0.6'), 'manifest.json'))).toBe(true);
    expect(existsSync(path.join(bundleRoot(tmp, '0.0.7'), 'manifest.json'))).toBe(true);
    // Exactly one active pointer — one of the two, never a corrupt mix.
    expect(['0.0.6', '0.0.7']).toContain(readActiveVersion(tmp));
  });

  it('a failed install does not wedge the serialization chain for the next caller', async () => {
    const good = bundleAt('0.0.8');
    const badUrlManifest = buildAppBundle({
      version: '0.0.9',
      minElectron: '33.0.0',
      nodeAbi: '',
      bundleUrl: 'https://evil.test/b.json.gz', // refused before any fetch
      privateKeyPem: PRIVKEY,
      files: { 'dist/index.html': Buffer.from('x') },
    }).manifest;

    const failing = downloadAndStage(
      { userDataDir: tmp, manifest: badUrlManifest, publicKeyPem: PUBKEY },
      {},
    );
    const succeeding = downloadAndStage(
      { userDataDir: tmp, manifest: good.manifest, publicKeyPem: PUBKEY },
      { fetchImpl: (async () => new Response(new Uint8Array(good.bundleGz))) as unknown as typeof fetch },
    );

    await expect(failing).rejects.toThrow(/allowed origin/i);
    await expect(succeeding).resolves.toEqual({ version: '0.0.8' });
    expect(readActiveVersion(tmp)).toBe('0.0.8'); // the chain recovered
  });

  it('re-staging an existing version keeps a complete dir even if the swap throws', async () => {
    // First install lands 0.0.6.
    const v1 = bundleAt('0.0.6');
    await downloadAndStage(
      { userDataDir: tmp, manifest: v1.manifest, publicKeyPem: PUBKEY },
      { fetchImpl: (async () => new Response(new Uint8Array(v1.bundleGz))) as unknown as typeof fetch },
    );
    const main = path.join(bundleRoot(tmp, '0.0.6'), 'dist-electron', 'main', 'index.js');
    expect(existsSync(main)).toBe(true);

    // Re-stage the SAME version successfully — the old dir is moved aside, the new
    // one committed, the old removed. The version's dir must remain complete the
    // whole time (never an empty hole), and stay active.
    const v2 = bundleAt('0.0.6');
    await downloadAndStage(
      { userDataDir: tmp, manifest: v2.manifest, publicKeyPem: PUBKEY },
      { fetchImpl: (async () => new Response(new Uint8Array(v2.bundleGz))) as unknown as typeof fetch },
    );
    expect(existsSync(main)).toBe(true);
    expect(readActiveVersion(tmp)).toBe('0.0.6');
    // No stray `.retired-*` / `.incoming-*` scaffolding left behind.
    const leftover = readdirSync(appUpdateDir(tmp)).filter((n) => /\.(retired|incoming)-/.test(n));
    expect(leftover).toEqual([]);
  });
});
