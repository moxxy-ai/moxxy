/**
 * Code signatures of the programs the macOS installer carries inside archives
 * (the Python and the Git of `runtimes-seed`). Apple's notary service opens
 * the archives and refuses the app unless every program and library in them is
 * signed with a Developer ID, carries a secure timestamp and, for a program,
 * has the hardened runtime. electron-builder signs the app; it does not look
 * inside an archive.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, lstatSync, openSync, readSync, readdirSync } from 'node:fs';
import * as path from 'node:path';

const MACHO_64 = 0xfeedfacf;
const MACHO_32 = 0xfeedface;
const FAT = 0xcafebabe;
const FAT_64 = 0xcafebabf;
const MH_EXECUTE = 2;
/** A Java class file starts like a universal binary; its version is where the count of slices would be. */
const MOST_SLICES = 20;
/** Files handed to one `codesign`, far below what a command line holds. */
const BATCH = 100;

/** `'executable'` for a program, `'library'` for any other Mach-O file, `undefined` for everything else. */
function machOKind(file) {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(32);
    const read = (position) => readSync(fd, head, 0, head.length, position);
    if (read(0) < 16) return undefined;
    let at = 0;
    const big = head.readUInt32BE(0);
    if (big === FAT || big === FAT_64) {
      if (head.readUInt32BE(4) > MOST_SLICES) return undefined;
      // The first slice says what the file is; the others are the same thing for another processor.
      at = big === FAT ? head.readUInt32BE(16) : Number(head.readBigUInt64BE(16));
      if (read(at) < 16) return undefined;
    }
    const magic = head.readUInt32LE(0);
    if (magic !== MACHO_64 && magic !== MACHO_32) return undefined;
    return head.readUInt32LE(12) === MH_EXECUTE ? 'executable' : 'library';
  } finally {
    closeSync(fd);
  }
}

/** Every Mach-O file under `root`, by path relative to it. A link is the file it points at, listed once. */
export function machOFiles(root) {
  const found = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const file = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(abs);
      if (stat.isDirectory()) walk(abs, file);
      else if (stat.isFile()) {
        const kind = machOKind(abs);
        if (kind) found.push({ file, kind });
      }
    }
  };
  walk(root, '');
  return found;
}

/** What `codesign -dv --verbose=4` says of a file, reduced to what notarization asks for. */
export function parseSignature(description) {
  return {
    developerId: /^Authority=Developer ID Application: /m.test(description),
    timestamp: /^Timestamp=/m.test(description),
    hardenedRuntime: /^CodeDirectory .*flags=0x[0-9a-f]+\([^)]*\bruntime\b/m.test(description),
  };
}

function signatureOf(file) {
  // The description goes to stderr; a file that is not signed is an error with nothing to parse.
  return parseSignature(spawnSync('codesign', ['-dv', '--verbose=4', file], { encoding: 'utf8' }).stderr ?? '');
}

/** One line per Mach-O file under `root` that notarization would refuse, with the reasons. */
export function notarizationProblems(root) {
  const problems = [];
  for (const { file, kind } of machOFiles(root)) {
    const signature = signatureOf(path.join(root, file));
    const reasons = [];
    if (!signature.developerId) reasons.push('not signed with a Developer ID');
    if (!signature.timestamp) reasons.push('no secure timestamp');
    if (kind === 'executable' && !signature.hardenedRuntime) reasons.push('hardened runtime not enabled');
    if (reasons.length > 0) problems.push(`${file}: ${reasons.join(', ')}`);
  }
  return problems;
}

/**
 * Sign every Mach-O file under `root` that has no Developer ID signature, with
 * the hardened runtime; `entitlements` go to the programs. A file its maker
 * signed with a Developer ID is left as it is: Apple accepts it, and signing
 * it again would drop the entitlements it needs to run. `identity` is a
 * signing identity of the keychain, or `-` for an ad-hoc signature (a build
 * without a certificate, which is not notarized). Returns what it signed.
 */
export function signForNotarization(root, { identity, entitlements }) {
  const unsigned = machOFiles(root).filter(({ file }) => !signatureOf(path.join(root, file)).developerId);
  // An ad-hoc signature cannot carry a timestamp of Apple's service.
  const base = ['--force', '--sign', identity, '--options', 'runtime', identity === '-' ? '--timestamp=none' : '--timestamp'];
  const sign = (kind, extra) => {
    const files = unsigned.filter((entry) => entry.kind === kind).map(({ file }) => path.join(root, file));
    for (let i = 0; i < files.length; i += BATCH) {
      execFileSync('codesign', [...base, ...extra, ...files.slice(i, i + BATCH)], { stdio: ['ignore', 'ignore', 'inherit'] });
    }
  };
  sign('library', []);
  sign('executable', entitlements ? ['--entitlements', entitlements] : []);
  return unsigned.map(({ file }) => file);
}
