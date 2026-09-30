/**
 * The one-click update of the runner (`@moxxy/cli`) and the user's `@moxxy`
 * plugins, run with the REAL npm against locally packed tarballs on a temp
 * profile. Only the npm registry lookup is a stand-in (the network).
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyComponentUpdate,
  findNpm,
  planComponentUpdate,
  recoverComponentUpdates,
  type ComponentUpdatePlan,
  type PackageRegistry,
} from './component-update.js';
import { offerBundledProviderUpdate } from './provider-update-runtime.js';
import { fixtureProviderCode } from './provider-update.fixture.js';

const NPM_TIMEOUT = 120_000;
const root = mkdtempSync(path.join(tmpdir(), 'component-update-'));
const tarballs = path.join(root, 'tarballs');
const tarball = (name: string, version: string) =>
  path.join(tarballs, `${name.replace('@', '').replace('/', '-')}-${version}.tgz`);
const spec = (name: string, version: string) => `file:${tarball(name, version)}`;

function packFixture(name: string, version: string, files: Record<string, string>, extra: object = {}): void {
  const dir = mkdtempSync(path.join(root, 'src-'));
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version, type: 'module', ...extra }));
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), body);
  }
  execFileSync('npm', ['pack', '--pack-destination', tarballs, '--silent'], { cwd: dir, stdio: 'ignore' });
}

const plugin = (label: string) => ({
  'index.js': `export default { name: '${label}' };`,
});
const pluginManifest = { moxxy: { plugin: { entry: './index.js' } }, main: 'index.js' };

beforeAll(() => {
  mkdirSync(tarballs);
  for (const version of ['0.1.0', '0.2.0']) {
    packFixture('@moxxy/plugin-a', version, plugin(`a ${version}`), pluginManifest);
    packFixture('@moxxy/lib-b', version, { 'index.js': `export const version = '${version}';` }, { main: 'index.js' });
    packFixture('@moxxy/cli', version, { 'dist/bin.js': `console.log('moxxy ${version}');` }, { bin: { moxxy: 'dist/bin.js' } });
    // A hooks-kind plugin exports a function the runner calls, not a plugin object.
    packFixture('@moxxy/plugin-hooks', version, { 'index.js': 'export default function build() { return {}; }' }, pluginManifest);
  }
  packFixture('@moxxy/plugin-broken', '0.1.0', plugin('broken 0.1.0'), pluginManifest);
  packFixture('@moxxy/plugin-broken', '0.2.0', { 'index.js': 'throw new Error("broken build");' }, pluginManifest);
  packFixture('@moxxy/plugin-provider-openai-codex', '0.2.0', { 'dist/index.js': fixtureProviderCode }, { main: 'dist/index.js' });
}, NPM_TIMEOUT);

afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A profile as a user has it: registry-installed `@moxxy` plugins, a plugin
 *  linked to local source, a hand-made plugin dir, and their data. */
function profile(installed: ReadonlyArray<string> = ['@moxxy/plugin-a', '@moxxy/lib-b']) {
  const home = mkdtempSync(path.join(root, 'home-'));
  const plugins = path.join(home, 'plugins');
  mkdirSync(plugins);
  writeFileSync(path.join(plugins, 'package.json'), JSON.stringify({ name: 'moxxy-user-plugins', private: true }));
  execFileSync('npm', ['install', '--prefix', plugins, '--no-audit', '--no-fund', ...installed.map((n) => spec(n, '0.1.0'))], { stdio: 'ignore' });
  // Registry installs record exact versions; the tarball paths above are only how the fixture got them.
  const manifestPath = path.join(plugins, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dependencies?: Record<string, string> };
  manifest.dependencies ??= {};
  for (const name of installed) manifest.dependencies[name] = '0.1.0';
  // A plugin linked to local source (a developer install) is never touched.
  const linkedSrc = path.join(home, 'linked-src');
  mkdirSync(linkedSrc);
  writeFileSync(path.join(linkedSrc, 'package.json'), JSON.stringify({ name: '@moxxy/plugin-linked', version: '0.1.0' }));
  manifest.dependencies['@moxxy/plugin-linked'] = 'file:../linked-src';
  mkdirSync(path.join(plugins, 'node_modules', '@moxxy'), { recursive: true });
  symlinkSync('../../../linked-src', path.join(plugins, 'node_modules', '@moxxy', 'plugin-linked'));
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const lockPath = path.join(plugins, 'package-lock.json');
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { packages: Record<string, { dependencies?: Record<string, string> }> };
    lock.packages[''] = { ...lock.packages[''], dependencies: manifest.dependencies };
    writeFileSync(lockPath, JSON.stringify(lock));
  }
  mkdirSync(path.join(plugins, 'my-own-plugin'));
  writeFileSync(path.join(plugins, 'my-own-plugin', 'index.js'), '// hand-made');
  // The user's data.
  mkdirSync(path.join(home, 'desktop'));
  mkdirSync(path.join(home, 'sessions'));
  writeFileSync(path.join(home, 'vault.json'), '{"secret":"encrypted"}');
  writeFileSync(path.join(home, 'vault.key'), 'key');
  writeFileSync(path.join(home, 'desktop', 'desks.json'), '{"desks":[{"id":"d1"}]}');
  writeFileSync(path.join(home, 'sessions', 's1.jsonl'), '{"type":"user_prompt"}\n');
  const userData = mkdtempSync(path.join(root, 'userdata-'));
  return { home, plugins, userData };
}

function dataFingerprint(home: string): string {
  const hash = createHash('sha256');
  for (const file of ['vault.json', 'vault.key', 'desktop/desks.json', 'sessions/s1.jsonl']) {
    hash.update(file).update(readFileSync(path.join(home, file)));
  }
  return hash.digest('hex');
}

const installedVersion = (plugins: string, name: string): string =>
  (JSON.parse(readFileSync(path.join(plugins, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }).version;

function registry(latest: string, published: ReadonlyArray<string> = ['@moxxy/plugin-a', '@moxxy/lib-b', '@moxxy/plugin-hooks', '@moxxy/plugin-broken', '@moxxy/cli', '@moxxy/plugin-provider-openai-codex']): PackageRegistry {
  return {
    latestVersion: async (name) => (name === '@moxxy/cli' ? latest : null),
    hasVersion: async (name, version) => published.includes(name) && version === latest,
  };
}

function npm() {
  const found = findNpm();
  if (!found) throw new Error('npm is required for these tests');
  return found;
}

const leftovers = (dir: string) => readdirSync(dir).filter((name) => name.includes('.update-'));

describe('planComponentUpdate', () => {
  it('lists the runner and the @moxxy plugins behind the latest release, skipping linked and unpublished ones', async () => {
    const { home } = profile();

    const plan = await planComponentUpdate({ cliVersion: '0.1.0', moxxyHome: home, registry: registry('0.2.0', ['@moxxy/plugin-a', '@moxxy/cli']) });

    expect(plan).toEqual({
      version: '0.2.0',
      cli: { current: '0.1.0' },
      plugins: [{ name: '@moxxy/plugin-a', current: '0.1.0' }],
    });
  }, NPM_TIMEOUT);

  it('has nothing to do when the runner and plugins are already on the latest release', async () => {
    const { home } = profile();

    await expect(planComponentUpdate({ cliVersion: '0.1.0', moxxyHome: home, registry: registry('0.1.0') })).resolves.toBeNull();
  }, NPM_TIMEOUT);

  it('has nothing to do when the release cannot be looked up (offline)', async () => {
    const { home } = profile();
    const offline: PackageRegistry = { latestVersion: async () => null, hasVersion: async () => false };

    await expect(planComponentUpdate({ cliVersion: '0.1.0', moxxyHome: home, registry: offline })).resolves.toBeNull();
  }, NPM_TIMEOUT);
});

describe('applyComponentUpdate', () => {
  it('updates the plugins and the runner and leaves every piece of user data as it was', async () => {
    const { home, plugins, userData } = profile(['@moxxy/plugin-a', '@moxxy/lib-b', '@moxxy/plugin-hooks']);
    const before = dataFingerprint(home);
    const plan = await planComponentUpdate({ cliVersion: '0.1.0', moxxyHome: home, registry: registry('0.2.0') });
    if (!plan) throw new Error('expected an update');

    await applyComponentUpdate({ plan, moxxyHome: home, userDataDir: userData, npm: npm(), spec });

    expect(installedVersion(plugins, '@moxxy/plugin-a')).toBe('0.2.0');
    expect(installedVersion(plugins, '@moxxy/lib-b')).toBe('0.2.0');
    expect(installedVersion(plugins, '@moxxy/plugin-hooks')).toBe('0.2.0');
    expect(installedVersion(path.join(userData, 'cli'), '@moxxy/cli')).toBe('0.2.0');
    expect(readFileSync(path.join(plugins, 'node_modules', '@moxxy', 'plugin-linked', 'package.json'), 'utf8')).toContain('plugin-linked');
    expect(existsSync(path.join(plugins, 'my-own-plugin', 'index.js'))).toBe(true);
    expect(dataFingerprint(home)).toBe(before);
    expect(installedVersion(path.join(home, 'plugins.previous'), '@moxxy/plugin-a')).toBe('0.1.0');
    expect(leftovers(home)).toEqual([]);
    expect(leftovers(userData)).toEqual([]);
  }, NPM_TIMEOUT);

  it('keeps the previous versions working when npm fails, with no half-installed files left', async () => {
    const { home, plugins, userData } = profile();
    const plan: ComponentUpdatePlan = { version: '9.9.9', cli: null, plugins: [{ name: '@moxxy/plugin-a', current: '0.1.0' }] };

    await expect(applyComponentUpdate({ plan, moxxyHome: home, userDataDir: userData, npm: npm(), spec })).rejects.toThrow();

    expect(installedVersion(plugins, '@moxxy/plugin-a')).toBe('0.1.0');
    expect(leftovers(home)).toEqual([]);
  }, NPM_TIMEOUT);

  it('keeps the previous versions when an updated plugin does not load', async () => {
    const { home, plugins, userData } = profile(['@moxxy/plugin-a', '@moxxy/plugin-broken']);
    const plan: ComponentUpdatePlan = {
      version: '0.2.0',
      cli: null,
      plugins: [{ name: '@moxxy/plugin-a', current: '0.1.0' }, { name: '@moxxy/plugin-broken', current: '0.1.0' }],
    };

    await expect(applyComponentUpdate({ plan, moxxyHome: home, userDataDir: userData, npm: npm(), spec })).rejects.toThrow(/plugin-broken does not load: Error: broken build/);

    expect(installedVersion(plugins, '@moxxy/plugin-a')).toBe('0.1.0');
    expect(installedVersion(plugins, '@moxxy/plugin-broken')).toBe('0.1.0');
    expect(leftovers(home)).toEqual([]);
  }, NPM_TIMEOUT);

  it('keeps the previous runner when the new one does not start', async () => {
    const { home, userData } = profile();
    await applyComponentUpdate({
      plan: { version: '0.1.0', cli: { current: null }, plugins: [] },
      moxxyHome: home, userDataDir: userData, npm: npm(), spec,
    });
    packFixture('@moxxy/cli', '0.3.0', { 'dist/bin.js': 'process.exit(3);' }, { bin: { moxxy: 'dist/bin.js' } });

    await expect(applyComponentUpdate({
      plan: { version: '0.3.0', cli: { current: '0.1.0' }, plugins: [] },
      moxxyHome: home, userDataDir: userData, npm: npm(), spec,
    })).rejects.toThrow(/runner/i);

    expect(installedVersion(path.join(userData, 'cli'), '@moxxy/cli')).toBe('0.1.0');
    expect(leftovers(userData)).toEqual([]);
  }, NPM_TIMEOUT);

  it('marks an updated OpenAI connection as a managed install, so the installer neither asks about it nor downgrades it', async () => {
    const { home, plugins, userData } = profile([]);
    const name = '@moxxy/plugin-provider-openai-codex';

    await applyComponentUpdate({
      plan: { version: '0.2.0', cli: null, plugins: [{ name, current: '0.0.0' }] },
      moxxyHome: home, userDataDir: userData, npm: npm(), spec,
    });

    const resourcesPath = path.join(root, `resources-${path.basename(home)}`);
    const seeded = path.join(resourcesPath, 'plugins-seed', 'node_modules', name);
    mkdirSync(path.join(seeded, 'dist'), { recursive: true });
    writeFileSync(path.join(seeded, 'dist', 'index.js'), fixtureProviderCode);
    const neverAsk = async () => { throw new Error('a managed install must not need approval'); };
    for (const [version, outcome] of [['0.1.0', 'current'], ['0.3.0', 'updated']] as const) {
      writeFileSync(path.join(seeded, 'package.json'), JSON.stringify({ name, version, type: 'module' }));
      await expect(offerBundledProviderUpdate({ resourcesPath, moxxyHome: home, plugin: name, confirm: neverAsk })).resolves.toBe(outcome);
    }
    expect(installedVersion(plugins, name)).toBe('0.3.0');
  }, NPM_TIMEOUT);
});

describe('recoverComponentUpdates', () => {
  it('puts the previous plugins back when a swap was interrupted', async () => {
    const { home, plugins, userData } = profile();
    const { renameSync } = await import('node:fs');
    renameSync(plugins, path.join(home, 'plugins.previous'));
    mkdirSync(path.join(home, 'plugins.update-abc123'));

    await recoverComponentUpdates({ moxxyHome: home, userDataDir: userData });

    expect(installedVersion(plugins, '@moxxy/plugin-a')).toBe('0.1.0');
    expect(leftovers(home)).toEqual([]);
  }, NPM_TIMEOUT);
});
