#!/usr/bin/env node
/**
 * Unpack the runtimes of a prepared or installed app the way a first launch
 * does, and run them: Python imports every bundled package, `pip`, `node` and
 * `npm` answer, Git commits and has its https helper, and on macOS and Linux
 * the agent's login shell finds the bundled `python3` first. Usage: smoke-runtimes.mjs <resources dir>
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { activateRuntimes, runtimePathDirs, seedRuntimesFromResources } from '../../../packages/desktop-host/dist/seed-runtimes.js';
import { withPathFirst } from '../../../packages/tools-builtin/dist/shell.js';
import { NODE_VERSION, PYTHON_IMPORTS, PYTHON_VERSION, gitVersion, runtimeTargets } from './runtimes-catalog.mjs';

export async function smokeRuntimes(resourcesPath, { platform = process.platform, log = console.log } = {}) {
  const windows = platform === 'win32';
  for (const target of runtimeTargets(platform)) {
    const arch = target.slice(target.indexOf('-') + 1);
    const home = mkdtempSync(path.join(tmpdir(), 'moxxy runtimes smoke-'));
    try {
      const seeded = await seedRuntimesFromResources({ resourcesPath, moxxyHome: home, platform, arch });
      if (seeded.copied.length !== 3) throw new Error(`${target}: expected Node, Python and Git to unpack, got [${seeded.copied.join(', ')}]`);
      const env = { ...process.env };
      activateRuntimes(home, platform, env);
      const { first: [pythonDir], last: [nodeDir, gitDir] } = runtimePathDirs(home, platform, true);
      // Windows spells the variable `Path`; a copy of the environment keeps that spelling.
      const pathKey = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
      const run = (file, args) => execFileSync(file, args, { env, encoding: 'utf8', windowsHide: true }).trim();
      // `.cmd` shims and PATH lookups go through the shell a person would use.
      const inShell = (line) => (windows ? run(process.env.COMSPEC ?? 'cmd.exe', ['/d', '/s', '/c', line]) : run('/bin/sh', ['-lc', withPathFirst(line, env.MOXXY_PATH_FIRST)]));

      const python = path.join(pythonDir, windows ? 'python.exe' : 'python3');
      expectIncludes(run(python, ['-c', `import ${PYTHON_IMPORTS.join(', ')}, sys; print(sys.version.split()[0])`]), PYTHON_VERSION, `${target} python`);
      expectIncludes(inShell('python3 --version'), PYTHON_VERSION, `${target} python3 on PATH`);
      // pip names the Python it belongs to; a temp folder may be reported under its real path.
      expectIncludes(inShell('pip --version'), path.join(path.basename(home), 'runtimes', 'python'), `${target} pip`);
      expectIncludes(run(path.join(nodeDir, windows ? 'node.exe' : 'node'), ['--version']), NODE_VERSION, `${target} node`);
      // npm of the bundled Node, not of a Node the computer already has: that one stays ahead on PATH.
      const npmVersion = windows
        ? execFileSync(process.env.COMSPEC ?? 'cmd.exe', ['/d', '/s', '/c', 'npm --version'], { env: { ...env, [pathKey]: `${nodeDir};${env[pathKey] ?? ''}` }, encoding: 'utf8', windowsHide: true }).trim()
        : run(path.join(nodeDir, 'npm'), ['--version']);
      if (!/^\d+\.\d+\.\d+/.test(npmVersion)) throw new Error(`${target}: npm did not answer with a version`);
      const git = (args, cwd) => execFileSync(path.join(gitDir, windows ? 'git.exe' : 'git'), args, { env, cwd, encoding: 'utf8', windowsHide: true }).trim();
      expectIncludes(git(['--version']), gitVersion(target), `${target} git`);
      // Cloning over https is a separate program; the macOS and Linux build finds it only through its launcher.
      if (!windows && !existsSync(path.join(git(['--exec-path']), 'git-remote-https'))) throw new Error(`${target}: git cannot find its https helper`);
      const repo = path.join(home, 'repo');
      mkdirSync(repo);
      git(['init', '--quiet'], repo);
      writeFileSync(path.join(repo, 'file.txt'), 'content\n');
      git(['add', 'file.txt'], repo);
      git(['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '--quiet', '-m', 'first'], repo);
      expectIncludes(git(['log', '--oneline'], repo), 'first', `${target} git commit`);
      log(`runtimes smoke: ${target} Python ${PYTHON_VERSION} with ${PYTHON_IMPORTS.length} packages, pip, Node ${NODE_VERSION}, npm, Git ${gitVersion(target)}`);
    } finally {
      rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    }
  }
}

function expectIncludes(output, wanted, what) {
  if (!output.includes(wanted)) throw new Error(`${what}: expected "${wanted}" in "${output}"`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const resources = process.argv[2];
  if (!resources) throw new Error('Usage: smoke-runtimes.mjs <resources dir>');
  await smokeRuntimes(path.resolve(resources));
}
