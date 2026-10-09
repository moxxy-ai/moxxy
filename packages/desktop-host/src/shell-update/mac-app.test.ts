import { beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { appBundleOf, extractMacArchive, verifyMacApp } from './mac-app';
import { copyApp, makeTinyApp, signAdHoc, zipApp } from './mac-app.test-support';

describe('appBundleOf', () => {
  it('is the app the running program sits in', () => {
    expect(appBundleOf('/Applications/MoxxyAI Workspaces.app/Contents/MacOS/MoxxyAI Workspaces')).toBe(
      '/Applications/MoxxyAI Workspaces.app',
    );
  });

  it('is nothing for a program that is not inside an app', () => {
    expect(appBundleOf('/usr/local/bin/electron')).toBeNull();
    expect(appBundleOf('/opt/Moxxy/Contents/MacOS/moxxy')).toBeNull();
  });
});

describe.skipIf(process.platform !== 'darwin')('a macOS app on disk', () => {
  let dir: string;
  let running: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'shell-app-'));
    running = path.join(dir, 'installed', 'Tiny.app');
    makeTinyApp(running, { version: '1.0.0' });
    signAdHoc(running);
  });

  describe('extractMacArchive', () => {
    it('unpacks the app the archive carries', async () => {
      const archive = path.join(dir, 'tiny.zip');
      zipApp(running, archive);

      const app = await extractMacArchive(archive, path.join(dir, 'staged'));

      expect(app).toBe(path.join(dir, 'staged', 'Tiny.app'));
      expect(readFileSync(path.join(app, 'Contents', 'Resources', 'note.txt'), 'utf8')).toBe('tiny');
    });

    it('starts from an empty folder every time', async () => {
      const archive = path.join(dir, 'tiny.zip');
      zipApp(running, archive);
      const staged = path.join(dir, 'staged');
      await extractMacArchive(archive, staged);
      writeFileSync(path.join(staged, 'left-over'), 'from the last attempt');

      await extractMacArchive(archive, staged);

      expect(existsSync(path.join(staged, 'left-over'))).toBe(false);
    });

    it('refuses an archive with no app in it', async () => {
      const archive = path.join(dir, 'not-an-app.zip');
      zipApp(path.join(running, 'Contents', 'Resources'), archive);

      await expect(extractMacArchive(archive, path.join(dir, 'staged'))).rejects.toThrow(/no app/i);
    });

    it('refuses a file that is not an archive', async () => {
      const archive = path.join(dir, 'broken.zip');
      writeFileSync(archive, 'this is not a zip');

      await expect(extractMacArchive(archive, path.join(dir, 'staged'))).rejects.toThrow(/could not be unpacked/i);
    });
  });

  describe('verifyMacApp', () => {
    it('accepts an app signed as the running one is', async () => {
      const candidate = path.join(dir, 'staged', 'Tiny.app');
      copyApp(running, candidate);

      await expect(verifyMacApp({ candidate, running, version: '1.0.0' })).resolves.toBeUndefined();
    });

    it('refuses an app signed by someone else', async () => {
      const candidate = path.join(dir, 'staged', 'Tiny.app');
      makeTinyApp(candidate, { version: '1.0.0', note: 'from somewhere else' });
      signAdHoc(candidate);

      await expect(verifyMacApp({ candidate, running, version: '1.0.0' })).rejects.toThrow(/not signed by the same developer/i);
    });

    it('refuses an app changed after it was signed', async () => {
      const candidate = path.join(dir, 'staged', 'Tiny.app');
      copyApp(running, candidate);
      appendFileSync(path.join(candidate, 'Contents', 'Resources', 'note.txt'), ' and more');

      await expect(verifyMacApp({ candidate, running, version: '1.0.0' })).rejects.toThrow(/signature is not valid/i);
    });

    it('refuses an app that is not signed at all', async () => {
      const candidate = path.join(dir, 'staged', 'Tiny.app');
      makeTinyApp(candidate, { version: '1.0.0' });

      await expect(verifyMacApp({ candidate, running, version: '1.0.0' })).rejects.toThrow(/signature is not valid/i);
    });

    it('refuses an app of another version than the release named', async () => {
      const candidate = path.join(dir, 'staged', 'Tiny.app');
      copyApp(running, candidate);

      await expect(verifyMacApp({ candidate, running, version: '2.0.0' })).rejects.toThrow(/version 1\.0\.0, not 2\.0\.0/);
    });

    it('cannot check against a running app that is not signed', async () => {
      const unsigned = path.join(dir, 'unsigned', 'Tiny.app');
      makeTinyApp(unsigned, { version: '1.0.0' });
      const candidate = path.join(dir, 'staged', 'Tiny.app');
      copyApp(running, candidate);

      await expect(verifyMacApp({ candidate, running: unsigned, version: '1.0.0' })).rejects.toThrow(/this copy of Moxxy is not signed/i);
    });
  });
});
