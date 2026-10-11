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
    } else if (request.url?.startsWith('/tokens')) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        jwt: 'do-not-log', csrf_token: 'do-not-log', 'X-CSRF-Token': 'do-not-log', xsrfToken: 'do-not-log',
        auth_token: 'do-not-log', 'x-api-key': 'do-not-log', apikey: 'do-not-log', private_key: 'do-not-log',
        sessionid: 'do-not-log', note: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl', message: 'still useful',
      }));
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
    const before = await tab.read<{ width: number; height: number }>('({ width: innerWidth, height: innerHeight })');
    for (let attempt = 0; attempt < 50; attempt++) {
      expect(await dispatchToHost(host, 'viewport', { width: 390, height: 844 })).toMatchObject({
        ok: true, result: { width: 390, height: 844, overridden: true },
      });
      expect(await dispatchToHost(host, 'viewport', { reset: true })).toMatchObject({
        ok: true, result: { ...before, overridden: false },
      });
      expect(await tab.read('({ width: innerWidth, height: innerHeight })')).toEqual(before);
    }
  });

  it('sets and resets the viewport of a tab behind another one', async () => {
    const { host, tab } = await page();
    const before = await tab.read<{ width: number; height: number }>('({ width: innerWidth, height: innerHeight })');
    await tab.hide();
    expect(await dispatchToHost(host, 'viewport', { width: 375, height: 800 })).toMatchObject({
      ok: true, result: { width: 375, height: 800, overridden: true },
    });
    expect(await dispatchToHost(host, 'viewport', { reset: true })).toMatchObject({
      ok: true, result: { ...before, overridden: false },
    });
    expect(tab.wc.getBackgroundThrottling?.()).toBe(true);
  });

  it('measures the layout after the page processes its viewport resize', async () => {
    const { host, tab } = await page();
    await tab.read(`addEventListener('resize', () => {
      document.querySelector('main').style.minWidth = innerWidth + 'px';
    })`);
    expect(await dispatchToHost(host, 'viewport', { width: 390, height: 844 })).toMatchObject({
      ok: true, result: { width: 390, documentWidth: 398, horizontalOverflow: true },
    });
    expect(await tab.read('document.querySelector("main").style.minWidth')).toBe('390px');
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

  it('records on the developer\'s own machine without asking for the site', async () => {
    const { host } = await page();
    expect(await dispatchToHost(host, 'diagnostics', { action: 'start', sites: [] })).toMatchObject({ ok: true, result: { recording: true } });
  });

  it('asks for the site before recording or reading a response anywhere else', async () => {
    const { host, tab } = await page();
    const port = new URL(origin).port;
    await tab.wc.loadURL(`http://shop.example:${port}/`);
    const start = await dispatchToHost(host, 'diagnostics', { action: 'start', sites: [] });
    expect(start).toMatchObject({ ok: false, error: { message: expect.stringContaining('shop.example') } });
    expect(start.ok ? '' : start.error.message).toContain('browser_allow_site');
    expect(await dispatchToHost(host, 'diagnostics', { action: 'response', request_id: 'any', sites: [] })).toMatchObject({
      ok: false, error: { message: expect.stringContaining('browser_allow_site') },
    });
    expect(await dispatchToHost(host, 'diagnostics', { action: 'read', sites: [] })).toMatchObject({ ok: true });
    expect(await dispatchToHost(host, 'diagnostics', { action: 'start', sites: ['shop.example'] })).toMatchObject({ ok: true });
  });

  it('masks credentials under any of their usual names, and a token whatever its field is called', async () => {
    const { host, tab } = await page();
    await dispatchToHost(host, 'diagnostics', { action: 'start' });
    await tab.read(`fetch('/tokens').then((r) => r.text())`);
    await expect.poll(async () => await dispatchToHost(host, 'diagnostics', { action: 'read', query: 'tokens' })).toMatchObject({
      result: { network: [expect.objectContaining({ finished: true })] },
    });
    const read = await dispatchToHost(host, 'diagnostics', { action: 'read', query: 'tokens' });
    const row = (read.result as { network: { id: string }[] }).network[0];
    if (!row) throw new Error('request missing');
    const response = JSON.stringify(await dispatchToHost(host, 'diagnostics', { action: 'response', request_id: row.id }));
    expect(response).not.toContain('do-not-log');
    expect(response).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(response).toContain('still useful');
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

  it('says the recording ended with the message, and how to get a response, when it is read in the next one', async () => {
    const { host, tab } = await page();
    await dispatchToHost(host, 'diagnostics', { action: 'start', turn_id: 'developer' });
    await tab.read(`fetch('/api?category_id=lighting').then((r) => r.text())`);
    await expect.poll(async () => await dispatchToHost(host, 'diagnostics', { action: 'read', turn_id: 'developer' })).toMatchObject({
      result: { network: [expect.objectContaining({ finished: true })] },
    });
    const read = await dispatchToHost(host, 'diagnostics', { action: 'read', turn_id: 'developer' });
    const row = (read.result as { network: { id: string }[] }).network[0];
    if (!row) throw new Error('request missing');

    const later = await dispatchToHost(host, 'diagnostics', { action: 'response', request_id: row.id, turn_id: 'next' });
    expect(later).toMatchObject({ ok: false, error: { message: expect.stringContaining('a new message started') } });
    expect(later.ok ? '' : later.error.message).toMatch(/start .*again.*same message/i);
    expect(await dispatchToHost(host, 'diagnostics', { action: 'read', turn_id: 'next' })).toMatchObject({
      ok: true, result: { recording: false, ended: 'a new message started' },
    });
  });

  it('names an explicit stop as the reason the recording ended', async () => {
    const { host } = await page();
    await dispatchToHost(host, 'diagnostics', { action: 'start' });
    await dispatchToHost(host, 'diagnostics', { action: 'stop' });
    expect(await dispatchToHost(host, 'diagnostics', { action: 'response', request_id: 'gone' })).toMatchObject({
      ok: false, error: { message: expect.stringContaining('it was stopped') },
    });
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
