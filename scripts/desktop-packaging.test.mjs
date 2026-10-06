import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { nativePnpm, pnpmCommand } from '../apps/desktop/scripts/pnpm-command.mjs';
import { verifyDesktopResources } from '../apps/desktop/scripts/verify-desktop-resources.mjs';
import { SEED_FINGERPRINTS_FILE, seedFingerprints, writeSeedFingerprints } from '../apps/desktop/scripts/seed-fingerprints.mjs';
import { CONTRACT_PROTOCOL_VERSION } from '../packages/plugin-computer-control/dist/backend/rpc.js';
import { writeHelperManifest } from '../packages/plugin-computer-control/dist/helper/artifact.js';
import { findDarwinArchGaps, findPackagedApps } from '../apps/desktop/scripts/verify-packaged-desktop.mjs';
import { VOICE_CATALOG } from '../packages/plugin-tts-local/dist/voices.js';
import { NODE_VERSION, PYTHON_VERSION, RUNTIME_TARGETS, gitVersion, runtimeTargets } from '../apps/desktop/scripts/runtimes-catalog.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('desktop extraResources copies the dependency trees and the voices from their parent', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(repo, 'apps/desktop/package.json'), 'utf8'),
  );
  assert.deepEqual(manifest.build.extraResources, [
    {
      from: 'resources',
      to: '.',
      filter: ['moxxy-cli/**/*', 'plugins-seed/**/*', 'models-seed/**/*', 'runtimes-seed/**/*'],
    },
  ]);
});

test('universal macOS merge accepts the Computer Use helper, which is already universal', async () => {
  const manifest = JSON.parse(await readFile(path.join(repo, 'apps/desktop/package.json'), 'utf8'));
  const names = manifest.build.mac.x64ArchFiles.replace(/^\{|\}$/g, '').split(',');
  assert.ok(names.includes('moxxy-computer'), manifest.build.mac.x64ArchFiles);
});

test('universal macOS merge accepts the prebuilt binaries that come with the offline voice', async () => {
  // model-fetch → tar-stream → bare-fs/bare-path/bare-url ship one `.bare` per platform.
  const manifest = JSON.parse(await readFile(path.join(repo, 'apps/desktop/package.json'), 'utf8'));
  const names = manifest.build.mac.x64ArchFiles.replace(/^\{|\}$/g, '').split(',');
  assert.ok(names.includes('*.bare'), manifest.build.mac.x64ArchFiles);
});

test('the app bundle leaves out the native sources and build output of the Computer Use helper', async () => {
  const manifest = JSON.parse(await readFile(path.join(repo, 'apps/desktop/package.json'), 'utf8'));
  assert.ok(manifest.build.files.includes('!**/node_modules/@moxxy/plugin-computer-control/native/**'), manifest.build.files.join(', '));
});

test('desktop resource verifier rejects the shipped Windows failure shape', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moxxy-broken-resources-'));
  try {
    await mkdir(path.join(root, 'moxxy-cli', 'dist'), { recursive: true });
    await mkdir(path.join(root, 'plugins-seed'), { recursive: true });
    await writeJson(path.join(root, 'moxxy-cli', 'package.json'), {
      name: '@moxxy/cli',
      version: '1.2.3',
      type: 'module',
    });
    await writeFile(path.join(root, 'moxxy-cli', 'dist', 'bin.js'), 'console.log("moxxy 1.2.3");\n');
    await writeJson(path.join(root, 'plugins-seed', 'package.json'), {
      name: 'moxxy-plugins-seed',
      version: '1.0.0',
      dependencies: {},
    });

    await assert.rejects(
      verifyDesktopResources(root, { runCli: false }),
      /Missing embedded CLI dependency: @moxxy\/sdk/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('desktop resource verifier starts the embedded CLI and finds the Codex provider', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moxxy-valid-resources-'));
  try {
    await writeValidResources(root);

    const report = await verifyDesktopResources(root);
    assert.equal(report.cliVersion, '1.2.3');
    assert.equal(report.providerVersion, '1.2.3');
    assert.equal(report.seedPackageCount, 4);
    assert.equal(report.voiceCount, VOICE_CATALOG.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('desktop resource verifier rejects a plugin seed without the Claude sign-in provider', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moxxy-no-claude-resources-'));
  try {
    await writeValidResources(root, { seedProviders: ['@moxxy/plugin-provider-openai-codex'] });

    await assert.rejects(
      verifyDesktopResources(root, { runCli: false }),
      /plugins-seed manifest does not include @moxxy\/plugin-provider-claude-code/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('desktop resource verifier rejects a plugin seed without the offline voice', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moxxy-no-piper-resources-'));
  try {
    await writeValidResources(root, { offlineVoice: false });

    await assert.rejects(
      verifyDesktopResources(root, { runCli: false }),
      /plugins-seed manifest does not include @moxxy\/plugin-tts-local/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('desktop resource verifier rejects a plugin seed without the Gemini voice the settings offer', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moxxy-no-gemini-resources-'));
  try {
    await writeValidResources(root, { cloudVoice: false });

    await assert.rejects(
      verifyDesktopResources(root, { runCli: false }),
      /plugins-seed manifest does not include @moxxy\/plugin-tts-gemini/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('desktop resource verifier rejects resources that leave a voice to be downloaded', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moxxy-no-voice-resources-'));
  try {
    await writeValidResources(root);
    const [voice] = VOICE_CATALOG;
    await rm(path.join(root, 'models-seed', 'tts', voice.id, voice.archiveRootDir, voice.modelFile));

    await assert.rejects(
      verifyDesktopResources(root, { runCli: false }),
      new RegExp(`Bundled voice ${voice.id} is missing`),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('desktop resource verifier rejects a bundled voice that is not the pinned one', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moxxy-wrong-voice-resources-'));
  try {
    await writeValidResources(root);
    const [voice] = VOICE_CATALOG;
    await writeFile(path.join(root, 'models-seed', 'tts', voice.id, '.model.ok'), 'f'.repeat(64));

    await assert.rejects(
      verifyDesktopResources(root, { runCli: false }),
      new RegExp(`Bundled voice ${voice.id} is not the pinned archive`),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('desktop resource verifier rejects resources that leave Node or Python to be installed by hand', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moxxy-no-runtime-resources-'));
  try {
    await writeValidResources(root);
    await rm(path.join(root, 'runtimes-seed', 'win32-x64', 'python.tar.gz'));
    await assert.rejects(
      verifyDesktopResources(root, { runCli: false, platform: 'win32', arch: 'x64' }),
      /Bundled python runtime for win32-x64 is missing/,
    );

    await rm(path.join(root, 'runtimes-seed', 'linux-x64'), { recursive: true });
    await assert.rejects(
      verifyDesktopResources(root, { runCli: false, platform: 'linux', arch: 'x64' }),
      /Bundled runtimes for linux-x64 are missing/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('desktop resource verifier rejects resources that leave Git to be installed by hand', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moxxy-no-git-resources-'));
  try {
    await writeValidResources(root);
    await writeJson(path.join(root, 'runtimes-seed', 'win32-x64', 'manifest.json'), {
      runtimes: [
        { name: 'node', id: `${NODE_VERSION}-aaaaaaaaaaaa`, archive: 'node.zip' },
        { name: 'python', id: `${PYTHON_VERSION}-bbbbbbbbbbbb`, archive: 'python.tar.gz' },
        { name: 'git', id: `${gitVersion('darwin-arm64')}-cccccccccccc`, archive: 'git.tar.gz' },
      ],
    });
    await assert.rejects(
      verifyDesktopResources(root, { runCli: false, platform: 'win32', arch: 'x64' }),
      /Bundled git runtime for win32-x64 is not the pinned version/,
    );

    await rm(path.join(root, 'runtimes-seed', 'darwin-x64', 'git.tar.gz'));
    await assert.rejects(
      verifyDesktopResources(root, { runCli: false, platform: 'darwin' }),
      /Bundled git runtime for darwin-x64 is missing/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('desktop resource verifier wants both architectures in a macOS app, which is universal', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moxxy-one-arch-resources-'));
  try {
    await writeValidResources(root);
    assert.deepEqual(runtimeTargets('darwin', 'arm64'), ['darwin-arm64', 'darwin-x64']);
    await rm(path.join(root, 'runtimes-seed', 'darwin-x64'), { recursive: true });

    await assert.rejects(
      verifyDesktopResources(root, { runCli: false, platform: 'darwin' }),
      /Bundled runtimes for darwin-x64 are missing/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('desktop resource verifier rejects a bundled runtime that is not the pinned version', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moxxy-old-runtime-resources-'));
  try {
    await writeValidResources(root);
    await writeJson(path.join(root, 'runtimes-seed', 'win32-x64', 'manifest.json'), {
      runtimes: [
        { name: 'node', id: 'v18.0.0-aaaaaaaaaaaa', archive: 'node.zip' },
        { name: 'python', id: `${PYTHON_VERSION}-bbbbbbbbbbbb`, archive: 'python.tar.gz' },
      ],
    });

    await assert.rejects(
      verifyDesktopResources(root, { runCli: false, platform: 'win32', arch: 'x64' }),
      /Bundled node runtime for win32-x64 is not the pinned version/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('desktop resource verifier rejects a plugin seed without its package lock', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moxxy-unlocked-resources-'));
  try {
    await writeValidResources(root, { includeSeedLock: false });

    await assert.rejects(
      verifyDesktopResources(root, { runCli: false }),
      /plugins-seed package lock/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a seed fingerprint names each top-level package by its content, and only that', async () => {
  const seed = await mkdtemp(path.join(tmpdir(), 'moxxy-seed-fingerprints-'));
  try {
    const modules = path.join(seed, 'node_modules');
    await writePackage(path.join(modules, '@moxxy', 'plugin-browser'), '@moxxy/plugin-browser');
    await writePackage(path.join(modules, 'zod'), 'zod');
    await mkdir(path.join(modules, '.bin'), { recursive: true });
    await writeFile(path.join(modules, '.package-lock.json'), '{}');

    const first = await seedFingerprints(seed);
    assert.deepEqual(Object.keys(first).sort(), ['@moxxy/plugin-browser', 'zod']);
    assert.deepEqual(await seedFingerprints(seed), first);

    await writeFile(path.join(modules, '@moxxy', 'plugin-browser', 'dist', 'index.js'), 'export const changed = 1;\n');
    const edited = await seedFingerprints(seed);
    assert.notEqual(edited['@moxxy/plugin-browser'], first['@moxxy/plugin-browser']);
    assert.equal(edited.zod, first.zod);

    // Restoring a lost executable permission is a change the installed copy needs.
    if (process.platform !== 'win32') {
      await chmod(path.join(modules, 'zod', 'dist', 'index.js'), 0o755);
      assert.notEqual((await seedFingerprints(seed)).zod, first.zod);
    }
  } finally {
    await rm(seed, { recursive: true, force: true });
  }
});

test('desktop resource verifier rejects a plugin seed without fingerprints, which could not replace an old install', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moxxy-unfingerprinted-resources-'));
  try {
    await writeValidResources(root);
    await rm(path.join(root, 'plugins-seed', SEED_FINGERPRINTS_FILE));

    await assert.rejects(verifyDesktopResources(root, { runCli: false }), /plugins-seed fingerprints/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('desktop resource verifier rejects fingerprints that no longer match the seed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moxxy-stale-fingerprints-'));
  try {
    await writeValidResources(root);
    await writeFile(
      path.join(root, 'plugins-seed', 'node_modules', '@moxxy', 'plugin-tts-gemini', 'dist', 'index.js'),
      'export const rebuilt = true;\n',
    );

    await assert.rejects(
      verifyDesktopResources(root, { runCli: false }),
      /plugins-seed fingerprints do not match @moxxy\/plugin-tts-gemini/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a packaged app, whose binaries signing rewrote, still needs a fingerprint for every package', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moxxy-signed-resources-'));
  try {
    await writeValidResources(root);
    const gemini = path.join(root, 'plugins-seed', 'node_modules', '@moxxy', 'plugin-tts-gemini');
    await writeFile(path.join(gemini, 'dist', 'index.js'), 'export const signed = true;\n');
    await verifyDesktopResources(root, { runCli: false, fingerprintContent: false });

    const file = path.join(root, 'plugins-seed', SEED_FINGERPRINTS_FILE);
    const recorded = JSON.parse(await readFile(file, 'utf8'));
    delete recorded.packages['@moxxy/plugin-tts-gemini'];
    await writeJson(file, recorded);
    await assert.rejects(
      verifyDesktopResources(root, { runCli: false, fingerprintContent: false }),
      /plugins-seed fingerprints do not cover @moxxy\/plugin-tts-gemini/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('desktop resources reject a computer extension without the native component', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moxxy-native-resource-test-'));
  try {
    await writeValidResources(root);
    const seed = path.join(root, 'plugins-seed');
    const name = '@moxxy/plugin-computer-control';
    for (const filename of ['package.json', 'package-lock.json']) {
      const file = path.join(seed, filename);
      const json = JSON.parse(await readFile(file, 'utf8'));
      const entry = filename === 'package.json' ? json : json.packages[''];
      entry.dependencies[name] = '1.2.3';
      await writeJson(file, json);
    }
    const plugin = path.join(seed, 'node_modules', name);
    await mkdir(path.join(plugin, 'dist'), { recursive: true });
    await writeJson(path.join(plugin, 'package.json'), { name, version: '1.2.3', moxxy: { plugin: { entry: './dist/index.js' } } });
    await writeFile(path.join(plugin, 'dist/index.js'), 'export {};');
    // The build fingerprints the seed last, after every change to it.
    await writeSeedFingerprints(seed);
    await assert.rejects(verifyDesktopResources(root, { runCli: false, platform: 'win32' }), /Windows Computer Use/);
    await assert.rejects(verifyDesktopResources(root, { runCli: false, platform: 'darwin' }), /macOS Computer Use/);
    await assert.rejects(verifyDesktopResources(root, { runCli: false, platform: 'linux' }), /Linux Computer Use/);

    // A universal Mach-O header with its manifest is what the macOS build ships.
    const helper = path.join(plugin, 'bin', 'darwin-universal', 'moxxy-computer');
    await mkdir(path.dirname(helper), { recursive: true });
    const header = Buffer.alloc(8 + 2 * 20);
    header.writeUInt32BE(0xcafebabe, 0);
    header.writeUInt32BE(2, 4);
    header.writeUInt32BE(0x01000007, 8);
    header.writeUInt32BE(0x0100000c, 28);
    await writeFile(helper, header);
    await writeHelperManifest(helper, { protocolVersion: CONTRACT_PROTOCOL_VERSION, architecture: 'universal' });
    await writeSeedFingerprints(seed);
    // Packing a plugin drops the permission to run its files; Windows has no such permission.
    if (process.platform !== 'win32') {
      await assert.rejects(verifyDesktopResources(root, { runCli: false, platform: 'darwin' }), /macOS Computer Use component cannot be run/);
      await chmod(helper, 0o755);
      await writeSeedFingerprints(seed);
    }
    await verifyDesktopResources(root, { runCli: false, platform: 'darwin' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('packaged verifier locates Windows, Linux, and macOS resource roots', async () => {
  const releaseDir = await mkdtemp(path.join(tmpdir(), 'moxxy-release-layout-'));
  try {
    await mkdir(path.join(releaseDir, 'win-unpacked'));
    await mkdir(path.join(releaseDir, 'linux-unpacked'));
    await mkdir(path.join(releaseDir, 'mac-arm64', 'MoxxyAI Workspaces.app'), {
      recursive: true,
    });

    const apps = await findPackagedApps(releaseDir);
    assert.deepEqual(
      apps.map((app) => path.relative(releaseDir, app.resourcesPath)).sort(),
      [
        path.join('linux-unpacked', 'resources'),
        path.join('mac-arm64', 'MoxxyAI Workspaces.app', 'Contents', 'Resources'),
        path.join('win-unpacked', 'resources'),
      ],
    );
  } finally {
    await rm(releaseDir, { recursive: true, force: true });
  }
});

test('universal macOS guard reports native packages missing their other-arch sibling', async () => {
  const resources = await mkdtemp(path.join(tmpdir(), 'moxxy-darwin-arch-'));
  try {
    const seed = path.join(resources, 'plugins-seed', 'node_modules');
    await writePackage(path.join(seed, '@napi-rs', 'keyring-darwin-arm64'), '@napi-rs/keyring-darwin-arm64');
    await writePackage(path.join(seed, '@napi-rs', 'keyring-darwin-x64'), '@napi-rs/keyring-darwin-x64');
    await writePackage(path.join(seed, '@img', 'sharp-darwin-arm64'), '@img/sharp-darwin-arm64');
    await writePackage(
      path.join(resources, 'moxxy-cli', 'node_modules', '.pnpm', 'fsevents-darwin-x64@1.0.0', 'node_modules', 'fsevents-darwin-x64'),
      'fsevents-darwin-x64',
    );

    assert.deepEqual(await findDarwinArchGaps(resources), [
      'moxxy-cli: fsevents-darwin-x64 has no fsevents-darwin-arm64',
      'plugins-seed: @img/sharp-darwin-arm64 has no @img/sharp-darwin-x64',
    ]);
  } finally {
    await rm(resources, { recursive: true, force: true });
  }
});

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writePackage(packageDir, name, extra = {}) {
  await mkdir(path.join(packageDir, 'dist'), { recursive: true });
  await writeJson(path.join(packageDir, 'package.json'), {
    name,
    version: '1.2.3',
    type: 'module',
    main: './dist/index.js',
    ...extra,
  });
  await writeFile(path.join(packageDir, 'dist', 'index.js'), 'export {};\n');
}

const OFFLINE_VOICE = '@moxxy/plugin-tts-local';
const CLOUD_VOICE = '@moxxy/plugin-tts-gemini';
const SIGN_IN_PROVIDERS = ['@moxxy/plugin-provider-openai-codex', '@moxxy/plugin-provider-claude-code'];

async function writeValidResources(
  root,
  { includeSeedLock = true, seedProviders = SIGN_IN_PROVIDERS, offlineVoice = true, cloudVoice = true } = {},
) {
  const seedPackages = [
    ...seedProviders,
    ...(offlineVoice ? [OFFLINE_VOICE] : []),
    ...(cloudVoice ? [CLOUD_VOICE] : []),
  ];
  const cliDir = path.join(root, 'moxxy-cli');
  await mkdir(path.join(cliDir, 'dist'), { recursive: true });
  await writeJson(path.join(cliDir, 'package.json'), {
    name: '@moxxy/cli',
    version: '1.2.3',
    type: 'module',
  });
  await writeFile(path.join(cliDir, 'dist', 'bin.js'), 'console.log("moxxy 1.2.3");\n');
  for (const dependency of ['@moxxy/sdk', 'zod', 'undici']) {
    await writePackage(path.join(cliDir, 'node_modules', dependency), dependency);
  }

  const seedDir = path.join(root, 'plugins-seed');
  await mkdir(seedDir, { recursive: true });
  const dependencies = Object.fromEntries(seedPackages.map((name) => [name, '1.2.3']));
  await writeJson(path.join(seedDir, 'package.json'), {
    name: 'moxxy-plugins-seed',
    version: '1.0.0',
    dependencies,
  });
  if (includeSeedLock) {
    await writeJson(path.join(seedDir, 'package-lock.json'), {
      name: 'moxxy-plugins-seed',
      lockfileVersion: 3,
      packages: { '': { dependencies } },
    });
  }
  for (const name of seedPackages) {
    await writePackage(path.join(seedDir, 'node_modules', name), name, {
      moxxy: { plugin: { entry: './dist/index.js', kind: 'provider' } },
    });
  }
  await writeSeedFingerprints(seedDir);
  for (const target of Object.keys(RUNTIME_TARGETS)) {
    const dir = path.join(root, 'runtimes-seed', target);
    await mkdir(dir, { recursive: true });
    const nodeArchive = target.startsWith('win32') ? 'node.zip' : target.startsWith('linux') ? 'node.tar.xz' : 'node.tar.gz';
    await writeFile(path.join(dir, nodeArchive), 'node');
    await writeFile(path.join(dir, 'python.tar.gz'), 'python');
    await writeFile(path.join(dir, 'git.tar.gz'), 'git');
    await writeJson(path.join(dir, 'manifest.json'), {
      runtimes: [
        { name: 'node', id: `${NODE_VERSION}-aaaaaaaaaaaa`, archive: nodeArchive },
        { name: 'python', id: `${PYTHON_VERSION}-bbbbbbbbbbbb`, archive: 'python.tar.gz' },
        { name: 'git', id: `${gitVersion(target)}-cccccccccccc`, archive: 'git.tar.gz' },
      ],
    });
  }
  for (const voice of VOICE_CATALOG) {
    const voiceDir = path.join(root, 'models-seed', 'tts', voice.id);
    await mkdir(path.join(voiceDir, voice.archiveRootDir), { recursive: true });
    await writeFile(path.join(voiceDir, voice.archiveRootDir, voice.modelFile), 'model');
    await writeFile(path.join(voiceDir, '.model.ok'), `${voice.sha256}\n`);
  }
}

test('pnpm is run through node only when its entrypoint is a script', () => {
  const node = path.join('opt', 'node');
  assert.deepEqual(pnpmCommand(path.join('lib', 'pnpm', 'bin', 'pnpm.cjs'), node), {
    command: node,
    prefix: [path.join('lib', 'pnpm', 'bin', 'pnpm.cjs')],
  });
  assert.deepEqual(pnpmCommand(path.join('lib', 'pnpm', 'dist', 'pnpm.mjs'), node), {
    command: node,
    prefix: [path.join('lib', 'pnpm', 'dist', 'pnpm.mjs')],
  });
  // pnpm 11+ and the standalone build hand scripts a native executable.
  for (const native of ['C:\\store\\@pnpm\\exe\\pnpm.exe', '/store/@pnpm/exe/pnpm', 'C:\\store\\PNPM.EXE']) {
    assert.deepEqual(pnpmCommand(native, node), { command: native, prefix: [] });
  }
});

test('pnpm entrypoint is required, since the deploy step cannot guess it', () => {
  assert.throws(() => pnpmCommand(undefined, 'node'), /run through pnpm/);
  assert.throws(() => pnpmCommand('', 'node'), /run through pnpm/);
});

test('a native pnpm that is running the build is used as is, a script entrypoint is not', () => {
  assert.equal(nativePnpm('C:\\store\\@pnpm\\exe\\pnpm.exe'), 'C:\\store\\@pnpm\\exe\\pnpm.exe');
  assert.equal(nativePnpm('/store/@pnpm/exe/pnpm'), '/store/@pnpm/exe/pnpm');
  assert.equal(nativePnpm('/lib/pnpm/bin/pnpm.cjs'), undefined);
  assert.equal(nativePnpm('/lib/npm/bin/npm-cli.js'), undefined);
  assert.equal(nativePnpm('/usr/bin/yarn'), undefined);
  assert.equal(nativePnpm(undefined), undefined);
});
