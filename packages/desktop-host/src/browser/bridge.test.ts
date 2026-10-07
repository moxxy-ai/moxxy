import { afterEach, describe, expect, it } from 'vitest';
import { connect, type Socket } from 'node:net';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserBridge, bridgeEndpoint, sweepAbandonedBridges } from './bridge.js';
import { BrowserHost, type HostWebContents } from '@moxxy/plugin-browser/host';

/**
 * The bridge is a trust boundary: it is a socket on the filesystem that hands
 * whoever connects the ability to drive a logged-in browser. Its handshake is
 * therefore tested against a real socket, not a stub — the interesting cases
 * are the ones where a client skips or fakes the handshake, and a stub would
 * not exercise the framing that makes those possible.
 */

const AX = {
  nodes: [
    { nodeId: 'a', role: { value: 'RootWebArea' }, name: { value: 'Sklep' }, childIds: ['b'] },
    { nodeId: 'b', role: { value: 'button' }, name: { value: 'Kup' }, backendDOMNodeId: 4 },
  ],
};

function fakeWc(id: number): HostWebContents {
  let attached = false;
  return {
    id,
    getURL: () => 'https://sklep.pl',
    getTitle: () => 'Sklep',
    isDestroyed: () => false,
    loadURL: async () => {},
    debugger: {
      isAttached: () => attached,
      attach: () => {
        attached = true;
      },
      detach: () => {
        attached = false;
      },
      sendCommand: async (method) => {
        if (method === 'Accessibility.getFullAXTree') return AX;
        if (method === 'DOM.getBoxModel') return { model: { content: [0, 0, 10, 0, 10, 10, 0, 10] } };
        if (method === 'Page.captureScreenshot') return { data: 'UE5H' };
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
        if (method === 'DOM.querySelector') return { nodeId: 2 };
        if (method === 'DOM.describeNode') return { node: { backendNodeId: 4 } };
        if (method === 'DOM.resolveNode') return { object: { objectId: 'obj-1' } };
        if (method === 'Runtime.evaluate') return { result: { value: 'ok' } };
        return {};
      },
    },
    sendInputEvent: () => {},
  };
}

/** A client speaking the bridge's newline-JSON, like the plugin does. */
function client(path: string) {
  const socket: Socket = connect(path);
  socket.setEncoding('utf8');
  let buf = '';
  // Correlate by id, the way the real client does. A FIFO queue would let an
  // unsolicited reply (the error for a malformed line) settle the next
  // request's promise and hide what actually came back.
  const waiters = new Map<string, (v: Record<string, unknown>) => void>();
  socket.on('data', (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const reply = JSON.parse(line) as Record<string, unknown>;
      const waiter = waiters.get(String(reply.id));
      if (waiter) {
        waiters.delete(String(reply.id));
        waiter(reply);
      }
    }
  });
  let seq = 0;
  return {
    socket,
    ready: new Promise<void>((res) => socket.once('connect', () => res())),
    send(method: string, params: Record<string, unknown> = {}) {
      const id = `r${++seq}`;
      return new Promise<Record<string, unknown>>((resolve) => {
        waiters.set(id, resolve);
        socket.write(JSON.stringify({ id, method, params }) + '\n');
      });
    },
    closed: new Promise<void>((res) => socket.once('close', () => res())),
  };
}

const open: Array<{ bridge: BrowserBridge; c?: ReturnType<typeof client> }> = [];

afterEach(async () => {
  for (const entry of open.splice(0)) {
    entry.c?.socket.destroy();
    await entry.bridge.stop();
  }
});

async function boot(tabs = 1) {
  const views = new Map<number, HostWebContents>();
  for (let i = 1; i <= tabs; i++) views.set(i, fakeWc(i));
  const host = new BrowserHost((id) => views.get(id) ?? null);
  for (let i = 1; i <= tabs; i++) host.register(i);
  const bridge = new BrowserBridge(host);
  const addr = await bridge.start();
  const c = client(addr.socketPath);
  await c.ready;
  open.push({ bridge, c });
  return { host, bridge, addr, c };
}

describe('BrowserBridge — handshake', () => {
  it('accepts a client that presents the token', async () => {
    const { addr, c } = await boot();
    expect(await c.send('hello', { token: addr.token })).toMatchObject({ ok: true });
  });

  it('rejects a wrong token and hangs up', async () => {
    const { c } = await boot();
    const reply = await c.send('hello', { token: 'nie-ten' });

    expect(reply.ok).toBe(false);
    await c.closed; // the socket must not stay open for a retry
  });

  it('refuses work before the handshake', async () => {
    const { c } = await boot();
    const reply = await c.send('snapshot', {});

    expect(reply.ok).toBe(false);
    expect((reply.error as { message: string }).message).toContain('unauthorized');
  });
});

describe('BrowserBridge — serving the agent', () => {
  it('answers snapshot with the same envelope the sidecar produces', async () => {
    const { addr, c } = await boot();
    await c.send('hello', { token: addr.token });

    const reply = await c.send('snapshot', {});
    const text = String((reply.result as { text: string }).text);

    expect(reply.ok).toBe(true);
    expect(text).toContain('### Page');
    expect(text).toContain('### Open tabs');
    expect(text).toContain('UNTRUSTED DATA');
    expect(text).toContain('Kup');
  });

  it('acts on a uid from the snapshot it just served', async () => {
    const { addr, c } = await boot();
    await c.send('hello', { token: addr.token });
    await c.send('snapshot', {});

    expect(await c.send('act', { action: 'click', uid: '2' })).toMatchObject({ ok: true });
  });

  it('reports an unknown method rather than going quiet', async () => {
    const { addr, c } = await boot();
    await c.send('hello', { token: addr.token });

    const reply = await c.send('wyparuj', {});
    expect((reply.error as { message: string }).message).toContain('unknown method');
  });

  it('captures a cropped image on demand', async () => {
    const { addr, c } = await boot();
    await c.send('hello', { token: addr.token });

    const reply = await c.send('capture', { clip: { x: 0, y: 0, width: 10, height: 10 } });

    expect(reply.ok).toBe(true);
    expect((reply.result as { base64: string }).base64).toBe('UE5H');
  });

  it('says the pane is not open when the agent asks for a tab and nothing can make one', async () => {
    const { addr, c } = await boot();
    await c.send('hello', { token: addr.token });

    const reply = await c.send('tabs', { action: 'new', url: 'https://a.pl' });

    expect(reply.ok).toBe(false);
    expect((reply.error as { message: string }).message).toMatch(/pane is not open/i);
  });

  it('blocks on a hand-off until the user answers', async () => {
    const { host, addr, c } = await boot();
    await c.send('hello', { token: addr.token });

    let asked: { requestId: string; reason: string } | null = null;
    host.setHandoffPrompt((req) => {
      asked = req;
    });

    const pending = c.send('await_human', { reason: 'Zaloguj się w Canvie' });
    // Give the request a turn of the loop to reach the prompt.
    await new Promise((r) => setTimeout(r, 10));
    expect(asked).not.toBeNull();
    expect(asked!.reason).toContain('Canvie');

    host.resolveHandoff(asked!.requestId, true);
    const reply = await pending;

    expect(reply.ok).toBe(true);
    expect((reply.result as { completed: boolean }).completed).toBe(true);
  });

  it('reports honestly when there is no pane to ask', async () => {
    const { addr, c } = await boot();
    await c.send('hello', { token: addr.token });

    const reply = await c.send('await_human', { reason: 'x' });

    expect(reply.ok).toBe(false);
    expect((reply.error as { message: string }).message).toMatch(/pane is not open|nobody/i);
  });

  it('invalidates the snapshot across a hand-off — the page moved while we were not looking', async () => {
    const { host, addr, c } = await boot();
    await c.send('hello', { token: addr.token });
    await c.send('snapshot', {});
    host.setHandoffPrompt((req) => host.resolveHandoff(req.requestId, true));

    await c.send('await_human', { reason: 'zaloguj' });
    const act = await c.send('act', { action: 'click', uid: '2' });

    expect(act.ok).toBe(false);
    expect((act.error as { message: string }).message).toMatch(/snapshot/i);
  });

  it('survives a malformed line and keeps serving', async () => {
    const { addr, c } = await boot();
    await c.send('hello', { token: addr.token });

    c.socket.write('{ to nie jest json\n');
    expect(await c.send('snapshot', {})).toMatchObject({ ok: true });
  });
});

describe('bridgeEndpoint', () => {
  /**
   * Windows cannot listen on a file path: there the bridge never started and
   * the browser tools fell back to a Playwright the installer does not carry.
   */
  it('is a named pipe on Windows, with no directory to make', () => {
    const endpoint = bridgeEndpoint({ pid: 4242, id: 'ab12', tmp: 'C:\\Temp', platform: 'win32' });

    expect(endpoint).toEqual({ socketPath: '\\\\.\\pipe\\moxxy-browser-4242-ab12', dir: null });
  });

  it('is a socket file in an owner-only directory elsewhere', () => {
    const endpoint = bridgeEndpoint({ pid: 4242, id: 'ab12', tmp: tmpdir(), platform: 'darwin' });

    const dir = join(tmpdir(), 'moxxy-browser-4242');
    expect(endpoint).toEqual({ socketPath: join(dir, 'ab12.sock'), dir });
  });
});

describe('sweepAbandonedBridges', () => {
  /**
   * A clean quit removes its own directory. A crash cannot — and one empty
   * directory per crash accumulates forever, so startup takes care of the
   * ones whose owner is demonstrably gone.
   */
  it('removes a directory whose process is gone and keeps a live one', () => {
    const root = mkdtempSync(join(tmpdir(), 'moxxy-sweep-test-'));
    // The process that started this test: alive for as long as the test runs,
    // and not ours to touch.
    const alive = join(root, `moxxy-browser-${process.ppid}`);
    // A pid this high is not running; if it somehow were, the probe says so
    // and we leave it, which is the safe direction.
    const dead = join(root, 'moxxy-browser-4194303');
    const mine = join(root, `moxxy-browser-${process.pid}`);
    const unrelated = join(root, 'something-else');
    for (const d of [alive, dead, mine, unrelated]) mkdirSync(d, { recursive: true });

    sweepAbandonedBridges(root);

    expect(existsSync(alive)).toBe(true);
    expect(existsSync(mine)).toBe(true);
    expect(existsSync(unrelated)).toBe(true);
    // Only assert the removal when the pid really is free.
    let deadIsFree = false;
    try {
      process.kill(4194303, 0);
    } catch (err) {
      deadIsFree = (err as NodeJS.ErrnoException).code === 'ESRCH';
    }
    if (deadIsFree) expect(existsSync(dead)).toBe(false);
  });

  it('ignores a directory that is not a bridge', () => {
    const root = mkdtempSync(join(tmpdir(), 'moxxy-sweep-test-'));
    const other = join(root, 'moxxy-browser-nie-liczba');
    mkdirSync(other, { recursive: true });

    sweepAbandonedBridges(root);

    expect(existsSync(other)).toBe(true);
  });
});

describe('BrowserBridge — the agent aims, the person watches', () => {
  /**
   * The pane's active tab and the agent's working tab are different things. A
   * person clicking a tab while the agent is mid-task must not silently re-point
   * the agent's next un-targeted command at the page they just opened.
   */
  it('keeps the agent on its tab when the person switches in the pane', async () => {
    const { host, addr, c } = await boot(2);
    await c.send('hello', { token: addr.token });
    await c.send('snapshot', { tab_id: 't2' }); // the agent goes to work on t2

    host.select('t1'); // the person clicks the first tab

    expect(host.activeId).toBe('t1');
    const reply = await c.send('url', {});
    expect(host.agentTarget()).toBe('t2');
    expect(reply.ok).toBe(true);
  });

  it('treats an empty tab_id as "no tab named", not as a tab called ""', async () => {
    const { host, addr, c } = await boot(2);
    await c.send('hello', { token: addr.token });
    await c.send('snapshot', { tab_id: 't2' });

    const reply = await c.send('snapshot', { tab_id: '' });

    expect(reply.ok).toBe(true);
    expect(host.agentTarget()).toBe('t2');
  });
});

describe('BrowserBridge — the layer below accessibility', () => {
  /**
   * `browser_session` sends these. Before this they reached the bridge and came
   * back "unknown method", so the tool was advertised to the model and failed on
   * contact — on the desktop only, which is the build people actually use.
   */
  it('answers every verb browser_session sends', async () => {
    const { addr, c } = await boot();
    await c.send('hello', { token: addr.token });

    for (const [method, params] of [
      ['click', { selector: '#kup' }],
      ['fill', { selector: '#kup', value: 'x' }],
      ['text', {}],
      ['html', {}],
      ['eval', { expression: '1' }],
      ['screenshot', {}],
      ['url', {}],
      ['close', {}],
    ] as Array<[string, Record<string, unknown>]>) {
      const reply = await c.send(method, params);
      expect(reply, `${method} must not come back unknown`).toMatchObject({ ok: true });
    }
  });

  it('still refuses a method nobody implements', async () => {
    const { addr, c } = await boot();
    await c.send('hello', { token: addr.token });

    expect(await c.send('teleport', {})).toMatchObject({ ok: false });
  });
});

describe('BrowserBridge — when the person has the browser', () => {
  it('refuses what would act on the page, and still lets the agent read it', async () => {
    const { host, addr, c } = await boot();
    await c.send('hello', { token: addr.token });
    await c.send('snapshot', {});
    host.takeOver();

    const acted = await c.send('act', { action: 'click', uid: '2' });
    const went = await c.send('goto', { url: 'https://example.com' });
    const opened = await c.send('tabs', { action: 'new' });
    const read = await c.send('snapshot', {});
    const listed = await c.send('tabs', { action: 'list' });

    for (const reply of [acted, went, opened]) {
      expect(reply.ok).toBe(false);
      expect((reply.error as { message: string }).message).toMatch(/user has taken over the browser/);
    }
    expect(read.ok).toBe(true);
    expect(listed.ok).toBe(true);
  });

  it('lets a new turn drive again, and keeps refusing the turn that was stopped', async () => {
    const { host, addr, c } = await boot();
    await c.send('hello', { token: addr.token });
    await c.send('snapshot', { turn_id: 'T1' });
    host.takeOver();

    const same = await c.send('act', { action: 'click', uid: '2', turn_id: 'T1' });
    const next = await c.send('act', { action: 'click', uid: '2', turn_id: 'T2' });

    expect(same.ok).toBe(false);
    expect(next.error).toBeUndefined();
    expect(host.control).toEqual({ driver: 'agent', turnId: 'T2' });
  });
});

describe('BrowserBridge — only on sites the conversation allowed', () => {
  /** Every page in these tests is https://sklep.pl. */
  const refused = (reply: Record<string, unknown>) => {
    expect(reply.ok).toBe(false);
    return String((reply.error as { message: string }).message);
  };

  it('refuses to act on a site nobody allowed, and says how to ask', async () => {
    const { addr, c } = await boot(2);
    await c.send('hello', { token: addr.token });
    await c.send('snapshot', { sites: [] });

    const replies = [
      await c.send('act', { action: 'click', uid: '2', sites: [] }),
      await c.send('act', { action: 'type', uid: '2', text: 'x', sites: ['example.com'] }),
      await c.send('key', { key: 'Enter', sites: [] }),
      await c.send('select', { uid: '2', option: 'A', sites: [] }),
      await c.send('back', { sites: [] }),
      await c.send('tabs', { action: 'close', tab_id: 't2', sites: [] }),
    ];

    for (const reply of replies) {
      const message = refused(reply);
      expect(message).toContain('sklep.pl');
      expect(message).toContain('browser_allow_site');
    }
  });

  it('acts on a site the conversation allowed', async () => {
    const { addr, c } = await boot();
    await c.send('hello', { token: addr.token });
    await c.send('snapshot', { sites: ['sklep.pl'] });

    expect(await c.send('act', { action: 'click', uid: '2', sites: ['sklep.pl'] })).toMatchObject({ ok: true });
  });

  it('judges a navigation by where it goes, not where it starts', async () => {
    const { addr, c } = await boot();
    await c.send('hello', { token: addr.token });

    expect(refused(await c.send('goto', { url: 'https://example.com/a', sites: ['sklep.pl'] }))).toContain('example.com');
    expect(refused(await c.send('tabs', { action: 'new', url: 'https://example.com', sites: [] }))).toContain('example.com');
    expect(await c.send('goto', { url: 'https://www.example.com/a', sites: ['example.com'] })).toMatchObject({ ok: true });
    // A blank tab goes nowhere; here it fails only because no pane can open one.
    const blank = await c.send('tabs', { action: 'new', sites: [] });
    expect(String((blank.error as { message?: string } | undefined)?.message)).not.toContain('browser_allow_site');
  });

  it('lets the agent read, scroll, point and wait anywhere', async () => {
    const { addr, c } = await boot();
    await c.send('hello', { token: addr.token });

    for (const [method, params] of [
      ['snapshot', {}],
      ['scroll', { direction: 'down' }],
      ['act', { action: 'hover', uid: '2' }],
      ['capture', {}],
      ['tabs', { action: 'list' }],
    ] as Array<[string, Record<string, unknown>]>) {
      const reply = await c.send(method, { ...params, sites: [] });
      expect(reply.error, method).toBeUndefined();
    }
  });

  it('leaves a call that carries no sites to the prompt it already went through', async () => {
    const { addr, c } = await boot();
    await c.send('hello', { token: addr.token });

    // browser_session asks the user before every call; it sends no sites.
    expect(await c.send('goto', { url: 'https://example.com' })).toMatchObject({ ok: true });
  });
});

describe('BrowserBridge — pointing at a picture and giving files', () => {
  it('passes point and upload through to the host', async () => {
    const { addr, c } = await boot();
    await c.send('hello', { token: addr.token });

    const pointed = await c.send('point', { action: 'click', x: 1, y: 1, view: 'v1', sites: ['sklep.pl'] });
    const uploaded = await c.send('upload', { uid: '2', paths: ['/nie/ma/takiego.png'], sites: ['sklep.pl'] });

    // Both reach the host, which answers in its own words.
    expect((pointed.error as { message: string }).message).toMatch(/browser_capture/);
    expect((uploaded.error as { message: string }).message).toMatch(/not a file/);
  });

  it('refuses both on a site nobody allowed, and while the person has the browser', async () => {
    const { host, addr, c } = await boot();
    await c.send('hello', { token: addr.token });

    for (const [method, params] of [
      ['point', { action: 'click', x: 1, y: 1, view: 'v1' }],
      ['upload', { uid: '2', paths: ['/x.png'] }],
    ] as Array<[string, Record<string, unknown>]>) {
      const reply = await c.send(method, { ...params, sites: [] });
      expect((reply.error as { message: string }).message, method).toContain('browser_allow_site');
    }
    host.takeOver();
    for (const method of ['point', 'upload']) {
      const reply = await c.send(method, { sites: ['sklep.pl'] });
      expect((reply.error as { message: string }).message, method).toMatch(/user has taken over/);
    }
  });
});

describe('BrowserBridge — the page for a run of steps', () => {
  it('serves the elements and the page text, on any site and while the person has the browser', async () => {
    const { host, addr, c } = await boot();
    await c.send('hello', { token: addr.token });
    host.takeOver();

    const reply = await c.send('tree', { sites: [] });

    expect(reply.ok).toBe(true);
    const result = reply.result as { tree: { app: string; elements: Array<{ index: number; title?: string }> }; page: string };
    expect(result.tree.app).toBe('sklep.pl');
    expect(result.tree.elements).toEqual([expect.objectContaining({ index: 2, title: 'Kup' })]);
    expect(result.page).toContain('Kup');
  });
});
