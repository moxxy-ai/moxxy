import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { verifyDesktopResources } from '../apps/desktop/scripts/verify-desktop-resources.mjs';
import { CONTRACT_PROTOCOL_VERSION } from '../packages/plugin-computer-control/dist/backend/rpc.js';
import { writeHelperManifest } from '../packages/plugin-computer-control/dist/helper/artifact.js';
import { findDarwinArchGaps, findPackagedApps } from '../apps/desktop/scripts/verify-packaged-desktop.mjs';
import { VOICE_CATALOG } from '../packages/plugin-tts-local/dist/voices.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('desktop extraResources copies the dependency trees and the voices from their parent', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(repo, 'apps/desktop/package.json'), 'utf8'),
  );
  assert.deepEqual(manifest.build.extraResources, [
    {
      from: 'resources',
      to: '.',
      filter: ['moxxy-cli/**/*', 'plugins-seed/**/*', 'models-seed/**/*'],
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
  for (const voice of VOICE_CATALOG) {
    const voiceDir = path.join(root, 'models-seed', 'tts', voice.id);
    await mkdir(path.join(voiceDir, voice.archiveRootDir), { recursive: true });
    await writeFile(path.join(voiceDir, voice.archiveRootDir, voice.modelFile), 'model');
    await writeFile(path.join(voiceDir, '.model.ok'), `${voice.sha256}\n`);
  }
}
