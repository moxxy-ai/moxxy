import { useEffect } from 'react';
import { api } from '@moxxy/client-core';
import type { DeepLinkPayload } from '@moxxy/desktop-ipc-contract';

/**
 * Module-level store of `moxxy://` deep-links the app has received. The main
 * process pushes one `deepLink:received` per opened link (notification click,
 * action link, OS protocol launch) and buffers any that arrive before the
 * renderer is listening; {@link DeepLinkBridge} drains the buffer on mount and
 * subscribes for live ones.
 *
 * This is transport only — it fans each `deepLink:received` payload out to
 * subscribers (with the link, not a bare ping) so feature code (workspace
 * routing, action handlers) can wire in later without re-plumbing the store. No
 * routing is wired yet, but the payload now survives delivery and the last link
 * is retained for late subscribers / a getSnapshot read.
 */
type DeepLinkListener = (link: DeepLinkPayload) => void;

class DeepLinkStore {
  private listeners = new Set<DeepLinkListener>();
  private last: DeepLinkPayload | null = null;

  subscribe = (fn: DeepLinkListener): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /** The most recently received link, or null. Lets a consumer that mounts
   *  after a link fired still observe it. */
  getLast(): DeepLinkPayload | null {
    return this.last;
  }

  push(link: DeepLinkPayload): void {
    this.last = link;
    // Snapshot listeners so a handler that unsubscribes mid-dispatch can't
    // mutate the set we're iterating.
    for (const l of [...this.listeners]) l(link);
  }
}

export const deepLinkStore = new DeepLinkStore();

/**
 * Bridge component — subscribes to live `deepLink:received` events and, on
 * mount, drains any links buffered by the main process before the renderer
 * was ready (cold-start launch). Subscribe happens BEFORE the drain so the
 * main side can safely flip to live-push the moment it answers the drain with
 * no lost-link race. Render once at the top of the tree, like
 * {@link ConnectionBridge}.
 */
export function DeepLinkBridge(): null {
  useEffect(() => {
    const unsub = api().subscribe('deepLink:received', (link) => {
      deepLinkStore.push(link);
    });
    // Drain cold-start / pre-mount links. Tolerate a missing preload (tests).
    void api()
      .invoke('deepLink:drain')
      .then((links) => {
        for (const link of links) deepLinkStore.push(link);
      })
      .catch(() => {
        /* preload missing */
      });
    return () => {
      unsub();
    };
  }, []);

  return null;
}
