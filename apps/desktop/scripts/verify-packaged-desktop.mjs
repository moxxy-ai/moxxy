#!/usr/bin/env node
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
      });
    }
  }
  return apps;
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
