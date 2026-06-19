/**
 * Regression tests for the deep-link store. The store used to discard the
 * payload and fire a bare notification — every link collapsed to "something
 * arrived". It must now deliver the actual link to subscribers, retain the last
 * one for late mounters, and survive a subscriber that unsubscribes mid-dispatch.
 */
import { describe, expect, it, vi } from 'vitest';
import { deepLinkStore } from './useDeepLink';
import type { DeepLinkPayload } from '@moxxy/desktop-ipc-contract';

const link = (over: Partial<DeepLinkPayload> = {}): DeepLinkPayload =>
  ({ url: 'moxxy://action/x', ...over }) as DeepLinkPayload;

describe('deepLinkStore', () => {
  it('delivers the payload (not a bare ping) to subscribers', () => {
    const seen: DeepLinkPayload[] = [];
    const unsub = deepLinkStore.subscribe((l) => seen.push(l));
    const a = link({ url: 'moxxy://a' });
    deepLinkStore.push(a);
    unsub();
    expect(seen).toEqual([a]);
  });

  it('retains the last link for a consumer that mounts after it fired', () => {
    const a = link({ url: 'moxxy://late' });
    deepLinkStore.push(a);
    expect(deepLinkStore.getLast()).toEqual(a);
  });

  it('does not throw when a subscriber unsubscribes during dispatch', () => {
    const unsubFns: Array<() => void> = [];
    const first = vi.fn(() => {
      // Tear down both listeners while we're iterating.
      for (const u of unsubFns) u();
    });
    const second = vi.fn();
    unsubFns.push(deepLinkStore.subscribe(first));
    unsubFns.push(deepLinkStore.subscribe(second));
    expect(() => deepLinkStore.push(link())).not.toThrow();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
