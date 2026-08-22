import { describe, expect, it } from 'vitest';
import { TabRegistry } from './tabs.js';
import type { PageHandle } from './types.js';

/**
 * The registry is what turns "the page" into "a named tab the model can
 * address". Its whole job is to make the agent's target explicit, so the two
 * failure modes it must not have are: silently retargeting a command when a
 * tab is gone, and letting the human's tab selection move the agent's target.
 */

function fakePage(url = 'about:blank'): PageHandle {
  let current = url;
  return {
    goto: async (u: string) => {
      current = u;
      return undefined;
    },
    click: async () => {},
    fill: async () => {},
    textContent: async () => null,
    content: async () => '',
    screenshot: async () => Buffer.from(''),
    evaluate: async () => undefined,
    url: () => current,
    close: async () => {},
    viewportSize: () => ({ width: 800, height: 600 }),
    setViewportSize: async () => {},
    goBack: async () => undefined,
    goForward: async () => undefined,
    reload: async () => undefined,
    mouse: { move: async () => {}, click: async () => {}, wheel: async () => {} },
    keyboard: { press: async () => {}, type: async () => {} },
  };
}

describe('TabRegistry', () => {
  it('hands out stable ids and makes the first tab active', () => {
    const tabs = new TabRegistry();
    const first = tabs.add(fakePage('https://a.pl'));

    expect(tabs.activeId).toBe(first);
    expect(tabs.list()).toHaveLength(1);
  });

  it('keeps the active tab when another one is added', () => {
    // A popup opening must not move the agent's target out from under it.
    const tabs = new TabRegistry();
    const first = tabs.add(fakePage('https://a.pl'));
    tabs.add(fakePage('https://popup.pl'));

    expect(tabs.activeId).toBe(first);
  });

  it('resolves an explicit id', () => {
    const tabs = new TabRegistry();
    tabs.add(fakePage('https://a.pl'));
    const second = tabs.add(fakePage('https://b.pl'));

    expect(tabs.get(second).page.url()).toBe('https://b.pl');
  });

  it('falls back to the active tab when no id is given', () => {
    const tabs = new TabRegistry();
    const first = tabs.add(fakePage('https://a.pl'));
    tabs.add(fakePage('https://b.pl'));

    expect(tabs.get().id).toBe(first);
  });

  it('throws a message naming the open tabs when the id is unknown', () => {
    const tabs = new TabRegistry();
    const only = tabs.add(fakePage());

    expect(() => tabs.get('t999')).toThrow(/t999/);
    expect(() => tabs.get('t999')).toThrow(new RegExp(only));
  });

  it('refuses to resolve a closed tab instead of retargeting', () => {
    const tabs = new TabRegistry();
    const first = tabs.add(fakePage('https://a.pl'));
    const second = tabs.add(fakePage('https://b.pl'));

    void tabs.close(second);

    expect(() => tabs.get(second)).toThrow();
    expect(tabs.get().id).toBe(first);
  });

  it('moves active to a surviving tab when the active one closes', () => {
    const tabs = new TabRegistry();
    const first = tabs.add(fakePage('https://a.pl'));
    const second = tabs.add(fakePage('https://b.pl'));
    tabs.select(second);

    void tabs.close(second);

    expect(tabs.activeId).toBe(first);
  });

  it('reports no active tab once every tab is closed', () => {
    const tabs = new TabRegistry();
    const only = tabs.add(fakePage());
    void tabs.close(only);

    expect(tabs.activeId).toBeNull();
    expect(() => tabs.get()).toThrow(/no open tab/i);
  });

  it('registers the same page object only once', () => {
    // `context.newPage()` both returns the page AND fires `context.on('page')`,
    // so the explicit add and the listener race to register the same document.
    // Caught by the end-to-end smoke: one new tab showed up as two.
    const tabs = new TabRegistry();
    const page = fakePage('https://a.pl');

    const first = tabs.add(page);
    const again = tabs.add(page);

    expect(again).toBe(first);
    expect(tabs.list()).toHaveLength(1);
  });

  it('forgets a page on close so it can be registered again later', () => {
    const tabs = new TabRegistry();
    const page = fakePage();
    const first = tabs.add(page);
    void tabs.close(first);

    const second = tabs.add(page);
    expect(second).not.toBe(first);
    expect(tabs.list()).toHaveLength(1);
  });

  it('never reuses an id after a close', () => {
    // A stale id from a previous turn must fail loudly, not hit a new tab.
    const tabs = new TabRegistry();
    const first = tabs.add(fakePage());
    void tabs.close(first);
    const next = tabs.add(fakePage());

    expect(next).not.toBe(first);
  });
});
