import { describe, expect, it } from 'vitest';

import { NativeBrowserState } from './native-browser-state.js';

function ids(): () => string {
  let next = 0;
  return () => `tab-${++next}`;
}

describe('NativeBrowserState', () => {
  it('keeps tabs and active selection isolated per workspace', () => {
    const state = new NativeBrowserState(ids());

    const alpha = state.ensureWorkspace('alpha');
    const beta = state.ensureWorkspace('beta');
    const alphaSecond = state.newTab('alpha', 'https://example.com');

    state.selectTab('alpha', alphaSecond.id);

    expect(state.snapshot('alpha')).toMatchObject({
      activeTabId: alphaSecond.id,
      tabs: [
        { id: alpha.tabs[0]?.id, url: 'about:blank' },
        { id: alphaSecond.id, url: 'https://example.com' },
      ],
    });
    expect(state.snapshot('beta')).toMatchObject({
      activeTabId: beta.activeTabId,
      tabs: [{ id: beta.tabs[0]?.id, url: 'about:blank' }],
    });
  });

  it('captures the target tab when an operation starts', () => {
    const state = new NativeBrowserState(ids());
    const first = state.ensureWorkspace('workspace').tabs[0];
    expect(first).toBeDefined();
    const second = state.newTab('workspace', 'https://example.com');

    state.selectTab('workspace', first?.id ?? 'missing');
    const target = state.resolveOperationTarget('workspace');
    state.selectTab('workspace', second.id);

    expect(target.id).toBe(first?.id);
    expect(state.snapshot('workspace').activeTabId).toBe(second.id);
  });

  it('closes a selected tab and keeps a blank tab when the last tab closes', () => {
    const state = new NativeBrowserState(ids());
    const first = state.ensureWorkspace('workspace').tabs[0];
    expect(first).toBeDefined();
    const second = state.newTab('workspace', 'https://example.com');

    state.selectTab('workspace', second.id);
    state.closeTab('workspace', second.id);
    expect(state.snapshot('workspace').activeTabId).toBe(first?.id);

    state.closeTab('workspace', first?.id ?? 'missing');
    const snapshot = state.snapshot('workspace');
    expect(snapshot.tabs).toHaveLength(1);
    expect(snapshot.tabs[0]?.url).toBe('about:blank');
    expect(snapshot.activeTabId).toBe(snapshot.tabs[0]?.id);
  });

  it('restores persisted ordering and rejects an unknown active tab', () => {
    const state = new NativeBrowserState(ids());

    state.restore([
      {
        workspaceId: 'workspace',
        activeTabId: 'missing',
        tabs: [
          { id: 'one', url: 'https://one.example' },
          { id: 'two', url: 'https://two.example' },
        ],
      },
    ]);

    expect(state.snapshot('workspace')).toMatchObject({
      activeTabId: 'one',
      tabs: [
        { id: 'one', url: 'https://one.example' },
        { id: 'two', url: 'https://two.example' },
      ],
    });
  });

  it('caps a workspace at the persisted tab limit instead of creating unsavable state', () => {
    const state = new NativeBrowserState(ids());
    state.ensureWorkspace('ws-1');
    for (let index = 1; index < 64; index += 1) state.newTab('ws-1');

    expect(state.snapshot('ws-1').tabs).toHaveLength(64);
    expect(() => state.newTab('ws-1')).toThrow('maximum of 64');
    expect(state.snapshot('ws-1').tabs).toHaveLength(64);
  });
});
