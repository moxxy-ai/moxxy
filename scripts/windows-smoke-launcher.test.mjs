import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { execExecutableTargetSync, resolveExecutableTarget } from '../packages/sdk/dist/server.js';

test('Windows smoke uses a lifecycle script that supplies the real pnpm entrypoint', async () => {
  const pnpm = resolveExecutableTarget('pnpm', { nodeEntryHint: process.env.npm_execpath });
  assert.ok(pnpm);
  const root = await mkdtemp(path.join(tmpdir(), 'moxxy-smoke-launcher-'));
  try {
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      private: true,
      scripts: { probe: 'node probe.cjs' },
    }));
    await writeFile(path.join(root, 'probe.cjs'),
      "require('node:fs').writeFileSync('entry.txt', process.env.npm_execpath || '');\n");
    const env = { ...process.env, npm_execpath: undefined };
    // Execute real pnpm commands, starting without an inherited lifecycle hint.
    execExecutableTargetSync(pnpm, ['exec', 'node', 'probe.cjs'], {
      cwd: root, env, stdio: 'pipe', timeout: 30_000,
    });
    assert.equal(await readFile(path.join(root, 'entry.txt'), 'utf8'), '');
    execExecutableTargetSync(pnpm, ['run', 'probe'], {
      cwd: root, env, stdio: 'pipe', timeout: 30_000,
    });
    const entry = await readFile(path.join(root, 'entry.txt'), 'utf8');
    assert.ok(path.isAbsolute(entry));
    assert.match(path.basename(entry), /^pnpm\.(cjs|js)$/);
    await readFile(entry);

    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(manifest.scripts['smoke:windows-installer'], 'node apps/desktop/scripts/smoke-windows-installer.mjs');
    const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    assert.match(workflow, /pnpm run smoke:windows-installer \$installer[^\n]+--local-packages/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
