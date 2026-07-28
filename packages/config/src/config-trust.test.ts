import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configTrustPath,
  hashConfigFile,
  isConfigTrusted,
  listTrustedConfigs,
  trustConfig,
  untrustConfig,
} from './config-trust.js';

describe('config trust store', () => {
  let home: string;
  let project: string;
  let configFile: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'moxxy-trust-home-'));
    project = await mkdtemp(join(tmpdir(), 'moxxy-trust-proj-'));
    prevHome = process.env.MOXXY_HOME;
    process.env.MOXXY_HOME = home;
    configFile = join(project, 'moxxy.config.ts');
    await writeFile(configFile, 'export default {}\n');
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.MOXXY_HOME;
    else process.env.MOXXY_HOME = prevHome;
    await rm(home, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  });

  it('starts untrusted', async () => {
    expect(await isConfigTrusted(configFile)).toBe(false);
  });

  it('trusts a file and remembers it', async () => {
    await trustConfig(configFile);
    expect(await isConfigTrusted(configFile)).toBe(true);
  });

  // The whole point of hashing content: approval covers the file somebody read,
  // so a later edit has to ask again. A path allow-list would silently
  // re-authorize whatever gets written there.
  it('revokes itself when the content changes', async () => {
    await trustConfig(configFile);
    await writeFile(configFile, 'export default { evil: true }\n');
    expect(await isConfigTrusted(configFile)).toBe(false);
  });

  it('re-trusting supersedes the old hash rather than accumulating entries', async () => {
    await trustConfig(configFile);
    await writeFile(configFile, 'export default { v: 2 }\n');
    await trustConfig(configFile);
    const entries = await listTrustedConfigs();
    expect(entries.filter((e) => e.path === configFile)).toHaveLength(1);
    expect(await isConfigTrusted(configFile)).toBe(true);
  });

  it('untrust removes the approval and reports whether it did', async () => {
    await trustConfig(configFile);
    expect(await untrustConfig(configFile)).toBe(true);
    expect(await isConfigTrusted(configFile)).toBe(false);
    expect(await untrustConfig(configFile)).toBe(false);
  });

  it('refuses to trust a file it cannot read', async () => {
    await expect(trustConfig(join(project, 'missing.ts'))).rejects.toThrow(/cannot read/);
  });

  // A store we cannot parse must read as "nothing is trusted", never as
  // "everything is trusted".
  it('treats a corrupt store as empty', async () => {
    await trustConfig(configFile);
    await writeFile(configTrustPath(), 'not json at all');
    expect(await isConfigTrusted(configFile)).toBe(false);
  });

  it('hashes file content, and returns null for a missing file', async () => {
    const hash = await hashConfigFile(configFile);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashConfigFile(join(project, 'nope.ts'))).toBeNull();
  });

  it('stores the trust file owner-only', async () => {
    if (process.platform === 'win32') return;
    await trustConfig(configFile);
    const { stat } = await import('node:fs/promises');
    expect((await stat(configTrustPath())).mode & 0o777).toBe(0o600);
  });
});
