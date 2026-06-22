/**
 * Process-wide fan-out for main→renderer events beyond the direct SessionDriver
 * window delivery path.
 *
 * Runner/session events keep their existing, battle-tested delivery path
 * (`SessionDriver`'s window set, `bindWindow`, `sendEvent`) untouched. Host-level
 * events that are not emitted by a runner (for example `desks.changed` from an IPC
 * mutation) use {@link broadcastHostEvent}, so Electron windows and remote WS
 * clients observe the same state changes in realtime.
 *
 * Keeping this as a small additive bus avoids routing the old runner stream
 * through a new path while still letting mobile-originated host mutations refresh
 * the desktop renderer immediately.
 */

import type { IpcEvents } from '@moxxy/desktop-ipc-contract';
import type { EventSink } from '@moxxy/desktop-ipc-contract/bus';

/** An {@link EventSink} that forwards every broadcast to a set of child sinks. */
export class EventBus implements EventSink {
  private readonly sinks = new Set<EventSink>();

  /** Register a sink; returns an unregister fn. */
  addSink(sink: EventSink): () => void {
    this.sinks.add(sink);
    return () => {
      this.sinks.delete(sink);
    };
  }

  broadcast<K extends keyof IpcEvents>(channel: K, payload: IpcEvents[K]): void {
    for (const sink of this.sinks) {
      try {
        sink.broadcast(channel, payload);
      } catch {
        // A misbehaving sink (e.g. a dropped WS connection mid-send) must not
        // break the others or the Electron path that already delivered.
      }
    }
  }
}

/**
 * Electron windows registered by `bindWindow`. This is only for host-level events
 * that are not already sent by a `SessionDriver`.
 */
export const desktopEventBus = new EventBus();

/**
 * The WebSocket bridge registers its `WebSocketCommandBus` as a sink at startup;
 * with no bridge running this has zero sinks and `broadcast` is free.
 */
export const wsEventBus = new EventBus();

/** Broadcast a host-level event to every local and remote surface. */
export function broadcastHostEvent<K extends keyof IpcEvents>(
  channel: K,
  payload: IpcEvents[K],
): void {
  desktopEventBus.broadcast(channel, payload);
  wsEventBus.broadcast(channel, payload);
}
