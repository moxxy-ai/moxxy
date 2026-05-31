import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

import { buildAppBundle } from './build';
import { checkForUpdate, downloadAndStage, isAllowedUpdateHost } from './stager';
import { bundleRoot, type ShellInfo } from './resolve';

const SHELL: ShellInfo = { electron: '33.4.11', nodeAbi: '115' };
const keys = generateKeyPairSync('ed25519');
const PUBKEY = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PRIVKEY = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'app-stager-'));
});

describe('isAllowedUpdateHost', () => {
  it('allows GitHub + its release-asset CDN over https only', () => {
    expect(isAllowedUpdateHost('https://github.com/o/r/releases/latest/download/m.json')).toBe(true);
    expect(isAllowedUpdateHost('https://objects.githubusercontent.com/x')).toBe(true);
    expect(isAllowedUpdateHost('https://release-assets.githubusercontent.com/x')).toBe(true);
    expect(isAllowedUpdateHost('https://codeload.github.com/x')).toBe(true);
  });

  it('rejects other hosts, http, and junk', () => {
    expect(isAllowedUpdateHost('https://evil.test/m.json')).toBe(false);
    expect(isAllowedUpdateHost('https://github.com.evil.test/m.json')).toBe(false);
    expect(isAllowedUpdateHost('http://github.com/x')).toBe(false);
    expect(isAllowedUpdateHost('not a url')).toBe(false);
  });
});

describe('checkForUpdate guards', () => {
  it('returns "no update" without ever fetching a non-allowlisted manifest URL', async () => {
    let fetched = false;
    const fetchImpl = (async () => {
      fetched = true;
      return new Response('{}');
    }) as unknown as typeof fetch;
    const res = await checkForUpdate(
      { manifestUrl: 'https://evil.test/m.json', currentVersion: '0.0.5', publicKeyPem: PUBKEY, shell: SHELL },
      { fetchImpl },
    );
    expect(res.available).toBe(false);
    expect(fetched).toBe(false);
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
});
