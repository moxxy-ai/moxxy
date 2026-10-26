import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

// Programs a test can start on every OS, written as Node scripts. A `#!` shell
// script is no program on Windows, so a test that stands in for a CLI with one
// can only skip there. These run the same script everywhere.

const sh = (s) => `'${s.replaceAll("'", `'\\''`)}'`;
const ps = (s) => `'${s.replaceAll("'", "''")}'`;

/**
 * A command-line program at `file`. `script` is the body of a CommonJS Node
 * script with the program's arguments in scope as `args`.
 *
 * POSIX: an executable file at `file` that runs the script with this Node.
 * Windows: what a global npm install leaves, `<file>.cmd` with the script at
 * `windowsEntry` (relative to the shim's folder, `/`-separated) — a shim only
 * a shell runs, so the code under test must run what it points at.
 *
 * Returns the path a lookup on PATH or in the folder finds.
 */
export function writeFakeCli(file, script, { windowsEntry, platform = process.platform } = {}) {
  const body = `'use strict';\nconst args = process.argv.slice(2);\n${script}\n`;
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  if (platform === 'win32') {
    if (!windowsEntry) throw new Error('writeFakeCli: on Windows the fake needs windowsEntry, the script its .cmd shim runs.');
    const entry = join(dir, ...windowsEntry.split('/'));
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(entry, body);
    const shim = `${file}.cmd`;
    writeFileSync(shim, `@node "%~dp0\\${windowsEntry.replaceAll('/', '\\')}" %*\r\n`);
    return shim;
  }
  const entry = join(dir, `.${basename(file)}.fake.cjs`);
  writeFileSync(entry, body);
  writeFileSync(file, `#!/bin/sh\nexec ${sh(process.execPath)} ${sh(entry)} "$@"\n`);
  chmodSync(file, 0o755);
  return file;
}

let installers = 0;

/**
 * An installer line for a CLI descriptor's `install`: runs `script` (a
 * CommonJS Node script body) with this Node, from a POSIX shell or from
 * Windows PowerShell, passing its exit code on.
 */
export function fakeInstaller(dir, script) {
  installers += 1;
  const entry = join(dir, `installer-${installers}.cjs`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(entry, `'use strict';\n${script}\n`);
  return {
    posix: `${sh(process.execPath)} ${sh(entry)}`,
    windows: `& ${ps(process.execPath)} ${ps(entry)}; exit $LASTEXITCODE`,
  };
}
