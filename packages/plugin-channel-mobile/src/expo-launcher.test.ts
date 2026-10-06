import { existsSync, mkdtempSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildExpoStartArgs,
  startMobileExpoApp,
  resolveMobileExpoAppDir,
  resolveMobileExpoOptions,
} from './expo-launcher.js';
import { removeDirSync } from '@moxxy/vitest-preset/fs';

describe('mobile Expo launcher', () => {
  it('starts the bundled full mobile Expo app by default', () => {
    expect(resolveMobileExpoOptions()).toEqual({
      enabled: true,
      host: 'lan',
      port: 8081,
    });
  });

  it('can be disabled for bridge-only mobile runs', () => {
    expect(resolveMobileExpoOptions({ 'no-expo': true })).toEqual({
      enabled: false,
      host: 'lan',
      port: 8081,
    });
  });

  it('builds the Expo start command Expo Go can scan', () => {
    expect(buildExpoStartArgs({ host: 'lan', port: 8081 })).toEqual([
      'run',
      'start',
      '--',
      '--host',
      'lan',
      '--port',
      '8081',
    ]);
  });

  it('resolves the repo mobile app from the package directory', () => {
    const expected = fileURLToPath(new URL('../../../apps/mobile', import.meta.url));

    expect(resolveMobileExpoAppDir()).toBe(expected);
  });

  // npm is a .cmd shim on Windows, which a plain spawn('npm') cannot start.
  it("runs the app's own npm start script and stops it", async () => {
    const appDir = mkdtempSync(join(tmpdir(), 'moxxy-expo-app-'));
    const marker = join(appDir, 'started');
    writeFileSync(
      join(appDir, 'start.cjs'),
      "require('node:fs').writeFileSync('started', process.argv.slice(2).join(' ')); setInterval(() => {}, 1000);",
    );
    writeFileSync(
      join(appDir, 'package.json'),
      JSON.stringify({ name: 'fake-mobile-app', private: true, scripts: { start: 'node start.cjs' } }),
    );
    const started = new Promise<void>((resolveStarted) => {
      const watcher = watch(appDir, () => {
        if (!existsSync(marker)) return;
        watcher.close();
        resolveStarted();
      });
    });
    try {
      const handle = await startMobileExpoApp(
        { enabled: true, host: 'lan', port: 8081, appDir },
        { isPortOpen: async () => false },
      );
      await started;
      await handle?.stop();
      expect(readFileSync(marker, 'utf8')).toBe('--host lan --port 8081');
    } finally {
      removeDirSync(appDir);
    }
  }, 30_000);

  // npm runs the start script as its own child; killing only npm orphans Expo,
  // which keeps the port taken and the parent's stdio open.
  it.skipIf(process.platform === 'win32')('stops the process npm started, not only npm', async () => {
    const appDir = mkdtempSync(join(tmpdir(), 'moxxy-expo-app-'));
    const pidFile = join(appDir, 'pid');
    writeFileSync(
      join(appDir, 'start.cjs'),
      "require('node:fs').writeFileSync('pid', String(process.pid)); setInterval(() => {}, 1000);",
    );
    writeFileSync(
      join(appDir, 'package.json'),
      JSON.stringify({ name: 'fake-mobile-app', private: true, scripts: { start: 'node start.cjs' } }),
    );
    const started = new Promise<void>((resolveStarted) => {
      const watcher = watch(appDir, () => {
        if (!existsSync(pidFile) || readFileSync(pidFile, 'utf8') === '') return;
        watcher.close();
        resolveStarted();
      });
    });
    let appPid = 0;
    try {
      const handle = await startMobileExpoApp(
        { enabled: true, host: 'lan', port: 8081, appDir },
        { isPortOpen: async () => false },
      );
      await started;
      appPid = Number(readFileSync(pidFile, 'utf8'));
      await handle?.stop();
      await expect.poll(() => isAlive(appPid), { timeout: 5_000 }).toBe(false);
    } finally {
      if (appPid > 0 && isAlive(appPid)) process.kill(appPid, 'SIGKILL');
      removeDirSync(appDir);
    }
  }, 30_000);
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
