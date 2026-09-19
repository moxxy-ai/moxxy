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
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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
 *  from local tarballs (usage-stats→core, oauth→vault, everything→sdk). */
const CLOSURE = ['sdk', 'core', 'config', 'channel-kit', 'plugin-vault', 'plugin-tunnel-proxy', 'e2e', 'plugin-provider-openai-codex'];
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
