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

  it('bounds the cache: an unbounded stream of unnamed views does not grow forever', () => {
    // Worst case: a long session presents 500 distinct UNNAMED views (each a new
    // viewId, never coalesced). The browser must not leak one ViewDoc per render.
    let s = initialNav;
    for (let i = 0; i < 500; i++) s = applyView(s, frame(`v${i}`));
    expect(Object.keys(s.cache).length).toBeLessThanOrEqual(64);
    expect(s.order.length).toBeLessThanOrEqual(64);
    // The current (newest) view is always still present and navigable.
    expect(currentEntry(s)?.viewId).toBe('v499');
  });

  it('bounds history under pressure yet every Back target stays in cache (no dangling)', () => {
    // Flood with unnamed views (each pushes a fresh history frame). History is
    // FIFO-trimmed, but the INVARIANT must hold: every key still on the history
    // stack has a live cache entry, so Back can never dereference a missing doc.
    let s = initialNav;
    for (let i = 0; i < 500; i++) s = applyView(s, frame(`x${i}`));
    expect(s.history.length).toBeLessThanOrEqual(50);
    let back = s;
    while (canGoBack(back)) {
      back = goBack(back);
      expect(currentEntry(back)).not.toBeNull(); // never a dangling history key
    }
  });

  it('preserves recent Back targets — a screen visited just before the flood is still reachable', () => {
    // 'recent' is pushed, then a modest run of unnamed views within the history
    // cap: it must remain on the stack AND in cache (recency is what's retained).
    let s = applyView(initialNav, frame('r', 'recent'));
    for (let i = 0; i < 10; i++) s = applyView(s, frame(`y${i}`));
    expect(s.cache['recent']).toBeDefined();
    let back = s;
    while (canGoBack(back)) back = goBack(back);
    expect(currentEntry(back)?.key).toBe('recent');
  });

  it('keeps the cache map and order array consistent after eviction', () => {
    let s = initialNav;
    for (let i = 0; i < 200; i++) s = applyView(s, frame(`v${i}`));
    // order and cache must be the SAME key set (no dangling refs either way).
    expect(new Set(s.order)).toEqual(new Set(Object.keys(s.cache)));
    // and every history key must be cached (Back integrity).
    for (const key of s.history) expect(s.cache[key]).toBeDefined();
  });
});
