/**
 * Removes a folder and what is in it. Not `fs.rm`: inside Electron `fs` reads
 * an `.asar` as a folder, so an app bundle — which holds one — is emptied
 * around it and never goes.
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function removeTree(target: string): Promise<void> {
  // Only macOS installs this way; elsewhere this is here for the tests to run.
  if (process.platform === 'win32') await fs.rm(target, { recursive: true, force: true });
  else await run('/bin/rm', ['-rf', '--', target]);
}
