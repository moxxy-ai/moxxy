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
 * This is transport only — it fans `deepLink:received` out to subscribers so
 * feature code (workspace routing, action handlers) can wire in later. No
 * routing is wired yet.
 */
class DeepLinkStore {
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  push(_link: DeepLinkPayload): void {
    for (const l of this.listeners) l();
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
