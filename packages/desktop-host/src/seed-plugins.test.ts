import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  repairSeededPluginManifest,
  seedPluginsFromResources,
} from './seed-plugins.js';
import { removeDir } from '@moxxy/vitest-preset/fs';

let tmp: string;
let resources: string;
let home: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-seed-'));
  resources = path.join(tmp, 'resources');
  home = path.join(tmp, 'home');
});

afterEach(async () => {
  await removeDir(tmp);
});

interface SeedPackage { version: string; extra?: string; dependencySpec?: string }

/** A seed as the build writes it: packages, their ledger and, unless
 *  `fingerprints` is false, the content fingerprint of every package. */
async function makeSeed(
  pkgs: Record<string, SeedPackage>,
  { fingerprints = true }: { fingerprints?: boolean } = {},
) {
  const modules = path.join(resources, 'plugins-seed', 'node_modules');
  await removeDir(modules);
  const deps: Record<string, string> = {};
  if (fingerprints) {
    const packages = Object.fromEntries(
      Object.entries(pkgs).map(([name, spec]) => [name, `fp:${spec.version}:${spec.extra ?? ''}`]),
    );
    await fs.mkdir(path.join(resources, 'plugins-seed'), { recursive: true });
    await fs.writeFile(
      path.join(resources, 'plugins-seed', 'seed-fingerprints.json'),
      JSON.stringify({ schemaVersion: 1, packages }),
    );
  }
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
    expect(lock.packages['node_modules/@moxxy/mode-goal'].resolved).toBeUndefined();
    expect(lock.packages['node_modules/@moxxy/mode-goal'].integrity).toBeUndefined();
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

  it('keeps an installed package that is newer than the seed (updated from npm since)', async () => {
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

const pluginsDir = () => path.join(home, 'plugins');
const installedDir = (name: string) => path.join(pluginsDir(), 'node_modules', name);

async function install(name: string, version: string, code: string): Promise<void> {
  await fs.mkdir(path.join(installedDir(name), 'dist'), { recursive: true });
  await fs.writeFile(path.join(installedDir(name), 'package.json'), JSON.stringify({ name, version }));
  await fs.writeFile(path.join(installedDir(name), 'dist', 'index.js'), code);
}

const installedCode = (name: string) => fs.readFile(path.join(installedDir(name), 'dist', 'index.js'), 'utf8');
const seedOnce = (managedElsewhere?: ReadonlyArray<string>) =>
  seedPluginsFromResources({ resourcesPath: resources, moxxyHome: home, ...(managedElsewhere ? { managedElsewhere } : {}) });

describe('seedPluginsFromResources over an earlier install', () => {
  it('replaces a package an earlier installer left, even at the same version number', async () => {
    await install('@moxxy/plugin-browser', '1.0.0', 'OLD BUILD');
    await makeSeed({ '@moxxy/plugin-browser': { version: '1.0.0', extra: 'NEW BUILD' } });

    const res = await seedOnce();

    expect(res.replaced).toEqual(['@moxxy/plugin-browser']);
    expect(await installedCode('@moxxy/plugin-browser')).toBe('NEW BUILD');
  });

  it('replaces an older third-party dependency with the one the seed resolved', async () => {
    await install('zod', '3.20.0', 'OLD ZOD');
    await makeSeed({ zod: { version: '3.24.0', extra: 'NEW ZOD' } });

    expect((await seedOnce()).replaced).toEqual(['zod']);
    expect(await installedCode('zod')).toBe('NEW ZOD');
  });

  it('adds a package the earlier install never had', async () => {
    await install('@moxxy/sdk', '1.0.0', 'OLD SDK');
    await makeSeed({ '@moxxy/sdk': { version: '1.0.0', extra: 'SDK' }, '@moxxy/jev': { version: '0.1.0' } });

    const res = await seedOnce();

    expect(res.copied).toEqual(['@moxxy/jev']);
    expect(res.replaced).toEqual(['@moxxy/sdk']);
  });

  it('leaves the package alone on the next launch of the same installer, whatever was done to it since', async () => {
    await makeSeed({ '@moxxy/mode-goal': { version: '1.0.0', extra: 'SEED' } });
    await seedOnce();
    await install('@moxxy/mode-goal', '1.0.0', 'USER PATCH');

    const res = await seedOnce();

    expect(res).toMatchObject({ copied: [], replaced: [] });
    expect(await installedCode('@moxxy/mode-goal')).toBe('USER PATCH');
  });

  it('replaces it again when a newer installer brings different content', async () => {
    await makeSeed({ '@moxxy/mode-goal': { version: '1.0.0', extra: 'FIRST' } });
    await seedOnce();
    await makeSeed({ '@moxxy/mode-goal': { version: '1.0.0', extra: 'SECOND' } });

    expect((await seedOnce()).replaced).toEqual(['@moxxy/mode-goal']);
    expect(await installedCode('@moxxy/mode-goal')).toBe('SECOND');
  });

  it('leaves a package to the updater that manages it', async () => {
    await install('@moxxy/plugin-provider-openai', '1.0.0', 'MANAGED');
    await makeSeed({ '@moxxy/plugin-provider-openai': { version: '1.0.0', extra: 'SEED' } });

    const res = await seedOnce(['@moxxy/plugin-provider-openai']);

    expect(res.replaced).toEqual([]);
    expect(res.skipped).toEqual(['@moxxy/plugin-provider-openai']);
    expect(await installedCode('@moxxy/plugin-provider-openai')).toBe('MANAGED');
  });

  it('never touches a plugin the user added that the seed does not carry', async () => {
    await install('@example/own-plugin', '0.1.0', 'MINE');
    await makeSeed({ '@moxxy/mode-goal': { version: '1.0.0' } });

    await seedOnce();

    expect(await installedCode('@example/own-plugin')).toBe('MINE');
  });

  it('moves the npm ledger and lock of a replaced package to the seed version, so a later install keeps it', async () => {
    await install('zod', '3.20.0', 'OLD ZOD');
    await fs.writeFile(
      path.join(pluginsDir(), 'package.json'),
      JSON.stringify({ name: 'moxxy-user-plugins', dependencies: { zod: '3.20.0', '@example/own-plugin': '^0.1.0' } }),
    );
    await fs.writeFile(
      path.join(pluginsDir(), 'package-lock.json'),
      JSON.stringify({
        name: 'moxxy-user-plugins',
        lockfileVersion: 3,
        packages: {
          '': { dependencies: { zod: '3.20.0', '@example/own-plugin': '^0.1.0' } },
          'node_modules/zod': { version: '3.20.0' },
          'node_modules/zod/node_modules/old-helper': { version: '1.0.0' },
          'node_modules/@example/own-plugin': { version: '0.1.0' },
        },
      }),
    );
    await fs.writeFile(path.join(pluginsDir(), 'node_modules', '.package-lock.json'), '{}');
    await makeSeed({ zod: { version: '3.24.0' } });
    await makeSeedLock({ zod: '3.24.0' }, { 'node_modules/zod': { version: '3.24.0', integrity: 'sha512-zod' } });

    await seedOnce();

    const pkg = JSON.parse(await fs.readFile(path.join(pluginsDir(), 'package.json'), 'utf8'));
    expect(pkg.dependencies).toEqual({ zod: '3.24.0', '@example/own-plugin': '^0.1.0' });
    const lock = JSON.parse(await fs.readFile(path.join(pluginsDir(), 'package-lock.json'), 'utf8'));
    expect(lock.packages['node_modules/zod']).toEqual({ version: '3.24.0', integrity: 'sha512-zod' });
    expect(lock.packages['node_modules/zod/node_modules/old-helper']).toBeUndefined();
    expect(lock.packages['node_modules/@example/own-plugin']).toEqual({ version: '0.1.0' });
    expect(lock.packages[''].dependencies).toEqual(pkg.dependencies);
    // npm's hidden lockfile described the old tree; npm rebuilds it.
    await expect(fs.access(path.join(pluginsDir(), 'node_modules', '.package-lock.json'))).rejects.toThrow();
  });

  it('clears what an interrupted replacement left behind, outside the plugin tree', async () => {
    const leftover = path.join(pluginsDir(), '.seed-staging', 'interrupted', '@moxxy', 'mode-goal');
    await fs.mkdir(leftover, { recursive: true });
    await makeSeed({ '@moxxy/mode-goal': { version: '1.0.0' } });

    await seedOnce();

    await expect(fs.access(path.join(pluginsDir(), '.seed-staging', 'interrupted'))).rejects.toThrow();
  });

  it('keeps every installed package when the seed carries no fingerprints', async () => {
    await install('@moxxy/mode-goal', '1.0.0', 'OLD');
    await makeSeed({ '@moxxy/mode-goal': { version: '1.0.0', extra: 'NEW' } }, { fingerprints: false });

    expect((await seedOnce()).replaced).toEqual([]);
    expect(await installedCode('@moxxy/mode-goal')).toBe('OLD');
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
    await fs.writeFile(
      path.join(pluginsDir, 'package-lock.json'),
      JSON.stringify({
        name: 'moxxy-user-plugins',
        lockfileVersion: 3,
        packages: {
          '': {
            dependencies: {
              '@moxxy/plugin-provider-anthropic':
                'file:../../tmp/moxxy-seed-tars-deleted/plugin-provider-anthropic.tgz',
              '@example/custom': 'file:../custom-plugin',
            },
          },
          'node_modules/@moxxy/plugin-provider-anthropic': {
            version: '3.4.5',
            resolved:
              'file:../../tmp/moxxy-seed-tars-deleted/plugin-provider-anthropic.tgz',
            integrity: 'sha512-transient-tarball',
          },
          'node_modules/@example/custom': {
            version: '1.0.0',
            resolved: 'file:../custom-plugin',
          },
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
    const lock = JSON.parse(
      await fs.readFile(path.join(pluginsDir, 'package-lock.json'), 'utf8'),
    );
    expect(lock.packages[''].dependencies).toEqual(pkg.dependencies);
    expect(
      lock.packages['node_modules/@moxxy/plugin-provider-anthropic'].resolved,
    ).toBeUndefined();
    expect(
      lock.packages['node_modules/@moxxy/plugin-provider-anthropic'].integrity,
    ).toBeUndefined();
    expect(lock.packages['node_modules/@example/custom'].resolved).toBe(
      'file:../custom-plugin',
    );
  });
});
