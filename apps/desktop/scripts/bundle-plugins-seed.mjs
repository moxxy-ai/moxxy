#!/usr/bin/env node
/**
 * Assemble `resources/plugins-seed` — a ready-to-copy npm prefix tree of the
 * on-demand first-party plugins the desktop expects out of the box. The
 * packaged app copies it into `~/.moxxy/plugins` on first launch (see
 * `@moxxy/desktop-host` seed-plugins.ts), giving an OFFLINE first run: no
 * npm, no network, while the npm CLI itself stays slim.
 *
 * Run from the repo root (workspace context required):
 *   node apps/desktop/scripts/bundle-plugins-seed.mjs
 *
 * Mechanics: `pnpm pack` each seed package (rewrites workspace:* to exact
 * versions) plus its first-party dep closure (sdk/core/vault), then
 * `npm install --prefix resources/plugins-seed <tarballs...>` so third-party
 * deps resolve at BUILD time. Installing the closure from local tarballs
 * (not the registry) keeps this runnable before the release publishes.
 *
 * IMPORTANT: build the workspace first — a package packed without dist/ is
 * silently skipped by plugin discovery at runtime.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  execExecutableTargetSync,
  resolveExecutableTarget,
  writeFileAtomicSync,
} from '@moxxy/sdk/server';

/** On-demand plugins seeded into the desktop. Extend as batches unbundle. */
const SEED_PLUGINS = [
  // API-key providers (init/provision normally install these on demand).
  'plugin-provider-anthropic',
  'plugin-provider-openai',
  'plugin-provider-google',
  'plugin-provider-xai',
  'plugin-provider-zai',
  'plugin-provider-local',
  // Claude Pro/Max sign-in — the desktop signs in through it, so it must be
  // registered before the user picks it (not installed on demand).
  'plugin-provider-claude-code',
  // Slim-wave batch 1.
  'mode-goal',
  'mode-deep-research',
  'plugin-subagents',
  'plugin-oauth',
  'plugin-computer-control',
  'plugin-channel-http',
  'plugin-usage-stats',
  // Slim-wave batch 2.
  'plugin-view',
  'plugin-self-update',
  'plugin-voice-admin',
  // Slim-wave batches 3+4 (desktop surfaces ride these).
  'plugin-browser',
  'plugin-terminal',
  'plugin-channel-web',
  // Slim-wave batches 5+6 (desktop voice, Settings panels, Apps→Channels).
  'plugin-stt-whisper',
  'plugin-stt-whisper-codex',
  'plugin-telegram',
  'plugin-channel-slack',
  'plugin-channel-whatsapp',
  'plugin-provider-admin',
  'plugin-mcp',
  'plugin-memory',
];

/** First-party runtime deps of seed members — packed so the closure installs
 *  from local tarballs (usage-stats→core, oauth→vault, channel-kit→chat-model,
 *  everything→sdk). None of these are on npm, so a missing one fails with 404. */
const CLOSURE = ['sdk', 'core', 'config', 'channel-kit', 'chat-model', 'plugin-vault', 'plugin-tunnel-proxy', 'e2e', 'plugin-provider-openai-codex'];
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?(?:\+[0-9a-z.-]+)?$/i;

// fileURLToPath, NOT url.pathname — pathname on Windows is `/D:/a/...`, which
// path.resolve prefixes with the drive again (`D:\D:\a\...`).
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const seedDir = path.join(repo, 'apps/desktop/resources/plugins-seed');
const tarDir = mkdtempSync(path.join(tmpdir(), 'moxxy-seed-tars-'));

const run = (cmd, args, opts = {}) => {
  const target = resolveExecutableTarget(cmd, {
    nodeEntryHint: packageManagerEntryHint(cmd),
  });
  if (!target) throw new Error(`Build command not found on PATH: ${cmd}`);
  execExecutableTargetSync(target, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    ...opts,
  });
};

rmSync(seedDir, { recursive: true, force: true });
mkdirSync(seedDir, { recursive: true });

for (const p of [...SEED_PLUGINS, ...CLOSURE]) {
  run('pnpm', ['pack', '--out', path.join(tarDir, `${p}.tgz`)], {
    cwd: path.join(repo, 'packages', p),
  });
}

const tarballs = readdirSync(tarDir).map((f) => path.join(tarDir, f));
run('npm', [
  'install',
  '--prefix',
  seedDir,
  '--no-fund',
  '--no-audit',
  '--install-links=false',
  ...tarballs,
]);

if (process.platform === 'darwin') installOtherDarwinArchPackages();

// npm records direct local tarballs exactly as `file:/tmp/moxxy-seed-tars-*`.
// The tar directory is intentionally removed below, so persisting those specs
// would poison every later `npm install` in the user's copied plugin tree.
// Replace them with the exact versions npm just installed while both sources
// are still available.
const seedManifestPath = path.join(seedDir, 'package.json');
const seedManifest = JSON.parse(readFileSync(seedManifestPath, 'utf8'));
for (const [name, spec] of Object.entries(seedManifest.dependencies ?? {})) {
  if (!isTransientSeedTarball(spec)) continue;
  const installedManifest = JSON.parse(
    readFileSync(path.join(seedDir, 'node_modules', name, 'package.json'), 'utf8'),
  );
  if (
    installedManifest.name !== name ||
    typeof installedManifest.version !== 'string' ||
    !EXACT_VERSION.test(installedManifest.version)
  ) {
    throw new Error(`Cannot normalize transient seed dependency ${name}`);
  }
  seedManifest.dependencies[name] = installedManifest.version;
}
writeFileAtomicSync(seedManifestPath, `${JSON.stringify(seedManifest, null, 2)}\n`);

rmSync(tarDir, { recursive: true, force: true });
console.log(`plugins-seed assembled at ${seedDir} (${SEED_PLUGINS.length} plugins + closure)`);

// npm only installs optional platform packages for the host arch, but the
// macOS app is universal: an arm64 build runner must also ship the x64 native
// packages (keyring, sharp) or Intel Macs silently lose them. The lockfile
// pins every platform variant with its integrity, so fetch the missing ones.
function installOtherDarwinArchPackages() {
  const lock = JSON.parse(readFileSync(path.join(seedDir, 'package-lock.json'), 'utf8'));
  const packRoot = mkdtempSync(path.join(tmpdir(), 'moxxy-seed-darwin-'));
  let fetched = 0;
  for (const [lockPath, entry] of Object.entries(lock.packages ?? {})) {
    if (!lockPath || entry.link || !entry.os?.includes('darwin')) continue;
    if (!entry.cpu?.some((cpu) => cpu === 'x64' || cpu === 'arm64')) continue;
    const dest = path.join(seedDir, lockPath);
    if (existsSync(dest)) continue;
    const name = entry.name ?? lockPath.slice(lockPath.lastIndexOf('node_modules/') + 13);
    if (typeof entry.version !== 'string' || typeof entry.integrity !== 'string') {
      throw new Error(`Seed lockfile entry ${lockPath} has no pinned version/integrity`);
    }
    const packDir = path.join(packRoot, String(fetched++));
    mkdirSync(packDir);
    run('npm', ['pack', `${name}@${entry.version}`, '--pack-destination', packDir]);
    const [tarball] = readdirSync(packDir).map((f) => path.join(packDir, f));
    const digest = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
    if (digest !== entry.integrity) {
      throw new Error(`Integrity mismatch for ${name}@${entry.version}: ${digest}`);
    }
    mkdirSync(dest, { recursive: true });
    run('tar', ['-xzf', tarball, '-C', dest, '--strip-components=1']);
  }
  rmSync(packRoot, { recursive: true, force: true });
  console.log(`plugins-seed: fetched ${fetched} other-arch darwin package(s)`);
}

function isTransientSeedTarball(spec) {
  return (
    typeof spec === 'string' &&
    spec.startsWith('file:') &&
    /(?:^|[\\/])moxxy-seed-tars-[^\\/]+[\\/][^\\/]+\.tgz$/i.test(spec.slice(5))
  );
}

function packageManagerEntryHint(command) {
  const entry = process.env.npm_execpath;
  if (!entry) return undefined;
  const basename = path.basename(entry).toLowerCase();
  if (command === 'pnpm' && (basename === 'pnpm.cjs' || basename === 'pnpm.js')) return entry;
  if (command === 'npm' && (basename === 'npm-cli.js' || basename === 'npm.js')) return entry;
  return undefined;
}
