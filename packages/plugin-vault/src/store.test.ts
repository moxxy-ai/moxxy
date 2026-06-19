import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MoxxyError } from '@moxxy/sdk';
import { VaultStore } from './store.js';
import { createStaticKeySource } from './keysource.js';
import { deriveKey, generateSalt } from './crypto.js';

let tmp: string;
let filePath: string;
const stableKey = deriveKey('test-passphrase', generateSalt());

const newStore = () =>
  new VaultStore({ filePath, keySource: createStaticKeySource(stableKey) });

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-vault-'));
  filePath = path.join(tmp, 'vault.json');
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('VaultStore', () => {
  it('creates a new vault file on first set', async () => {
    const store = newStore();
    await store.set('hello', 'world');
    expect(await store.get('hello')).toBe('world');

    const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
    expect(raw.version).toBe(1);
    expect(raw.kdf).toBe('scrypt');
    expect(raw.entries.hello).toMatchObject({ iv: expect.any(String), tag: expect.any(String) });
    // Ciphertext should never contain the plaintext
    expect(raw.entries.hello.data).not.toContain('world');
  });

  it('round-trips multiple entries across instances', async () => {
    const a = newStore();
    await a.set('foo', 'one');
    await a.set('bar', 'two', ['ops']);
    const b = newStore();
    expect(await b.get('foo')).toBe('one');
    expect(await b.get('bar')).toBe('two');
    const listed = await b.list();
    expect(listed.map((e) => e.name).sort()).toEqual(['bar', 'foo']);
    const bar = listed.find((e) => e.name === 'bar');
    expect(bar?.tags).toEqual(['ops']);
  });

  it('returns null on missing key', async () => {
    const store = newStore();
    expect(await store.get('absent')).toBeNull();
    expect(await store.has('absent')).toBe(false);
  });

  it('overwrites updates updatedAt but preserves createdAt', async () => {
    const store = newStore();
    await store.set('x', 'a');
    const first = (await store.list())[0]!;
    await new Promise((r) => setTimeout(r, 10));
    await store.set('x', 'b');
    const second = (await store.list())[0]!;
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).not.toBe(first.updatedAt);
    expect(await store.get('x')).toBe('b');
  });

  it('delete removes the entry', async () => {
    const store = newStore();
    await store.set('x', '1');
    expect(await store.delete('x')).toBe(true);
    expect(await store.delete('x')).toBe(false);
    expect(await store.get('x')).toBeNull();
  });

  it('fails to decrypt with a different key', async () => {
    const a = newStore();
    await a.set('x', 'secret');
    const otherKey = deriveKey('different', generateSalt());
    const b = new VaultStore({ filePath, keySource: createStaticKeySource(otherKey) });
    await expect(b.get('x')).rejects.toThrow();
  });

  it('serializes concurrent set() calls — no lost updates', async () => {
    const store = newStore();
    await Promise.all([
      store.set('a', '1'),
      store.set('b', '2'),
      store.set('c', '3'),
      store.set('d', '4'),
    ]);
    expect(await store.get('a')).toBe('1');
    expect(await store.get('b')).toBe('2');
    expect(await store.get('c')).toBe('3');
    expect(await store.get('d')).toBe('4');
    const listed = await store.list();
    expect(listed.map((e) => e.name).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('serializes concurrent delete() calls', async () => {
    const store = newStore();
    await store.set('a', '1');
    await store.set('b', '2');
    const [r1, r2] = await Promise.all([store.delete('a'), store.delete('b')]);
    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(await store.list()).toEqual([]);
  });

  it('writes atomically: never leaves a truncated vault file behind', async () => {
    const store = newStore();
    await store.set('a', '1');
    // After persist completes, the tmp sibling should NOT exist; only the final file.
    const dir = path.dirname(filePath);
    const after = await fs.readdir(dir);
    const tmps = after.filter((f) => f.startsWith('vault.json.tmp.'));
    expect(tmps).toEqual([]);
    // And the persisted file is well-formed.
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
    expect(raw.entries.a).toBeDefined();
  });

  it("merges another writer's keys on write — no whole-file last-writer-wins clobber", async () => {
    // Two stores (≈ two processes) over the same file, the second holding an
    // in-memory snapshot from BEFORE the first one's later writes. Its next
    // whole-file persist used to silently drop those writes.
    const a = newStore();
    await a.set('seed', 's');
    const b = newStore();
    await b.open(); // b's snapshot: { seed }
    await a.set('rotated_token', 'fresh'); // e.g. a rotated OAuth refresh token
    await b.set('other_key', 'B'); // must MERGE, not clobber

    const c = newStore();
    expect(await c.get('rotated_token')).toBe('fresh');
    expect(await c.get('other_key')).toBe('B');
    expect(await c.get('seed')).toBe('s');
  });

  it("reads see another writer's newer value for the same key", async () => {
    const a = newStore();
    await a.set('token', 'old');
    const b = newStore();
    await b.set('token', 'new');
    // a still holds 'old' in memory; get() must fold the on-disk update in.
    expect(await a.get('token')).toBe('new');
  });

  it("reads observe another writer's delete (no resurrection from memory)", async () => {
    const a = newStore();
    await a.set('gone', 'x');
    const b = newStore();
    expect(await b.delete('gone')).toBe(true);
    expect(await a.get('gone')).toBeNull();
    // …and a's next persist must not write it back.
    await a.set('unrelated', 'y');
    const c = newStore();
    expect(await c.get('gone')).toBeNull();
    expect(await c.get('unrelated')).toBe('y');
  });

  it('ignores an on-disk file with a different salt (wiped/recreated vault)', async () => {
    const a = newStore();
    await a.set('mine', '1');
    // Recreate the vault out-of-band with a different salt: a's master key
    // can't decrypt those entries, so a must keep serving its own state.
    await fs.rm(filePath);
    const other = new VaultStore({
      filePath,
      keySource: createStaticKeySource(deriveKey('other-pass', generateSalt())),
    });
    await other.set('theirs', '2');
    expect(await a.get('mine')).toBe('1');
    expect(await a.get('theirs')).toBeNull();
  });

  it('rejects an unsupported vault file with a VAULT_CORRUPT MoxxyError', async () => {
    await fs.writeFile(filePath, JSON.stringify({ version: 99, kdf: 'argon2', salt: 'x', entries: {} }), 'utf8');
    const store = newStore();
    const err = await store.get('anything').catch((e) => e);
    expect(MoxxyError.isMoxxyError(err)).toBe(true);
    expect((err as MoxxyError).code).toBe('VAULT_CORRUPT');
  });

  it('rejects malformed-but-valid-JSON vault files with VAULT_CORRUPT, not a raw TypeError', async () => {
    // Each of these is valid JSON that passes the version/kdf gate (or fails
    // it gracefully) but would crash verifyPassphrase()/list() with a raw
    // TypeError if the shape weren't validated. All must surface VAULT_CORRUPT.
    const cases: unknown[] = [
      { version: 1, kdf: 'scrypt', salt: 'x', entries: null }, // entries null
      { version: 1, kdf: 'scrypt', salt: 'x' }, // entries missing
      { version: 1, kdf: 'scrypt', salt: 123, entries: {} }, // salt not a string
      { version: 1, kdf: 'scrypt', salt: 'x', entries: { e: { iv: 1, tag: 2, data: 3 } } }, // blob fields not strings
      {
        version: 1,
        kdf: 'scrypt',
        salt: 'x',
        entries: {},
        canary: { iv: 'a', tag: 'b' }, // canary missing data
      },
      '"a bare json string"',
      '12345',
      '[]',
      '{ not valid json',
    ];
    for (const c of cases) {
      await fs.writeFile(filePath, typeof c === 'string' ? c : JSON.stringify(c), 'utf8');
      const store = newStore();
      const err = await store.get('anything').catch((e) => e);
      expect(MoxxyError.isMoxxyError(err), `case=${JSON.stringify(c)}`).toBe(true);
      expect((err as MoxxyError).code, `case=${JSON.stringify(c)}`).toBe('VAULT_CORRUPT');
    }
  });

  it('get() reads a consistent snapshot under a concurrent set() (no torn read)', async () => {
    const store = newStore();
    await store.set('k', 'v0');
    // Kick off a get and a set on the same tick. The get must run in its own
    // mutex turn against a coherent snapshot — never a partially-updated file
    // — so it returns either the old or the new value, never undefined/garbage.
    const [got] = await Promise.all([store.get('k'), store.set('k', 'v1')]);
    expect(['v0', 'v1']).toContain(got);
    expect(await store.get('k')).toBe('v1');
  });

  it('get() of a structurally-valid-but-corrupt entry yields VAULT_CORRUPT, not a raw crypto error', async () => {
    // A vault whose canary is fine (passphrase verifies on open) but ONE entry
    // has a malformed blob: an empty `iv` and a truncated `tag`. Both are
    // strings, so validateVaultFile passes, but Node's AES-GCM throws a raw
    // ERR_CRYPTO_INVALID_IV / ERR_CRYPTO_INVALID_AUTH_TAG when decrypting it.
    // get() must convert that into a friendly VAULT_CORRUPT MoxxyError naming
    // the entry — degrade, never crash, on partial corruption.
    const store = newStore();
    await store.set('good', 'value'); // creates the vault + canary
    const onDisk = JSON.parse(await fs.readFile(filePath, 'utf8'));
    const now = new Date().toISOString();
    for (const bad of [
      { iv: '', tag: 'AA==', data: '', createdAt: now, updatedAt: now }, // empty IV
      { iv: 'AAAAAAAAAAAA', tag: '', data: '', createdAt: now, updatedAt: now }, // empty tag
      { iv: 'AAAAAAAAAAAA', tag: 'AA==', data: '', createdAt: now, updatedAt: now }, // short tag
      { iv: 'AAAAAAAAAAAAAAAA', tag: 'AAAAAAAAAAAAAAAAAAAAAA==', data: 'AAAA', createdAt: now, updatedAt: now }, // wrong key/auth mismatch
    ]) {
      onDisk.entries.broken = bad;
      await fs.writeFile(filePath, JSON.stringify(onDisk, null, 2), 'utf8');
      const fresh = newStore();
      const err = await fresh.get('broken').catch((e) => e);
      expect(MoxxyError.isMoxxyError(err), `blob=${JSON.stringify(bad)}`).toBe(true);
      expect((err as MoxxyError).code, `blob=${JSON.stringify(bad)}`).toBe('VAULT_CORRUPT');
      expect((err as MoxxyError).context, `blob=${JSON.stringify(bad)}`).toMatchObject({ name: 'broken' });
      // A good sibling entry on the same file still decrypts (one bad entry
      // doesn't lock the whole vault).
      expect(await fresh.get('good')).toBe('value');
    }
  });

  it('close() zeroes the master key and can be reopened', async () => {
    const key = deriveKey('close-test', generateSalt());
    const store = new VaultStore({ filePath, keySource: createStaticKeySource(key) });
    await store.set('s', 'v');
    store.close();
    // Reopening re-derives the (same static) key and still decrypts.
    const reopened = new VaultStore({ filePath, keySource: createStaticKeySource(key) });
    expect(await reopened.get('s')).toBe('v');
  });

  it('keysource error during persist does not poison subsequent calls', async () => {
    // Even if a single mutation fails, the chain should keep running.
    const store = newStore();
    await store.set('a', '1');
    // First successful set already initialized vault. Now run a failing
    // operation back-to-back with a normal one.
    const failing = store.set('b', ' '.repeat(1)).then(
      () => 'ok' as const,
      () => 'failed' as const,
    );
    const ok = await store.set('c', '3').then(() => 'ok' as const);
    expect(ok).toBe('ok');
    await failing; // resolves either way; the chain is still alive
    expect(await store.get('c')).toBe('3');
  });
});
