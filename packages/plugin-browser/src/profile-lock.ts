import { mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isPidAlive, moxxyPath } from '@moxxy/sdk/server';

/**
 * Where the terminal's browser keeps its profile, and who holds it.
 *
 * One Chromium on a profile at a time: two writing the same cookie store
 * corrupt it, and Chromium under Playwright does not refuse a second one, so
 * the lock file says who holds it.
 */

export interface BrowserProfile {
  readonly dir: string;
  readonly lock: string;
}

export function defaultBrowserProfile(): BrowserProfile {
  return { dir: moxxyPath('browser', 'profile'), lock: moxxyPath('browser', 'profile.lock') };
}

export class ProfileBusyError extends Error {
  constructor(readonly holder: number) {
    super(
      `the browser profile is in use by another moxxy run (pid ${holder}) — ` +
        'let it finish or close it, then try again',
    );
    this.name = 'ProfileBusyError';
  }
}

/** Hold the profile: a release, or the pid of the live run holding it. */
export function claimProfile(profile: BrowserProfile): (() => void) | { busy: number } {
  mkdirSync(dirname(profile.lock), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(profile.lock, String(process.pid), { flag: 'wx', mode: 0o600 });
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        rmSync(profile.lock, { force: true });
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const holder = Number.parseInt(readFileSync(profile.lock, 'utf8'), 10);
      if (isPidAlive(holder)) return { busy: holder };
      // Its holder died without letting go.
      try {
        unlinkSync(profile.lock);
      } catch {
        // Another run took it over first; the next attempt sees who.
      }
    }
  }
  return { busy: Number.parseInt(readFileSync(profile.lock, 'utf8'), 10) };
}
