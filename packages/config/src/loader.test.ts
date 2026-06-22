import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig } from './loader.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-config-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('returns empty config when no file is found', async () => {
    const result = await loadConfig({ cwd: tmp, skipUser: true });
    expect(result.config).toEqual({});
    expect(result.sources).toEqual([]);
  });

  it('loads a moxxy.config.js from cwd', async () => {
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.js'),
      `export default { provider: { name: 'anthropic', model: 'sonnet' } };`,
    );
    const result = await loadConfig({ cwd: tmp, skipUser: true });
    expect(result.config.provider?.name).toBe('anthropic');
    expect(result.config.provider?.model).toBe('sonnet');
    expect(result.sources[0]?.scope).toBe('project');
  });

  it('walks upward to find moxxy.config.js', async () => {
    const nested = path.join(tmp, 'a/b/c');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.js'),
      `export default { mode: 'default' };`,
    );
    const result = await loadConfig({ cwd: nested, skipUser: true });
    expect(result.config.mode).toBe('default');
  });

  it('honors explicitPath over upward search', async () => {
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.js'),
      `export default { mode: 'default' };`,
    );
    const custom = path.join(tmp, 'custom.config.js');
    await fs.writeFile(custom, `export default { mode: 'research' };`);
    const result = await loadConfig({ cwd: tmp, explicitPath: custom, skipUser: true });
    expect(result.config.mode).toBe('research');
    expect(result.sources[0]?.scope).toBe('explicit');
  });

  it('rejects a config whose schema is invalid', async () => {
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.js'),
      `export default { provider: { name: 42 } };`,
    );
    await expect(loadConfig({ cwd: tmp, skipUser: true })).rejects.toThrow(/Invalid moxxy config/);
  });

  it('rejects a config with no default export', async () => {
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.js'),
      `export const config = {};`,
    );
    await expect(loadConfig({ cwd: tmp, skipUser: true })).rejects.toThrow(/default-export/);
  });

  it('reloads a rewritten .mjs config freshly even on rapid successive loads', async () => {
    // The first import is plain (single module-registry entry, no per-load
    // cache-buster → no leak); subsequent reloads append a monotonic-counter
    // buster so back-to-back reloads in the same millisecond can't return the
    // stale cached module. Use .mjs so it goes through importJsConfig, not jiti.
    const file = path.join(tmp, 'moxxy.config.mjs');
    await fs.writeFile(file, `export default { mode: 'default' };`);
    const first = await loadConfig({ cwd: tmp, skipUser: true });
    expect(first.config.mode).toBe('default');

    await fs.writeFile(file, `export default { mode: 'goal' };`);
    // Two reloads with no delay between them (same-ms risk).
    const [a, b] = await Promise.all([
      loadConfig({ cwd: tmp, skipUser: true }),
      loadConfig({ cwd: tmp, skipUser: true }),
    ]);
    expect(a.config.mode).toBe('goal');
    expect(b.config.mode).toBe('goal');
  });

  it('resolves each .ts config\'s relative imports against ITS OWN dir (jiti cache keyed by cwd)', async () => {
    // Two projects in two dirs, each with a .ts config that imports a sibling
    // module. A jiti instance binds its resolution base to the dir it was
    // created with; a single shared instance would resolve the SECOND config's
    // `./marker` against the FIRST dir, picking up the wrong value.
    const dirA = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-jiti-a-'));
    const dirB = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-jiti-b-'));
    try {
      await fs.writeFile(path.join(dirA, 'marker.ts'), `export const marker = 'from-A';`);
      await fs.writeFile(
        path.join(dirA, 'moxxy.config.ts'),
        `import { marker } from './marker';\nexport default { provider: { name: 'x', model: marker } };`,
      );
      await fs.writeFile(path.join(dirB, 'marker.ts'), `export const marker = 'from-B';`);
      await fs.writeFile(
        path.join(dirB, 'moxxy.config.ts'),
        `import { marker } from './marker';\nexport default { provider: { name: 'x', model: marker } };`,
      );

      const a = await loadConfig({ cwd: dirA, skipUser: true });
      const b = await loadConfig({ cwd: dirB, skipUser: true });

      expect(a.config.provider?.model).toBe('from-A');
      expect(b.config.provider?.model).toBe('from-B');
    } finally {
      await fs.rm(dirA, { recursive: true, force: true });
      await fs.rm(dirB, { recursive: true, force: true });
    }
  });
});
