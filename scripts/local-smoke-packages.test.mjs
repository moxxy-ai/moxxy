import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { execExecutableTargetSync, resolveExecutableTarget } from '../packages/sdk/dist/server.js';

import { prepareLocalSmokePackages } from '../apps/desktop/scripts/local-smoke-packages.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

test('prepublish smoke packs the real first-party closure and installs it without a registry', async () => {
  const pluginsDir = await mkdtemp(path.join(tmpdir(), 'moxxy-local-smoke-'));
  try {
    await writeFile(path.join(pluginsDir, 'package.json'), JSON.stringify({
      name: 'smoke-test', private: true, dependencies: { '@moxxy/cache-strategy-stable-prefix': '0.0.1' },
    }));
    const sources = await prepareLocalSmokePackages({
      repoRoot, pluginsDir, packageNames: ['@moxxy/cache-strategy-stable-prefix'],
    });
    const manifest = JSON.parse(await readFile(path.join(pluginsDir, 'package.json'), 'utf8'));
    assert.ok(sources['@moxxy/cache-strategy-stable-prefix'].endsWith('.tgz'));
    assert.match(manifest.dependencies['@moxxy/sdk'], /^file:/);
    assert.match(manifest.dependencies['@moxxy/cache-strategy-stable-prefix'], /^file:/);
    // Use the real npm shipped alongside Node, not a simulated registry/client.
    const npm = resolveExecutableTarget('npm');
    assert.ok(npm);
    // This package only needs the SDK. Suppress optional peer installation so
    // the regression test is independent of both npm's cache and the network.
    execExecutableTargetSync(npm, ['install', '--offline', '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', path.join(pluginsDir, 'npm-cache')], {
      cwd: pluginsDir, timeout: 30_000, stdio: 'pipe',
    });
    for (const name of ['@moxxy/sdk', '@moxxy/cache-strategy-stable-prefix']) {
      const installed = JSON.parse(await readFile(path.join(pluginsDir, 'node_modules', name, 'package.json'), 'utf8'));
      const source = JSON.parse(await readFile(path.join(repoRoot, 'packages', name.slice(7), 'package.json'), 'utf8'));
      assert.equal(installed.version, source.version);
    }
  } finally {
    await rm(pluginsDir, { recursive: true, force: true });
  }
});
