#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_CLI_DEPENDENCIES = ['@moxxy/sdk', 'zod', 'undici'];
const CODEX_PROVIDER = '@moxxy/plugin-provider-openai-codex';

export async function verifyDesktopResources(resourcesPath, options = {}) {
  const root = path.resolve(resourcesPath);
  const cliDir = path.join(root, 'moxxy-cli');
  const cliManifestPath = path.join(cliDir, 'package.json');
  const cliBin = path.join(cliDir, 'dist', 'bin.js');
  const seedDir = path.join(root, 'plugins-seed');
  const seedManifestPath = path.join(seedDir, 'package.json');
  const seedLockPath = path.join(seedDir, 'package-lock.json');

  const cliManifest = await readManifest(cliManifestPath, '@moxxy/cli');
  await requireFile(cliBin, 'embedded CLI entrypoint');
  for (const dependency of REQUIRED_CLI_DEPENDENCIES) {
    try {
      await readManifest(path.join(cliDir, 'node_modules', dependency, 'package.json'), dependency);
    } catch (error) {
      throw new Error(`Missing embedded CLI dependency: ${dependency}`, { cause: error });
    }
  }

  const seedManifest = await readManifest(seedManifestPath);
  const seedLock = await readSeedPackageLock(seedLockPath);
  if (typeof seedManifest.dependencies?.[CODEX_PROVIDER] !== 'string') {
    throw new Error(`plugins-seed manifest does not include ${CODEX_PROVIDER}`);
  }
  const seedDependencies = Object.keys(seedManifest.dependencies).filter((name) =>
    name.startsWith('@moxxy/'),
  );
  if (seedDependencies.length === 0) {
    throw new Error('plugins-seed manifest contains no first-party dependencies');
  }
  for (const dependency of seedDependencies) {
    if (typeof seedLock.packages[''].dependencies?.[dependency] !== 'string') {
      throw new Error(`plugins-seed package lock does not include ${dependency}`);
    }
  }
  let providerManifest;
  for (const dependency of seedDependencies) {
    const manifestPath = path.join(seedDir, 'node_modules', dependency, 'package.json');
    const manifest = await readManifest(manifestPath, dependency);
    const plugin = manifest.moxxy?.plugin;
    if (plugin !== undefined) {
      const entry = plugin.entry;
      if (typeof entry !== 'string' || entry.length === 0) {
        throw new Error(`${dependency} has no moxxy.plugin.entry`);
      }
      await requireFile(path.resolve(path.dirname(manifestPath), entry), `${dependency} entrypoint`);
    }
    if (dependency === CODEX_PROVIDER) providerManifest = manifest;
  }
  if (!providerManifest?.moxxy?.plugin) {
    throw new Error(`${CODEX_PROVIDER} is installed but is not a discoverable plugin`);
  }

  if (options.runCli !== false) {
    verifyCliStarts(options.runtimePath ?? process.execPath, cliBin);
  }

  return {
    resourcesPath: root,
    cliVersion: cliManifest.version,
    providerVersion: providerManifest.version,
    seedPackageCount: seedDependencies.length,
  };
}

function verifyCliStarts(runtimePath, cliBin) {
  const result = spawnSync(runtimePath, [cliBin, '--version'], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    timeout: 30_000,
  });
  if (result.error) {
    throw new Error(`Embedded CLI could not start: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim();
    throw new Error(`Embedded CLI exited with status ${result.status}: ${detail}`);
  }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (!/moxxy\s+\d+\.\d+\.\d+/i.test(output)) {
    throw new Error(`Embedded CLI returned an unexpected version response: ${output.trim()}`);
  }
}

async function readManifest(manifestPath, expectedName) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read package manifest: ${manifestPath}`, { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Expected an object in package manifest: ${manifestPath}`);
  }
  if (expectedName && parsed.name !== expectedName) {
    throw new Error(`Expected ${expectedName} in ${manifestPath}, found ${String(parsed.name)}`);
  }
  return parsed;
}

async function readSeedPackageLock(lockPath) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(lockPath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read plugins-seed package lock: ${lockPath}`, { cause: error });
  }
  const root = parsed?.packages?.[''];
  if (
    !Number.isInteger(parsed?.lockfileVersion) ||
    !root ||
    typeof root !== 'object' ||
    Array.isArray(root)
  ) {
    throw new Error(`Invalid plugins-seed package lock: ${lockPath}`);
  }
  return parsed;
}

async function requireFile(filePath, label) {
  try {
    await access(filePath);
  } catch (error) {
    throw new Error(`Missing ${label}: ${filePath}`, { cause: error });
  }
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const resourcesPath = process.argv[2];
  if (!resourcesPath) {
    console.error('Usage: verify-desktop-resources.mjs <resources-path> [runtime-path]');
    process.exitCode = 2;
  } else {
    try {
      const report = await verifyDesktopResources(resourcesPath, {
        runtimePath: process.argv[3],
      });
      console.log(
        `Desktop resources verified: CLI ${report.cliVersion}, ${report.seedPackageCount} seed packages, ${CODEX_PROVIDER} ${report.providerVersion}`,
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
