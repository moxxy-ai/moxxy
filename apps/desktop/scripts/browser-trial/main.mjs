// A window with the desktop's real browser host, for live trials of the agent's browser tools without the app.
// The page is a real <webview> driven over CDP by the same BrowserHost and BrowserBridge the desktop uses;
// `moxxy -p` reaches it through MOXXY_BROWSER_BRIDGE_SOCKET / _TOKEN, read from the file this writes.
//
// usage: pnpm --filter @moxxy/desktop exec electron scripts/browser-trial/main.mjs --user-data-dir=<dir>
// env:   TRIAL_BRIDGE_FILE  where to write { socketPath, token } (0600)
//        TRIAL_START_URL    the first tab's page (default about:blank)
//        TRIAL_LOG          where hand-offs and tab changes are logged (optional)
import { app, BrowserWindow, ipcMain, webContents } from 'electron';
import { appendFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BrowserHost, BROWSER_PARTITION } from '../../../../packages/desktop-host/dist/browser/host.js';
import { BrowserBridge } from '../../../../packages/desktop-host/dist/browser/bridge.js';

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const log = (entry) => {
  if (process.env.TRIAL_LOG) appendFileSync(process.env.TRIAL_LOG, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
};

const host = new BrowserHost((id) => {
  const wc = webContents.fromId(id);
  return wc && !wc.isDestroyed() ? wc : null;
});
const bridge = new BrowserBridge(host);
// As the desktop does: a new window from a page becomes a tab.

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Moxxy browser trial',
    webPreferences: { preload: here('./preload.cjs'), contextIsolation: true, sandbox: false, webviewTag: true },
  });
  // The same privileges the desktop gives its views: main decides them, not the page.
  window.webContents.on('will-attach-webview', (_event, preferences, params) => {
    params.partition = BROWSER_PARTITION;
    Object.assign(preferences, { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true });
    delete preferences.preload;
  });

  const send = (channel, payload) => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  };
  ipcMain.handle('trial.register', (_event, { webContentsId, requestId }) => host.register(webContentsId, requestId));
  ipcMain.handle('trial.release', (_event, { tabId }) => host.unregister(tabId));
  ipcMain.handle('trial.select', (_event, { tabId }) => host.select(tabId));
  ipcMain.on('trial.focused', (_event, { requestId }) => host.confirmFocus(requestId));
  host.setOpener((req) => send('trial.openTab', req));
  host.setFocuser((req) => send('trial.focusTab', req));
  // Nobody sits at a trial: a hand-off is logged and skipped, which the agent sees as "not completed".
  host.setHandoffPrompt((req) => {
    log({ handoff: req });
    setTimeout(() => host.resolveHandoff(req.requestId, false), 50);
  });
  host.onChange(() => {
    const tabs = host.list();
    log({ tabs });
    send('trial.tabs', { tabs, activeTabId: host.activeId });
  });

  await window.loadFile(here('./index.html'), { query: { start: process.env.TRIAL_START_URL ?? 'about:blank' } });
  const address = await bridge.start();
  if (process.env.TRIAL_BRIDGE_FILE) writeFileSync(process.env.TRIAL_BRIDGE_FILE, JSON.stringify(address), { mode: 0o600 });
  log({ ready: true });
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  host.closeAll();
  void bridge.stop();
});
