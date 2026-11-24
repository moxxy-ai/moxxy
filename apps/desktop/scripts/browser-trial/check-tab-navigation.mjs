// Run after pnpm build: node apps/desktop/scripts/browser-trial/check-tab-navigation.mjs
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const desktop = fileURLToPath(new URL('../../', import.meta.url));
const electron = createRequire(import.meta.url)('electron');
const { _electron } = createRequire(new URL('../../../../packages/plugin-browser/package.json', import.meta.url))('playwright');
const dir = await mkdtemp(join(tmpdir(), 'moxxy-tab-navigation-'));
const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<title>Draft</title><input id="draft">');
});

let app;
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  const home = join(dir, 'home');
  await mkdir(join(home, 'desktop'), { recursive: true });
  await writeFile(join(home, 'desktop/prefs.json'), JSON.stringify({ onboardingComplete: true, mobileGatewayEnabled: false }));
  app = await _electron.launch({
    executablePath: electron,
    args: [desktop, '--user-data-dir=' + join(dir, 'profile')],
    env: {
      ...process.env,
      MOXXY_HOME: home,
      MOXXY_CLI_ENTRY: join(desktop, '../../packages/cli/dist/bin.js'),
      ELECTRON_RENDERER_URL: pathToFileURL(join(desktop, 'dist/index.html')).href,
    },
  });
  const page = await app.firstWindow();
  const menu = page.getByTestId('account-menu-trigger');
  await menu.waitFor();
  const openView = async (name) => {
    await menu.click();
    await page.getByTestId('nav-' + name).click();
  };
  const list = () => page.evaluate(() => window.moxxy.invoke('browser.listTabs'));
  for (const path of ['/one', '/two']) {
    const url = origin + path;
    await page.evaluate((url) => window.moxxy.invoke('browser.showUrl', { url }), url);
    await page.locator(`.browser__tab-name[title="${url}"]`).filter({ hasText: 'Draft' }).waitFor();
  }
  const before = await list();
  assert.equal(before.tabs.length, 2);
  const view = page.locator('webview').last();
  await view.evaluate(v => v.executeJavaScript('document.querySelector("input").value = "unsaved draft"'));
  const guest = await view.evaluate(v => v.getWebContentsId());

  for (const [destination, section] of [['settings'], ['extensions', 'Skills'], ['extensions', 'MCP'], ['channels']]) {
    await openView(destination);
    if (section) await page.getByRole('button', { name: section, exact: true }).click();
    await page.getByRole('complementary', { name: 'Workbench' }).waitFor({ state: 'hidden' });
    assert.deepEqual((await list()).tabs, before.tabs, 'open tabs while visiting ' + (section ?? destination));
    await openView('chat');
    await page.getByRole('tablist', { name: 'Browser tabs' }).waitFor();
    const after = await list();
    assert.deepEqual(after.tabs, before.tabs);
    assert.equal(after.activeTabId, before.activeTabId);
    assert.equal(await view.evaluate(v => v.getWebContentsId()), guest);
    assert.equal(await view.evaluate(v => v.executeJavaScript('document.querySelector("input").value')), 'unsaved draft');
    console.log('PASS return from', section ?? destination);
  }

  await page.getByTestId('bench-full').click();
  // The sidebar is hidden in full view. Open Extensions with its numbered shortcut.
  await page.getByTestId('bench-full').press(process.platform === 'darwin' ? 'Meta+2' : 'Control+2');
  await page.getByRole('complementary', { name: 'Workbench' }).waitFor({ state: 'hidden', timeout: 4000 });
  await openView('chat');
  assert.equal(await page.getByTestId('bench-full').getAttribute('aria-pressed'), 'true');
  assert.equal(await view.evaluate(v => v.getWebContentsId()), guest);
  await page.getByRole('button', { name: 'Close Draft', exact: true }).first().click();
  await page.locator('.browser__tab-name').nth(1).waitFor({ state: 'detached' });
  assert.deepEqual((await list()).tabs.map(tab => tab.tabId), [before.activeTabId]);
  console.log('PASS full view and closing one tab after returning');
} finally {
  try {
    await app?.close();
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}
