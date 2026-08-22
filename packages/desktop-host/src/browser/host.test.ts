import { describe, expect, it } from 'vitest';
import { BrowserHost, type HostWebContents } from './host.js';

/**
 * The main-process browser. Driven against a recorded WebContents rather than
 * a real Electron view: what needs pinning is which CDP commands go out, and
 * what happens when a handle no longer describes the page — neither of which
 * needs a window on screen.
 */

const AX_NODES = [
  { nodeId: 'a', role: { value: 'RootWebArea' }, name: { value: 'Sklep' }, childIds: ['b', 'c'] },
  { nodeId: 'b', role: { value: 'button' }, name: { value: 'Do kasy' }, backendDOMNodeId: 21 },
  { nodeId: 'c', role: { value: 'textbox' }, name: { value: 'Hasło' }, value: { value: 'tajne' }, backendDOMNodeId: 22 },
];

function fakeWc(id: number, url = 'https://sklep.pl', title = 'Sklep', opts: { navigateError?: string } = {}) {
  let axNodes: unknown[] = AX_NODES;
  /** Zero-area means the element is in the tree but not drawn. */
  const boxes: Record<number, number[] | null> = {};
  /** Whether the page reports the element inside its viewport. */
  let onScreen = true;
  let current = url;
  let attached = false;
  let reloads = 0;
  const back: string[] = [];
  const forward: string[] = [];
  const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
  let focused = 0;
  const wc: HostWebContents = {
    id,
    on: (event: string, fn: (...a: unknown[]) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(fn);
      listeners.set(event, set);
    },
    removeListener: (event: string, fn: (...a: unknown[]) => void) => {
      listeners.get(event)?.delete(fn);
    },
    getURL: () => current,
    getTitle: () => title,
    isDestroyed: () => false,
    loadURL: async (u: string) => {
      current = u;
    },
    reload: () => {
      reloads++;
    },
    navigationHistory: {
      canGoBack: () => back.length > 0,
      canGoForward: () => forward.length > 0,
      goBack: () => {
        const prev = back.pop();
        if (prev !== undefined) {
          forward.push(current);
          current = prev;
        }
      },
      goForward: () => {
        const next = forward.pop();
        if (next !== undefined) {
          back.push(current);
          current = next;
        }
      },
    },
    debugger: {
      isAttached: () => attached,
      attach: () => {
        attached = true;
      },
      detach: () => {
        attached = false;
      },
      sendCommand: async (method, params) => {
        sent.push({ method, params });
        if (method === 'Accessibility.getFullAXTree') return { nodes: axNodes };
        if (method === 'DOM.getBoxModel') {
          const id_ = (params as { backendNodeId?: number })?.backendNodeId;
          if (id_ !== undefined && id_ in boxes) {
            const q = boxes[id_];
            return q ? { model: { content: q } } : {};
          }
          return { model: { content: [0, 0, 80, 0, 80, 40, 0, 40] } };
        }
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
        if (method === 'DOM.querySelector') {
          // Only `#kup` and `#q` exist on this page.
          const sel = String((params as { selector?: string })?.selector ?? '');
          return { nodeId: sel === '#kup' || sel === '#q' ? 2 : 0 };
        }
        if (method === 'DOM.describeNode') return { node: { backendNodeId: 21 } };
        if (method === 'DOM.resolveNode') return { object: { objectId: 'obj-1' } };
        if (method === 'Runtime.callFunctionOn') {
          const fn = String((params as { functionDeclaration?: string })?.functionDeclaration ?? '');
          if (fn.includes('getBoundingClientRect')) return { result: { value: onScreen } };
          return {};
        }
        if (method === 'Runtime.evaluate') {
          const expr = String((params as { expression?: string })?.expression ?? '');
          if (expr.includes('outerHTML')) return { result: { value: '<html>sklep</html>' } };
          if (expr.includes('querySelector')) return { result: { value: 'Tytul produktu' } };
          if (expr.includes('innerText')) return { result: { value: 'caly tekst strony' } };
          return { result: { value: 4 } };
        }
        if (method === 'Page.navigate') {
          if (opts.navigateError) return { errorText: opts.navigateError };
          current = String((params as { url?: string })?.url ?? current);
          return {};
        }
        return {};
      },
    },
    sendInputEvent: () => {},
    focus: () => {
      focused++;
    },
  };
  return {
    wc,
    sent,
    setUrl: (u: string) => (current = u),
    isAttached: () => attached,
    reloads: () => reloads,
    pushHistory: (u: string) => {
      back.push(current);
      current = u;
    },
    /** Let a test change what the page says, the way a real page would. */
    setPage: (nodes: unknown[]) => (axNodes = nodes),
    setBox: (backendNodeId: number, quad: number[] | null) => (boxes[backendNodeId] = quad),
    setOnScreen: (v: boolean) => (onScreen = v),
    emit: (event: string) => {
      for (const fn of [...(listeners.get(event) ?? [])]) fn();
    },
    listenerCount: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
    focusCount: () => focused,
  };
}

function hostWith(...contents: Array<{ wc: HostWebContents }>) {
  const byId = new Map(contents.map((c) => [c.wc.id, c.wc]));
  return new BrowserHost((id) => byId.get(id) ?? null);
}

describe('BrowserHost — adopting views', () => {
  it('names a registered webview and makes the first one active', () => {
    const a = fakeWc(1);
    const host = hostWith(a);

    const tabId = host.register(a.wc.id);

    expect(tabId).toBe('t1');
    expect(host.activeId).toBe('t1');
  });

  it('registers the same view only once', () => {
    const a = fakeWc(1);
    const host = hostWith(a);

    expect(host.register(1)).toBe(host.register(1));
    expect(host.list()).toHaveLength(1);
  });

  it('keeps the agent-visible list in document order with the active flag', () => {
    const a = fakeWc(1, 'https://a.pl', 'A');
    const b = fakeWc(2, 'https://b.pl', 'B');
    const host = hostWith(a, b);
    host.register(1);
    host.register(2);

    expect(host.list()).toEqual([
      { tabId: 't1', url: 'https://a.pl', title: 'A', active: false },
      { tabId: 't2', url: 'https://b.pl', title: 'B', active: true },
    ]);
  });

  /**
   * A tab is registered exactly when someone opened one — the person pressed
   * plus, or the agent asked for it. Every browser goes to the tab it just
   * opened, and staying put is the surprise: you press plus and nothing appears
   * to happen.
   */
  it('goes to the tab it just opened', () => {
    const a = fakeWc(1);
    const b = fakeWc(2);
    const host = hostWith(a, b);
    host.register(1);

    host.register(2);

    expect(host.activeId).toBe('t2');
  });

  it('stays put when the same view is registered again', () => {
    const a = fakeWc(1);
    const b = fakeWc(2);
    const host = hostWith(a, b);
    host.register(1);
    host.register(2);
    host.select('t1');

    host.register(2);

    expect(host.activeId).toBe('t1');
  });

  it('does not drag the agent along with it', () => {
    // Opening a tab moves what the person sees. Where the agent is working is
    // its own business — that separation is why a click in the strip cannot
    // re-aim it either.
    const a = fakeWc(1);
    const b = fakeWc(2);
    const host = hostWith(a, b);
    host.register(1);
    host.noteAgentTab('t1');

    host.register(2);

    expect(host.activeId).toBe('t2');
    expect(host.agentTarget()).toBe('t1');
  });

  it('notifies listeners when the tab set changes', () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    let calls = 0;
    host.onChange(() => calls++);

    host.register(1);
    expect(calls).toBe(1);
  });
});

describe('BrowserHost — snapshot', () => {
  it('attaches the debugger and reads the accessibility tree', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    const reply = await host.snapshot();

    expect(reply.ok).toBe(true);
    expect(a.isAttached()).toBe(true);
    // The box lookup is the wall check: this fixture has a password field, so a
    // sign-in wall is detected and then confirmed against its geometry.
    expect(a.sent.map((s) => s.method)).toEqual([
      'Accessibility.enable',
      'Accessibility.getFullAXTree',
      'DOM.getBoxModel',
    ]);
  });

  it('returns text carrying the uid, the tab list and the untrusted framing', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    const text = String(((await host.snapshot()).result as { text: string }).text);

    expect(text).toContain('Do kasy');
    expect(text).toContain('t1');
    expect(text).toContain('UNTRUSTED DATA');
  });

  it('redacts a password field before it reaches the model', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    const text = String(((await host.snapshot()).result as { text: string }).text);

    expect(text).not.toContain('tajne');
    expect(text).toContain('Hasło');
  });
});

describe('BrowserHost — acting on a uid', () => {
  it('clicks at the centre of the resolved box', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    await host.snapshot();

    const reply = await host.act({ action: 'click', uid: '2' });

    expect(reply.ok).toBe(true);
    const press = a.sent.find((s) => s.params?.type === 'mousePressed');
    expect(press?.params).toMatchObject({ x: 40, y: 20, button: 'left' });
  });

  it('types via CDP insertText after focusing the field', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    await host.snapshot();

    await host.act({ action: 'type', uid: '3', text: 'moxxy' });

    expect(a.sent.find((s) => s.method === 'Input.insertText')?.params).toMatchObject({ text: 'moxxy' });
  });

  it('refuses a uid taken before the page moved', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    await host.snapshot();
    a.setUrl('https://gdzie-indziej.pl');

    const reply = await host.act({ action: 'click', uid: '2' });

    expect(reply.ok).toBe(false);
    expect(reply.error?.message).toMatch(/stale|navigated/i);
    expect(a.sent.some((s) => s.params?.type === 'mousePressed')).toBe(false);
  });

  it('refuses before any snapshot exists', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    expect((await host.act({ action: 'click', uid: '2' })).error?.message).toMatch(/snapshot/i);
  });

  it('names the open tabs when the tab id is unknown', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    const reply = await host.snapshot('t9');

    expect(reply.error?.message).toContain('t9');
    expect(reply.error?.message).toContain('t1');
  });
});

describe('BrowserHost — history', () => {
  it('goes back and invalidates the snapshot', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    a.pushHistory('https://sklep.pl/koszyk');
    await host.snapshot();

    const reply = await host.history('back');

    expect(reply.ok).toBe(true);
    // The uids described the page we just left.
    expect((await host.act({ action: 'click', uid: '2' })).error?.message).toMatch(/snapshot/i);
  });

  it('says so rather than pretending when there is nowhere to go', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    expect((await host.history('back')).error?.message).toMatch(/nothing to go back/i);
    expect((await host.history('forward')).error?.message).toMatch(/nothing to go forward/i);
  });

  it('reloads through the view, not by re-navigating', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    await host.history('reload');

    expect(a.reloads()).toBe(1);
  });
});

describe('BrowserHost — teardown', () => {
  it('detaches every debugger so nothing outlives the window', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    await host.snapshot();
    expect(a.isAttached()).toBe(true);

    host.closeAll();

    expect(a.isAttached()).toBe(false);
    expect(host.list()).toHaveLength(0);
  });

  it('finishes teardown even when a listener throws', () => {
    // On quit the obvious listener pushes the tab list into a window whose
    // webContents is already destroyed. Observed live: it threw out of
    // closeAll and Electron popped an error dialog on every exit.
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    host.onChange(() => {
      throw new Error('Object has been destroyed');
    });

    expect(() => host.closeAll()).not.toThrow();
    expect(host.list()).toHaveLength(0);
  });

  it('fails a pending open instead of leaving the agent waiting', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.setOpener(() => {
      /* never answers */
    });
    const pending = host.newTab('https://a.pl');

    host.closeAll();

    await expect(pending).rejects.toThrow(/shutting down/i);
  });
});

describe('BrowserHost — navigation', () => {
  it('navigates through CDP, not the embedder', async () => {
    // `loadURL` on a <webview> guest races the embedder's own navigation
    // handling and comes back ERR_FAILED with a blank view. Observed live.
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    const reply = await host.goto('https://nowa.pl');

    expect(reply.ok).toBe(true);
    expect(a.sent.find((s) => s.method === 'Page.navigate')?.params).toMatchObject({ url: 'https://nowa.pl' });
  });

  it('reports a navigation the page refused', async () => {
    const a = fakeWc(1, 'https://a.pl', 'A', { navigateError: 'ERR_NAME_NOT_RESOLVED' });
    const host = hostWith(a);
    host.register(1);

    const reply = await host.goto('https://nie-ma-takiej-domeny.invalid');

    expect(reply.ok).toBe(false);
    expect(reply.error?.message).toContain('ERR_NAME_NOT_RESOLVED');
  });

  it('drops the snapshot so old uids cannot be replayed on the new page', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    await host.snapshot();

    await host.goto('https://inna.pl');
    const reply = await host.act({ action: 'click', uid: '2' });

    expect(reply.ok).toBe(false);
    expect(reply.error?.message).toMatch(/snapshot/i);
  });
});

describe('BrowserHost — keeping the pane in step with the page', () => {
  /**
   * The tab strip is pushed, not polled, and `changed()` only fired when a tab
   * was added, removed or selected. A page that retitled or navigated itself —
   * which is what pages do — left the strip describing something that was no
   * longer on screen. Seen live: two tabs both labelled "DuckDuckGo" while the
   * second was in fact showing example.com.
   */
  it('announces a tab that retitles or navigates itself', () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    let calls = 0;
    host.onChange(() => calls++);

    a.emit('page-title-updated');
    a.emit('did-navigate');
    a.emit('did-navigate-in-page');

    expect(calls).toBe(3);
  });

  it('stops listening to a view it has given back', () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    let calls = 0;
    host.onChange(() => calls++);

    host.unregister('t1');
    calls = 0;
    a.emit('page-title-updated');

    expect(calls).toBe(0);
    expect(a.listenerCount()).toBe(0);
  });

  it('leaves nothing attached to the view after teardown', () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    host.closeAll();

    expect(a.listenerCount()).toBe(0);
  });

  it('subscribes once even if the same view is registered twice', () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    host.register(1);
    let calls = 0;
    host.onChange(() => calls++);

    a.emit('did-navigate');

    expect(calls).toBe(1);
  });
});

describe('BrowserHost — reaching an element by CSS selector', () => {
  /**
   * `browser_session` is the escape hatch below the accessibility layer, for
   * pages where AX says nothing useful. It used to run against the Playwright
   * sidecar; on the desktop it now has to be answered here, or the tool is
   * advertised to the model and fails on contact.
   */
  it('clicks what the selector found, at the middle of its box', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    const reply = await host.clickSelector('#kup');

    expect(reply.ok).toBe(true);
    expect(a.sent.find((s) => s.params?.type === 'mousePressed')?.params).toMatchObject({ x: 40, y: 20 });
  });

  it('names the selector it could not find rather than failing blankly', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    const reply = await host.clickSelector('#nie-ma', { timeoutMs: 40 });

    expect(reply.ok).toBe(false);
    expect(reply.error?.message).toContain('#nie-ma');
    expect(a.sent.some((s) => s.params?.type === 'mousePressed')).toBe(false);
  });

  it('replaces what a field already held instead of appending to it', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    await host.fillSelector('#q', 'moxxy');

    const order = a.sent.map((s) => s.method);
    expect(order).toContain('DOM.focus');
    // Selecting the old value first is what makes insertText a replacement.
    expect(order.indexOf('Runtime.callFunctionOn')).toBeLessThan(order.indexOf('Input.insertText'));
    expect(a.sent.find((s) => s.method === 'Input.insertText')?.params).toMatchObject({ text: 'moxxy' });
  });

  it('reads one element or the whole document', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    expect((await host.textOf('#tytul')).result).toBe('Tytul produktu');
    expect((await host.textOf()).result).toBe('caly tekst strony');
    expect((await host.htmlOf()).result).toBe('<html>sklep</html>');
  });

  it('evaluates an expression in the page and gives back its value', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    expect((await host.evaluate('2 + 2')).result).toBe(4);
  });
});

describe('BrowserHost — whose tab is whose', () => {
  /**
   * The pane's active tab and the tab the agent is working on are two different
   * things. Conflating them means that a person clicking a tab mid-task silently
   * re-aims the agent's next un-targeted command at the page they just opened.
   */
  it('keeps the agent on its tab when the user switches to another', () => {
    const a = fakeWc(1, 'https://a.pl', 'A');
    const b = fakeWc(2, 'https://b.pl', 'B');
    const host = hostWith(a, b);
    host.register(1);
    host.register(2);
    host.noteAgentTab('t2');

    host.select('t1'); // the person clicks the first tab

    expect(host.activeId).toBe('t1');
    expect(host.agentTarget()).toBe('t2');
  });

  it('follows the agent when the agent names a tab', () => {
    const a = fakeWc(1);
    const b = fakeWc(2);
    const host = hostWith(a, b);
    host.register(1);
    host.register(2);

    host.noteAgentTab('t2');

    expect(host.agentTarget()).toBe('t2');
  });

  it('falls back to the tab in front before the agent has named one', () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    expect(host.agentTarget()).toBe('t1');
  });

  it('forgets an aim at a tab that no longer exists', () => {
    const a = fakeWc(1);
    const b = fakeWc(2);
    const host = hostWith(a, b);
    host.register(1);
    host.register(2);
    host.noteAgentTab('t2');

    host.unregister('t2');

    expect(host.agentTarget()).toBe('t1');
  });

  it('ignores an aim at a tab it has never heard of', () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    host.noteAgentTab('t99');

    expect(host.agentTarget()).toBe('t1');
  });
});

describe('BrowserHost — not re-reading a page that has not moved', () => {
  /**
   * The agent looks again after every action, and most of the time the page is
   * exactly as it left it. Measured on a Wikipedia article: the second read is
   * 100% identical to the first and costs the same ~25k tokens. Saying "nothing
   * changed" costs a line.
   */
  const CHANGED = [
    { nodeId: 'a', role: { value: 'RootWebArea' }, name: { value: 'Sklep' }, childIds: ['b'] },
    { nodeId: 'b', role: { value: 'button' }, name: { value: 'Zaplac teraz' }, backendDOMNodeId: 31 },
  ];

  it('says so instead of sending the tree again', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    const first = String(((await host.snapshot()).result as { text: string }).text);
    const second = String(((await host.snapshot()).result as { text: string }).text);

    expect(first).toContain('Do kasy');
    expect(second).not.toContain('Do kasy');
    expect(second).toMatch(/unchanged/i);
    expect(second.length).toBeLessThan(first.length / 2);
  });

  it('leaves the uids from that page usable', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    await host.snapshot();
    await host.snapshot();

    const reply = await host.act({ action: 'click', uid: '2' });

    expect(reply.ok).toBe(true);
  });

  it('sends the whole tree again the moment the page differs', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    await host.snapshot();

    a.setPage(CHANGED);
    const text = String(((await host.snapshot()).result as { text: string }).text);

    expect(text).toContain('Zaplac teraz');
    expect(text).not.toMatch(/unchanged/i);
  });

  it('never answers "unchanged" for a page it has not read before', async () => {
    const a = fakeWc(1);
    const b = fakeWc(2, 'https://inny.pl', 'Inny');
    const host = hostWith(a, b);
    host.register(1);
    host.register(2);
    await host.snapshot('t1');

    const text = String(((await host.snapshot('t2')).result as { text: string }).text);

    expect(text).toContain('Do kasy');
  });

  it('forgets what it read once the tab navigates', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    await host.snapshot();

    await host.goto('https://sklep.pl/koszyk');
    const text = String(((await host.snapshot()).result as { text: string }).text);

    expect(text).toContain('Do kasy');
    expect(text).not.toMatch(/unchanged/i);
  });
});

describe('BrowserHost — letting go of a tab nobody is using', () => {
  /**
   * Chromium builds no accessibility tree until something asks, and maintains
   * one across every DOM mutation once it has. Measured: +49 MB on a Wikipedia
   * article, held for the life of the tab, because the host only ever detached
   * when the tab closed.
   */
  const idle = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('turns the tree off and detaches once the agent stops working', async () => {
    const a = fakeWc(1);
    const host = new BrowserHost(() => a.wc, 30);
    host.register(1);
    await host.snapshot();
    expect(a.isAttached()).toBe(true);

    await idle(90);

    expect(a.sent.some((s) => s.method === 'Accessibility.disable')).toBe(true);
    expect(a.isAttached()).toBe(false);
  });

  it('holds on while the agent is still working the tab', async () => {
    const a = fakeWc(1);
    const host = new BrowserHost(() => a.wc, 60);
    host.register(1);

    await host.snapshot();
    await idle(35);
    await host.snapshot();
    await idle(35);

    expect(a.isAttached()).toBe(true);
  });

  it('picks the tab back up on the next read', async () => {
    const a = fakeWc(1);
    const host = new BrowserHost(() => a.wc, 30);
    host.register(1);
    await host.snapshot();
    await idle(90);
    expect(a.isAttached()).toBe(false);

    const reply = await host.snapshot();

    expect(reply.ok).toBe(true);
    expect(a.isAttached()).toBe(true);
    // The labels survive the release, so an unchanged page reads as unchanged
    // rather than as a whole tree — see "what the uid memory survives".
    expect(String((reply.result as { text: string }).text)).toMatch(/unchanged/i);
  });

  it('drops the countdown with the tab, so nothing fires into a closed view', async () => {
    const a = fakeWc(1);
    const host = new BrowserHost(() => a.wc, 30);
    host.register(1);
    await host.snapshot();

    host.closeAll();
    await idle(90);

    expect(a.isAttached()).toBe(false);
  });
});

describe('BrowserHost — the keyboard', () => {
  /**
   * There was no way to send a key at all. An agent that needed Cmd+A to replace
   * the contents of a field had nothing to reach for, so it reached outside —
   * seen live on Canva, where it went for a completely different browser rather
   * than admit it could not press a key. The sidecar backend has had this since
   * the beginning; only the desktop was missing it.
   */
  const sentKeys = (a: ReturnType<typeof fakeWc>) => a.sent.filter((s) => s.method === 'Input.dispatchKeyEvent');

  it('presses a lone printable character, carrying the text so it lands', async () => {
    // `Input.insertText` looked like the shorter road for a single character and
    // is not one: on its own, after the click that focused the field, it does
    // nothing at all. Observed against a real input — a key event with `text`
    // is what actually types.
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    await host.key('a');

    const keys = sentKeys(a);
    expect(keys.map((k) => k.params?.type)).toEqual(['keyDown', 'keyUp']);
    expect(keys[0]?.params).toMatchObject({ key: 'a', text: 'a' });
    expect(a.sent.some((s) => s.method === 'Input.insertText')).toBe(false);
  });

  it('presses punctuation it has no name for', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    expect((await host.key('/')).ok).toBe(true);
    expect(sentKeys(a)[0]?.params).toMatchObject({ text: '/' });
  });

  it('presses a named key down and up again', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    await host.key('Enter');

    const keys = sentKeys(a);
    expect(keys.map((k) => k.params?.type)).toEqual(['rawKeyDown', 'keyUp']);
    expect(keys[0]?.params).toMatchObject({ key: 'Enter', windowsVirtualKeyCode: 13 });
  });

  it('carries modifiers as the bitmask CDP expects', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    await host.key('Shift+Tab');

    expect(sentKeys(a)[0]?.params).toMatchObject({ key: 'Tab', modifiers: 8 });
  });

  it('sends select-all as an editing command, not just a modified letter', async () => {
    // The blocked case. A modified letter alone does not reach the editing
    // pipeline; the command does, and it is what a real Cmd+A produces.
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    await host.key('Meta+a');

    expect(sentKeys(a)[0]?.params).toMatchObject({ modifiers: 4, commands: ['selectAll'] });
  });

  it('treats Control and Meta alike for the editing commands', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    await host.key('Control+a');

    expect(sentKeys(a)[0]?.params).toMatchObject({ modifiers: 2, commands: ['selectAll'] });
  });

  it('refuses a key it cannot spell rather than pressing something else', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    const reply = await host.key('Wypadnij');

    expect(reply.ok).toBe(false);
    expect(reply.error?.message).toContain('Wypadnij');
    expect(sentKeys(a)).toHaveLength(0);
  });

  it('refuses nothing at all', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    expect((await host.key('')).ok).toBe(false);
  });
});

describe('BrowserHost — keys land where the user last clicked "allow"', () => {
  /**
   * Every acting tool asks before it runs, and answering means clicking in the
   * app — which takes keyboard focus off the page. So key one of a sequence
   * lands, key two does not, and the agent is left looking at a field it
   * selected and could not clear. Seen live on a search box: the same two keys
   * work with no prompt between them and do nothing with one.
   */
  it('takes the page back before pressing anything', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    await host.key('Backspace');

    expect(a.focusCount()).toBe(1);
  });

  it('does not grab focus for reading or for clicking', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    await host.snapshot();
    await host.act({ action: 'click', uid: '2' });

    expect(a.focusCount()).toBe(0);
  });
});

describe('BrowserHost — getting the page focused before a key', () => {
  /**
   * A key only reaches the page when the `<webview>` ELEMENT has focus in the
   * window's DOM — and answering the approval prompt takes that away, because
   * answering means clicking in the app. `webContents.focus()` from here is not
   * enough: the guest is a child of the embedder, and only the renderer can
   * focus the element. Reproduced in a real window with a second focusable
   * element beside the view.
   */
  it('asks the renderer to focus the view, then presses', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    const asked: string[] = [];
    host.setFocuser((req) => {
      asked.push(req.tabId);
      host.confirmFocus(req.requestId);
    });

    await host.key('Enter');

    expect(asked).toEqual(['t1']);
    expect(a.sent.some((s) => s.method === 'Input.dispatchKeyEvent')).toBe(true);
  });

  it('presses anyway when no renderer is listening', async () => {
    // The CLI has no pane to ask. A key that silently never fires would be worse
    // than one sent at a view that may or may not have focus.
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    const reply = await host.key('Enter');

    expect(reply.ok).toBe(true);
  });

  it('does not wait forever on a renderer that never answers', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    host.setFocuser(() => {
      /* never confirms */
    });

    const reply = await host.key('Enter', undefined, 40);

    expect(reply.ok).toBe(true);
    expect(a.sent.some((s) => s.method === 'Input.dispatchKeyEvent')).toBe(true);
  });

  it('asks for nothing when only reading or clicking', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    let asked = 0;
    host.setFocuser(() => asked++);

    await host.snapshot();
    await host.act({ action: 'click', uid: '2' });

    expect(asked).toBe(0);
  });
});

describe('BrowserHost — a wall only counts when it is on screen', () => {
  /**
   * A control can sit in the accessibility tree without being drawn — hidden by
   * opacity, moved off by a transform, inside a collapsed container. Reported as
   * a wall it traps the agent in a hand-off nobody can answer: the person is
   * told to click something that is not on their screen, presses Done because
   * there is nothing to do, and the next read says the same thing. Seen live on
   * canva.com.
   */
  const CONSENT_PAGE = [
    { nodeId: 'a', role: { value: 'RootWebArea' }, name: { value: 'Canva' }, childIds: ['b'] },
    { nodeId: 'b', role: { value: 'button' }, name: { value: 'Zaakceptuj wszystkie pliki cookie' }, backendDOMNodeId: 55 },
  ];

  it('names the wall when the thing to press is really there', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    a.setPage(CONSENT_PAGE);

    const text = String(((await host.snapshot()).result as { text: string }).text);

    expect(text).toContain('### Needs you');
    expect(text).toContain('browser_await_human');
  });

  it('says nothing when the control is in the tree but not drawn', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    a.setPage(CONSENT_PAGE);
    a.setBox(55, null);

    const text = String(((await host.snapshot()).result as { text: string }).text);

    expect(text).not.toContain('### Needs you');
    // The page itself is still read — only the claim about a wall is dropped.
    expect(text).toContain('Zaakceptuj wszystkie pliki cookie');
  });

  it('says nothing when the control has collapsed to nothing', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    a.setPage(CONSENT_PAGE);
    a.setBox(55, [0, 0, 0, 0, 0, 0, 0, 0]);

    const text = String(((await host.snapshot()).result as { text: string }).text);

    expect(text).not.toContain('### Needs you');
  });
});

describe('BrowserHost — putting the wall where the person can see it', () => {
  /**
   * A hand-off is only worth anything if the thing it asks about is on screen.
   * Seen live: the pane showed one tab while the consent banner sat on another,
   * so the agent asked the user to press something that was not in front of
   * them — and the banner itself was near the bottom of a page nobody had
   * scrolled. Asking is the easy half; showing is the half that was missing.
   */
  const CONSENT_PAGE = [
    { nodeId: 'a', role: { value: 'RootWebArea' }, name: { value: 'Canva' }, childIds: ['b'] },
    { nodeId: 'b', role: { value: 'button' }, name: { value: 'Zaakceptuj wszystkie pliki cookie' }, backendDOMNodeId: 55 },
  ];

  it('scrolls the wall into view before anyone is asked about it', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    a.setPage(CONSENT_PAGE);
    await host.snapshot();
    host.setHandoffPrompt((req) => host.resolveHandoff(req.requestId, true));

    await host.awaitHuman({ reason: 'zaakceptuj cookies' });

    const scrolled = a.sent.filter((s) => s.method === 'DOM.scrollIntoViewIfNeeded');
    expect(scrolled.some((s) => s.params?.backendNodeId === 55)).toBe(true);
  });

  it('asks anyway when there is no wall it can point at', async () => {
    // A sign-in the agent recognised from the page text, say. Nothing to scroll
    // to is not a reason to withhold the question.
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    host.setHandoffPrompt((req) => host.resolveHandoff(req.requestId, true));

    const reply = await host.awaitHuman({ reason: 'zaloguj sie' });

    expect(reply.ok).toBe(true);
    expect((reply.result as { completed: boolean }).completed).toBe(true);
  });

  it('forgets the wall once the page has moved on', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    a.setPage(CONSENT_PAGE);
    await host.snapshot();

    await host.goto('https://inna.pl');
    host.setHandoffPrompt((req) => host.resolveHandoff(req.requestId, true));
    const before = a.sent.filter((s) => s.method === 'DOM.scrollIntoViewIfNeeded').length;
    await host.awaitHuman({ reason: 'cokolwiek' });

    expect(a.sent.filter((s) => s.method === 'DOM.scrollIntoViewIfNeeded')).toHaveLength(before);
  });
});

describe('BrowserHost — asking only about what the person can see', () => {
  /**
   * `DOM.getBoxModel` answers "is this laid out", not "is this on screen": an
   * element far down the page has a perfectly good box. So a rendered wall is
   * worth reporting — a consent banner below the fold is still a real wall — but
   * before anyone is asked about it, it has to be brought into view and the
   * arrival has to be checked. Seen live: the agent asked twice about a banner
   * that was nowhere on the user's screen.
   */
  const CONSENT_PAGE = [
    { nodeId: 'a', role: { value: 'RootWebArea' }, name: { value: 'Canva' }, childIds: ['b'] },
    { nodeId: 'b', role: { value: 'button' }, name: { value: 'Zaakceptuj wszystkie pliki cookie' }, backendDOMNodeId: 55 },
  ];

  async function handoffOn(a: ReturnType<typeof fakeWc>, host: BrowserHost) {
    const asked: Array<{ reason: string; onScreen: boolean }> = [];
    host.setHandoffPrompt((req) => {
      asked.push({ reason: req.reason, onScreen: req.onScreen });
      host.resolveHandoff(req.requestId, true);
    });
    await host.awaitHuman({ reason: 'zaakceptuj cookies' });
    return asked;
  }

  it('reports a wall that is rendered but below the fold', async () => {
    // Not on screen yet is not the same as not there. The snapshot still says so.
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    a.setPage(CONSENT_PAGE);
    a.setOnScreen(false);

    const text = String(((await host.snapshot()).result as { text: string }).text);

    expect(text).toContain('### Needs you');
  });

  it('says the wall is on screen once scrolling has put it there', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    a.setPage(CONSENT_PAGE);
    await host.snapshot();

    const asked = await handoffOn(a, host);

    expect(a.sent.some((s) => s.method === 'DOM.scrollIntoViewIfNeeded' && s.params?.backendNodeId === 55)).toBe(true);
    expect(asked[0]?.onScreen).toBe(true);
  });

  it('admits it when scrolling could not bring the wall into view', async () => {
    // Fixed elements, oddly-clipped containers, a page that moved underneath.
    // Telling the person to press something invisible is worse than saying so.
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    a.setPage(CONSENT_PAGE);
    await host.snapshot();
    a.setOnScreen(false);

    const asked = await handoffOn(a, host);

    expect(asked[0]?.onScreen).toBe(false);
  });

  it('still asks when there is no wall to point at', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);

    const asked = await handoffOn(a, host);

    expect(asked).toHaveLength(1);
    expect(asked[0]?.onScreen).toBe(false);
  });
});

describe('BrowserHost — sending what moved, not the whole page again', () => {
  /**
   * A Canva task came to 2.2 million tokens, nearly all of it re-sending a page
   * that had barely changed. The agent clicks one thing and pays for the entire
   * tree: ~9,700 tokens on Canva's home page, ~25,300 on a Wikipedia article.
   *
   * Now that a uid means the same element read after read, the second and later
   * reads can carry only the difference — with a way back to the whole thing
   * when the agent has lost its bearings.
   */
  const PAGE_A = [
    { nodeId: 'a', role: { value: 'RootWebArea' }, name: { value: 'Sklep' }, childIds: ['b', 'c'] },
    { nodeId: 'b', role: { value: 'heading' }, name: { value: 'Koty' }, backendDOMNodeId: 21 },
    { nodeId: 'c', role: { value: 'link' }, name: { value: 'Stara oferta' }, backendDOMNodeId: 22 },
  ];
  const PAGE_B = [
    { nodeId: 'a', role: { value: 'RootWebArea' }, name: { value: 'Sklep' }, childIds: ['b', 'd'] },
    { nodeId: 'b', role: { value: 'heading' }, name: { value: 'Koty' }, backendDOMNodeId: 21 },
    { nodeId: 'd', role: { value: 'button' }, name: { value: 'Zamknij' }, backendDOMNodeId: 31 },
  ];

  const textOf = (r: { result?: unknown }) => String((r.result as { text: string }).text);

  it('sends the whole tree the first time it reads a page', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    a.setPage(PAGE_A);

    const text = textOf(await host.snapshot());

    expect(text).toContain('Koty');
    expect(text).toContain('Stara oferta');
    expect(text).not.toMatch(/^\+ /m);
  });

  it('sends only what moved on the reads after that', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    a.setPage(PAGE_A);
    await host.snapshot();

    a.setPage(PAGE_B);
    const text = textOf(await host.snapshot());

    expect(text).toContain('+ [4] button: "Zamknij"');
    expect(text).toContain('- [3] link: "Stara oferta"');
    // The heading did not move, so it costs nothing to say so.
    expect(text).not.toContain('Koty"');
  });

  it('keeps a uid pointing at the same element across reads', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    a.setPage(PAGE_A);
    const first = textOf(await host.snapshot());
    const headingUid = /\[(\d+)\] heading: "Koty"/.exec(first)?.[1];

    a.setPage(PAGE_B);
    await host.snapshot();
    const reply = await host.act({ action: 'click', uid: headingUid! });

    expect(reply.ok).toBe(true);
  });

  it('gives the whole tree back when asked for it', async () => {
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    a.setPage(PAGE_A);
    await host.snapshot();
    a.setPage(PAGE_B);

    const text = textOf(await host.snapshot(undefined, { full: true }));

    expect(text).toContain('Koty');
    expect(text).toContain('Zamknij');
    expect(text).not.toMatch(/^\+ /m);
  });

  it('starts again from the whole tree after a navigation', async () => {
    // The old page's elements are gone; describing the new one as a difference
    // from them would be describing it against nothing.
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    a.setPage(PAGE_A);
    await host.snapshot();

    await host.goto('https://inna.pl');
    a.setPage(PAGE_B);
    const text = textOf(await host.snapshot());

    expect(text).toContain('Zamknij');
    expect(text).not.toMatch(/^\+ /m);
  });
});

describe('BrowserHost — what the uid memory survives', () => {
  const PAGE = [
    { nodeId: 'a', role: { value: 'RootWebArea' }, name: { value: 'Sklep' }, childIds: ['b'] },
    { nodeId: 'b', role: { value: 'button' }, name: { value: 'Kup' }, backendDOMNodeId: 21 },
  ];
  const idle = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const textOf = (r: { result?: unknown }) => String((r.result as { text: string }).text);

  it('keeps the labels when the tree is handed back for being idle', async () => {
    // Measured: Accessibility.disable, detach, re-attach — 1,636 nodes kept
    // their accessibility ids and none changed. Throwing the memory away there
    // would cost a whole tree on the next read for no reason.
    const a = fakeWc(1);
    const host = new BrowserHost(() => a.wc, 30);
    host.register(1);
    a.setPage(PAGE);
    await host.snapshot();

    await idle(90);
    const text = textOf(await host.snapshot());

    // Had the memory been thrown away, this would be the whole tree again.
    expect(text).toMatch(/unchanged/i);
    expect(text).not.toContain('Kup');
  });

  it('starts over when the page itself navigated', async () => {
    // A link the person clicked. The old page's elements are gone, so there is
    // nothing to describe a difference against.
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    a.setPage(PAGE);
    await host.snapshot();

    a.setUrl('https://sklep.pl/koszyk');
    a.emit('did-navigate');
    const text = textOf(await host.snapshot());

    expect(text).toContain('Kup');
    expect(text).not.toMatch(/Changes since your last read/);
  });

  it('keeps them when the page only changed its address in place', async () => {
    // pushState and fragments keep the document, so the labels still hold.
    const a = fakeWc(1);
    const host = hostWith(a);
    host.register(1);
    a.setPage(PAGE);
    await host.snapshot();

    a.setUrl('https://sklep.pl#dol');
    a.emit('did-navigate-in-page');
    const text = textOf(await host.snapshot());

    // Same document, same labels — so an unmoved page still reads as unmoved
    // rather than being sent again from scratch.
    expect(text).toMatch(/unchanged/i);
    expect(text).not.toContain('Kup');
  });
});
