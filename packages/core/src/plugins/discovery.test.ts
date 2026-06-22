import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../logger.js';
import { discoverPlugins } from './discovery.js';
import { createPluginLoader } from './loader.js';

let tmp: string;
let cwd: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-discover-'));
  cwd = path.join(tmp, 'project');
  await fs.mkdir(path.join(cwd, 'node_modules', '@acme', 'mox-thing'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function makePkg(pkgRoot: string, opts: { name: string; entry: string; entryContent: string }) {
  await fs.writeFile(
    path.join(pkgRoot, 'package.json'),
    JSON.stringify(
      {
        name: opts.name,
        version: '1.2.3',
        type: 'module',
        moxxy: { plugin: { entry: opts.entry } },
      },
      null,
      2,
    ),
  );
  await fs.writeFile(path.join(pkgRoot, opts.entry), opts.entryContent);
}

describe('discoverPlugins + createPluginLoader (end-to-end)', () => {
  it('finds plugins in cwd/node_modules and loads them via the default loader', async () => {
    const pkgRoot = path.join(cwd, 'node_modules', '@acme', 'mox-thing');
    await makePkg(pkgRoot, {
      name: '@acme/mox-thing',
      entry: 'index.mjs',
      entryContent: `export default Object.freeze({ __moxxy: 'plugin', name: '@acme/mox-thing', version: '1.2.3', tools: [] });\n`,
    });

    const manifests = await discoverPlugins({ cwd, logger: silentLogger });
    const ours = manifests.find((m) => m.packageName === '@acme/mox-thing');
    expect(ours).toBeDefined();
    expect(ours!.entry).toBe('index.mjs');

    const loader = createPluginLoader({ cwd });
    const plugin = await loader.load(ours!);
    expect(plugin.name).toBe('@acme/mox-thing');
    expect(plugin.version).toBe('1.2.3');
  });

  it('stamps the package.json version over a hardcoded definePlugin literal', async () => {
    const pkgRoot = path.join(cwd, 'node_modules', '@acme', 'mox-thing');
    // package.json version is 1.2.3 (makePkg), but the entry hardcodes 0.0.0 —
    // the placeholder plugin authors leave in definePlugin. The loader must
    // report the package version, not the literal.
    await makePkg(pkgRoot, {
      name: '@acme/mox-thing',
      entry: 'index.mjs',
      entryContent: `export default Object.freeze({ __moxxy: 'plugin', name: '@acme/mox-thing', version: '0.0.0', tools: [] });\n`,
    });

    const manifests = await discoverPlugins({ cwd, logger: silentLogger });
    const ours = manifests.find((m) => m.packageName === '@acme/mox-thing');
    const plugin = await createPluginLoader({ cwd }).load(ours!);
    expect(plugin.version).toBe('1.2.3');
  });

  it('ignores packages without a moxxy.plugin manifest', async () => {
    const pkgRoot = path.join(cwd, 'node_modules', 'plain-pkg');
    await fs.mkdir(pkgRoot, { recursive: true });
    await fs.writeFile(
      path.join(pkgRoot, 'package.json'),
      JSON.stringify({ name: 'plain-pkg', version: '0.0.1' }),
    );

    const manifests = await discoverPlugins({ cwd, logger: silentLogger });
    expect(manifests.find((m) => m.packageName === 'plain-pkg')).toBeUndefined();
  });

  it('rejects a plugin entry that escapes its package directory (path traversal)', async () => {
    const pkgRoot = path.join(cwd, 'node_modules', '@acme', 'mox-thing');
    await fs.mkdir(pkgRoot, { recursive: true });
    await fs.writeFile(
      path.join(pkgRoot, 'package.json'),
      JSON.stringify({
        name: '@acme/mox-thing',
        version: '1.0.0',
        moxxy: { plugin: { entry: '../../../../../../tmp/evil.js' } },
      }),
    );
    const manifests = await discoverPlugins({ cwd, logger: silentLogger });
    const ours = manifests.find((m) => m.packageName === '@acme/mox-thing')!;
    expect(ours).toBeDefined();
    const loader = createPluginLoader({ cwd });
    await expect(loader.load(ours)).rejects.toThrow(/escapes its package directory/);
  });

  it('rejects entries that do not export a moxxy plugin object', async () => {
    const pkgRoot = path.join(cwd, 'node_modules', '@acme', 'mox-thing');
    await makePkg(pkgRoot, {
      name: '@acme/mox-thing',
      entry: 'index.mjs',
      entryContent: `export default { hello: 'world' };\n`,
    });

    const manifests = await discoverPlugins({ cwd, logger: silentLogger });
    const ours = manifests.find((m) => m.packageName === '@acme/mox-thing')!;
    const loader = createPluginLoader({ cwd });
    await expect(loader.load(ours)).rejects.toThrow(/did not export a valid Plugin/);
  });

  it('stays silent on a missing package.json but warns on a non-ENOENT read failure', async () => {
    // A directory with NO package.json (ENOENT) is the common "not a package"
    // case — must not warn.
    const emptyDir = path.join(cwd, 'node_modules', 'no-pkgjson');
    await fs.mkdir(emptyDir, { recursive: true });
    // A directory whose package.json is malformed JSON (SyntaxError, not ENOENT)
    // means a plugin may have been dropped for a non-structural reason → warn,
    // not swallow it identically to "no package.json".
    const badDir = path.join(cwd, 'node_modules', 'bad-pkgjson');
    await fs.mkdir(badDir, { recursive: true });
    await fs.writeFile(path.join(badDir, 'package.json'), '{ this is not json');

    const warn = vi.fn();
    const logger = { ...silentLogger, warn };
    const manifests = await discoverPlugins({ cwd, logger });
    expect(manifests.find((m) => m.packageName === 'no-pkgjson')).toBeUndefined();
    expect(manifests.find((m) => m.packageName === 'bad-pkgjson')).toBeUndefined();
    // Exactly the malformed one warned; the missing one did not.
    const warnedPaths = warn.mock.calls.map((c) => String((c[1] as { path?: string })?.path ?? ''));
    expect(warnedPaths.some((p) => p.includes('bad-pkgjson'))).toBe(true);
    expect(warnedPaths.some((p) => p.includes('no-pkgjson'))).toBe(false);
  });

  it('discovers all plugins even when there are more than the concurrency cap', async () => {
    // Bounding fd concurrency must not DROP plugins — create well over the cap
    // and assert every one is found.
    const count = 80;
    for (let i = 0; i < count; i++) {
      const pkgRoot = path.join(cwd, 'node_modules', `mox-bulk-${i}`);
      await fs.mkdir(pkgRoot, { recursive: true });
      await fs.writeFile(
        path.join(pkgRoot, 'package.json'),
        JSON.stringify({ name: `mox-bulk-${i}`, version: '1.0.0', moxxy: { plugin: { entry: './index.mjs' } } }),
      );
    }
    const manifests = await discoverPlugins({ cwd, logger: silentLogger });
    const found = manifests.filter((m) => m.packageName.startsWith('mox-bulk-'));
    expect(found).toHaveLength(count);
  });

  it('walks up parent dirs to find node_modules', async () => {
    const nested = path.join(cwd, 'deeply', 'nested');
    await fs.mkdir(nested, { recursive: true });
    const pkgRoot = path.join(cwd, 'node_modules', '@acme', 'mox-thing');
    await makePkg(pkgRoot, {
      name: '@acme/mox-thing',
      entry: 'index.mjs',
      entryContent: `export default Object.freeze({ __moxxy: 'plugin', name: '@acme/mox-thing', version: '1.0.0' });\n`,
    });

    const manifests = await discoverPlugins({ cwd: nested, logger: silentLogger });
    expect(manifests.find((m) => m.packageName === '@acme/mox-thing')).toBeDefined();
  });
});
