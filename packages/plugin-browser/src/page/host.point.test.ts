import { describe, expect, it } from 'vitest';
import { BrowserHost, type HostWebContents } from './host.js';
import { canvas, encodePng } from './png.test-support.js';

/**
 * Working on a page by its picture: a canvas app has nothing in the
 * accessibility tree to name, so the agent points at pixels of its last
 * capture. The page here is 200×100 CSS pixels drawn at device ratio 2, so the
 * picture is 400×200 and every coordinate is halved on the way to the page.
 */

type Sent = { method: string; params?: Record<string, unknown> };

function page() {
  let picture = canvas(400, 200);
  picture.paint(80, 40, 40, 20, [0, 0, 255, 255]);
  let url = 'https://excalidraw.com/';
  let scroll = '0,0';
  const sent: Sent[] = [];
  const wc: HostWebContents = {
    id: 1,
    getURL: () => url,
    getTitle: () => 'Excalidraw',
    isDestroyed: () => false,
    loadURL: async () => {},
    reload: () => {},
    navigationHistory: { canGoBack: () => false, canGoForward: () => false, goBack: () => {}, goForward: () => {} },
    debugger: {
      isAttached: () => true,
      attach: () => {},
      detach: () => {},
      sendCommand: async (method, params) => {
        sent.push({ method, ...(params ? { params } : {}) });
        if (method === 'Page.getLayoutMetrics') {
          return {
            cssVisualViewport: { clientWidth: 200, clientHeight: 100, pageX: 0, pageY: 30 },
            visualViewport: { clientWidth: 400, clientHeight: 200 },
          };
        }
        if (method === 'Page.captureScreenshot') return { data: encodePng(picture).toString('base64') };
        if (method === 'Runtime.evaluate') return { result: { value: scroll } };
        return {};
      },
    },
    sendInputEvent: () => {},
  };
  const host = new BrowserHost((id) => (id === 1 ? wc : null));
  host.register(1);
  return {
    host,
    sent,
    mouse: () => sent.filter((s) => s.method === 'Input.dispatchMouseEvent').map((s) => s.params ?? {}),
    repaint: (x: number, y: number, w: number, h: number) => {
      const next = canvas(400, 200);
      next.data.set(picture.data);
      next.paint(x, y, w, h, [255, 0, 0, 255]);
      picture = next;
    },
    setUrl: (next: string) => (url = next),
    setScroll: (next: string) => (scroll = next),
  };
}

async function captured(host: BrowserHost) {
  const reply = await host.capture({ view: true });
  expect(reply.ok).toBe(true);
  return reply.result as { view: string; width: number; height: number; base64: string; forModel: string };
}

describe('BrowserHost — a picture to point at', () => {
  it('names the picture of the viewport and says how to point at it', async () => {
    const { host } = page();

    const view = await captured(host);

    expect(view).toMatchObject({ view: 'v1', width: 400, height: 200 });
    expect(view.forModel).toContain('400×200');
    expect(view.forModel).toContain('browser_point');
    expect(view.base64.length).toBeGreaterThan(0);
  });

  it('asks for the viewport at the page’s own pixel size, not the screen’s, wherever the page is scrolled', async () => {
    const { host, sent } = page();

    await captured(host);

    expect(sent.find((s) => s.method === 'Page.captureScreenshot')?.params).toMatchObject({
      format: 'png',
      clip: { x: 0, y: 30, width: 200, height: 100, scale: 0.5 },
    });
  });

  it('makes a cropped picture a view too, and points land inside the crop', async () => {
    const { host, sent, mouse } = page();

    const reply = await host.capture({ clip: { x: 20, y: 10, width: 50, height: 25 }, view: true });
    await host.point({ action: 'click', x: 200, y: 100, view: 'v1' });

    // The crop is asked for where the page is scrolled to (pageY 30)…
    expect(sent.find((s) => s.method === 'Page.captureScreenshot')?.params).toMatchObject({
      clip: { x: 20, y: 40, width: 50, height: 25, scale: 0.5 },
    });
    expect(reply.result).toMatchObject({ view: 'v1' });
    // …and a point in it lands in the crop's own place on the page.
    expect(mouse().find((e) => e.type === 'mousePressed')).toMatchObject({ x: 45, y: 22.5 });
  });

  it('leaves the person’s own pictures out of it, so the agent’s picture stays the latest', async () => {
    const { host } = page();
    await captured(host);

    const reply = await host.capture({});

    expect(reply.result).not.toHaveProperty('view');
    expect((await host.point({ action: 'click', x: 100, y: 50, view: 'v1' })).ok).toBe(true);
  });
});

describe('BrowserHost — pointing', () => {
  it('presses at the place in the picture, in the page’s own pixels, and answers with a fresh picture', async () => {
    const { host, mouse } = page();
    await captured(host);

    const reply = await host.point({ action: 'click', x: 100, y: 50, view: 'v1' });

    expect(reply.ok).toBe(true);
    expect(mouse().filter((e) => e.type === 'mousePressed')).toEqual([
      expect.objectContaining({ x: 50, y: 25, button: 'left', clickCount: 1 }),
    ]);
    expect(reply.result).toMatchObject({ view: 'v2', width: 400, height: 200, mediaType: 'image/png' });
    expect((reply.result as { forModel: string }).forModel).toMatch(/v2/);
  });

  it('presses twice for a double click, and with the other button for a right click', async () => {
    const { host, mouse } = page();
    await captured(host);

    await host.point({ action: 'double_click', x: 100, y: 50, view: 'v1' });
    await host.point({ action: 'right_click', x: 100, y: 50, view: 'v2' });

    const presses = mouse().filter((e) => e.type === 'mousePressed');
    expect(presses.map((e) => [e.button, e.clickCount])).toEqual([
      ['left', 1],
      ['left', 2],
      ['right', 1],
    ]);
  });

  it('drags along the path with the button held, ending where the path ends', async () => {
    const { host, mouse } = page();
    await captured(host);

    await host.point({ action: 'drag', x: 20, y: 20, path: [[200, 20], [200, 180]], view: 'v1' });

    const events = mouse();
    const pressed = events.findIndex((e) => e.type === 'mousePressed');
    const released = events.findIndex((e) => e.type === 'mouseReleased');
    expect(events[pressed]).toMatchObject({ x: 10, y: 10, button: 'left' });
    const held = events.slice(pressed + 1, released);
    expect(held.length).toBeGreaterThan(2);
    expect(held.every((e) => e.type === 'mouseMoved' && e.buttons === 1)).toBe(true);
    expect(held).toContainEqual(expect.objectContaining({ x: 100, y: 10 }));
    expect(events[released]).toMatchObject({ x: 100, y: 90, button: 'left' });
  });

  it('scrolls the wheel at the place', async () => {
    const { host, mouse } = page();
    await captured(host);

    await host.point({ action: 'scroll', x: 100, y: 50, direction: 'down', view: 'v1' });

    expect(mouse().find((e) => e.type === 'mouseWheel')).toMatchObject({ x: 50, y: 25, deltaX: 0 });
    expect(Number(mouse().find((e) => e.type === 'mouseWheel')?.deltaY)).toBeGreaterThan(0);
  });

  it('presses a key and answers with the picture after it, so the next point needs no capture', async () => {
    const { host, sent } = page();
    await captured(host);

    const reply = await host.point({ action: 'key', key: 'r', view: 'v1' });

    expect(reply.ok).toBe(true);
    expect(sent.some((s) => s.method === 'Input.dispatchKeyEvent' && s.params?.key === 'r')).toBe(true);
    expect(reply.result).toMatchObject({ view: 'v2' });
  });

  it('types at the keyboard focus, wherever the last press left it', async () => {
    const { host, sent } = page();
    await captured(host);

    const reply = await host.point({ action: 'type', text: 'Hi', view: 'v1' });

    expect(reply.ok).toBe(true);
    expect(sent.filter((s) => s.method === 'Input.dispatchKeyEvent' && s.params?.type === 'keyDown').map((s) => s.params?.text)).toEqual([
      'H',
      'i',
    ]);
  });
});

describe('BrowserHost — refusing to point blind', () => {
  const refused = (reply: { ok: boolean; error?: { message: string } }) => {
    expect(reply.ok).toBe(false);
    return String(reply.error?.message);
  };

  it('asks for a picture first', async () => {
    const { host, mouse } = page();

    expect(refused(await host.point({ action: 'click', x: 1, y: 1, view: 'v1' }))).toMatch(/browser_capture/);
    expect(mouse()).toEqual([]);
  });

  it('refuses coordinates from a picture that is not the latest', async () => {
    const { host } = page();
    await captured(host);
    await captured(host);

    expect(refused(await host.point({ action: 'click', x: 1, y: 1, view: 'v1' }))).toMatch(/v2/);
  });

  it('refuses when the place it points at looks different now, and presses nothing', async () => {
    const { host, mouse, repaint } = page();
    await captured(host);
    repaint(90, 40, 30, 30);

    expect(refused(await host.point({ action: 'click', x: 100, y: 50, view: 'v1' }))).toMatch(/changed since/);
    expect(mouse().filter((e) => e.type === 'mousePressed')).toEqual([]);
  });

  it('does not mind a change elsewhere on the page', async () => {
    const { host, repaint } = page();
    await captured(host);
    repaint(350, 150, 40, 40);

    expect((await host.point({ action: 'click', x: 100, y: 50, view: 'v1' })).ok).toBe(true);
  });

  it('refuses when the page navigated or scrolled since the picture', async () => {
    const { host, setUrl, setScroll } = page();
    await captured(host);
    setScroll('0,300');
    expect(refused(await host.point({ action: 'click', x: 100, y: 50, view: 'v1' }))).toMatch(/scrolled/);

    await captured(host);
    setUrl('https://excalidraw.com/#room');
    expect(refused(await host.point({ action: 'click', x: 100, y: 50, view: 'v2' }))).toMatch(/navigated/);
  });

  it('refuses a place outside the picture', async () => {
    const { host } = page();
    await captured(host);

    expect(refused(await host.point({ action: 'click', x: 401, y: 50, view: 'v1' }))).toMatch(/outside/);
    expect(refused(await host.point({ action: 'drag', x: 1, y: 1, path: [[1, 900]], view: 'v1' }))).toMatch(/outside/);
  });
});
