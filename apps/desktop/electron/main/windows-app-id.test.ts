import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WINDOWS_APP_ID, nameAppForWindows } from './windows-app-id.js';

describe('nameAppForWindows', () => {
  it('uses the id the installer writes on the shortcut, or Windows shows no toast for the app', () => {
    const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')) as {
      build: { appId: string };
    };

    expect(WINDOWS_APP_ID).toBe(manifest.build.appId);
  });

  it('names the process on Windows only', () => {
    const named: string[] = [];
    const app = { setAppUserModelId: (id: string) => named.push(id) };

    nameAppForWindows(app, 'darwin');
    nameAppForWindows(app, 'linux');
    expect(named).toEqual([]);

    nameAppForWindows(app, 'win32');
    expect(named).toEqual([WINDOWS_APP_ID]);
  });
});
