import { beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  applyShellUpdate,
  readPendingShellUpdate,
  settleShellUpdate,
  shellUpdatePaths,
  writePendingShellUpdate,
  type PendingShellUpdate,
} from './mac-swap';

let root: string;
let userDataDir: string;
let appPath: string;

/** A directory standing for an app: swapping moves directories, whatever is in them. */
function makeApp(at: string, marker: string): void {
  mkdirSync(path.join(at, 'Contents'), { recursive: true });
  writeFileSync(path.join(at, 'Contents', 'marker'), marker);
}
const markerOf = (at: string): string => readFileSync(path.join(at, 'Contents', 'marker'), 'utf8');

function pendingFor(version: string): PendingShellUpdate {
  const paths = shellUpdatePaths(userDataDir);
  return {
    version,
    appPath,
    stagedApp: path.join(paths.staged, 'Moxxy.app'),
    previousApp: path.join(paths.previous, 'Moxxy.app'),
  };
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'shell-swap-'));
  userDataDir = path.join(root, 'user-data');
  appPath = path.join(root, 'Applications', 'Moxxy.app');
  makeApp(appPath, 'old');
});

describe('applyShellUpdate', () => {
  it('puts the new app where the old one was and keeps the old one aside', () => {
    const pending = pendingFor('2.0.0');
    makeApp(pending.stagedApp, 'new');
    writePendingShellUpdate(userDataDir, pending);

    expect(applyShellUpdate(userDataDir)).toEqual({ ok: true });

    expect(markerOf(appPath)).toBe('new');
    expect(markerOf(pending.previousApp)).toBe('old');
    expect(existsSync(pending.stagedApp)).toBe(false);
  });

  it('leaves the old app in place when the new one is not there', () => {
    const pending = pendingFor('2.0.0');
    writePendingShellUpdate(userDataDir, pending);

    const result = applyShellUpdate(userDataDir);

    expect(result.ok).toBe(false);
    expect(markerOf(appPath)).toBe('old');
    expect(readPendingShellUpdate(userDataDir)?.error).toMatch(/new version/i);
  });

  // Taking write access from a directory is how a move out of it fails for
  // real; it holds neither on Windows nor for root.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'puts the old app back when the new one cannot be moved in',
    () => {
      const pending = pendingFor('2.0.0');
      makeApp(pending.stagedApp, 'new');
      writePendingShellUpdate(userDataDir, pending);
      const locked = path.dirname(pending.stagedApp);
      chmodSync(locked, 0o555);
      try {
        const result = applyShellUpdate(userDataDir);

        expect(result.ok).toBe(false);
        expect(markerOf(appPath)).toBe('old');
        expect(existsSync(pending.previousApp)).toBe(false);
        expect(readPendingShellUpdate(userDataDir)?.error).toMatch(/could not be put in place/i);
      } finally {
        chmodSync(locked, 0o755);
      }
    },
  );

  it('does nothing when no update is waiting', () => {
    expect(applyShellUpdate(userDataDir)).toEqual({ ok: false, error: 'No update is waiting to be installed.' });
    expect(markerOf(appPath)).toBe('old');
  });
});

describe('settleShellUpdate', () => {
  it('has nothing to say when no update was waiting', async () => {
    expect(await settleShellUpdate({ userDataDir, shellVersion: '1.0.0' })).toBeNull();
  });

  it('removes the old app once the new one is the one running', async () => {
    const pending = pendingFor('2.0.0');
    const paths = shellUpdatePaths(userDataDir);
    makeApp(pending.stagedApp, 'new');
    mkdirSync(paths.downloads, { recursive: true });
    writeFileSync(path.join(paths.downloads, 'app.zip'), 'zip');
    writePendingShellUpdate(userDataDir, pending);
    applyShellUpdate(userDataDir);

    expect(await settleShellUpdate({ userDataDir, shellVersion: '2.0.0' })).toEqual({ version: '2.0.0', installed: true });

    expect(markerOf(appPath)).toBe('new');
    expect(existsSync(paths.root)).toBe(false);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'finishes on the next launch a clean-up that was cut short',
    async () => {
      const pending = pendingFor('2.0.0');
      const paths = shellUpdatePaths(userDataDir);
      makeApp(pending.stagedApp, 'new');
      writePendingShellUpdate(userDataDir, pending);
      applyShellUpdate(userDataDir);
      const locked = path.join(pending.previousApp, 'Contents');
      chmodSync(locked, 0o555);
      try {
        expect(await settleShellUpdate({ userDataDir, shellVersion: '2.0.0' })).toEqual({ version: '2.0.0', installed: true });
        expect(existsSync(pending.previousApp)).toBe(true);
      } finally {
        chmodSync(locked, 0o755);
      }

      expect(await settleShellUpdate({ userDataDir, shellVersion: '2.0.0' })).toEqual({ version: '2.0.0', installed: true });
      expect(existsSync(paths.root)).toBe(false);
    },
  );

  it('keeps the old app aside while the app running is still the old one', async () => {
    const pending = pendingFor('2.0.0');
    makeApp(pending.stagedApp, 'new');
    writePendingShellUpdate(userDataDir, pending);
    applyShellUpdate(userDataDir);

    // The old app, started by hand from where it was kept.
    const outcome = await settleShellUpdate({ userDataDir, shellVersion: '1.0.0' });

    expect(outcome).toEqual({ version: '2.0.0', installed: false, error: expect.stringMatching(/1\.0\.0/) });
    expect(markerOf(pending.previousApp)).toBe('old');
  });

  it('says why when the new app was never moved in, and clears what was unpacked', async () => {
    const pending = pendingFor('2.0.0');
    const paths = shellUpdatePaths(userDataDir);
    mkdirSync(paths.downloads, { recursive: true });
    writeFileSync(path.join(paths.downloads, 'app.zip'), 'zip');
    writePendingShellUpdate(userDataDir, pending);
    applyShellUpdate(userDataDir);

    const outcome = await settleShellUpdate({ userDataDir, shellVersion: '1.0.0' });

    expect(outcome).toEqual({ version: '2.0.0', installed: false, error: expect.stringMatching(/new version/i) });
    expect(readPendingShellUpdate(userDataDir)).toBeNull();
    expect(existsSync(paths.staged)).toBe(false);
    // The download is whole: trying again does not fetch it a second time.
    expect(existsSync(path.join(paths.downloads, 'app.zip'))).toBe(true);
  });

  it('reads a damaged record as no update waiting', async () => {
    const paths = shellUpdatePaths(userDataDir);
    mkdirSync(paths.root, { recursive: true });
    writeFileSync(paths.pending, '{not json');

    expect(readPendingShellUpdate(userDataDir)).toBeNull();
    expect(await settleShellUpdate({ userDataDir, shellVersion: '1.0.0' })).toBeNull();
  });
});
