/**
 * The full app update on macOS, without Squirrel: the release's archive is
 * downloaded to disk, unpacked beside Moxxy's data, checked against the
 * running app's signature, and left waiting to be moved in as Moxxy closes
 * (`applyShellUpdate`). Squirrel read the whole archive into memory, which
 * crashed the app once the installer grew past a gigabyte.
 *
 * Refuses before the restart whenever the move could not work — a folder it
 * cannot change, another disk, no room, a signature that is not ours — so the
 * installer screen can offer the download page instead.
 */

import { accessSync, constants, promises as fs, statSync } from 'node:fs';
import path from 'node:path';

import { fetchAllowed } from '../app-update/stager.js';
import { downloadVerified } from './download.js';
import { extractMacArchive, verifyMacApp } from './mac-app.js';
import { parseMacFeed, pickMacArchive } from './mac-feed.js';
import { shellUpdatePaths, writePendingShellUpdate } from './mac-swap.js';

export interface MacAppUpdateOptions {
  /** `…/releases/download/desktop-v<version>/` of the release to install. */
  readonly feedBaseUrl: string;
  /** The installed `.app` to replace. */
  readonly appPath: string;
  readonly userDataDir: string;
  readonly arch: string;
  readonly onProgress?: (p: { phase: 'download' | 'install'; received?: number; total?: number; message?: string }) => void;
}

/** The archive, and the app unpacked from it (about twice the archive). */
export function diskSpaceNeeded(archiveSize: number): number {
  return Math.ceil(archiveSize * 3.5);
}

const inGb = (bytes: number): string => (bytes / 1024 ** 3).toFixed(1);

function canWrite(target: string): boolean {
  try {
    accessSync(target, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Everything that would stop the move, found before anything is downloaded. */
async function checkCanReplace(appPath: string, root: string): Promise<void> {
  if (appPath.includes('/AppTranslocation/')) {
    throw new Error('Move Moxxy to the Applications folder and open it from there: macOS runs this copy from a place where it cannot be updated.');
  }
  const folder = path.dirname(appPath);
  if (!canWrite(folder) || !canWrite(appPath)) {
    throw new Error(`Moxxy cannot change the folder it is installed in (${folder}).`);
  }
  await fs.mkdir(root, { recursive: true });
  if (statSync(root).dev !== statSync(folder).dev) {
    throw new Error('Moxxy is installed on another disk than its data, where it cannot replace itself.');
  }
}

async function prepare(opts: MacAppUpdateOptions, deps: { fetchImpl?: typeof fetch }): Promise<{ version: string }> {
  const { appPath, userDataDir } = opts;
  const report = opts.onProgress ?? (() => {});
  const fetchImpl = deps.fetchImpl ?? fetch;
  const paths = shellUpdatePaths(userDataDir);
  await checkCanReplace(appPath, paths.root);

  const listed = await fetchAllowed(fetchImpl, new URL('latest-mac.yml', opts.feedBaseUrl).toString());
  if (!listed.ok) throw new Error(`This release has no list of macOS installers (HTTP ${listed.status}).`);
  const feed = parseMacFeed(await listed.text());
  if (!feed) throw new Error("This release's list of macOS installers could not be read.");
  const archive = pickMacArchive(feed, opts.arch);
  if (!archive) throw new Error('This release has no installer for this Mac.');

  const free = await fs.statfs(paths.root);
  const needed = diskSpaceNeeded(archive.size);
  if (free.bavail * free.bsize < needed) {
    throw new Error(`Not enough free space for the new version: it needs ${inGb(needed)} GB.`);
  }

  // What an earlier attempt left, except this very archive.
  await Promise.all([paths.pending, paths.staged, paths.previous].map((left) => fs.rm(left, { recursive: true, force: true })));
  await fs.mkdir(paths.downloads, { recursive: true });
  for (const name of await fs.readdir(paths.downloads)) {
    if (name !== archive.name) await fs.rm(path.join(paths.downloads, name), { recursive: true, force: true });
  }

  const downloaded = path.join(paths.downloads, archive.name);
  await downloadVerified(
    {
      url: new URL(archive.name, opts.feedBaseUrl).toString(),
      dest: downloaded,
      sha512: archive.sha512,
      size: archive.size,
      onProgress: (received, total) => report({ phase: 'download', received, total }),
    },
    { fetchImpl },
  );

  try {
    report({ phase: 'install', message: 'Unpacking the new version…' });
    const stagedApp = await extractMacArchive(downloaded, paths.staged);
    report({ phase: 'install', message: 'Checking the new version…' });
    await verifyMacApp({ candidate: stagedApp, running: appPath, version: feed.version });
    writePendingShellUpdate(userDataDir, {
      version: feed.version,
      appPath,
      stagedApp,
      previousApp: path.join(paths.previous, path.basename(appPath)),
    });
  } catch (error) {
    // An archive that unpacks to the wrong thing is not worth keeping.
    await fs.rm(paths.staged, { recursive: true, force: true });
    await fs.rm(downloaded, { force: true });
    throw error;
  }
  return { version: feed.version };
}

/** One preparation per data folder at a time: a second ask joins the first. */
const preparing = new Map<string, Promise<{ version: string }>>();

export function prepareMacAppUpdate(opts: MacAppUpdateOptions, deps: { fetchImpl?: typeof fetch } = {}): Promise<{ version: string }> {
  const running = preparing.get(opts.userDataDir);
  if (running) return running;
  const started = prepare(opts, deps).finally(() => preparing.delete(opts.userDataDir));
  preparing.set(opts.userDataDir, started);
  return started;
}
