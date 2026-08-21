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
  let current = url;
  let attached = false;
  let reloads = 0;
  const back: string[] = [];
  const forward: string[] = [];
  const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
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
        if (method === 'Accessibility.getFullAXTree') return { nodes: AX_NODES };
        if (method === 'DOM.getBoxModel') return { model: { content: [0, 0, 80, 0, 80, 40, 0, 40] } };
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
        if (method === 'DOM.querySelector') {
          // Only `#kup` and `#q` exist on this page.
          const sel = String((params as { selector?: string })?.selector ?? '');
          return { nodeId: sel === '#kup' || sel === '#q' ? 2 : 0 };
        }
        if (method === 'DOM.describeNode') return { node: { backendNodeId: 21 } };
        if (method === 'DOM.resolveNode') return { object: { objectId: 'obj-1' } };
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
    emit: (event: string) => {
      for (const fn of [...(listeners.get(event) ?? [])]) fn();
    },
    listenerCount: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
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
      { tabId: 't1', url: 'https://a.pl', title: 'A', active: true },
      { tabId: 't2', url: 'https://b.pl', title: 'B', active: false },
    ]);
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
    expect(a.sent.map((s) => s.method)).toEqual(['Accessibility.enable', 'Accessibility.getFullAXTree']);
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
