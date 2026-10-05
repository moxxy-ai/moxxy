import { createServer, type Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BrowserHost, type HostReply } from './host.js';
import { chromiumAvailable, closeChromium, openChromiumTab, type ChromiumTab } from './chromium-tab.test-support.js';

/**
 * The host against a real Chromium page.
 *
 * `host.test.ts` pins which CDP commands go out; this pins what Chromium does
 * with them, which is where the live failures were: Enter that submitted
 * nothing, a type that appended to the old value, a click that landed on the
 * banner covering the button. Skipped where no Chromium is installed.
 */

const PAGES: Record<string, string> = {
  '/search': `<title>Szukaj</title>
    <form action="/results"><input name="q" aria-label="Szukaj w serwisie"><button>Go</button></form>`,
  '/results': `<title>Wyniki</title><h1>Wyniki</h1>`,
  '/field': `<title>Pole</title><input aria-label="Imię" value="Jan">`,
  '/covered': `<title>Zasłonięte</title>
    <button onclick="document.title='zapisane'" style="position:fixed;bottom:20px;left:20px">Zapisz</button>
    <div id="promo" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#335;color:#fff">
      Promocja <button onclick="document.getElementById('promo').remove()">Zamknij promocję</button>
    </div>`,
  '/alert': `<title>Alert</title><button onclick="alert('Uwaga z testu'); document.title='po alercie'">Pokaż alert</button>`,
  '/link': `<title>Link</title><a href="/results">Do wyników</a>`,
  '/select': `<title>Lista</title>
    <select aria-label="Miasto" onchange="document.title = 'miasto=' + this.value">
      <option value="">— wybierz —</option><option>Warszawa</option><option value="krk">Kraków</option>
    </select>`,
  '/confirm': `<title>Pytanie</title>
    <button onclick="document.title = 'confirm=' + confirm('Na pewno usunąć?')">Usuń</button>`,
  '/long': `<title>Długa</title><div style="height:5000px">początek</div><p>koniec</p>`,
  '/hover-menu': `<title>Menu</title>
    <style>.menu{position:relative;display:inline-block}.items{display:none;position:absolute;top:100%;left:0;background:#fff;width:300px;height:120px}
      .menu:hover .items{display:block}</style>
    <div class="menu"><button>Menu</button><div class="items"><button onclick="document.title='ustawienia'">Ustawienia</button></div></div>
    <div style="margin-top:20px"><button onclick="document.title='pod menu'">Pod menu</button></div>`,
  '/framed': `<title>Z ramką</title><p>Strona</p><iframe src="/inner" title="Ramka" width="400" height="200"></iframe>`,
  '/inner': `<title>Wnętrze</title><button onclick="parent.document.title='z ramki'">Wewnątrz</button>`,
  '/overlay': `<title>Nakładka</title>
    <button onclick="document.title='kliknięte'" style="position:absolute;left:20px;top:20px">Prostokąt</button>
    <div style="position:fixed;inset:0;pointer-events:none"></div>`,
  '/cards': `<title>Usługi</title>
    <div class="card" data-name="n8n"><span>N8N</span><span>n8n is an extendable workflow automation tool.</span></div>
    <div class="card" data-name="pg"><span>N8N With Postgresql</span><span>n8n with a database.</span></div>
    <div><span>Not a card</span></div>
    <script>for (const card of document.querySelectorAll('.card')) card.addEventListener('click', () => { document.title = 'wybrano ' + card.dataset.name; });</script>`,
  '/settings': `<title>Ustawienia</title>
    <div><label>Description</label><input></div>
    <div><label>Domains</label><input placeholder="https://app.coolify.io" value="http://n8n.example:5678"></div>`,
  '/later': `<title>Później</title><p id="status">Szukam…</p>
    <script>setTimeout(() => { document.getElementById('status').textContent = 'Znaleziono 3 wyniki'; }, 300)</script>`,
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
  await closeChromium();
  // Chromium's keep-alive sockets would otherwise hold `close` open past the hook's deadline.
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}, 30_000);

let tab: ChromiumTab | null = null;
afterEach(async () => {
  await tab?.close();
  tab = null;
});

/** A host driving one fresh tab, already on `path`. */
async function hostOn(path: string): Promise<{ host: BrowserHost; tab: ChromiumTab }> {
  tab = await openChromiumTab();
  const opened = tab;
  const host = new BrowserHost((id) => (id === opened.wc.id ? opened.wc : null));
  host.register(opened.wc.id);
  await opened.wc.loadURL(`${origin}${path}`);
  return { host, tab: opened };
}

/** The uid the snapshot gave a node with this role and name. */
async function uidOf(host: BrowserHost, role: string, name: string): Promise<string> {
  const reply = await host.snapshot(undefined, { full: true });
  const text = String((reply.result as { text?: string } | undefined)?.text ?? JSON.stringify(reply));
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\[(\\w+)\\] ${role}: "${escaped}"`).exec(text);
  if (!match?.[1]) throw new Error(`no ${role} "${name}" in:\n${text}`);
  return match[1];
}

const resultOf = (reply: HostReply): Record<string, unknown> => {
  if (!reply.ok) throw new Error(reply.error?.message ?? 'failed');
  return (reply.result ?? {}) as Record<string, unknown>;
};

describe.skipIf(!available)('BrowserHost in a real Chromium page', () => {
  it('submits a search with Enter after typing into the field', async () => {
    const { host, tab: page } = await hostOn('/search');
    const field = await uidOf(host, 'textbox', 'Szukaj w serwisie');

    resultOf(await host.act({ action: 'type', uid: field, text: 'Marmolada' }));
    resultOf(await host.key('Enter'));

    await expect.poll(() => page.wc.getURL()).toBe(`${origin}/results?q=Marmolada`);
  });

  it('replaces what a field already holds rather than appending to it', async () => {
    const { host, tab: page } = await hostOn('/field');
    const field = await uidOf(host, 'textbox', 'Imię');

    resultOf(await host.act({ action: 'type', uid: field, text: 'Kamil' }));

    expect(await page.read<string>('document.querySelector("input").value')).toBe('Kamil');
  });

  it('refuses a click on a button something else covers, and names what covers it', async () => {
    const { host, tab: page } = await hostOn('/covered');
    const save = await uidOf(host, 'button', 'Zapisz');

    const reply = await host.act({ action: 'click', uid: save });

    expect(reply.ok).toBe(false);
    expect(reply.error?.message).toMatch(/covered/i);
    expect(reply.error?.message).toContain('Promocja');
    expect(await page.read<string>('document.title')).toBe('Zasłonięte');
  });

  it('comes back from a click that opens an alert, saying what it said', async () => {
    const { host } = await hostOn('/alert');
    const button = await uidOf(host, 'button', 'Pokaż alert');

    const result = resultOf(await host.act({ action: 'click', uid: button }));

    expect(result.dialog).toMatchObject({ type: 'alert', message: 'Uwaga z testu' });
  }, 15_000);

  it('waits for a navigation a click started and reports where it went', async () => {
    const { host } = await hostOn('/link');
    const link = await uidOf(host, 'link', 'Do wyników');

    const result = resultOf(await host.act({ action: 'click', uid: link }));

    expect(result.navigated).toBe(true);
    expect(result.url).toBe(`${origin}/results`);
  });

  it('chooses an option in a native list by its label, the way the page hears a choice', async () => {
    const { host, tab: page } = await hostOn('/select');
    const list = await uidOf(host, 'combobox', 'Miasto');

    const result = resultOf(await host.selectOption({ uid: list, option: 'Kraków' }));

    expect(result.selected).toBe('Kraków');
    expect(await page.read<string>('document.title')).toBe('miasto=krk');
  });

  it('names the options when the one asked for is not there', async () => {
    const { host } = await hostOn('/select');
    const list = await uidOf(host, 'combobox', 'Miasto');

    const reply = await host.selectOption({ uid: list, option: 'Gdańsk' });

    expect(reply.ok).toBe(false);
    expect(reply.error?.message).toContain('Warszawa, Kraków');
  });

  it('leaves a confirm for the agent to answer, and holds the page until it does', async () => {
    const { host, tab: page } = await hostOn('/confirm');
    const button = await uidOf(host, 'button', 'Usuń');

    const result = resultOf(await host.act({ action: 'click', uid: button }));
    expect(result.dialog).toMatchObject({ type: 'confirm', message: 'Na pewno usunąć?', open: true });

    const blocked = await host.act({ action: 'click', uid: button });
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.message).toContain('browser_dialog');

    resultOf(await host.answerDialog({ accept: false }));
    await expect.poll(() => page.read<string>('document.title')).toBe('confirm=false');
  }, 15_000);

  it('scrolls the page by screens and says that it moved', async () => {
    const { host, tab: page } = await hostOn('/long');

    const result = resultOf(await host.scroll({ direction: 'down', screens: 2 }));

    expect(result.moved).toBe(true);
    expect(await page.read<number>('scrollY')).toBeGreaterThan(0);
  });

  it('waits for text the page shows later, and answers "not yet" at the deadline', async () => {
    const { host } = await hostOn('/later');

    expect(resultOf(await host.waitFor({ text: 'Znaleziono', timeoutMs: 5000 })).met).toBe(true);
    expect(resultOf(await host.waitFor({ text: 'Nic takiego', timeoutMs: 200 })).met).toBe(false);
  });

  it('moves the pointer off a hover menu before deciding the menu is in the way', async () => {
    const { host, tab: page } = await hostOn('/hover-menu');
    resultOf(await host.act({ action: 'hover', uid: await uidOf(host, 'button', 'Menu') }));
    const below = await uidOf(host, 'button', 'Pod menu');

    resultOf(await host.act({ action: 'click', uid: below }));

    expect(await page.read<string>('document.title')).toBe('pod menu');
  });

  it('reads and presses a button inside a frame from the same site', async () => {
    const { host, tab: page } = await hostOn('/framed');
    await expect.poll(() => page.read<number>('document.querySelector("iframe").contentDocument?.readyState === "complete" ? 1 : 0')).toBe(1);

    const inside = await uidOf(host, 'button', 'Wewnątrz');
    resultOf(await host.act({ action: 'click', uid: inside }));

    expect(await page.read<string>('document.title')).toBe('z ramki');
  });

  /**
   * Excalidraw lays a full-window container with `pointer-events: none` over
   * its whole UI. The pointer passes through it, so it covers nothing — and the
   * hit test said every tool and the canvas itself were covered. Seen live.
   */
  it('looks through a layer the pointer passes through', async () => {
    const { host, tab: page } = await hostOn('/overlay');

    resultOf(await host.act({ action: 'click', uid: await uidOf(host, 'button', 'Prostokąt') }));

    expect(await page.read<string>('document.title')).toBe('kliknięte');
  });

  /**
   * Coolify's service catalogue is a grid of `div` cards with click handlers and
   * no role; read by role alone, a run found nothing to click. Chromium knows
   * which nodes answer a click, and the run's tree lists them by their text.
   */
  it('lists a card the page answers clicks on, and the card can be pressed', async () => {
    const { host, tab: page } = await hostOn('/cards');

    const { tree } = resultOf(await host.tree()) as { tree: { elements: Array<{ index: number; role: string; title?: string }> } };
    const card = tree.elements.find((element) => element.title === 'N8N');
    expect(card?.role).toBe('generic');
    expect(tree.elements.map((element) => element.title)).not.toContain('Not a card');

    resultOf(await host.act({ action: 'click', uid: String(card?.index) }));
    expect(await page.read<string>('document.title')).toBe('wybrano n8n');
  });

  it('names a field by the label that stands before it without being tied to it', async () => {
    const { host } = await hostOn('/settings');

    const { tree } = resultOf(await host.tree()) as { tree: { elements: Array<{ role: string; title?: string; description?: string; value?: string }> } };
    expect(tree.elements).toEqual([
      expect.objectContaining({ role: 'textbox', title: 'Description', value: '' }),
      expect.objectContaining({ role: 'textbox', title: 'Domains', description: 'https://app.coolify.io', value: 'http://n8n.example:5678' }),
    ]);
  });
});
