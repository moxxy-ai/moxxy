import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPolicyBundles, PolicyLoadError } from './policy-source.js';

const URL_A = 'https://policy.example/corp.json';

const keys = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    pem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    sign: (b: Uint8Array) => cryptoSign(null, Buffer.from(b), privateKey).toString('base64'),
  };
};

const body = (revision: string, deny: string[] = ['Bash']): Uint8Array =>
  new Uint8Array(
    Buffer.from(
      JSON.stringify({
        version: 1,
        id: 'corp',
        revision,
        permissions: { deny: deny.map((name) => ({ name })) },
      }),
    ),
  );

/** A fetch that serves `bytes`/`sig`, or fails every request when given null. */
const serving = (pairs: Record<string, { bytes: Uint8Array; sig: string } | null>) =>
  (async (url: string) => {
    const base = url.endsWith('.sig') ? url.slice(0, -4) : url;
    const entry = pairs[base];
    if (!entry) return { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0), text: async () => '' };
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => entry.bytes.buffer.slice(entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength) as ArrayBuffer,
      text: async () => entry.sig,
    };
  }) as never;

describe('loadPolicyBundles', () => {
  let cacheDir: string;
  const k = keys();
  const ref = { id: 'corp', url: URL_A, publicKey: k.pem };

  beforeEach(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-policy-'));
  });
  afterEach(async () => {
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  it('returns nothing when no bundle is configured, without touching the network', async () => {
    const loaded = await loadPolicyBundles([], { cacheDir, fetch: serving({}) });

    expect(loaded.deny).toEqual([]);
    expect(loaded.sources).toEqual([]);
  });

  it('fetches, verifies and reports the revision in force', async () => {
    const bytes = body('r1');
    const loaded = await loadPolicyBundles([ref], {
      cacheDir,
      fetch: serving({ [URL_A]: { bytes, sig: k.sign(bytes) } }),
    });

    expect(loaded.deny).toEqual([{ name: 'Bash' }]);
    expect(loaded.sources).toEqual([
      { id: 'corp', revision: 'r1', url: URL_A, from: 'remote' },
    ]);
  });

  it('refuses to start when the bundle is unreachable and was never cached', async () => {
    // The condition the feature exists to prevent: a host running without the
    // rules it subscribes to, and no way to tell from the outside.
    await expect(
      loadPolicyBundles([ref], { cacheDir, fetch: serving({ [URL_A]: null }) }),
    ).rejects.toBeInstanceOf(PolicyLoadError);
  });

  it('carries on from a verified cache when the remote is down, and says so', async () => {
    const bytes = body('r1');
    await loadPolicyBundles([ref], {
      cacheDir,
      fetch: serving({ [URL_A]: { bytes, sig: k.sign(bytes) } }),
    });

    const offline = await loadPolicyBundles([ref], {
      cacheDir,
      fetch: serving({ [URL_A]: null }),
    });

    expect(offline.deny).toEqual([{ name: 'Bash' }]);
    expect(offline.sources[0]?.from).toBe('cache');
    expect(offline.sources[0]?.staleReason).toContain('503');
  });

  it('keeps a verified pre-0.38 policy cache usable during an offline upgrade', async () => {
    const bytes = body('r1');
    const signature = k.sign(bytes);
    await loadPolicyBundles([ref], {
      cacheDir,
      fetch: serving({ [URL_A]: { bytes, sig: signature } }),
    });
    const [file] = await fs.readdir(cacheDir);
    if (file === undefined) throw new Error('expected a policy cache file');
    await fs.writeFile(
      path.join(cacheDir, file),
      JSON.stringify({ bytes: Buffer.from(bytes).toString('base64'), sig: signature }),
    );

    const offline = await loadPolicyBundles([ref], {
      cacheDir,
      fetch: serving({ [URL_A]: null }),
    });
    expect(offline.sources[0]?.from).toBe('cache');
    expect(offline.deny).toEqual([{ name: 'Bash' }]);
  });

  it('discards a cache that was edited on disk', async () => {
    const bytes = body('r1');
    await loadPolicyBundles([ref], {
      cacheDir,
      fetch: serving({ [URL_A]: { bytes, sig: k.sign(bytes) } }),
    });

    // Rewrite the cached rules while keeping the signature that covered the
    // originals. A local edit must be worth nothing.
    const [file] = await fs.readdir(cacheDir);
    if (file === undefined) throw new Error('expected a policy cache file');
    const cached = JSON.parse(await fs.readFile(path.join(cacheDir, file), 'utf8'));
    cached.payloadB64 = Buffer.from(body('r1', [])).toString('base64');
    await fs.writeFile(path.join(cacheDir, file), JSON.stringify(cached));

    await expect(
      loadPolicyBundles([ref], { cacheDir, fetch: serving({ [URL_A]: null }) }),
    ).rejects.toBeInstanceOf(PolicyLoadError);
  });

  it('does not fall back to cache when the remote serves a badly signed bundle', async () => {
    const good = body('r1');
    await loadPolicyBundles([ref], {
      cacheDir,
      fetch: serving({ [URL_A]: { bytes: good, sig: k.sign(good) } }),
    });

    // Otherwise anyone who can answer for the URL pins the fleet to an old
    // revision indefinitely by serving garbage.
    const attacker = keys();
    const forged = body('r2', ['nothing']);
    await expect(
      loadPolicyBundles([ref], {
        cacheDir,
        fetch: serving({ [URL_A]: { bytes: forged, sig: attacker.sign(forged) } }),
      }),
    ).rejects.toBeInstanceOf(PolicyLoadError);
  });

  it('merges rules from several bundles', async () => {
    const urlB = 'https://policy.example/team.json';
    const a = body('r1', ['Bash']);
    const b = new Uint8Array(
      Buffer.from(
        JSON.stringify({
          version: 1,
          id: 'team',
          revision: 'r9',
          permissions: { allow: [{ name: 'Read' }] },
        }),
      ),
    );

    const loaded = await loadPolicyBundles(
      [ref, { id: 'team', url: urlB, publicKey: k.pem }],
      {
        cacheDir,
        fetch: serving({
          [URL_A]: { bytes: a, sig: k.sign(a) },
          [urlB]: { bytes: b, sig: k.sign(b) },
        }),
      },
    );

    expect(loaded.deny).toEqual([{ name: 'Bash' }]);
    expect(loaded.allow).toEqual([{ name: 'Read' }]);
    expect(loaded.sources.map((s) => s.id)).toEqual(['corp', 'team']);
  });
});
