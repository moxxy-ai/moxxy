/**
 * Putting a downloaded app where the installed one is, and what is left to do
 * on the launch after. Everything waits under `<userData>/shell-update/`:
 *
 *   downloads/   the archive, kept until the update is in so a retry is quick
 *   staged/      the new app, unpacked and checked
 *   previous/    the app that was installed, until the new one has started
 *   pending.json what is waiting, and how the move went
 *
 * The move is two renames on one disk, done as Moxxy closes — an app cannot be
 * swapped for another while its windows are still open.
 */

import { existsSync, mkdirSync, promises as fs, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { z } from '@moxxy/sdk';
import { writeFileAtomicSync } from '@moxxy/sdk/server';
import { removeTree } from './remove-tree.js';

const pendingSchema = z.object({
  version: z.string().min(1).max(100),
  appPath: z.string().min(1),
  stagedApp: z.string().min(1),
  previousApp: z.string().min(1),
  swapped: z.boolean().optional(),
  error: z.string().optional(),
});

export type PendingShellUpdate = Readonly<z.infer<typeof pendingSchema>>;

export type ShellUpdateOutcome =
  | { readonly version: string; readonly installed: true }
  | { readonly version: string; readonly installed: false; readonly error: string };

export interface ShellUpdatePaths {
  readonly root: string;
  readonly downloads: string;
  readonly staged: string;
  readonly previous: string;
  readonly pending: string;
}

export function shellUpdatePaths(userDataDir: string): ShellUpdatePaths {
  const root = path.join(userDataDir, 'shell-update');
  return {
    root,
    downloads: path.join(root, 'downloads'),
    staged: path.join(root, 'staged'),
    previous: path.join(root, 'previous'),
    pending: path.join(root, 'pending.json'),
  };
}

export function writePendingShellUpdate(userDataDir: string, pending: PendingShellUpdate): void {
  const { root, pending: file } = shellUpdatePaths(userDataDir);
  mkdirSync(root, { recursive: true });
  writeFileAtomicSync(file, `${JSON.stringify(pending, null, 2)}\n`);
}

export function readPendingShellUpdate(userDataDir: string): PendingShellUpdate | null {
  try {
    const parsed = pendingSchema.safeParse(JSON.parse(readFileSync(shellUpdatePaths(userDataDir).pending, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Moves the waiting app in. Synchronous: it runs as the process exits. The
 * installed app is back in its place whenever the new one could not take it.
 */
export function applyShellUpdate(userDataDir: string): { ok: true } | { ok: false; error: string } {
  const pending = readPendingShellUpdate(userDataDir);
  if (!pending) return { ok: false, error: 'No update is waiting to be installed.' };
  const failed = (error: string): { ok: false; error: string } => {
    try {
      writePendingShellUpdate(userDataDir, { ...pending, error });
    } catch {
      /* the launch after reads a move that did not happen either way */
    }
    return { ok: false, error };
  };
  const { appPath, stagedApp, previousApp } = pending;
  if (!existsSync(stagedApp)) return failed('The new version was not there to be put in place.');

  try {
    rmSync(previousApp, { recursive: true, force: true });
    mkdirSync(path.dirname(previousApp), { recursive: true });
    renameSync(appPath, previousApp);
  } catch (error) {
    return failed(`The installed version could not be set aside: ${messageOf(error)}`);
  }
  try {
    renameSync(stagedApp, appPath);
  } catch (error) {
    try {
      renameSync(previousApp, appPath);
    } catch (restoreError) {
      return failed(`The new version could not be put in place, and the installed one is now at ${previousApp}: ${messageOf(restoreError)}`);
    }
    return failed(`The new version could not be put in place: ${messageOf(error)}`);
  }
  try {
    writePendingShellUpdate(userDataDir, { ...pending, swapped: true });
  } catch {
    /* the launch after tells by the version that is running */
  }
  return { ok: true };
}

/**
 * The launch after: with the new version running, what the update left behind
 * is removed, the previous app included. Otherwise it says why the new version
 * is not the one running; what was downloaded stays for the next try.
 */
export async function settleShellUpdate(opts: { userDataDir: string; shellVersion: string }): Promise<ShellUpdateOutcome | null> {
  const pending = readPendingShellUpdate(opts.userDataDir);
  if (!pending) return null;
  const paths = shellUpdatePaths(opts.userDataDir);
  const { version } = pending;
  if (opts.shellVersion === version) {
    // The record goes last: a clean-up cut short is finished by the next launch.
    try {
      for (const left of [paths.previous, paths.staged, paths.downloads, paths.root]) {
        await removeTree(left);
      }
    } catch {
      /* the next launch tries again */
    }
    return { version, installed: true };
  }
  if (pending.swapped) {
    // This is the previous app, started from where it is kept: leave it there.
    return { version, installed: false, error: `Moxxy is running version ${opts.shellVersion}, not ${version}.` };
  }
  await removeTree(paths.staged);
  await fs.rm(paths.pending, { force: true });
  return { version, installed: false, error: pending.error ?? 'Moxxy closed before the new version was put in place.' };
}
