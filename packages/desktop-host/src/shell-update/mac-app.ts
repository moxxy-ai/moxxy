/**
 * A macOS app on disk: where the running one is, unpacking the one a release
 * carries, and checking it comes from whoever signed the running one — with
 * the tools macOS has for it (`ditto`, `codesign`, `plutil`).
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DITTO = '/usr/bin/ditto';
const CODESIGN = '/usr/bin/codesign';
const PLUTIL = '/usr/bin/plutil';
/** `codesign --verify` exits with this when the signature is valid but is not
 *  the one asked for. */
const REQUIREMENT_NOT_MET = 3;

interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(file: string, args: ReadonlyArray<string>): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(file, [...args], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      resolve({ code, stdout, stderr: stderr || (error ? error.message : '') });
    });
  });
}

const lastLine = (text: string): string => text.trim().split('\n').at(-1) ?? '';

/** The `.app` a program runs from (`X.app/Contents/MacOS/program`), if it is in one. */
export function appBundleOf(execPath: string): string | null {
  const macOs = path.dirname(execPath);
  const contents = path.dirname(macOs);
  const app = path.dirname(contents);
  const inApp = path.basename(macOs) === 'MacOS' && path.basename(contents) === 'Contents' && app.endsWith('.app');
  return inApp ? app : null;
}

/** Unpacks the archive into `intoDir`, emptied first, and returns the app in it. */
export async function extractMacArchive(archive: string, intoDir: string): Promise<string> {
  await fs.rm(intoDir, { recursive: true, force: true });
  await fs.mkdir(intoDir, { recursive: true });
  const unpacked = await run(DITTO, ['-x', '-k', archive, intoDir]);
  if (unpacked.code !== 0) throw new Error(`The download could not be unpacked: ${lastLine(unpacked.stderr)}`);
  const apps = (await fs.readdir(intoDir, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'));
  const [app] = apps;
  if (!app || apps.length !== 1) throw new Error('The download has no app in it.');
  return path.join(intoDir, app.name);
}

async function versionOf(app: string): Promise<string | null> {
  const read = await run(PLUTIL, ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(app, 'Contents', 'Info.plist')]);
  return read.code === 0 ? read.stdout.trim() : null;
}

/** What macOS asks of any later version of an app: `designated => …`, printed
 *  behind a `#` when the signature left it to be worked out (an ad-hoc one). */
async function requirementOf(app: string): Promise<string | null> {
  const read = await run(CODESIGN, ['--display', '--requirements', '-', app]);
  const found = /^(?:# )?designated => (.+)$/m.exec(read.stdout);
  return read.code === 0 && found?.[1] ? found[1] : null;
}

/**
 * Passes only for an app of the version the release named, whose signature is
 * whole and satisfies the running app's own requirement — the check macOS
 * makes before it lets one version of an app replace another.
 */
export async function verifyMacApp(opts: { candidate: string; running: string; version: string }): Promise<void> {
  const { candidate, running, version } = opts;
  const found = await versionOf(candidate);
  if (found !== version) throw new Error(`The download is version ${found ?? 'unknown'}, not ${version}.`);

  const requirement = await requirementOf(running);
  if (!requirement) throw new Error('This copy of Moxxy is not signed, so a new version cannot be checked against it.');

  const verified = await run(CODESIGN, ['--verify', '--deep', '--strict', `-R=${requirement}`, candidate]);
  if (verified.code === REQUIREMENT_NOT_MET) {
    throw new Error('The new version is not signed by the same developer as this copy of Moxxy.');
  }
  if (verified.code !== 0) throw new Error(`The new version's signature is not valid: ${lastLine(verified.stderr)}`);
}
