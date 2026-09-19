#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyDesktopResources } from './verify-desktop-resources.mjs';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(desktopDir, '../..');
const resourcesDir = path.join(desktopDir, 'resources');
const cliDir = path.join(resourcesDir, 'moxxy-cli');
const pnpmEntrypoint = process.env.npm_execpath;

if (!pnpmEntrypoint) {
  throw new Error('prepare:resources must be run through pnpm so npm_execpath is available');
}

rmSync(cliDir, { recursive: true, force: true });
runNode([
  pnpmEntrypoint,
  '--filter',
  '@moxxy/cli',
  '--legacy',
  'deploy',
  '--prod',
  cliDir,
]);

// pnpm deploy creates one workspace-only self-link. It resolves in the source
// checkout but dangles after copying/signing the packaged application.
rmSync(path.join(cliDir, 'node_modules', '.pnpm', 'node_modules', '@moxxy', 'cli'), {
  force: true,
});

runNode([path.join(desktopDir, 'scripts', 'bundle-plugins-seed.mjs')]);

const report = await verifyDesktopResources(resourcesDir);
console.log(
  `Desktop resources prepared: CLI ${report.cliVersion}, ${report.seedPackageCount} seed packages, OpenAI Codex provider ${report.providerVersion}`,
);

function runNode(args) {
  execFileSync(process.execPath, args, {
    cwd: repo,
    stdio: 'inherit',
  });
}
