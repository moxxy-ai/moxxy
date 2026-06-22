import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateIdentity } from './node.js';

describe('loadOrCreateIdentity', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'proxy-id-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates a fresh identity, persists it 0600, and reloads the same one', async () => {
    const path = join(dir, 'proxy-identity.key');
    const first = await loadOrCreateIdentity(path);
    expect(first.secretKey.length).toBe(32);

    const mode = (await stat(path)).mode & 0o777;
    expect(mode).toBe(0o600);

    const second = await loadOrCreateIdentity(path);
    expect([...second.secretKey]).toEqual([...first.secretKey]);
    expect([...second.publicKey]).toEqual([...first.publicKey]);
  });

  it('regenerates if the stored key is malformed', async () => {
    const path = join(dir, 'proxy-identity.key');
    await loadOrCreateIdentity(path);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, 'garbage', 'utf8');
    const regenerated = await loadOrCreateIdentity(path);
    expect(regenerated.secretKey.length).toBe(32);
    expect((await readFile(path, 'utf8')).trim()).not.toBe('garbage');
  });
});
