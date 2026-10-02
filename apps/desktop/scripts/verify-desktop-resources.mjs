#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { access, constants, readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyHelperArtifact } from '../../../packages/plugin-computer-control/dist/helper/artifact.js';
import { CONTRACT_PROTOCOL_VERSION } from '../../../packages/plugin-computer-control/dist/backend/rpc.js';
import { VOICE_CATALOG } from '../../../packages/plugin-tts-local/dist/voices.js';
import { NODE_VERSION, PYTHON_VERSION, gitVersion, runtimeTargets } from './runtimes-catalog.mjs';

/** The native Computer Use helper each desktop platform must ship: [label, path under the plugin, protocol]. */
const COMPUTER_HELPERS = {
  win32: ['Windows', ['bin', 'win32-x64', 'moxxy-computer.exe'], CONTRACT_PROTOCOL_VERSION],
  darwin: ['macOS', ['bin', 'darwin-universal', 'moxxy-computer'], CONTRACT_PROTOCOL_VERSION],
  linux: ['Linux', ['bin', `linux-${process.arch}`, 'moxxy-computer'], CONTRACT_PROTOCOL_VERSION],
};

const REQUIRED_CLI_DEPENDENCIES = ['@moxxy/sdk', 'zod', 'undici'];
const CODEX_PROVIDER = '@moxxy/plugin-provider-openai-codex';
/** Sign-in providers the desktop offers out of the box — each must be seeded. */
const SIGN_IN_PROVIDERS = [CODEX_PROVIDER, '@moxxy/plugin-provider-claude-code'];
/** Both voices Settings offers work without npm: offline Piper (with every
 *  voice it offers, checked below) and Gemini. */
const VOICE_PLUGINS = ['@moxxy/plugin-tts-local', '@moxxy/plugin-tts-gemini'];
const REQUIRED_SEED_PACKAGES = [...SIGN_IN_PROVIDERS, ...VOICE_PLUGINS];

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
  for (const required of REQUIRED_SEED_PACKAGES) {
    if (typeof seedManifest.dependencies?.[required] !== 'string') {
      throw new Error(`plugins-seed manifest does not include ${required}`);
    }
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
    const helper = COMPUTER_HELPERS[options.platform ?? process.platform];
    if (dependency === '@moxxy/plugin-computer-control' && helper) {
      const [label, segments, protocol] = helper;
      const helperPath = path.join(path.dirname(manifestPath), ...segments);
      try {
        await verifyHelperArtifact(helperPath, protocol);
      } catch (error) {
        throw new Error(`${label} Computer Use component missing or incompatible in desktop resources`, { cause: error });
      }
      // `pnpm pack` drops the permission to run a file; Windows has no such permission.
      if (process.platform !== 'win32' && label !== 'Windows') {
        await access(helperPath, constants.X_OK).catch((error) => {
          throw new Error(`${label} Computer Use component cannot be run: it lost its executable permission`, { cause: error });
        });
      }
    }
  }
  if (!providerManifest?.moxxy?.plugin) {
    throw new Error(`${CODEX_PROVIDER} is installed but is not a discoverable plugin`);
  }

  await verifyBundledVoices(path.join(root, 'models-seed', 'tts'));
  await verifyBundledRuntimes(path.join(root, 'runtimes-seed'), options.platform ?? process.platform, options.arch ?? process.arch);

  if (options.runCli !== false) {
    verifyCliStarts(options.runtimePath ?? process.execPath, cliBin);
  }

  return {
    resourcesPath: root,
    cliVersion: cliManifest.version,
    providerVersion: providerManifest.version,
    seedPackageCount: seedDependencies.length,
    voiceCount: VOICE_CATALOG.length,
  };
}

/** Every voice the plugin offers is there, and is the archive the plugin pins —
 *  otherwise the plugin would discard it and download on first use. */
async function verifyBundledVoices(voicesDir) {
  for (const voice of VOICE_CATALOG) {
    const voiceDir = path.join(voicesDir, voice.id);
    try {
      await access(path.join(voiceDir, voice.archiveRootDir, voice.modelFile));
    } catch (error) {
      throw new Error(`Bundled voice ${voice.id} is missing`, { cause: error });
    }
    let marker = '';
    try {
      marker = (await readFile(path.join(voiceDir, '.model.ok'), 'utf8')).trim().toLowerCase();
    } catch {
      /* reported below */
    }
    if (marker !== voice.sha256.toLowerCase()) {
      throw new Error(`Bundled voice ${voice.id} is not the pinned archive`);
    }
  }
}

/** Node, Python and Git are there for every architecture this installer serves, in the pinned versions —
 *  otherwise the agent could not run a script, npm or git on a computer that has none of them. */
async function verifyBundledRuntimes(seedRoot, platform, arch) {
  for (const target of runtimeTargets(platform, arch)) {
    const pinned = { node: NODE_VERSION, python: PYTHON_VERSION, git: gitVersion(target) };
    let runtimes;
    try {
      ({ runtimes } = JSON.parse(await readFile(path.join(seedRoot, target, 'manifest.json'), 'utf8')));
    } catch (error) {
      throw new Error(`Bundled runtimes for ${target} are missing`, { cause: error });
    }
    for (const [name, version] of Object.entries(pinned)) {
      const entry = Array.isArray(runtimes) ? runtimes.find((runtime) => runtime.name === name) : undefined;
      const size = entry ? await stat(path.join(seedRoot, target, String(entry.archive))).then((info) => info.size, () => 0) : 0;
      if (size === 0) throw new Error(`Bundled ${name} runtime for ${target} is missing`);
      if (!String(entry.id).startsWith(`${version}-`)) throw new Error(`Bundled ${name} runtime for ${target} is not the pinned version`);
    }
  }
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
        `Desktop resources verified: CLI ${report.cliVersion}, ${report.seedPackageCount} seed packages, ${report.voiceCount} voices, ${CODEX_PROVIDER} ${report.providerVersion}`,
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
