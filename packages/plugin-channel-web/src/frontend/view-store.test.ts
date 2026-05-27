import { describe, expect, it } from 'vitest';
import type { ViewDoc } from '@moxxy/sdk';
import { applyView, canGoBack, currentEntry, goBack, initialNav, navigateTo } from './view-store.js';

const doc = (tag = 'view'): ViewDoc => ({ root: { kind: 'element', tag, props: {}, children: [] } });
const frame = (viewId: string, name?: string): { viewId: string; name?: string; doc: ViewDoc } => ({
  viewId,
  ...(name ? { name } : {}),
  doc: doc(),
});

describe('view-store', () => {
  it('caches a view and makes it current', () => {
    const s = applyView(initialNav, frame('v1', 'search'));
    expect(currentEntry(s)?.key).toBe('search');
    expect(currentEntry(s)?.viewId).toBe('v1');
    expect(canGoBack(s)).toBe(false);
  });

  it('pushes distinct screens onto history; Back pops them', () => {
    let s = applyView(initialNav, frame('v1', 'search'));
    s = applyView(s, frame('v2', 'results'));
    expect(currentEntry(s)?.key).toBe('results');
    expect(canGoBack(s)).toBe(true);
    s = goBack(s);
    expect(currentEntry(s)?.key).toBe('search');
    expect(canGoBack(s)).toBe(false);
    // goBack at the root is a no-op.
    expect(goBack(s)).toBe(s);
  });

  it('re-rendering the current screen updates in place without growing history', () => {
    let s = applyView(initialNav, frame('v1', 'results'));
    const depth = s.history.length;
    s = applyView(s, frame('v2', 'results')); // same name → update in place
    expect(s.history.length).toBe(depth);
    expect(currentEntry(s)?.viewId).toBe('v2'); // latest doc/viewId wins
  });

  it('keys by viewId when a view has no name', () => {
    let s = applyView(initialNav, frame('v1'));
    s = applyView(s, frame('v2'));
    expect(s.history).toEqual(['v1', 'v2']);
  });

  it('navigateTo a cached view switches client-side; uncached returns null', () => {
    let s = applyView(initialNav, frame('v1', 'search'));
    s = applyView(s, frame('v2', 'results'));
    const back = navigateTo(s, 'search');
    expect(back).not.toBeNull();
    expect(currentEntry(back!)?.key).toBe('search');
    expect(navigateTo(s, 'detail')).toBeNull(); // not cached → caller asks the agent
  });

  it('navigateTo the current screen is a no-op (no duplicate history entry)', () => {
    const s = applyView(initialNav, frame('v1', 'search'));
    expect(navigateTo(s, 'search')).toBe(s);
  });
});
