import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { verifyDesktopResources } from '../apps/desktop/scripts/verify-desktop-resources.mjs';
import { findPackagedApps } from '../apps/desktop/scripts/verify-packaged-desktop.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('desktop extraResources copies both dependency trees from their parent', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(repo, 'apps/desktop/package.json'), 'utf8'),
  );
  assert.deepEqual(manifest.build.extraResources, [
    {
      from: 'resources',
      to: '.',
      filter: ['moxxy-cli/**/*', 'plugins-seed/**/*'],
    },
  ]);
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
    assert.equal(report.seedPackageCount, 1);
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

async function writeValidResources(root, { includeSeedLock = true } = {}) {
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
  const dependencies = { '@moxxy/plugin-provider-openai-codex': '1.2.3' };
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
  await writePackage(
    path.join(seedDir, 'node_modules', '@moxxy', 'plugin-provider-openai-codex'),
    '@moxxy/plugin-provider-openai-codex',
    { moxxy: { plugin: { entry: './dist/index.js', kind: 'provider' } } },
  );
}
