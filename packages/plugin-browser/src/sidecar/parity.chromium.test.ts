import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromiumAvailable } from '../page/chromium-tab.test-support.js';
import { setSsrfDnsResolver } from '../ssrf-guard.js';
import { dispatch, teardown, type SidecarState } from './dispatch.js';
import type { PageHandle, PlaywrightHandle, Reply } from './types.js';

/**
 * The headless sidecar — what `moxxy` in a terminal drives — against a real
 * Chromium, through the same wire methods the desktop bridge answers.
 *
 * The agent's tools are one set for both backends, so a method the desktop
 * serves and the sidecar does not is a tool that works in one and fails in the
 * other. These pin that the sidecar acts the way the desktop does: a type that
 * replaces, a press refused when covered, what an action set off, and the
 * methods only the desktop used to know. Skipped where no Chromium is installed.
 */

const PAGES: Record<string, string> = {
  '/field': `<title>Pole</title><input aria-label="Imię" value="Jan">`,
  '/covered': `<title>Zasłonięte</title>
    <button onclick="document.title='zapisane'" style="position:fixed;bottom:20px;left:20px">Zapisz</button>
    <div style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#335;color:#fff">Promocja</div>`,
  '/alert': `<title>Alert</title><button onclick="alert('Uwaga z testu'); document.title='po alercie'">Pokaż alert</button>`,
  '/select': `<title>Lista</title>
    <select aria-label="Miasto" onchange="document.title = 'miasto=' + this.value">
      <option value="">— wybierz —</option><option>Warszawa</option><option value="krk">Kraków</option>
    </select>`,
  '/long': `<title>Długa</title><div style="height:5000px">początek</div><p>koniec</p>`,
  '/later': `<title>Później</title><p id="status">Szukam…</p>
    <script>setTimeout(() => { document.getElementById('status').textContent = 'Znaleziono 3 wyniki'; }, 300)</script>`,
  '/opens': `<title>Otwiera</title><a href="/field" target="_blank">Nowa karta</a>`,
  '/search': `<title>Szukaj</title>
    <form action="/results"><input name="q" aria-label="Szukaj w serwisie"><button>Go</button></form>`,
  '/results': `<title>Wyniki</title><h1>Wyniki</h1>`,
  '/inner': `<title>Wnętrze</title><button onclick="document.title='z ramki'">Wewnątrz</button>`,
  '/upload': `<title>Plik</title><input type="file" aria-label="Załącznik"
    onchange="document.title = 'plik=' + this.files[0].name">`,
};

let server: Server;
let origin = '';
const available = await chromiumAvailable();

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://x').pathname;
    const page = PAGES[path];
    response.writeHead(page ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }).end(page ?? 'not found');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server has no port');
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}, 30_000);

let state: SidecarState | null = null;
afterEach(async () => {
  if (state) await teardown(state);
  state = null;
});

/**
 * A sidecar whose browser is already up, on `path`. Launched here rather than
 * through `init` so the page can live on a loopback fixture server, which the
 * sidecar's own launch rightly refuses to navigate to.
 */
async function sidecarOn(path: string): Promise<{
  page: PageHandle;
  context: { route(url: string, handler: (route: { fulfill(response: { body: string; contentType: string }): Promise<void> }) => Promise<void>): Promise<void> };
  call: (method: string, params?: Record<string, unknown>) => Promise<Reply>;
}> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}${path}`);
  const handle = { browser, context, page } as unknown as PlaywrightHandle;
  const current: SidecarState = { handle, pendingInstallNotice: null };
  state = current;
  let seq = 0;
  return {
    page: handle.page,
    context: context as never,
    call: (method, params = {}) => dispatch(current, { id: String(++seq), method, params }),
  };
}

const resultOf = (reply: Reply): Record<string, unknown> => {
  if (!reply.ok) throw new Error(reply.error.message);
  return (reply.result ?? {}) as Record<string, unknown>;
};

/** The uid the snapshot gave a node with this role and name. */
async function uidOf(call: (method: string, params?: Record<string, unknown>) => Promise<Reply>, role: string, name: string): Promise<string> {
  const text = String(resultOf(await call('snapshot', { full: true })).text ?? '');
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\[(\\w+)\\] ${role}: "${escaped}"`).exec(text);
  if (!match?.[1]) throw new Error(`no ${role} "${name}" in:\n${text}`);
  return match[1];
}

describe.skipIf(!available)('the headless sidecar acts as the desktop does', () => {
  it('replaces what a field already holds rather than appending to it', async () => {
    const { page, call } = await sidecarOn('/field');
    const field = await uidOf(call, 'textbox', 'Imię');

    resultOf(await call('act', { action: 'type', uid: field, text: 'Kamil' }));

    expect(await page.evaluate('document.querySelector("input").value')).toBe('Kamil');
  });

  it('refuses a click on a button something else covers, and names what covers it', async () => {
    const { page, call } = await sidecarOn('/covered');
    const save = await uidOf(call, 'button', 'Zapisz');

    const reply = await call('act', { action: 'click', uid: save });

    expect(reply.ok).toBe(false);
    expect(reply.ok ? '' : reply.error.message).toMatch(/covered by .*Promocja/i);
    expect(await page.evaluate('document.title')).toBe('Zasłonięte');
  });

  it('comes back from a click that opens an alert, saying what it said', async () => {
    const { call } = await sidecarOn('/alert');
    const button = await uidOf(call, 'button', 'Pokaż alert');

    const result = resultOf(await call('act', { action: 'click', uid: button }));

    expect(result.dialog).toMatchObject({ type: 'alert', message: 'Uwaga z testu' });
  }, 15_000);

  it('chooses an option in a native list by its label', async () => {
    const { page, call } = await sidecarOn('/select');
    const list = await uidOf(call, 'combobox', 'Miasto');

    expect(resultOf(await call('select', { uid: list, option: 'Kraków' })).selected).toBe('Kraków');
    expect(await page.evaluate('document.title')).toBe('miasto=krk');
  });

  it('scrolls the page by screens and says that it moved', async () => {
    const { page, call } = await sidecarOn('/long');

    expect(resultOf(await call('scroll', { direction: 'down', screens: 2 })).moved).toBe(true);
    expect(await page.evaluate('scrollY')).toBeGreaterThan(0);
  });

  it('waits for text the page shows later', async () => {
    const { call } = await sidecarOn('/later');

    expect(resultOf(await call('wait', { text: 'Znaleziono', timeoutMs: 5000 })).met).toBe(true);
  });

  it('reads the page the way a run of steps grounds its targets', async () => {
    const { call } = await sidecarOn('/select');

    const read = resultOf(await call('tree', {}));

    expect(read.url).toBe(`${origin}/select`);
    expect(String(read.page)).toContain('Miasto');
    expect(read.tree).toBeTypeOf('object');
  });

  it('takes a named picture of the viewport that browser_point can act on', async () => {
    const { call } = await sidecarOn('/field');

    const picture = resultOf(await call('capture', {}));

    expect(picture.view).toBe('v1');
    expect(picture.mediaType).toBe('image/png');
    expect(String(picture.forModel)).toContain('browser_point');
  });

  it('crops a picture to an element by its box', async () => {
    const { call } = await sidecarOn('/field');
    const field = await uidOf(call, 'textbox', 'Imię');

    const box = resultOf(await call('box', { uid: field }));

    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  it('reports the tab a link opened, as a tab the agent can work in', async () => {
    const { call } = await sidecarOn('/opens');
    const link = await uidOf(call, 'link', 'Nowa karta');

    const result = resultOf(await call('act', { action: 'click', uid: link }));

    expect(result.opened).toMatchObject({ tabId: 't2' });
    const tabs = resultOf(await call('tabs', { action: 'list' })).tabs as Array<{ tabId: string; url: string }>;
    expect(tabs.map((tab) => tab.tabId)).toEqual(['t1', 't2']);
  }, 15_000);

  it('gives a file input local files', async () => {
    const { page, call } = await sidecarOn('/upload');
    const field = await uidOf(call, 'button', 'Załącznik');
    const dir = mkdtempSync(join(tmpdir(), 'moxxy-upload-'));
    const file = join(dir, 'raport.txt');
    writeFileSync(file, 'treść');

    expect(resultOf(await call('upload', { uid: field, paths: [file] })).uploaded).toEqual(['raport.txt']);
    expect(await page.evaluate('document.title')).toBe('plik=raport.txt');
  });

  it('says plainly that nobody can take a hand-off in a browser with no window', async () => {
    const { call } = await sidecarOn('/field');

    const reply = await call('await_human', { reason: 'Zaloguj się' });

    expect(reply.ok).toBe(false);
    expect(reply.ok ? '' : reply.error.message).toMatch(/no window/i);
  });

  it('goes to a page through the same host, after the SSRF check, and the old uids stop being valid', async () => {
    const { context, call } = await sidecarOn('/field');
    const field = await uidOf(call, 'textbox', 'Imię');
    // A public name, answered here without the network: hermetic DNS for the
    // sidecar's own check, a fulfilled route for the browser.
    setSsrfDnsResolver(async () => ['93.184.216.34']);
    await context.route('http://shop.example/**', (route) =>
      route.fulfill({ body: '<title>Sklep</title><h1>Sklep</h1>', contentType: 'text/html' }),
    );
    try {
      expect(resultOf(await call('goto', { url: 'http://shop.example/' }))).toMatchObject({ url: 'http://shop.example/', tabId: 't1' });
      const stale = await call('act', { action: 'type', uid: field, text: 'x' });
      expect(stale.ok ? '' : stale.error.message).toMatch(/call snapshot first/);
      expect(String(resultOf(await call('snapshot', {})).text)).toContain('Sklep');
    } finally {
      setSsrfDnsResolver(null);
    }
  });

  it('presses a key on the agent tab — Enter submits what was typed', async () => {
    const { page, call } = await sidecarOn('/search');
    const field = await uidOf(call, 'textbox', 'Szukaj w serwisie');

    resultOf(await call('act', { action: 'type', uid: field, text: 'Marmolada' }));
    resultOf(await call('key', { key: 'Enter' }));

    await expect.poll(() => page.url()).toBe(`${origin}/results?q=Marmolada`);
  });

  it('refuses a key with nothing named', async () => {
    const { call } = await sidecarOn('/field');

    const reply = await call('key', {});

    expect(reply.ok).toBe(false);
    expect(reply.ok ? '' : reply.error.kind).toBe('runtime');
  });

  it('reads and presses a button inside a frame from another site', async () => {
    // 127.0.0.1 and localhost are different sites, so the frame is cross-site.
    const framed = `<title>Z ramką</title><p>Strona</p><iframe src="${origin.replace('127.0.0.1', 'localhost')}/inner" title="Ramka" width="400" height="200"></iframe>`;
    const { page, call } = await sidecarOn('/field');
    await page.evaluate(`document.open(); document.write(${JSON.stringify(framed)}); document.close();`);
    await new Promise((done) => setTimeout(done, 500));
    const button = await uidOf(call, 'button', 'Wewnątrz');

    resultOf(await call('act', { action: 'click', uid: button }));

    const frames = (page as unknown as { frames(): Array<{ url(): string; title(): Promise<string> }> }).frames();
    const inner = frames.find((frame) => frame.url().endsWith('/inner'));
    expect(await inner?.title()).toBe('z ramki');
  });
});
