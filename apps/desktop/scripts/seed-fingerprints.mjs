/**
 * Content fingerprints of the plugin seed, one per top-level package
 * (`plugins-seed/seed-fingerprints.json`). The desktop compares them with the
 * ones it last copied into `~/.moxxy/plugins` (`@moxxy/desktop-host`
 * seed-plugins.ts) and replaces a package whose content changed, even when
 * its version number did not: a local build ships new code under the same
 * version.
 */
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

export const SEED_FINGERPRINTS_FILE = 'seed-fingerprints.json';

/** `{ "<package>": "<sha256>" }` for every top-level entry of `<seedDir>/node_modules`. */
export async function seedFingerprints(seedDir) {
  const modules = path.join(seedDir, 'node_modules');
  const packages = {};
  for (const entry of await topLevelEntries(modules)) {
    packages[entry] = await treeFingerprint(path.join(modules, entry));
  }
  return packages;
}

export async function writeSeedFingerprints(seedDir) {
  const packages = await seedFingerprints(seedDir);
  await writeFile(
    path.join(seedDir, SEED_FINGERPRINTS_FILE),
    `${JSON.stringify({ schemaVersion: 1, packages }, null, 2)}\n`,
  );
  return packages;
}

/** npm's `.bin` and `.package-lock.json` are bookkeeping the target tree keeps itself. */
async function topLevelEntries(modules) {
  const out = [];
  for (const name of (await readdir(modules)).sort()) {
    if (name.startsWith('.')) continue;
    if (name.startsWith('@')) {
      for (const sub of (await readdir(path.join(modules, name))).sort()) {
        if (!sub.startsWith('.')) out.push(`${name}/${sub}`);
      }
    } else {
      out.push(name);
    }
  }
  return out;
}

/** Paths, contents, the executable bit and link targets — what a copy must reproduce. */
async function treeFingerprint(root) {
  const hash = createHash('sha256');
  async function walk(dir, relative) {
    for (const name of (await readdir(dir)).sort()) {
      const file = path.join(dir, name);
      const rel = relative ? `${relative}/${name}` : name;
      const stat = await lstat(file);
      if (stat.isSymbolicLink()) {
        hash.update(`link\0${rel}\0${await readlink(file)}\0`);
      } else if (stat.isDirectory()) {
        hash.update(`dir\0${rel}\0`);
        await walk(file, rel);
      } else {
        const content = createHash('sha256').update(await readFile(file)).digest('hex');
        const executable = process.platform !== 'win32' && (stat.mode & 0o111) !== 0;
        hash.update(`file\0${rel}\0${executable ? 'x' : '-'}\0${content}\0`);
      }
    }
  }
  await walk(root, '');
  return hash.digest('hex');
}
