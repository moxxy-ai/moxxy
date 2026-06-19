import { afterEach, describe, expect, it, vi } from 'vitest';
import { asSessionId } from '@moxxy/sdk';
import type { SessionRuntime } from '../session-runtime.js';
import {
  claimRetainedChild,
  clearRetainedChildren,
  getRetainedChild,
  registerRetainedChild,
  releaseRetainedChild,
  unclaimRetainedChild,
  type RetainedChildSession,
} from './registry.js';

// Minimal retained entry — the registry only reads childSessionId, parentSession.id,
// and retainedAt; the rest can be cast through `unknown`.
function makeEntry(id: string, parentId = 'parent'): RetainedChildSession {
  return {
    childSessionId: asSessionId(id),
    parentSession: { id: asSessionId(parentId) } as unknown as SessionRuntime,
  } as unknown as RetainedChildSession;
}

afterEach(() => {
  clearRetainedChildren();
  vi.useRealTimers();
});

describe('retained-child registry hardening', () => {
  it('claim removes the entry and marks it busy so a racing claim cannot double-drive it', () => {
    const id = asSessionId('c1');
    registerRetainedChild(makeEntry('c1'));

    const first = claimRetainedChild(id);
    expect(first).toBeDefined();
    // Entry is gone from the registry the instant it is claimed.
    expect(getRetainedChild(id)).toBeUndefined();
    // A racing claim for the same id finds nothing (and is also blocked by busy).
    expect(claimRetainedChild(id)).toBeUndefined();

    unclaimRetainedChild(id);
    expect(claimRetainedChild(id)).toBeUndefined(); // still gone from registry
  });

  it('release while a claim is in flight drops the busy marker without resurrecting the entry', () => {
    const id = asSessionId('c2');
    registerRetainedChild(makeEntry('c2'));
    expect(claimRetainedChild(id)).toBeDefined();
    releaseRetainedChild(id); // racing release()
    // Re-registering then claiming works again (busy was cleared).
    registerRetainedChild(makeEntry('c2'));
    expect(claimRetainedChild(id)).toBeDefined();
  });

  it('caps the number of retained children, evicting the oldest', () => {
    for (let i = 0; i < 100; i++) registerRetainedChild(makeEntry(`k${i}`));
    // The earliest entries must have been evicted; the latest survive.
    expect(getRetainedChild(asSessionId('k0'))).toBeUndefined();
    expect(getRetainedChild(asSessionId('k99'))).toBeDefined();
    // Bounded: never more than the cap.
    let live = 0;
    for (let i = 0; i < 100; i++) if (getRetainedChild(asSessionId(`k${i}`))) live++;
    expect(live).toBeLessThanOrEqual(64);
  });

  it('evicts a stale paused child after the TTL on the next register', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    registerRetainedChild(makeEntry('stale'));
    expect(getRetainedChild(asSessionId('stale'))).toBeDefined();

    // Advance past the 30-minute TTL, then register a fresh child — that
    // triggers pruning of the expired one.
    vi.setSystemTime(31 * 60 * 1000);
    registerRetainedChild(makeEntry('fresh'));
    expect(getRetainedChild(asSessionId('stale'))).toBeUndefined();
    expect(getRetainedChild(asSessionId('fresh'))).toBeDefined();
  });

  it('clearRetainedChildren scopes to the owning session', () => {
    registerRetainedChild(makeEntry('a1', 'sessA'));
    registerRetainedChild(makeEntry('b1', 'sessB'));
    clearRetainedChildren(asSessionId('sessA'));
    expect(getRetainedChild(asSessionId('a1'))).toBeUndefined();
    expect(getRetainedChild(asSessionId('b1'))).toBeDefined();
  });
});
