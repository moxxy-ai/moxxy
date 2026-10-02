import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// What a test may assume about the machine it runs on. A test that needs one
// of these says so with `it.skipIf(!posixFileModes)` and the like, so a skip
// names the missing capability instead of failing on it.

export const isWindows = process.platform === 'win32';

/** Permission bits are real: `chmod 0600` is kept and `stat` reports it. */
export const posixFileModes = !isWindows;

/** `/bin/sh` and the usual POSIX tools exist, and a `#!` script can be run as a program. */
export const posixShell = !isWindows;

/** Symlinks can be created. Windows needs Developer Mode or an elevated shell. */
export const canSymlink = probeSymlink();

function probeSymlink() {
  const dir = mkdtempSync(join(tmpdir(), 'moxxy-symlink-probe-'));
  try {
    writeFileSync(join(dir, 'target'), '');
    symlinkSync(join(dir, 'target'), join(dir, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
