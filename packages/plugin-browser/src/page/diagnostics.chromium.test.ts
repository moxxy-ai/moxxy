import { createServer, type Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BrowserHost } from './host.js';
import { dispatchToHost } from './dispatch.js';
import { chromiumAvailable, closeChromium, openChromiumTab, type ChromiumTab } from './chromium-tab.test-support.js';

const available = await chromiumAvailable();
let server: Server;
let origin = '';
let tab: ChromiumTab | undefined;
let host: BrowserHost | undefined;

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url?.startsWith('/secret')) {
      response.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'session=do-not-log' }).end(JSON.stringify({ token: 'do-not-log', nested: { accessToken: 'do-not-log', clientSecret: 'do-not-log' }, message: 'diagnostic result' }));
    } else if (request.url?.startsWith('/api')) {
      response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'INVALID_QUERY_PARAMETER' }));
    } else {
      response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Developer fixture</title><main style="min-width:820px">Products</main>');
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture has no port');
  origin = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  host?.closeAll();
  await tab?.close();
  tab = undefined;
  host = undefined;
});

afterAll(async () => {
  await closeChromium();
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
});

async function page() {
  tab = await openChromiumTab();
  const opened = tab;
  host = new BrowserHost((id) => id === opened.wc.id ? opened.wc : null);
  host.register(opened.wc.id);
  await opened.wc.loadURL(origin);
  return { host, tab: opened };
}

describe.skipIf(!available)('developer tools on real Chromium', () => {
  it('records a real HTTP 400, its response, console output and an uncaught exception', async () => {
    const { host, tab } = await page();
    expect((await dispatchToHost(host, 'diagnostics', { action: 'start' })).ok).toBe(true);
    await tab.read(`(async () => {
      console.error('filter failed');
      setTimeout(() => { throw new TypeError('missing price.amount'); }, 0);
      await fetch('/api?category_id=lighting');
    })()`);
    await expect.poll(async () => JSON.stringify(await dispatchToHost(host, 'diagnostics', { action: 'read' }))).toContain('missing price.amount');
    await expect.poll(async () => await dispatchToHost(host, 'diagnostics', { action: 'read' })).toMatchObject({ result: { network: expect.arrayContaining([expect.objectContaining({ status: 400, finished: true })]) } });
    const read = await dispatchToHost(host, 'diagnostics', { action: 'read', limit: 100 });
    expect(read).toMatchObject({ ok: true, result: { recording: true, console: expect.arrayContaining([
      expect.objectContaining({ level: 'error', text: 'filter failed' }),
      expect.objectContaining({ level: 'error', text: expect.stringContaining('missing price.amount') }),
    ]), network: expect.arrayContaining([expect.objectContaining({ method: 'GET', status: 400, url: `${origin}/api?category_id=lighting` })]) } });
    const result = read.result as { network: { id: string; url: string }[] };
    const request = result.network.find((row) => row.url.includes('/api'));
    if (!request) throw new Error('API request not recorded');
    await expect.poll(async () => await dispatchToHost(host, 'diagnostics', { action: 'response', request_id: request.id })).toMatchObject({
      ok: true, result: { body: '{"error":"INVALID_QUERY_PARAMETER"}', truncated: false },
    });
  });

  it('starts on demand, keeps at most 100 console entries and stops recording', async () => {
    const { host, tab } = await page();
    expect(await dispatchToHost(host, 'diagnostics', { action: 'read' })).toMatchObject({ ok: true, result: { recording: false, console: [], network: [] } });
    await dispatchToHost(host, 'diagnostics', { action: 'start' });
    await tab.read(`for (let i = 0; i < 140; i++) console.log('entry-' + i)`);
    const read = await dispatchToHost(host, 'diagnostics', { action: 'read', limit: 100 });
    expect(read).toMatchObject({ ok: true, result: { console: expect.any(Array), dropped: 40 } });
    expect((read.result as { console: unknown[] }).console).toHaveLength(100);
    await dispatchToHost(host, 'diagnostics', { action: 'stop' });
    await tab.read(`console.log('after stop')`);
    expect(JSON.stringify(await dispatchToHost(host, 'diagnostics', { action: 'read' }))).not.toContain('after stop');
  });

  it('stops diagnostics and refuses viewport changes when the user takes over', async () => {
    const { host, tab } = await page();
    host.noteAgentTurn('turn1');
    expect((await dispatchToHost(host, 'diagnostics', { action: 'start', turn_id: 'turn1' })).ok).toBe(true);
    host.takeOver();
    await tab.read(`console.error('private user input')`);
    expect(await dispatchToHost(host, 'viewport', { width: 390, height: 844, turn_id: 'turn1' })).toMatchObject({ ok: false });
    expect(JSON.stringify(await dispatchToHost(host, 'diagnostics', { action: 'read' }))).not.toContain('private user input');
    expect(await dispatchToHost(host, 'diagnostics', { action: 'read' })).toMatchObject({ ok: true, result: { recording: false } });
    expect(await dispatchToHost(host, 'diagnostics', { action: 'start', turn_id: 'turn1' })).toMatchObject({ ok: false });
  });

  it('sets and resets an actual 390 px viewport without changing page content', async () => {
    const { host, tab } = await page();
    const before = await tab.read<number>('innerWidth');
    expect(await dispatchToHost(host, 'viewport', { width: 390, height: 844 })).toMatchObject({ ok: true, result: { width: 390, height: 844, overridden: true } });
    expect(await tab.read('({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth })')).toEqual({ width: 390, overflow: true });
    expect((await dispatchToHost(host, 'viewport', { reset: true })).ok).toBe(true);
    expect(await tab.read('innerWidth')).toBe(before);
    expect(await tab.read('document.querySelector("main").textContent')).toBe('Products');
  });

  it('confirms clearing the viewport override at the actual panel size', async () => {
    const { host, tab } = await page();
    const before = await tab.read<number>('innerWidth');
    await dispatchToHost(host, 'viewport', { width: 390, height: 844 });
    expect(await dispatchToHost(host, 'viewport', { reset: true })).toMatchObject({
      ok: true, result: { width: before, overridden: false },
    });
    expect(await tab.read<number>('innerWidth')).toBe(before);
  });

  it('reports actual document overflow instead of just the requested viewport size', async () => {
    const { host, tab } = await page();
    const reply = await dispatchToHost(host, 'viewport', { width: 390, height: 844 });
    const documentWidth = await tab.read<number>('document.documentElement.scrollWidth');
    expect(documentWidth).toBeGreaterThan(390);
    expect(reply).toMatchObject({ ok: true, result: { width: 390, documentWidth, horizontalOverflow: true } });
  });

  it('reports no horizontal overflow when the content fits the viewport', async () => {
    const { host, tab } = await page();
    await tab.read('document.querySelector("main").style.minWidth = "0"');
    expect(await dispatchToHost(host, 'viewport', { width: 390, height: 844 })).toMatchObject({
      ok: true, result: { width: 390, documentWidth: 390, horizontalOverflow: false },
    });
  });

  it('redacts recognized credentials and never includes network headers', async () => {
    const { host, tab } = await page();
    await dispatchToHost(host, 'diagnostics', { action: 'start' });
    await tab.read(`(async () => {
      console.log('Authorization: Bearer do-not-log');
      await (await fetch('/secret?access_token=do-not-log', { headers: { Authorization: 'Bearer do-not-log' } })).text();
    })()`);
    await expect.poll(async () => await dispatchToHost(host, 'diagnostics', { action: 'read' })).toMatchObject({ result: { network: expect.arrayContaining([expect.objectContaining({ finished: true })]) } });
    const read = await dispatchToHost(host, 'diagnostics', { action: 'read' });
    expect(JSON.stringify(read)).not.toContain('do-not-log');
    expect(JSON.stringify(read)).not.toContain('set-cookie');
    const rows = (read.result as { network: { id: string }[] }).network;
    const row = rows[0];
    if (!row) throw new Error('request missing');
    const response = await dispatchToHost(host, 'diagnostics', { action: 'response', request_id: row.id });
    expect(JSON.stringify(response)).not.toContain('do-not-log');
    expect(JSON.stringify(response)).toContain('diagnostic result');
  });

  it('stops recording before asking the user to log in', async () => {
    const { host, tab } = await page();
    await dispatchToHost(host, 'diagnostics', { action: 'start' });
    let entered: Promise<void> | undefined;
    host.setHandoffPrompt(({ requestId }) => {
      entered = tab.read<void>(`console.log('login input must stay private')`).then(() => host.resolveHandoff(requestId, true));
    });
    await host.awaitHuman({ reason: 'Please sign in' });
    await entered;
    expect(await dispatchToHost(host, 'diagnostics', { action: 'read' })).toMatchObject({ ok: true, result: { recording: false } });
    expect(JSON.stringify(await dispatchToHost(host, 'diagnostics', { action: 'read' }))).not.toContain('login input must stay private');
  });

  it('identifies the page a console message came from across navigation', async () => {
    const { host, tab } = await page();
    await dispatchToHost(host, 'diagnostics', { action: 'start' });
    await tab.read(`console.error('before navigation')`);
    await tab.wc.loadURL(`${origin}/other`);
    await tab.read(`console.error('after navigation')`);
    expect(await dispatchToHost(host, 'diagnostics', { action: 'read' })).toMatchObject({ result: { console: expect.arrayContaining([
      expect.objectContaining({ text: 'before navigation', url: `${origin}/` }),
      expect.objectContaining({ text: 'after navigation', url: `${origin}/other` }),
    ]) } });
  });

  it('does not carry a live recording into the next ordinary browser turn', async () => {
    const { host, tab } = await page();
    await dispatchToHost(host, 'diagnostics', { action: 'start', turn_id: 'developer' });
    await dispatchToHost(host, 'snapshot', { turn_id: 'ordinary' });
    await tab.read(`console.log('not part of the developer task')`);
    const read = await dispatchToHost(host, 'diagnostics', { action: 'read', turn_id: 'ordinary' });
    expect(read).toMatchObject({ ok: true, result: { recording: false } });
    expect(JSON.stringify(read)).not.toContain('not part of the developer task');
  });
});
