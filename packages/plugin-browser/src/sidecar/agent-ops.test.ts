import { describe, expect, it } from 'vitest';
import { opAct, opSnapshot, opTabs } from './agent-ops.js';
import { TabRegistry } from './tabs.js';
import type { CdpSession, Err, Ok, PageHandle, PlaywrightHandle } from './types.js';
import type { SidecarState } from './dispatch.js';

/**
 * The operations the model actually calls. The contract that matters most is
 * the stale-handle one: a uid from before a navigation must fail loudly. A
 * click that silently lands on whatever now occupies that position is the
 * worst failure this layer can have, because nothing downstream can detect it.
 */

interface Recorder {
  clicks: Array<{ x: number; y: number }>;
  typed: string[];
  gotos: string[];
}

function fakePage(rec: Recorder, url = 'https://start.pl', title = 'Start'): PageHandle & { setUrl(u: string): void } {
  let current = url;
  return {
    goto: async (u: string) => {
      rec.gotos.push(u);
      current = u;
      return undefined;
    },
    click: async () => {},
    fill: async () => {},
    textContent: async () => null,
    content: async () => `<title>${title}</title>`,
    screenshot: async () => Buffer.from(''),
    evaluate: async () => title,
    url: () => current,
    close: async () => {},
    viewportSize: () => ({ width: 800, height: 600 }),
    setViewportSize: async () => {},
    goBack: async () => undefined,
    goForward: async () => undefined,
    reload: async () => undefined,
    mouse: {
      move: async () => {},
      click: async (x: number, y: number) => {
        rec.clicks.push({ x, y });
      },
      wheel: async () => {},
    },
    keyboard: {
      press: async () => {},
      type: async (t: string) => {
        rec.typed.push(t);
      },
    },
    setUrl(u: string) {
      current = u;
    },
  };
}

const AX_REPLY = {
  nodes: [
    { nodeId: 'a', role: { value: 'RootWebArea' }, name: { value: 'Start' }, childIds: ['b'] },
    { nodeId: 'b', role: { value: 'button' }, name: { value: 'Zaloguj' }, backendDOMNodeId: 55 },
  ],
};

function fakeCdp(): CdpSession {
  return {
    send: async (method) => {
      if (method === 'Accessibility.getFullAXTree') return AX_REPLY;
      if (method === 'DOM.getBoxModel') return { model: { content: [0, 0, 100, 0, 100, 50, 0, 50] } };
      return {};
    },
  };
}

function makeState(rec: Recorder): { state: SidecarState; handle: PlaywrightHandle; page: ReturnType<typeof fakePage> } {
  const page = fakePage(rec);
  const tabs = new TabRegistry();
  tabs.add(page);
  const handle = {
    browser: { close: async () => {} },
    context: {
      newPage: async () => fakePage(rec, 'https://nowa.pl', 'Nowa'),
      close: async () => {},
      newCDPSession: async () => fakeCdp(),
    },
    page,
  } as unknown as PlaywrightHandle;

  return { state: { handle, pendingInstallNotice: null, tabs }, handle, page };
}

const okResult = (r: Ok | Err): Record<string, unknown> => {
  expect(r.ok).toBe(true);
  return (r as Ok).result as Record<string, unknown>;
};

describe('opSnapshot', () => {
  it('returns the page text with the tab list attached', async () => {
    const rec: Recorder = { clicks: [], typed: [], gotos: [] };
    const { state, handle } = makeState(rec);

    const text = String(okResult(await opSnapshot(state, handle, { id: '1', method: 'snapshot' })).text);

    expect(text).toContain('Zaloguj');
    expect(text).toContain('t1');
    expect(text).toContain('(current)');
  });

  it('frames the page as untrusted every time', async () => {
    const rec: Recorder = { clicks: [], typed: [], gotos: [] };
    const { state, handle } = makeState(rec);

    const text = String(okResult(await opSnapshot(state, handle, { id: '1', method: 'snapshot' })).text);
    expect(text).toContain('UNTRUSTED DATA');
  });
});

describe('opAct — the stale-handle contract', () => {
  it('clicks the element a uid points at', async () => {
    const rec: Recorder = { clicks: [], typed: [], gotos: [] };
    const { state, handle } = makeState(rec);
    await opSnapshot(state, handle, { id: '1', method: 'snapshot' });

    const reply = await opAct(state, handle, { id: '2', method: 'act', params: { action: 'click', uid: '2' } });

    expect(reply.ok).toBe(true);
    expect(rec.clicks).toEqual([{ x: 50, y: 25 }]);
  });

  it('refuses a uid that was never in a snapshot', async () => {
    const rec: Recorder = { clicks: [], typed: [], gotos: [] };
    const { state, handle } = makeState(rec);
    await opSnapshot(state, handle, { id: '1', method: 'snapshot' });

    const reply = await opAct(state, handle, { id: '2', method: 'act', params: { action: 'click', uid: '999' } });

    expect(reply.ok).toBe(false);
    expect((reply as Err).error.message).toContain('999');
    expect(rec.clicks).toHaveLength(0);
  });

  it('refuses to act before any snapshot was taken', async () => {
    const rec: Recorder = { clicks: [], typed: [], gotos: [] };
    const { state, handle } = makeState(rec);

    const reply = await opAct(state, handle, { id: '1', method: 'act', params: { action: 'click', uid: '2' } });

    expect(reply.ok).toBe(false);
    expect((reply as Err).error.message).toMatch(/snapshot/i);
  });

  it('refuses a uid from before a navigation instead of clicking blind', async () => {
    const rec: Recorder = { clicks: [], typed: [], gotos: [] };
    const { state, handle, page } = makeState(rec);
    await opSnapshot(state, handle, { id: '1', method: 'snapshot' });

    page.setUrl('https://gdzie-indziej.pl');

    const reply = await opAct(state, handle, { id: '2', method: 'act', params: { action: 'click', uid: '2' } });

    expect(reply.ok).toBe(false);
    expect((reply as Err).error.message).toMatch(/changed|stale|snapshot/i);
    expect(rec.clicks).toHaveLength(0);
  });

  it('types into the element a uid points at', async () => {
    const rec: Recorder = { clicks: [], typed: [], gotos: [] };
    const { state, handle } = makeState(rec);
    await opSnapshot(state, handle, { id: '1', method: 'snapshot' });

    await opAct(state, handle, { id: '2', method: 'act', params: { action: 'type', uid: '2', text: 'moxxy' } });

    expect(rec.typed).toEqual(['moxxy']);
  });
});

describe('opTabs', () => {
  it('lists the open tabs', async () => {
    const rec: Recorder = { clicks: [], typed: [], gotos: [] };
    const { state, handle } = makeState(rec);

    const result = okResult(await opTabs(state, handle, { id: '1', method: 'tabs', params: { action: 'list' } }));

    expect(result.tabs).toHaveLength(1);
    expect(result.activeTabId).toBe('t1');
  });

  it('opens a new tab and reports its id without stealing focus from the agent', async () => {
    const rec: Recorder = { clicks: [], typed: [], gotos: [] };
    const { state, handle } = makeState(rec);

    const result = okResult(
      await opTabs(state, handle, { id: '1', method: 'tabs', params: { action: 'new', url: 'https://nowa.pl' } }),
    );

    expect(result.tabId).toBe('t2');
    expect(state.tabs!.list()).toHaveLength(2);
  });

  it('selects a tab', async () => {
    const rec: Recorder = { clicks: [], typed: [], gotos: [] };
    const { state, handle } = makeState(rec);
    await opTabs(state, handle, { id: '1', method: 'tabs', params: { action: 'new' } });

    await opTabs(state, handle, { id: '2', method: 'tabs', params: { action: 'select', tab_id: 't2' } });

    expect(state.tabs!.activeId).toBe('t2');
  });

  it('reports a clear error for an unknown tab', async () => {
    const rec: Recorder = { clicks: [], typed: [], gotos: [] };
    const { state, handle } = makeState(rec);

    const reply = await opTabs(state, handle, { id: '1', method: 'tabs', params: { action: 'select', tab_id: 'tZ' } });

    expect(reply.ok).toBe(false);
    expect((reply as Err).error.message).toContain('tZ');
  });

  it('closes a tab', async () => {
    const rec: Recorder = { clicks: [], typed: [], gotos: [] };
    const { state, handle } = makeState(rec);
    await opTabs(state, handle, { id: '1', method: 'tabs', params: { action: 'new' } });

    await opTabs(state, handle, { id: '2', method: 'tabs', params: { action: 'close', tab_id: 't2' } });

    expect(state.tabs!.list()).toHaveLength(1);
  });
});
