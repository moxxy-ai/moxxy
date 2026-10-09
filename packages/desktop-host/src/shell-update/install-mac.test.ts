import { beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { diskSpaceNeeded, prepareMacAppUpdate } from './install-mac';
import { applyShellUpdate, readPendingShellUpdate, settleShellUpdate, shellUpdatePaths } from './mac-swap';
import { makeTinyApp, signAdHoc, zipApp } from './mac-app.test-support';

const FEED_BASE = 'https://github.com/moxxy-ai/moxxy/releases/download/desktop-v1.0.0/';

/** The release, served by a `fetch` that answers from files on this disk — the
 *  network is the one boundary this test does not cross. */
function release(files: Record<string, Buffer | string>): { fetchImpl: typeof fetch; asked: string[] } {
  const asked: string[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    asked.push(url);
    const name = url.slice(FEED_BASE.length);
    const body = url.startsWith(FEED_BASE) ? files[name] : undefined;
    return body === undefined ? new Response('Not Found', { status: 404 }) : new Response(body);
  }) as typeof fetch;
  return { fetchImpl, asked };
}

const feedFor = (version: string, archive: Buffer, size = archive.length): string =>
  `version: ${version}\nfiles:\n  - url: tiny-universal.zip\n    sha512: ${createHash('sha512').update(archive).digest('base64')}\n    size: ${size}\npath: tiny-universal.zip\n`;

describe('diskSpaceNeeded', () => {
  it('is the archive and the app unpacked from it', () => {
    expect(diskSpaceNeeded(1_000)).toBe(3_500);
  });
});

describe.skipIf(process.platform !== 'darwin')('prepareMacAppUpdate', () => {
  let dir: string;
  let appPath: string;
  let userDataDir: string;
  let archive: Buffer;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'shell-install-'));
    appPath = path.join(dir, 'Applications', 'Tiny.app');
    userDataDir = path.join(dir, 'user-data');
    makeTinyApp(appPath, { version: '1.0.0' });
    signAdHoc(appPath);
    // The release carries the same signed app: an ad-hoc signature is tied to
    // the bytes, so only an identical app counts as "from the same developer".
    const zip = path.join(dir, 'release', 'tiny-universal.zip');
    zipApp(appPath, zip);
    archive = readFileSync(zip);
  });

  const prepare = (fetchImpl: typeof fetch, phases: string[] = []): Promise<{ version: string }> =>
    prepareMacAppUpdate(
      { feedBaseUrl: FEED_BASE, appPath, userDataDir, arch: 'arm64', onProgress: (p) => phases.push(p.message ?? p.phase) },
      { fetchImpl },
    );

  it('downloads, unpacks and checks the new app, and leaves it waiting to be moved in', async () => {
    const { fetchImpl } = release({ 'latest-mac.yml': feedFor('1.0.0', archive), 'tiny-universal.zip': archive });
    const phases: string[] = [];

    expect(await prepare(fetchImpl, phases)).toEqual({ version: '1.0.0' });

    const pending = readPendingShellUpdate(userDataDir);
    expect(pending).toMatchObject({ version: '1.0.0', appPath });
    expect(existsSync(path.join(pending?.stagedApp ?? '', 'Contents', 'Info.plist'))).toBe(true);
    expect(phases).toEqual(expect.arrayContaining(['download', 'Unpacking the new version…', 'Checking the new version…']));
  });

  it('moves the new app in when Moxxy closes, and clears up after the new one has started', async () => {
    const { fetchImpl } = release({ 'latest-mac.yml': feedFor('1.0.0', archive), 'tiny-universal.zip': archive });
    const installed = statSync(appPath).ino;
    await prepare(fetchImpl);

    expect(applyShellUpdate(userDataDir)).toEqual({ ok: true });

    const pending = readPendingShellUpdate(userDataDir);
    expect(statSync(appPath).ino).not.toBe(installed);
    expect(statSync(pending?.previousApp ?? '').ino).toBe(installed);

    expect(await settleShellUpdate({ userDataDir, shellVersion: '1.0.0' })).toEqual({ version: '1.0.0', installed: true });
    expect(existsSync(shellUpdatePaths(userDataDir).root)).toBe(false);
    expect(existsSync(path.join(appPath, 'Contents', 'Info.plist'))).toBe(true);
  });

  it('does not download the archive again when asked a second time', async () => {
    const first = release({ 'latest-mac.yml': feedFor('1.0.0', archive), 'tiny-universal.zip': archive });
    await prepare(first.fetchImpl);
    const second = release({ 'latest-mac.yml': feedFor('1.0.0', archive), 'tiny-universal.zip': archive });

    await prepare(second.fetchImpl);

    expect(second.asked).toEqual([`${FEED_BASE}latest-mac.yml`]);
  });

  it('refuses a release whose app is signed by someone else, and leaves nothing waiting', async () => {
    const foreign = path.join(dir, 'foreign', 'Tiny.app');
    makeTinyApp(foreign, { version: '1.0.0', note: 'from somewhere else' });
    signAdHoc(foreign);
    const zip = path.join(dir, 'foreign.zip');
    zipApp(foreign, zip);
    const other = readFileSync(zip);
    const { fetchImpl } = release({ 'latest-mac.yml': feedFor('1.0.0', other), 'tiny-universal.zip': other });

    await expect(prepare(fetchImpl)).rejects.toThrow(/not signed by the same developer/i);

    expect(readPendingShellUpdate(userDataDir)).toBeNull();
    expect(existsSync(shellUpdatePaths(userDataDir).staged)).toBe(false);
    expect(applyShellUpdate(userDataDir).ok).toBe(false);
  });

  it('refuses a release with no installer for this Mac', async () => {
    const { fetchImpl } = release({ 'latest-mac.yml': 'version: 1.0.0\nfiles: []\n' });

    await expect(prepare(fetchImpl)).rejects.toThrow(/no installer/i);
  });

  it('says so when the release has no macOS installer list', async () => {
    const { fetchImpl } = release({});

    await expect(prepare(fetchImpl)).rejects.toThrow(/HTTP 404/);
  });

  it('asks for nothing when the disk has no room for the new version', async () => {
    const { fetchImpl, asked } = release({ 'latest-mac.yml': feedFor('1.0.0', archive, 9e15), 'tiny-universal.zip': archive });

    await expect(prepare(fetchImpl)).rejects.toThrow(/not enough free space/i);

    expect(asked).toEqual([`${FEED_BASE}latest-mac.yml`]);
  });

  it.skipIf(process.getuid?.() === 0)('refuses up front when the folder Moxxy is in cannot be changed', async () => {
    const { fetchImpl, asked } = release({ 'latest-mac.yml': feedFor('1.0.0', archive), 'tiny-universal.zip': archive });
    const folder = path.dirname(appPath);
    chmodSync(folder, 0o555);
    try {
      await expect(prepare(fetchImpl)).rejects.toThrow(/cannot change the folder/i);
      expect(asked).toEqual([]);
    } finally {
      chmodSync(folder, 0o755);
    }
  });

  it('refuses a copy of Moxxy run from where macOS keeps unmoved downloads', async () => {
    const { fetchImpl, asked } = release({});

    await expect(
      prepareMacAppUpdate(
        {
          feedBaseUrl: FEED_BASE,
          appPath: '/private/var/folders/ab/T/AppTranslocation/1234/d/Tiny.app',
          userDataDir,
          arch: 'arm64',
        },
        { fetchImpl },
      ),
    ).rejects.toThrow(/Applications folder/i);
    expect(asked).toEqual([]);
  });
});
