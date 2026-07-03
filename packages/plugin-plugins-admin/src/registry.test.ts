import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkCapabilityManifest,
  fetchSignedRegistry,
  parseRegistryIndex,
  REGISTRY_CACHE_TTL_MS,
  resolveInstallSource,
  verifyRegistryIndex,
  type RegistryFetchLike,
} from './registry.js';
import { installPluginPackagePinned } from './install.js';
import { INSTALLABLE_PLUGIN_CATALOG } from './catalog.js';

// ---------------------------------------------------------------------------
// Test signing rig: an ephemeral Ed25519 keypair per suite. The production
// REGISTRY_PUBLIC_KEY constant stays '' (feature dormant); tests inject the
// ephemeral public key via the publicKeyPem opt.
// ---------------------------------------------------------------------------

let privateKey: KeyObject;
let publicKeyPem: string;

beforeEach(() => {
  const pair = generateKeyPairSync('ed25519');
  privateKey = pair.privateKey;
  publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
});

const VALID_INDEX = {
  version: 1,
  generatedAt: '2026-07-03T00:00:00Z',
  entries: [
    {
      id: 'telegram',
      label: 'Telegram channel',
      description: 'Chat with moxxy from Telegram.',
      packageName: '@moxxy/plugin-telegram',
      installSpec: '@moxxy/plugin-telegram',
      version: '0.26.0',
      provides: [{ category: 'channel', name: 'telegram' }],
      capabilities: { net: { mode: 'allowlist', hosts: ['api.telegram.org'] } },
    },
    {
      id: 'virtual-office',
      label: 'Virtual Office',
      description: 'Pixel-art UI.',
      packageName: '@moxxy/virtual-office-plugin',
      installSpec: 'github:moxxy-ai/virtual-office-plugin#main',
      version: '1.0.0',
    },
  ],
};

function signedIndex(index: unknown = VALID_INDEX): { bytes: Uint8Array; sig: string } {
  const bytes = new Uint8Array(Buffer.from(JSON.stringify(index), 'utf8'));
  const sig = cryptoSign(null, Buffer.from(bytes), privateKey).toString('base64');
  return { bytes, sig };
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(u8.byteLength);
  new Uint8Array(ab).set(u8);
  return ab;
}

/** Fetch stub serving `index.json` + `index.json.sig` from memory. */
function fetchServing(bytes: Uint8Array, sig: string): RegistryFetchLike {
  return async (url) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () =>
      url.endsWith('.sig') ? toArrayBuffer(new TextEncoder().encode(sig)) : toArrayBuffer(bytes),
    text: async () => (url.endsWith('.sig') ? sig : Buffer.from(bytes).toString('utf8')),
  });
}

let cacheDir: string;
beforeEach(() => {
  cacheDir = mkdtempSync(path.join(os.tmpdir(), 'mox-registry-'));
});
afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const cachePath = (): string => path.join(cacheDir, 'registry-cache.json');

// ---------------------------------------------------------------------------
// Verification + parsing
// ---------------------------------------------------------------------------

describe('verifyRegistryIndex / parseRegistryIndex', () => {
  it('a valid index verifies and parses', () => {
    const { bytes, sig } = signedIndex();
    expect(verifyRegistryIndex(bytes, sig, publicKeyPem)).toBe(true);
    const index = parseRegistryIndex(bytes);
    expect(index?.entries).toHaveLength(2);
    expect(index?.entries[0]?.version).toBe('0.26.0');
    expect(index?.entries[0]?.capabilities?.net).toEqual({
      mode: 'allowlist',
      hosts: ['api.telegram.org'],
    });
  });

  it('tampered index bytes are refused', () => {
    const { bytes, sig } = signedIndex();
    const tampered = Buffer.from(
      Buffer.from(bytes).toString('utf8').replace('0.26.0', '9.9.9'),
      'utf8',
    );
    expect(verifyRegistryIndex(tampered, sig, publicKeyPem)).toBe(false);
  });

  it('a bad or missing signature is refused', () => {
    const { bytes, sig } = signedIndex();
    expect(verifyRegistryIndex(bytes, '', publicKeyPem)).toBe(false);
    expect(verifyRegistryIndex(bytes, 'not-base64!!', publicKeyPem)).toBe(false);
    expect(verifyRegistryIndex(bytes, Buffer.from('junk').toString('base64'), publicKeyPem)).toBe(
      false,
    );
    // A signature from a DIFFERENT key must not verify.
    const other = generateKeyPairSync('ed25519');
    const otherSig = cryptoSign(null, Buffer.from(bytes), other.privateKey).toString('base64');
    expect(verifyRegistryIndex(bytes, otherSig, publicKeyPem)).toBe(false);
    expect(verifyRegistryIndex(bytes, sig, '')).toBe(false);
    expect(verifyRegistryIndex(bytes, sig, 'not a pem')).toBe(false);
  });

  it('schema-invalid entries refuse the whole index', () => {
    const bad = {
      ...VALID_INDEX,
      entries: [
        ...VALID_INDEX.entries,
        // version is a RANGE, not an exact pin → invalid.
        {
          id: 'evil',
          label: 'Evil',
          description: '',
          packageName: '@moxxy/plugin-evil',
          installSpec: '@moxxy/plugin-evil',
          version: '^1.0.0',
        },
      ],
    };
    expect(parseRegistryIndex(Buffer.from(JSON.stringify(bad), 'utf8'))).toBeUndefined();
    expect(parseRegistryIndex(Buffer.from('not json', 'utf8'))).toBeUndefined();
    expect(
      parseRegistryIndex(Buffer.from(JSON.stringify({ ...VALID_INDEX, version: 2 }), 'utf8')),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fetchSignedRegistry: source selection + fallback semantics
// ---------------------------------------------------------------------------

describe('fetchSignedRegistry', () => {
  it('empty baked key short-circuits to fallback without touching the network', async () => {
    const fetchImpl = vi.fn();
    // No publicKeyPem override → the baked REGISTRY_PUBLIC_KEY ('') applies.
    const res = await fetchSignedRegistry({ fetch: fetchImpl, cacheDir });
    expect(res.source).toBe('fallback');
    expect(res.reason?.code).toBe('key-not-provisioned');
    expect(res.entries).toEqual(INSTALLABLE_PLUGIN_CATALOG);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a valid remote index is returned as source remote and cached', async () => {
    const { bytes, sig } = signedIndex();
    const res = await fetchSignedRegistry({
      fetch: fetchServing(bytes, sig),
      cacheDir,
      publicKeyPem,
    });
    expect(res.source).toBe('remote');
    expect(res.reason).toBeUndefined();
    expect(res.entries.map((e) => e.id)).toEqual(['telegram', 'virtual-office']);
    expect(res.entries[0]?.version).toBe('0.26.0');
    const cached = JSON.parse(readFileSync(cachePath(), 'utf8'));
    expect(cached.sig).toBe(sig);
    expect(Buffer.from(cached.indexB64, 'base64')).toEqual(Buffer.from(bytes));
  });

  it('a fresh cache is reused without a network fetch, and re-verified on read', async () => {
    const { bytes, sig } = signedIndex();
    const t0 = 1_000_000;
    await fetchSignedRegistry({
      fetch: fetchServing(bytes, sig),
      cacheDir,
      publicKeyPem,
      now: () => t0,
    });
    const fetchImpl = vi.fn();
    const res = await fetchSignedRegistry({
      fetch: fetchImpl,
      cacheDir,
      publicKeyPem,
      now: () => t0 + REGISTRY_CACHE_TTL_MS - 1,
    });
    expect(res.source).toBe('cache');
    expect(res.entries[0]?.id).toBe('telegram');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('an expired cache re-fetches remote', async () => {
    const { bytes, sig } = signedIndex();
    const t0 = 1_000_000;
    await fetchSignedRegistry({
      fetch: fetchServing(bytes, sig),
      cacheDir,
      publicKeyPem,
      now: () => t0,
    });
    const fetchImpl = vi.fn(fetchServing(bytes, sig));
    const res = await fetchSignedRegistry({
      fetch: fetchImpl,
      cacheDir,
      publicKeyPem,
      now: () => t0 + REGISTRY_CACHE_TTL_MS + 1,
    });
    expect(res.source).toBe('remote');
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('a tampered cache is discarded (never trusted), and remote is fetched', async () => {
    const { bytes, sig } = signedIndex();
    const t0 = 1_000_000;
    await fetchSignedRegistry({
      fetch: fetchServing(bytes, sig),
      cacheDir,
      publicKeyPem,
      now: () => t0,
    });
    // Tamper: swap the cached index bytes for a different (unsigned) payload
    // while keeping the original signature and a fresh timestamp.
    const cached = JSON.parse(readFileSync(cachePath(), 'utf8'));
    const evil = { ...VALID_INDEX, entries: [] };
    cached.indexB64 = Buffer.from(JSON.stringify(evil), 'utf8').toString('base64');
    writeFileSync(cachePath(), JSON.stringify(cached));
    const fetchImpl = vi.fn(fetchServing(bytes, sig));
    const res = await fetchSignedRegistry({
      fetch: fetchImpl,
      cacheDir,
      publicKeyPem,
      now: () => t0 + 1, // well within TTL — only the tamper check can reject it
    });
    expect(res.source).toBe('remote');
    expect(res.entries).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('a future cache timestamp is treated as stale, not fresh', async () => {
    const { bytes, sig } = signedIndex();
    await fetchSignedRegistry({
      fetch: fetchServing(bytes, sig),
      cacheDir,
      publicKeyPem,
      now: () => 5_000_000, // cache stamped "in the future" relative to the next read
    });
    const fetchImpl = vi.fn(fetchServing(bytes, sig));
    const res = await fetchSignedRegistry({
      fetch: fetchImpl,
      cacheDir,
      publicKeyPem,
      now: () => 1_000, // clock says the cache is from the future
    });
    expect(res.source).toBe('remote');
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('a bad remote signature falls back to the hardcoded catalog', async () => {
    const { bytes } = signedIndex();
    const other = generateKeyPairSync('ed25519');
    const wrongSig = cryptoSign(null, Buffer.from(bytes), other.privateKey).toString('base64');
    const res = await fetchSignedRegistry({
      fetch: fetchServing(bytes, wrongSig),
      cacheDir,
      publicKeyPem,
    });
    expect(res.source).toBe('fallback');
    expect(res.reason?.code).toBe('bad-signature');
    expect(res.entries).toEqual(INSTALLABLE_PLUGIN_CATALOG);
  });

  it('a signed-but-schema-invalid remote index falls back', async () => {
    const { bytes, sig } = signedIndex({ ...VALID_INDEX, version: 99 });
    const res = await fetchSignedRegistry({
      fetch: fetchServing(bytes, sig),
      cacheDir,
      publicKeyPem,
    });
    expect(res.source).toBe('fallback');
    expect(res.reason?.code).toBe('invalid-schema');
  });

  it('network errors and non-2xx responses fall back, never throw', async () => {
    const boom: RegistryFetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    const res1 = await fetchSignedRegistry({ fetch: boom, cacheDir, publicKeyPem });
    expect(res1.source).toBe('fallback');
    expect(res1.reason?.code).toBe('network-error');

    const notFound: RegistryFetchLike = async () => ({
      ok: false,
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => '',
    });
    const res2 = await fetchSignedRegistry({ fetch: notFound, cacheDir, publicKeyPem });
    expect(res2.source).toBe('fallback');
    expect(res2.reason?.code).toBe('http-error');
  });

  it('MOXXY_REGISTRY_URL overrides the fetch URL (signature still required)', async () => {
    vi.stubEnv('MOXXY_REGISTRY_URL', 'https://example.test/custom.json');
    const { bytes, sig } = signedIndex();
    const seen: string[] = [];
    const fetchImpl: RegistryFetchLike = async (url, init) => {
      seen.push(url);
      return fetchServing(bytes, sig)(url, init);
    };
    const res = await fetchSignedRegistry({ fetch: fetchImpl, cacheDir, publicKeyPem });
    expect(res.source).toBe('remote');
    expect(seen).toEqual([
      'https://example.test/custom.json',
      'https://example.test/custom.json.sig',
    ]);
  });
});

// ---------------------------------------------------------------------------
// resolveInstallSource
// ---------------------------------------------------------------------------

describe('resolveInstallSource', () => {
  it('a signed entry wins and carries the exact version pin', async () => {
    const { bytes, sig } = signedIndex();
    const resolved = await resolveInstallSource('telegram', {
      fetch: fetchServing(bytes, sig),
      cacheDir,
      publicKeyPem,
    });
    expect(resolved.origin).toBe('signed');
    expect(resolved.spec).toBe('@moxxy/plugin-telegram');
    expect(resolved.pinnedVersion).toBe('0.26.0');
    expect(resolved.capabilities?.net).toEqual({
      mode: 'allowlist',
      hosts: ['api.telegram.org'],
    });
  });

  it('matches signed entries by package name too', async () => {
    const { bytes, sig } = signedIndex();
    const resolved = await resolveInstallSource('@moxxy/plugin-telegram', {
      fetch: fetchServing(bytes, sig),
      cacheDir,
      publicKeyPem,
    });
    expect(resolved.origin).toBe('signed');
    expect(resolved.pinnedVersion).toBe('0.26.0');
  });

  it('a signed git installSpec is never version-pinned', async () => {
    const { bytes, sig } = signedIndex();
    const resolved = await resolveInstallSource('virtual-office', {
      fetch: fetchServing(bytes, sig),
      cacheDir,
      publicKeyPem,
    });
    expect(resolved.origin).toBe('signed');
    expect(resolved.spec).toBe('github:moxxy-ai/virtual-office-plugin#main');
    expect(resolved.pinnedVersion).toBeUndefined();
  });

  it('falls back to the hardcoded catalog when the key is unprovisioned', async () => {
    const fetchImpl = vi.fn();
    const resolved = await resolveInstallSource('telegram', { fetch: fetchImpl, cacheDir });
    expect(resolved.origin).toBe('catalog');
    expect(resolved.spec).toBe('@moxxy/plugin-telegram');
    expect(resolved.pinnedVersion).toBeUndefined();
    expect(resolved.registryFallback?.code).toBe('key-not-provisioned');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('passes unknown raw specs through untouched', async () => {
    const resolved = await resolveInstallSource('some-third-party-pkg', { cacheDir });
    expect(resolved.origin).toBe('spec');
    expect(resolved.spec).toBe('some-third-party-pkg');
    expect(resolved.pinnedVersion).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Pin precedence: user > signed > cliVersion > latest
// ---------------------------------------------------------------------------

describe('pin precedence (installPluginPackagePinned + pinnedVersion)', () => {
  const okInstall = (spec: string) => ({ installed: spec, dir: '/p' });

  it('explicit user version beats the signed pin', async () => {
    const installFn = vi.fn(async (o: { packageName: string }) => okInstall(o.packageName));
    await installPluginPackagePinned({
      packageName: '@moxxy/plugin-telegram',
      version: '0.9.0',
      pinnedVersion: '0.26.0',
      cliVersion: '0.25.0',
      installFn,
    });
    expect(installFn).toHaveBeenCalledWith(
      expect.objectContaining({ packageName: '@moxxy/plugin-telegram@0.9.0' }),
    );
  });

  it('the signed pin beats cliVersion lockstep', async () => {
    const installFn = vi.fn(async (o: { packageName: string }) => okInstall(o.packageName));
    await installPluginPackagePinned({
      packageName: '@moxxy/plugin-telegram',
      pinnedVersion: '0.26.0',
      cliVersion: '0.25.0',
      installFn,
    });
    expect(installFn).toHaveBeenCalledWith(
      expect.objectContaining({ packageName: '@moxxy/plugin-telegram@0.26.0' }),
    );
  });

  it('without a signed pin, cliVersion lockstep applies as before', async () => {
    const installFn = vi.fn(async (o: { packageName: string }) => okInstall(o.packageName));
    await installPluginPackagePinned({
      packageName: '@moxxy/plugin-telegram',
      cliVersion: '0.25.0',
      installFn,
    });
    expect(installFn).toHaveBeenCalledWith(
      expect.objectContaining({ packageName: '@moxxy/plugin-telegram@0.25.0' }),
    );
  });

  it('a signed pin applies to non-first-party packages too', async () => {
    const installFn = vi.fn(async (o: { packageName: string }) => okInstall(o.packageName));
    await installPluginPackagePinned({
      packageName: 'third-party-pkg',
      pinnedVersion: '2.0.0',
      cliVersion: '0.25.0',
      installFn,
    });
    expect(installFn).toHaveBeenCalledWith(
      expect.objectContaining({ packageName: 'third-party-pkg@2.0.0' }),
    );
  });

  it('a signed pin is ignored for specs that already carry a version or are git/path-like', async () => {
    const installFn = vi.fn(async (o: { packageName: string }) => okInstall(o.packageName));
    await installPluginPackagePinned({
      packageName: '@moxxy/plugin-x@2.0.0',
      pinnedVersion: '1.0.0',
      installFn,
    });
    expect(installFn).toHaveBeenCalledWith(
      expect.objectContaining({ packageName: '@moxxy/plugin-x@2.0.0' }),
    );
    await installPluginPackagePinned({
      packageName: 'github:moxxy-ai/x#main',
      pinnedVersion: '1.0.0',
      installFn,
    });
    expect(installFn).toHaveBeenLastCalledWith(
      expect.objectContaining({ packageName: 'github:moxxy-ai/x#main' }),
    );
  });

  it('a signed pin that 404s retries unpinned with a warning (availability-first v1)', async () => {
    const installFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('npm install failed (exit 1): 404 Not Found'))
      .mockResolvedValueOnce({ installed: '@moxxy/plugin-telegram', dir: '/p' });
    const onWarn = vi.fn();
    const res = await installPluginPackagePinned({
      packageName: '@moxxy/plugin-telegram',
      pinnedVersion: '0.26.0',
      installFn,
      onWarn,
    });
    expect(installFn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ packageName: '@moxxy/plugin-telegram@0.26.0' }),
    );
    expect(installFn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ packageName: '@moxxy/plugin-telegram' }),
    );
    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(res.installed).toBe('@moxxy/plugin-telegram');
  });
});

// ---------------------------------------------------------------------------
// Capability-manifest comparison: fires ONLY on widening
// ---------------------------------------------------------------------------

describe('checkCapabilityManifest', () => {
  const declared = {
    net: { mode: 'allowlist' as const, hosts: ['api.telegram.org'] },
    fs: { read: ['$cwd/**'] },
    subprocess: true,
    commands: ['npm'],
  };

  it('no mismatch when the actual surface equals the manifest', () => {
    const check = checkCapabilityManifest(declared, declared);
    expect(check.capabilityMismatch).toBe(false);
    expect(check.widened).toEqual([]);
  });

  it('no mismatch when the actual surface is NARROWER', () => {
    const check = checkCapabilityManifest(declared, {
      net: { mode: 'allowlist', hosts: ['api.telegram.org'] },
    });
    expect(check.capabilityMismatch).toBe(false);
  });

  it('net widening: any > allowlist, extra hosts, and net vs none', () => {
    expect(
      checkCapabilityManifest(declared, { net: { mode: 'any' } }).capabilityMismatch,
    ).toBe(true);
    const extraHost = checkCapabilityManifest(declared, {
      net: { mode: 'allowlist', hosts: ['api.telegram.org', 'evil.example'] },
    });
    expect(extraHost.capabilityMismatch).toBe(true);
    expect(extraHost.widened.join(' ')).toContain('evil.example');
    expect(
      checkCapabilityManifest({}, { net: { mode: 'allowlist', hosts: ['x'] } })
        .capabilityMismatch,
    ).toBe(true);
  });

  it('fs / env / subprocess widening is reported', () => {
    expect(
      checkCapabilityManifest(declared, { fs: { read: ['$cwd/**'], write: ['/etc/**'] } })
        .capabilityMismatch,
    ).toBe(true);
    expect(checkCapabilityManifest({}, { env: ['AWS_SECRET'] }).capabilityMismatch).toBe(true);
    expect(checkCapabilityManifest({}, { subprocess: true }).capabilityMismatch).toBe(true);
  });

  it('command widening: extra commands and unrestricted-vs-allowlist', () => {
    const extra = checkCapabilityManifest(declared, { subprocess: true, commands: ['npm', 'curl'] });
    expect(extra.capabilityMismatch).toBe(true);
    expect(extra.widened.join(' ')).toContain('curl');
    // No command list under subprocess:true = unrestricted → wider than ['npm'].
    const unrestricted = checkCapabilityManifest(declared, { subprocess: true });
    expect(unrestricted.capabilityMismatch).toBe(true);
    // But an unrestricted manifest accepts any command list.
    expect(
      checkCapabilityManifest({ subprocess: true }, { subprocess: true, commands: ['rm'] })
        .capabilityMismatch,
    ).toBe(false);
  });

  it('budget widening: exceeding or dropping a declared ceiling', () => {
    expect(
      checkCapabilityManifest({ timeMs: 1000 }, { timeMs: 2000 }).capabilityMismatch,
    ).toBe(true);
    expect(checkCapabilityManifest({ timeMs: 1000 }, {}).capabilityMismatch).toBe(true);
    expect(
      checkCapabilityManifest({ timeMs: 1000 }, { timeMs: 500 }).capabilityMismatch,
    ).toBe(false);
    expect(checkCapabilityManifest({}, { timeMs: 500 }).capabilityMismatch).toBe(false);
  });
});
