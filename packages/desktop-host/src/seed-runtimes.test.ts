import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { activateRuntimes, bundledRuntimesReady, prepareBundledRuntimes, runtimePathDirs, seedRuntimesFromResources, tarCommand } from './seed-runtimes.js';

let tmp: string;
let resources: string;
let home: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-seed-runtimes-'));
  resources = path.join(tmp, 'resources');
  home = path.join(tmp, 'home');
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const seedDir = (target = 'darwin-arm64') => path.join(resources, 'runtimes-seed', target);

/** A real archive with one top-level folder, the shape the official downloads have. */
async function makeArchive(target: string, name: string, files: Record<string, string>): Promise<string> {
  const stage = path.join(tmp, `stage-${name}-${Math.random().toString(16).slice(2)}`);
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(stage, `${name}-1.0`, file);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
  await fs.mkdir(seedDir(target), { recursive: true });
  const archive = `${name}.tar.gz`;
  execFileSync(tarCommand(), ['-czf', path.join(seedDir(target), archive), '-C', stage, `${name}-1.0`]);
  return archive;
}

async function writeManifest(target: string, runtimes: ReadonlyArray<{ name: string; id: string; archive: string }>) {
  await fs.mkdir(seedDir(target), { recursive: true });
  await fs.writeFile(path.join(seedDir(target), 'manifest.json'), JSON.stringify({ runtimes }));
}

const seed = (platform: NodeJS.Platform = 'darwin', arch = 'arm64') =>
  seedRuntimesFromResources({ resourcesPath: resources, moxxyHome: home, platform, arch });

describe('seedRuntimesFromResources', () => {
  it('unpacks every runtime the installer carries, without its top-level folder', async () => {
    const node = await makeArchive('darwin-arm64', 'node', { 'bin/node': 'node binary', 'lib/npm.js': 'npm' });
    const python = await makeArchive('darwin-arm64', 'python', { 'bin/python3': 'python binary' });
    await writeManifest('darwin-arm64', [{ name: 'node', id: 'v1-aaa', archive: node }, { name: 'python', id: '3.12-bbb', archive: python }]);

    const result = await seed();

    expect([...result.copied].sort()).toEqual(['node', 'python']);
    expect(result.skipped).toEqual([]);
    expect(await fs.readFile(path.join(home, 'runtimes', 'node', 'bin', 'node'), 'utf8')).toBe('node binary');
    expect(await fs.readFile(path.join(home, 'runtimes', 'python', 'bin', 'python3'), 'utf8')).toBe('python binary');
    expect((await fs.readFile(path.join(home, 'runtimes', 'python', '.runtime.ok'), 'utf8')).trim()).toBe('3.12-bbb');
  });

  it('leaves a runtime already unpacked from the same installer untouched, with what was added to it', async () => {
    const python = await makeArchive('darwin-arm64', 'python', { 'bin/python3': 'python binary' });
    await writeManifest('darwin-arm64', [{ name: 'python', id: '3.12-bbb', archive: python }]);
    await seed();
    const added = path.join(home, 'runtimes', 'python', 'lib', 'site-packages', 'installed-later.py');
    await fs.mkdir(path.dirname(added), { recursive: true });
    await fs.writeFile(added, 'a package the agent installed');

    const result = await seed();

    expect(result).toEqual({ copied: [], skipped: ['python'] });
    expect(await fs.readFile(added, 'utf8')).toBe('a package the agent installed');
  });

  it('replaces a runtime when a newer installer carries another one', async () => {
    const old = await makeArchive('darwin-arm64', 'python', { 'bin/python3': 'old python' });
    await writeManifest('darwin-arm64', [{ name: 'python', id: '3.12-old', archive: old }]);
    await seed();
    const next = await makeArchive('darwin-arm64', 'python', { 'bin/python3': 'new python' });
    await writeManifest('darwin-arm64', [{ name: 'python', id: '3.12-new', archive: next }]);

    const result = await seed();

    expect(result.copied).toEqual(['python']);
    expect(await fs.readFile(path.join(home, 'runtimes', 'python', 'bin', 'python3'), 'utf8')).toBe('new python');
  });

  it('takes the runtimes built for this computer and no other', async () => {
    const arm = await makeArchive('darwin-arm64', 'node', { 'bin/node': 'arm node' });
    await writeManifest('darwin-arm64', [{ name: 'node', id: 'v1-arm', archive: arm }]);
    const intel = await makeArchive('darwin-x64', 'node', { 'bin/node': 'intel node' });
    await writeManifest('darwin-x64', [{ name: 'node', id: 'v1-x64', archive: intel }]);

    await seed('darwin', 'x64');

    expect(await fs.readFile(path.join(home, 'runtimes', 'node', 'bin', 'node'), 'utf8')).toBe('intel node');
  });

  it('does nothing when the app ships no runtimes for this computer', async () => {
    const result = await seed('linux', 'x64');

    expect(result).toEqual({ copied: [], skipped: [] });
    await expect(fs.access(path.join(home, 'runtimes'))).rejects.toThrow();
  });

  it('leaves no half-unpacked folder behind when an archive is broken', async () => {
    await fs.mkdir(seedDir(), { recursive: true });
    await fs.writeFile(path.join(seedDir(), 'python.tar.gz'), 'not an archive');
    await writeManifest('darwin-arm64', [{ name: 'python', id: '3.12-bbb', archive: 'python.tar.gz' }]);

    await expect(seed()).rejects.toThrow(/python/);

    expect(await fs.readdir(path.join(home, 'runtimes'))).toEqual([]);
  });

  it('refuses a manifest that points outside the seed folder', async () => {
    await writeManifest('darwin-arm64', [{ name: '../escape', id: 'x', archive: '../../secret.tar.gz' }]);

    await expect(seed()).rejects.toThrow(/manifest/);
  });
});

describe('runtimePathDirs', () => {
  const unpack = async (name: string, files: ReadonlyArray<string>) => {
    for (const file of files) {
      const full = path.join(home, 'runtimes', name, file);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, '');
    }
    await fs.writeFile(path.join(home, 'runtimes', name, '.runtime.ok'), 'id');
  };

  it('puts Python first and Node last on macOS and Linux', async () => {
    await unpack('python', ['bin/python3']);
    await unpack('node', ['bin/node']);

    expect(runtimePathDirs(home, 'darwin')).toEqual({
      first: [path.join(home, 'runtimes', 'python', 'bin')],
      last: [path.join(home, 'runtimes', 'node', 'bin')],
    });
  });

  it('uses the folders Windows builds keep their programs in', async () => {
    await unpack('python', ['python.exe', 'Scripts/tool.exe']);
    await unpack('node', ['node.exe']);

    expect(runtimePathDirs(home, 'win32')).toEqual({
      first: [path.join(home, 'runtimes', 'python'), path.join(home, 'runtimes', 'python', 'Scripts')],
      last: [path.join(home, 'runtimes', 'node')],
    });
  });

  it('puts the bundled Git last where the computer has a Git of its own', async () => {
    await unpack('node', ['bin/node']);
    await unpack('git', ['cmd/git']);

    expect(runtimePathDirs(home, 'darwin', true)).toEqual({
      first: [],
      last: [path.join(home, 'runtimes', 'node', 'bin'), path.join(home, 'runtimes', 'git', 'cmd')],
    });
    expect(runtimePathDirs(home, 'win32', true).last).toEqual([path.join(home, 'runtimes', 'node'), path.join(home, 'runtimes', 'git', 'cmd')]);
  });

  it('puts the bundled Git first on a Mac whose git only offers to install the developer tools', async () => {
    await unpack('python', ['bin/python3']);
    await unpack('git', ['cmd/git']);

    expect(runtimePathDirs(home, 'darwin', false)).toEqual({
      first: [path.join(home, 'runtimes', 'python', 'bin'), path.join(home, 'runtimes', 'git', 'cmd')],
      last: [],
    });
  });

  it('names nothing for a runtime that was never fully unpacked', async () => {
    await fs.mkdir(path.join(home, 'runtimes', 'python', 'bin'), { recursive: true });

    expect(runtimePathDirs(home, 'darwin')).toEqual({ first: [], last: [] });
  });
});

describe('activateRuntimes', () => {
  it('puts the bundled Python ahead of the system one and the bundled Node behind it, once', async () => {
    for (const [name, file] of [['python', 'bin/python3'], ['node', 'bin/node']] as const) {
      const full = path.join(home, 'runtimes', name, file);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, '');
      await fs.writeFile(path.join(home, 'runtimes', name, '.runtime.ok'), 'id');
    }
    const env: NodeJS.ProcessEnv = { PATH: ['/usr/bin', '/bin'].join(path.delimiter) };

    activateRuntimes(home, process.platform, env);
    activateRuntimes(home, process.platform, env);

    const { first, last } = runtimePathDirs(home);
    expect(first.length).toBeGreaterThan(0);
    expect(last.length).toBeGreaterThan(0);
    expect(env.PATH?.split(path.delimiter)).toEqual([...first, '/usr/bin', '/bin', ...last]);
    expect(env.MOXXY_PATH_FIRST).toBe(first.join(path.delimiter));
  });
});

describe('prepareBundledRuntimes', () => {
  it('unpacks the runtimes and puts them on PATH; whoever needs them waits on the same work', async () => {
    const node = await makeArchive('darwin-arm64', 'node', { 'bin/node': 'node binary' });
    await writeManifest('darwin-arm64', [{ name: 'node', id: 'v1-aaa', archive: node }]);
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };

    void prepareBundledRuntimes({ resourcesPath: resources, moxxyHome: home, platform: 'darwin', arch: 'arm64', env });
    expect(env.PATH).toBe('/usr/bin');
    await bundledRuntimesReady();

    expect(env.PATH).toBe(['/usr/bin', path.join(home, 'runtimes', 'node', 'bin')].join(':'));
  });

  it('reports a runtime that cannot be unpacked and lets the app start without it', async () => {
    await fs.mkdir(seedDir(), { recursive: true });
    await fs.writeFile(path.join(seedDir(), 'python.tar.gz'), 'not an archive');
    await writeManifest('darwin-arm64', [{ name: 'python', id: '3.12-bbb', archive: 'python.tar.gz' }]);
    const logged: string[] = [];

    await prepareBundledRuntimes({ resourcesPath: resources, moxxyHome: home, platform: 'darwin', arch: 'arm64', env: {}, log: (msg) => logged.push(msg) });

    expect(logged.join('\n')).toMatch(/bundled python runtime/);
  });
});
