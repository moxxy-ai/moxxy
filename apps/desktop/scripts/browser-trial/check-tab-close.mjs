// After pnpm build: pnpm --filter @moxxy/desktop exec electron scripts/browser-trial/check-tab-close.mjs
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow, webContents } from 'electron';
import { BrowserHost } from '../../../../packages/plugin-browser/dist/page/host.js';

const profile = mkdtempSync(join(tmpdir(), 'moxxy-close-tab-'));
app.setPath('userData', profile);
void app.whenReady().then(async () => {
  const host = new BrowserHost((id) => webContents.fromId(id) ?? null);
  const windows = [];
  function open() {
    const win = new BrowserWindow({ show: false });
    windows.push(win);
    return { win, id: host.register(win.webContents.id) };
  }

  let code = 0;
  try {
    const previous = open();
    const survivor = open();
    const selected = open();
    // Reloading the desktop renderer destroys its guest before it can send releaseTab.
    const gone = once(previous.win.webContents, 'destroyed');
    previous.win.destroy();
    await gone;
    host.unregister(selected.id);
    assert.deepEqual(host.list().map((tab) => tab.tabId), [survivor.id]);
    assert.equal(host.activeId, survivor.id);
  } catch (error) {
    console.error(error);
    code = 1;
  } finally {
    for (const win of windows) if (!win.isDestroyed()) win.destroy();
    app.once('quit', () => rmSync(profile, { recursive: true, force: true, maxRetries: 3 }));
    app.exit(code);
  }
});
