#!/usr/bin/env node
/**
 * Assemble `resources/runtimes-seed` — the Node, the Python and the Git the
 * desktop ships, so the agent can run scripts, `pip`, `npm` and `git` on a
 * computer that has none of them. The packaged app unpacks them into `~/.moxxy/runtimes` on first
 * launch (see `@moxxy/desktop-host` seed-runtimes.ts).
 *
 * Node goes in as the official archive, byte for byte. Python is the pinned
 * standalone build with the packages of `runtimes/python-requirements.txt`
 * installed into it, packed again. Git is the pinned build, packed again
 * under one folder with a launcher on macOS and Linux. All are checked against the sha256 in
 * `runtimes-catalog.mjs`. A runtime already assembled from the same inputs is
 * reused, so a rebuild downloads nothing.
 *
 * A macOS installer is universal and carries both architectures; installing
 * the packages for the other one runs that Python under Rosetta.
 *
 * Apple notarizes a macOS app only when the programs inside its archives are
 * signed too, so with `MOXXY_MAC_SIGN_IDENTITY` set the macOS Python and Git
 * are signed before they are packed: a Developer ID in a release, `-` for an
 * ad-hoc signature that runs them under the same hardened runtime without a
 * certificate. Node is already signed by its maker.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { tarCommand } from '../../../packages/desktop-host/dist/seed-runtimes.js';
import { signForNotarization } from './macos-code-signature.mjs';
import { NODE_VERSION, PYTHON_IMPORTS, PYTHON_VERSION, RUNTIME_TARGETS, gitVersion, runtimeTargets } from './runtimes-catalog.mjs';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedRoot = path.join(desktopDir, 'resources', 'runtimes-seed');
// Downloads and work folders stay outside the tree electron-builder copies.
const stagingDir = path.join(desktopDir, 'resources', '.runtimes-download');
const requirementsPath = path.join(desktopDir, 'runtimes', 'python-requirements.txt');
// A checkout on Windows may hold CRLF: the id must not depend on it.
const requirements = readFileSync(requirementsPath, 'utf8').replace(/\r\n/g, '\n');
const tar = tarCommand();
const signIdentity = process.env.MOXXY_MAC_SIGN_IDENTITY ?? '';
const pythonEntitlementsPath = path.join(desktopDir, 'build', 'entitlements.python.mac.plist');
/** `build.mac.minimumSystemVersion` of the desktop app. */
const MACOS_MINIMUM = Number.parseInt(JSON.parse(readFileSync(path.join(desktopDir, 'package.json'), 'utf8')).build.mac.minimumSystemVersion, 10);

/**
 * The macOS and Linux build of Git looks for its own programs under `/`, where
 * it was built. GitHub Desktop tells it where they are through the
 * environment; so does this launcher, from wherever the folder was unpacked.
 * Git for Windows finds them by itself and has `cmd/git.exe` already.
 */
const GIT_LAUNCHER = `#!/bin/sh
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
GIT_EXEC_PATH="$root/libexec/git-core" GIT_TEMPLATE_DIR="$root/share/git-core/templates" exec "$root/bin/git" "$@"
`;

const targets = runtimeTargets();
if (targets.length === 0) throw new Error(`No bundled runtimes are defined for ${process.platform}-${process.arch}`);

mkdirSync(seedRoot, { recursive: true });
for (const name of readdirSync(seedRoot)) {
  if (!targets.includes(name)) rmSync(path.join(seedRoot, name), { recursive: true, force: true });
}

for (const target of targets) {
  const { node, python, git } = RUNTIME_TARGETS[target];
  const targetDir = path.join(seedRoot, target);
  mkdirSync(targetDir, { recursive: true });
  const previous = readManifest(targetDir);
  const windows = target.startsWith('win32');
  const signed = signIdentity !== '' && target.startsWith('darwin');

  const nodeArchive = `node${archiveExtension(node.file)}`;
  const nodeId = `${NODE_VERSION}-${node.sha256.slice(0, 12)}`;
  if (!reusable(previous, targetDir, 'node', nodeId, nodeArchive)) {
    copyFileSync(await download(node), path.join(targetDir, nodeArchive));
    console.log(`runtimes-seed: ${target} Node ${NODE_VERSION} added`);
  }

  const pythonArchive = 'python.tar.gz';
  // A runtime signed differently is a different archive: one packed without a signature is not reused for a release.
  const pythonSigning = signed ? `\nsigned by ${signIdentity}\n${readFileSync(pythonEntitlementsPath, 'utf8')}` : '';
  const pythonId = `${PYTHON_VERSION}-${sha256Text(`${python.sha256}\n${requirements}${pythonSigning}`).slice(0, 12)}`;
  if (!reusable(previous, targetDir, 'python', pythonId, pythonArchive)) {
    const work = path.join(stagingDir, `work-${target}`);
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    run(tar, ['-xf', await download(python), '-C', work]);
    const root = path.join(work, 'python');
    const interpreter = windows ? path.join(root, 'python.exe') : path.join(root, 'bin', 'python3');
    try {
      run(interpreter, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-warn-script-location', '--no-compile', '--only-binary=:all:', ...oldestMacos(target, root), '-r', requirementsPath]);
      makeRelocatable(root, windows);
      if (signed) signForNotarization(root, { identity: signIdentity, entitlements: pythonEntitlementsPath });
      // Checked as it is packed: a signed Python loads its packages only with its entitlements.
      run(interpreter, ['-c', `import ${PYTHON_IMPORTS.join(', ')}`]);
    } catch (error) {
      throw new Error(`Could not prepare the bundled Python for ${target}` + (target === 'darwin-x64' && process.arch === 'arm64' ? ' (it runs under Rosetta: softwareupdate --install-rosetta)' : ''), { cause: error });
    }
    rmSync(path.join(targetDir, pythonArchive), { force: true });
    // COPYFILE_DISABLE keeps macOS tar from adding `._*` attribute files.
    run(tar, ['-czf', path.join(targetDir, pythonArchive), '-C', work, 'python'], { COPYFILE_DISABLE: '1' });
    rmSync(work, { recursive: true, force: true });
    console.log(`runtimes-seed: ${target} Python ${PYTHON_VERSION} with its packages added${signed ? ', signed' : ''}`);
  }

  const gitArchive = 'git.tar.gz';
  const gitId = `${gitVersion(target)}-${sha256Text(`${git.sha256}\n${GIT_LAUNCHER}${signed ? `\nsigned by ${signIdentity}` : ''}`).slice(0, 12)}`;
  if (!reusable(previous, targetDir, 'git', gitId, gitArchive)) {
    const work = path.join(stagingDir, `work-git-${target}`);
    const root = path.join(work, 'git');
    rmSync(work, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    // Neither download has a top-level folder; the app unpacks one.
    run(tar, ['-xf', await download(git), '-C', root]);
    if (!windows) {
      mkdirSync(path.join(root, 'cmd'));
      writeFileSync(path.join(root, 'cmd', 'git'), GIT_LAUNCHER);
      chmodSync(path.join(root, 'cmd', 'git'), 0o755);
    }
    if (signed) signForNotarization(root, { identity: signIdentity });
    if (runsHere(target)) {
      const answer = execFileSync(path.join(root, 'cmd', windows ? 'git.exe' : 'git'), ['--version'], { encoding: 'utf8', windowsHide: true });
      if (!answer.includes(gitVersion(target))) throw new Error(`The bundled Git for ${target} answered "${answer.trim()}", expected ${gitVersion(target)}`);
    }
    rmSync(path.join(targetDir, gitArchive), { force: true });
    run(tar, ['-czf', path.join(targetDir, gitArchive), '-C', work, 'git'], { COPYFILE_DISABLE: '1' });
    rmSync(work, { recursive: true, force: true });
    console.log(`runtimes-seed: ${target} Git ${gitVersion(target)} added${signed ? ', signed' : ''}`);
  }

  await writeFile(path.join(targetDir, 'manifest.json'), `${JSON.stringify({
    runtimes: [
      { name: 'node', id: nodeId, archive: nodeArchive },
      { name: 'python', id: pythonId, archive: pythonArchive },
      { name: 'git', id: gitId, archive: gitArchive },
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

/** A Mac runs both of its architectures (x64 under Rosetta); everything else only its own. */
function runsHere(target) {
  return target.startsWith(`${process.platform}-`) && (process.platform === 'darwin' || target.endsWith(`-${process.arch}`));
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
  // A missing or unreadable copy is fetched again.
  if ((await sha256File(dest).catch(() => undefined)) === sha256) return dest;
  console.log(`runtimes-seed: downloading ${file}`);
  const archive = await fetchWithRetry(url);
  // Checked against the pinned hash before it is written, so only the pinned archive reaches the disk.
  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== sha256) throw new Error(`${file} is not the pinned archive: sha256 ${actual}, expected ${sha256}`);
  await writeFile(dest, archive);
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
