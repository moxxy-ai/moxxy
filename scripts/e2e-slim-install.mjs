#!/usr/bin/env node
/**
 * Fresh-install smoke for the slim CLI + on-demand plugins. Run manually per
 * unbundle batch (not wired into CI — it global-installs into a temp prefix
 * and shells npm):
 *
 *   pnpm build && node scripts/e2e-slim-install.mjs [pkg-dir ...]
 *
 * Steps:
 *  1. `pnpm pack` the CLI (exercises prepack/postpack devDep stripping and
 *     the workspace:* → exact-version rewrite) + each named plugin package
 *     (default: mode-goal).
 *  2. `npm install -g` the CLI tarball into a temp prefix (fetches the
 *     published @moxxy/sdk — needs network).
 *  3. Boot with a fresh MOXXY_HOME: `moxxy plugins list` must succeed and
 *     must NOT list the unbundled packages as loaded.
 *  4. `moxxy plugins install <plugin.tgz>` (path spec) + re-list: the plugin
 *     must appear as loaded/installed.
 *
 * IMPORTANT: build the workspace first — a plugin packed without dist/ is
 * silently skipped by discovery (its moxxy.plugin.entry points at nothing).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pkgs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['mode-goal'];
const work = mkdtempSync(path.join(tmpdir(), 'moxxy-slim-smoke-'));
const prefix = path.join(work, 'npmprefix');
const home = path.join(work, 'home');

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts });

console.log(`work dir: ${work}`);

// 1. pack
run('pnpm', ['pack', '--out', path.join(work, 'cli.tgz')], { cwd: path.join(repo, 'packages/cli') });
for (const p of pkgs) {
  run('pnpm', ['pack', '--out', path.join(work, `${p}.tgz`)], { cwd: path.join(repo, 'packages', p) });
}

// 2. global install into the sandbox prefix
run('npm', ['install', '-g', '--prefix', prefix, path.join(work, 'cli.tgz')]);
const moxxy = path.join(prefix, 'bin', 'moxxy');
const env = { ...process.env, MOXXY_HOME: home };

// 3. fresh boot — unbundled packages must be absent from the loaded list
const before = run(moxxy, ['plugins', 'list'], { env });
for (const p of pkgs) {
  const scoped = p.startsWith('plugin-') || p.startsWith('mode-') ? `@moxxy/${p}` : p;
  if (new RegExp(`^\\s+${scoped.replace('/', '\\/')}\\s+@`, 'm').test(before)) {
    throw new Error(`${scoped} is still bundled (listed as loaded on a fresh boot)`);
  }
}
console.log('fresh boot OK — unbundled packages absent');

// 4. on-demand install (path spec) + verify discovery
for (const p of pkgs) {
  run(moxxy, ['plugins', 'install', path.join(work, `${p}.tgz`)], { env });
  const after = run(moxxy, ['plugins', 'list'], { env });
  const scoped = `@moxxy/${p}`;
  if (!new RegExp(`^\\s+${scoped.replace('/', '\\/')}\\s+@`, 'm').test(after)) {
    throw new Error(`${scoped} did not load after install — check dist/ was built before packing`);
  }
  console.log(`${scoped}: installed + discovered ✓`);
}

// exactly one hoisted @moxxy/sdk in the user plugins tree
const sdkDirs = readdirSync(path.join(home, 'plugins', 'node_modules', '@moxxy')).filter(
  (d) => d === 'sdk',
);
console.log(`hoisted @moxxy/sdk copies: ${sdkDirs.length === 1 ? '1 ✓' : 'UNEXPECTED'}`);
console.log('slim-install smoke PASSED');
