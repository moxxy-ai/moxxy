#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyDesktopResources } from './verify-desktop-resources.mjs';

export async function findPackagedApps(releasePath) {
  const root = path.resolve(releasePath);
  const entries = await readdir(root, { withFileTypes: true });
  const apps = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const outputDir = path.join(root, entry.name);
    if (entry.name === 'win-unpacked') {
      apps.push({
        resourcesPath: path.join(outputDir, 'resources'),
        runtimePath: path.join(outputDir, 'MoxxyAI Workspaces.exe'),
      });
      continue;
    }
    if (entry.name.endsWith('-unpacked')) {
      apps.push({
        resourcesPath: path.join(outputDir, 'resources'),
        runtimePath: path.join(outputDir, 'moxxy-desktop'),
      });
      continue;
    }
    if (!entry.name.startsWith('mac')) continue;
    const children = await readdir(outputDir, { withFileTypes: true });
    for (const child of children) {
      if (!child.isDirectory() || !child.name.endsWith('.app')) continue;
      const appRoot = path.join(outputDir, child.name, 'Contents');
      apps.push({
        resourcesPath: path.join(appRoot, 'Resources'),
        runtimePath: path.join(appRoot, 'MacOS', child.name.slice(0, -4)),
        mac: true,
      });
    }
  }
  return apps;
}

const DARWIN_ARCH_ROOTS = ['plugins-seed', 'moxxy-cli', 'app.asar.unpacked'];
const DARWIN_ARCH_PACKAGE = /^(.+)-darwin-(arm64|x64)$/;

/** Native `*-darwin-<arch>` packages in a universal app's resources that lack
 *  their other-arch sibling (an arm64 runner installing host-arch optionals
 *  only leaves Intel Macs without them). */
export async function findDarwinArchGaps(resourcesPath) {
  const gaps = [];
  for (const root of DARWIN_ARCH_ROOTS) {
    const names = new Set();
    await collectDarwinArchPackages(path.join(resourcesPath, root), names);
    for (const name of names) {
      const [, base, arch] = DARWIN_ARCH_PACKAGE.exec(name);
      const sibling = `${base}-darwin-${arch === 'arm64' ? 'x64' : 'arm64'}`;
      if (!names.has(sibling)) gaps.push(`${root}: ${name} has no ${sibling}`);
    }
  }
  return gaps.sort();
}

async function collectDarwinArchPackages(dir, names) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    if (DARWIN_ARCH_PACKAGE.test(entry.name) && existsSync(path.join(child, 'package.json'))) {
      const scope = path.basename(dir);
      names.add(scope.startsWith('@') ? `${scope}/${entry.name}` : entry.name);
      continue;
    }
    await collectDarwinArchPackages(child, names);
  }
}

function isUniversalMacApp(runtimePath) {
  const archs = execFileSync('lipo', ['-archs', runtimePath], { encoding: 'utf8' }).split(/\s+/);
  return archs.includes('x86_64') && archs.includes('arm64');
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const releasePath = process.argv[2];
  if (!releasePath) {
    console.error('Usage: verify-packaged-desktop.mjs <release-directory>');
    process.exitCode = 2;
  } else {
    try {
      const apps = await findPackagedApps(releasePath);
      if (apps.length === 0) {
        throw new Error(`No unpacked desktop application found under ${path.resolve(releasePath)}`);
      }
      for (const app of apps) {
        const report = await verifyDesktopResources(app.resourcesPath, {
          runtimePath: app.runtimePath,
        });
        if (app.mac && process.platform === 'darwin' && isUniversalMacApp(app.runtimePath)) {
          const gaps = await findDarwinArchGaps(app.resourcesPath);
          if (gaps.length > 0) {
            throw new Error(`Universal macOS app is missing native packages:\n${gaps.join('\n')}`);
          }
        }
        console.log(
          `Packaged desktop verified at ${app.resourcesPath}: CLI ${report.cliVersion}, ${report.seedPackageCount} seed packages, provider ${report.providerVersion}`,
        );
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
