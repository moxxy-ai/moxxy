#!/usr/bin/env node
/**
 * Assemble `resources/runtimes-seed` — the Node and the Python the desktop
 * ships, so the agent can run scripts, `pip` and `npm` on a computer that has
 * neither. The packaged app unpacks them into `~/.moxxy/runtimes` on first
 * launch (see `@moxxy/desktop-host` seed-runtimes.ts).
 *
 * Node goes in as the official archive, byte for byte. Python is the pinned
 * standalone build with the packages of `runtimes/python-requirements.txt`
 * installed into it, packed again. Both are checked against the sha256 in
 * `runtimes-catalog.mjs`. A runtime already assembled from the same inputs is
 * reused, so a rebuild downloads nothing.
 *
 * A macOS installer is universal and carries both architectures; installing
 * the packages for the other one runs that Python under Rosetta.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { tarCommand } from '../../../packages/desktop-host/dist/seed-runtimes.js';
import { NODE_VERSION, PYTHON_IMPORTS, PYTHON_VERSION, RUNTIME_TARGETS, runtimeTargets } from './runtimes-catalog.mjs';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedRoot = path.join(desktopDir, 'resources', 'runtimes-seed');
// Downloads and work folders stay outside the tree electron-builder copies.
const stagingDir = path.join(desktopDir, 'resources', '.runtimes-download');
const requirementsPath = path.join(desktopDir, 'runtimes', 'python-requirements.txt');
// A checkout on Windows may hold CRLF: the id must not depend on it.
const requirements = readFileSync(requirementsPath, 'utf8').replace(/\r\n/g, '\n');
const tar = tarCommand();
/** `build.mac.minimumSystemVersion` of the desktop app. */
const MACOS_MINIMUM = Number.parseInt(JSON.parse(readFileSync(path.join(desktopDir, 'package.json'), 'utf8')).build.mac.minimumSystemVersion, 10);

const targets = runtimeTargets();
if (targets.length === 0) throw new Error(`No bundled runtimes are defined for ${process.platform}-${process.arch}`);

mkdirSync(seedRoot, { recursive: true });
for (const name of readdirSync(seedRoot)) {
  if (!targets.includes(name)) rmSync(path.join(seedRoot, name), { recursive: true, force: true });
}

for (const target of targets) {
  const { node, python } = RUNTIME_TARGETS[target];
  const targetDir = path.join(seedRoot, target);
  mkdirSync(targetDir, { recursive: true });
  const previous = readManifest(targetDir);
  const windows = target.startsWith('win32');

  const nodeArchive = `node${archiveExtension(node.file)}`;
  const nodeId = `${NODE_VERSION}-${node.sha256.slice(0, 12)}`;
  if (!reusable(previous, targetDir, 'node', nodeId, nodeArchive)) {
    copyFileSync(await download(node), path.join(targetDir, nodeArchive));
    console.log(`runtimes-seed: ${target} Node ${NODE_VERSION} added`);
  }

  const pythonArchive = 'python.tar.gz';
  const pythonId = `${PYTHON_VERSION}-${sha256Text(`${python.sha256}\n${requirements}`).slice(0, 12)}`;
  if (!reusable(previous, targetDir, 'python', pythonId, pythonArchive)) {
    const work = path.join(stagingDir, `work-${target}`);
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    run(tar, ['-xf', await download(python), '-C', work]);
    const root = path.join(work, 'python');
    const interpreter = windows ? path.join(root, 'python.exe') : path.join(root, 'bin', 'python3');
    try {
      run(interpreter, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-warn-script-location', '--no-compile', '--only-binary=:all:', ...oldestMacos(target, root), '-r', requirementsPath]);
      run(interpreter, ['-c', `import ${PYTHON_IMPORTS.join(', ')}`]);
    } catch (error) {
      throw new Error(`Could not prepare the bundled Python for ${target}` + (target === 'darwin-x64' && process.arch === 'arm64' ? ' (it runs under Rosetta: softwareupdate --install-rosetta)' : ''), { cause: error });
    }
    makeRelocatable(root, windows);
    rmSync(path.join(targetDir, pythonArchive), { force: true });
    // COPYFILE_DISABLE keeps macOS tar from adding `._*` attribute files.
    run(tar, ['-czf', path.join(targetDir, pythonArchive), '-C', work, 'python'], { COPYFILE_DISABLE: '1' });
    rmSync(work, { recursive: true, force: true });
    console.log(`runtimes-seed: ${target} Python ${PYTHON_VERSION} with its packages added`);
  }

  await writeFile(path.join(targetDir, 'manifest.json'), `${JSON.stringify({
    runtimes: [
      { name: 'node', id: nodeId, archive: nodeArchive },
      { name: 'python', id: pythonId, archive: pythonArchive },
    ],
  }, null, 2)}\n`);
}
console.log(`runtimes-seed assembled at ${seedRoot} (${targets.join(', ')})`);

/**
 * pip picks the wheel built for the newest macOS the build machine runs, which
 * an older Mac cannot load. Naming the oldest macOS the app supports makes it
 * take a wheel every supported Mac can run. pip accepts a platform only with
 * an explicit folder to install into.
 */
function oldestMacos(target, root) {
  if (!target.startsWith('darwin')) return [];
  return ['--platform', `macosx_${MACOS_MINIMUM}_0_${target.endsWith('arm64') ? 'arm64' : 'x86_64'}`, '--target', unixSitePackages(root)];
}

function unixSitePackages(root) {
  return path.join(root, 'lib', `python${PYTHON_VERSION.split('.').slice(0, 2).join('.')}`, 'site-packages');
}

/**
 * Programs pip generates carry the absolute path of the Python that installed
 * them, which is this build folder. They are removed: every package still runs
 * as `python -m <name>`. On Windows that includes `pip.exe`, so `pip` becomes
 * a shim next to `python.exe`, and `python3` a copy of it (it finds its DLL
 * beside itself), since scripts written for macOS and Linux call both.
 */
function makeRelocatable(root, windows) {
  if (windows) {
    const scripts = path.join(root, 'Scripts');
    if (existsSync(scripts)) {
      for (const name of readdirSync(scripts)) {
        if (name.toLowerCase().endsWith('.exe')) rmSync(path.join(scripts, name), { force: true });
      }
    }
    for (const name of ['pip.cmd', 'pip3.cmd']) writeFileSync(path.join(root, name), '@"%~dp0python.exe" -m pip %*\r\n');
    copyFileSync(path.join(root, 'python.exe'), path.join(root, 'python3.exe'));
    return;
  }
  // With an explicit install folder pip puts the programs inside it.
  rmSync(path.join(unixSitePackages(root), 'bin'), { recursive: true, force: true });
  const bin = path.join(root, 'bin');
  for (const name of readdirSync(bin)) {
    const file = path.join(bin, name);
    const head = readFileSync(file).subarray(0, 512).toString('latin1');
    if (head.startsWith('#!') && (head.split('\n')[0] ?? '').includes(root)) rmSync(file, { force: true });
  }
}

function reusable(manifest, targetDir, name, id, archive) {
  return manifest.some((entry) => entry.name === name && entry.id === id && entry.archive === archive) && existsSync(path.join(targetDir, archive));
}

function readManifest(targetDir) {
  try {
    const { runtimes } = JSON.parse(readFileSync(path.join(targetDir, 'manifest.json'), 'utf8'));
    return Array.isArray(runtimes) ? runtimes : [];
  } catch {
    return [];
  }
}

function archiveExtension(file) {
  const match = /\.(tar\.gz|tar\.xz|zip)$/.exec(file);
  if (!match) throw new Error(`Unknown archive type: ${file}`);
  return `.${match[1]}`;
}

/** The pinned archive in the download folder, fetched unless a verified copy is there. */
async function download({ file, url, sha256 }) {
  mkdirSync(stagingDir, { recursive: true });
  const dest = path.join(stagingDir, file);
  if (existsSync(dest) && (await sha256File(dest)) === sha256) return dest;
  console.log(`runtimes-seed: downloading ${file}`);
  await writeFile(dest, await fetchWithRetry(url));
  const actual = await sha256File(dest);
  if (actual !== sha256) {
    rmSync(dest, { force: true });
    throw new Error(`${file} is not the pinned archive: sha256 ${actual}, expected ${sha256}`);
  }
  return dest;
}

/** A release CDN drops a connection now and then; a build should not fail on the first one. */
async function fetchWithRetry(url, attempts = 4) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}) for ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.log(`runtimes-seed: download interrupted, trying again (${attempt}/${attempts - 1})`);
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    }
  }
}

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
}

function run(command, args, env = {}) {
  execFileSync(command, args, { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, ...env }, windowsHide: true });
}
