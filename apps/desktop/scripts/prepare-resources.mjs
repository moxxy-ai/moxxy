#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pnpmCommand } from './pnpm-command.mjs';
import { verifyDesktopResources } from './verify-desktop-resources.mjs';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(desktopDir, '../..');
const resourcesDir = path.join(desktopDir, 'resources');
const cliDir = path.join(resourcesDir, 'moxxy-cli');
const pnpm = pnpmCommand(process.env.npm_execpath);

rmSync(cliDir, { recursive: true, force: true });
run(pnpm.command, [...pnpm.prefix, '--filter', '@moxxy/cli', '--legacy', 'deploy', '--prod', cliDir]);

// pnpm deploy creates one workspace-only self-link. It resolves in the source
// checkout but dangles after copying/signing the packaged application.
rmSync(path.join(cliDir, 'node_modules', '.pnpm', 'node_modules', '@moxxy', 'cli'), {
  force: true,
});

runNode([path.join(desktopDir, 'scripts', 'bundle-plugins-seed.mjs')]);
runNode([path.join(desktopDir, 'scripts', 'bundle-models-seed.mjs')]);
runNode([path.join(desktopDir, 'scripts', 'bundle-runtimes-seed.mjs')]);

const report = await verifyDesktopResources(resourcesDir);
console.log(
  `Desktop resources prepared: CLI ${report.cliVersion}, ${report.seedPackageCount} seed packages, ${report.voiceCount} voices, OpenAI Codex provider ${report.providerVersion}`,
);

function runNode(args) {
  run(process.execPath, args);
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: repo,
    stdio: 'inherit',
  });
}
