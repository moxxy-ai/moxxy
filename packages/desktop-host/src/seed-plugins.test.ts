import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  repairSeededPluginManifest,
  seedPluginsFromResources,
} from './seed-plugins.js';

let tmp: string;
let resources: string;
let home: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-seed-'));
  resources = path.join(tmp, 'resources');
  home = path.join(tmp, 'home');
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function makeSeed(
  pkgs: Record<string, { version: string; extra?: string; dependencySpec?: string }>,
) {
  const modules = path.join(resources, 'plugins-seed', 'node_modules');
  const deps: Record<string, string> = {};
  for (const [name, spec] of Object.entries(pkgs)) {
    const dir = path.join(modules, name);
    await fs.mkdir(path.join(dir, 'dist'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name, version: spec.version }),
    );
    await fs.writeFile(path.join(dir, 'dist', 'index.js'), spec.extra ?? 'export default {}');
    deps[name] = spec.dependencySpec ?? spec.version;
  }
  await fs.writeFile(
    path.join(resources, 'plugins-seed', 'package.json'),
    JSON.stringify({ name: 'seed', dependencies: deps }),
  );
}

async function makeSeedLock(
  dependencies: Record<string, string>,
  packages: Record<string, unknown> = {},
): Promise<void> {
  await fs.writeFile(
    path.join(resources, 'plugins-seed', 'package-lock.json'),
    JSON.stringify({
      name: 'plugins-seed',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { dependencies },
        ...packages,
      },
    }),
  );
}

describe('seedPluginsFromResources', () => {
  it('no-ops without a bundled seed (dev run)', async () => {
    await fs.mkdir(resources, { recursive: true });
    const res = await seedPluginsFromResources({ resourcesPath: resources, moxxyHome: home });
    expect(res.copied).toEqual([]);
  });

  it('copies the whole tree on first launch and writes the manifest', async () => {
    await makeSeed({
      '@moxxy/mode-goal': { version: '1.0.0' },
      '@moxxy/sdk': { version: '1.0.0' },
      zod: { version: '3.24.0' },
    });
    const res = await seedPluginsFromResources({ resourcesPath: resources, moxxyHome: home });
    expect(res.copied.sort()).toEqual(['@moxxy/mode-goal', '@moxxy/sdk', 'zod']);
    const pkg = JSON.parse(
      await fs.readFile(path.join(home, 'plugins', 'package.json'), 'utf8'),
    );
    expect(pkg.dependencies['@moxxy/mode-goal']).toBe('1.0.0');
    expect(pkg.private).toBe(true);
    await expect(
      fs.readFile(
        path.join(home, 'plugins', 'node_modules', '@moxxy', 'mode-goal', 'dist', 'index.js'),
        'utf8',
      ),
    ).resolves.toContain('export default');
  });

  it('initializes a package lock so later installs reuse seeded dependencies', async () => {
    const transientSpec = 'file:../../tmp/moxxy-seed-tars-old/mode-goal.tgz';
    await makeSeed({
      '@moxxy/mode-goal': {
        version: '1.2.3',
        dependencySpec: transientSpec,
      },
    });
    await makeSeedLock(
      { '@moxxy/mode-goal': transientSpec },
      {
        'node_modules/@moxxy/mode-goal': {
          version: '1.2.3',
          resolved: transientSpec,
          integrity: 'sha512-test',
        },
        'node_modules/libsignal': {
          version: '6.0.0',
          resolved: 'git+ssh://git@github.com/whiskeysockets/libsignal-node.git#pinned',
        },
      },
    );

    await seedPluginsFromResources({ resourcesPath: resources, moxxyHome: home });

    const lock = JSON.parse(
      await fs.readFile(path.join(home, 'plugins', 'package-lock.json'), 'utf8'),
    );
    expect(lock.name).toBe('moxxy-user-plugins');
    expect(lock.version).toBe('0.0.0');
    expect(lock.packages[''].dependencies['@moxxy/mode-goal']).toBe('1.2.3');
    expect(lock.packages['node_modules/libsignal'].resolved).toContain('#pinned');
  });

  it('never overwrites a user package lock', async () => {
    await makeSeed({ '@moxxy/mode-goal': { version: '1.0.0' } });
    await makeSeedLock({ '@moxxy/mode-goal': '1.0.0' });
    const pluginsDir = path.join(home, 'plugins');
    await fs.mkdir(pluginsDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginsDir, 'package-lock.json'),
      JSON.stringify({ name: 'user-owned-lock', lockfileVersion: 3, packages: { '': {} } }),
    );

    await seedPluginsFromResources({ resourcesPath: resources, moxxyHome: home });

    const lock = JSON.parse(await fs.readFile(path.join(pluginsDir, 'package-lock.json'), 'utf8'));
    expect(lock.name).toBe('user-owned-lock');
  });

  it('never overwrites an existing (possibly user-updated) package', async () => {
    await makeSeed({ '@moxxy/mode-goal': { version: '1.0.0', extra: 'SEED' } });
    const existing = path.join(home, 'plugins', 'node_modules', '@moxxy', 'mode-goal');
    await fs.mkdir(existing, { recursive: true });
    await fs.writeFile(path.join(existing, 'package.json'), JSON.stringify({ name: '@moxxy/mode-goal', version: '9.9.9' }));
    const res = await seedPluginsFromResources({ resourcesPath: resources, moxxyHome: home });
    expect(res.copied).toEqual([]);
    expect(res.skipped).toEqual(['@moxxy/mode-goal']);
    const kept = JSON.parse(await fs.readFile(path.join(existing, 'package.json'), 'utf8'));
    expect(kept.version).toBe('9.9.9');
  });

  it('keeps existing target manifest dependencies over seed entries', async () => {
    await makeSeed({ '@moxxy/mode-goal': { version: '1.0.0' } });
    await fs.mkdir(path.join(home, 'plugins'), { recursive: true });
    await fs.writeFile(
      path.join(home, 'plugins', 'package.json'),
      JSON.stringify({ name: 'moxxy-user-plugins', dependencies: { '@moxxy/mode-goal': '2.0.0' } }),
    );
    await seedPluginsFromResources({ resourcesPath: resources, moxxyHome: home });
    const pkg = JSON.parse(await fs.readFile(path.join(home, 'plugins', 'package.json'), 'utf8'));
    expect(pkg.dependencies['@moxxy/mode-goal']).toBe('2.0.0');
  });

  it('normalizes transient build tarballs to durable exact versions', async () => {
    await makeSeed({
      '@moxxy/mode-goal': {
        version: '1.2.3',
        dependencySpec: 'file:../../tmp/moxxy-seed-tars-old/mode-goal.tgz',
      },
    });

    await seedPluginsFromResources({ resourcesPath: resources, moxxyHome: home });

    const pkg = JSON.parse(
      await fs.readFile(path.join(home, 'plugins', 'package.json'), 'utf8'),
    );
    expect(pkg.dependencies['@moxxy/mode-goal']).toBe('1.2.3');
  });

  it('preserves an existing installed version while repairing an old seeded spec', async () => {
    await makeSeed({ '@moxxy/mode-goal': { version: '1.0.0' } });
    const existing = path.join(home, 'plugins', 'node_modules', '@moxxy', 'mode-goal');
    await fs.mkdir(existing, { recursive: true });
    await fs.writeFile(
      path.join(existing, 'package.json'),
      JSON.stringify({ name: '@moxxy/mode-goal', version: '9.9.9' }),
    );
    await fs.writeFile(
      path.join(home, 'plugins', 'package.json'),
      JSON.stringify({
        name: 'moxxy-user-plugins',
        dependencies: {
          '@moxxy/mode-goal': 'file:../../tmp/moxxy-seed-tars-old/mode-goal.tgz',
        },
      }),
    );

    await seedPluginsFromResources({ resourcesPath: resources, moxxyHome: home });

    const pkg = JSON.parse(
      await fs.readFile(path.join(home, 'plugins', 'package.json'), 'utf8'),
    );
    expect(pkg.dependencies['@moxxy/mode-goal']).toBe('9.9.9');
  });

  it('skips npm bookkeeping entries (.bin, .package-lock.json)', async () => {
    await makeSeed({ '@moxxy/mode-goal': { version: '1.0.0' } });
    const modules = path.join(resources, 'plugins-seed', 'node_modules');
    await fs.mkdir(path.join(modules, '.bin'), { recursive: true });
    await fs.writeFile(path.join(modules, '.package-lock.json'), '{}');
    const res = await seedPluginsFromResources({ resourcesPath: resources, moxxyHome: home });
    expect(res.copied).toEqual(['@moxxy/mode-goal']);
  });
});

describe('repairSeededPluginManifest', () => {
  it('repairs only generated first-party tarball specs and removes dead entries', async () => {
    const pluginsDir = path.join(home, 'plugins');
    const installed = path.join(
      pluginsDir,
      'node_modules',
      '@moxxy',
      'plugin-provider-anthropic',
    );
    await fs.mkdir(installed, { recursive: true });
    await fs.writeFile(
      path.join(installed, 'package.json'),
      JSON.stringify({ name: '@moxxy/plugin-provider-anthropic', version: '3.4.5' }),
    );
    await fs.writeFile(
      path.join(pluginsDir, 'package.json'),
      JSON.stringify({
        name: 'moxxy-user-plugins',
        dependencies: {
          '@moxxy/plugin-provider-anthropic':
            'file:../../tmp/moxxy-seed-tars-deleted/plugin-provider-anthropic.tgz',
          '@moxxy/plugin-missing':
            'file:../../tmp/moxxy-seed-tars-deleted/plugin-missing.tgz',
          '@example/custom': 'file:../custom-plugin',
        },
      }),
    );

    const repaired = await repairSeededPluginManifest(pluginsDir);

    expect(repaired.replaced).toEqual(['@moxxy/plugin-provider-anthropic']);
    expect(repaired.removed).toEqual(['@moxxy/plugin-missing']);
    const pkg = JSON.parse(await fs.readFile(path.join(pluginsDir, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@moxxy/plugin-provider-anthropic']).toBe('3.4.5');
    expect(pkg.dependencies['@moxxy/plugin-missing']).toBeUndefined();
    expect(pkg.dependencies['@example/custom']).toBe('file:../custom-plugin');
  });
});
