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
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

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

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const seedDir = path.join(repo, 'apps/desktop/resources/plugins-seed');
const tarDir = mkdtempSync(path.join(tmpdir(), 'moxxy-seed-tars-'));

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'], ...opts });

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

rmSync(tarDir, { recursive: true, force: true });
console.log(`plugins-seed assembled at ${seedDir} (${SEED_PLUGINS.length} plugins + closure)`);
