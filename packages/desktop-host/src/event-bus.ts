/**
 * Process-wide fan-out for main→renderer events beyond the direct SessionDriver
 * window delivery path.
 *
 * Runner/session events keep their existing, battle-tested delivery path
 * (`SessionDriver`'s window set, `bindWindow`, `sendEvent`) untouched. Host-level
 * events that are not emitted by a runner (for example `desks.changed` from an IPC
 * mutation) use {@link broadcastHostEvent}, so every Electron window observes the
 * same state changes in realtime.
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
        // A misbehaving sink (e.g. a window closed mid-send) must not break
        // the others.
      }
    }
  }
}

/**
 * Electron windows registered by `bindWindow`. This is only for host-level events
 * that are not already sent by a `SessionDriver`.
 */
export const desktopEventBus = new EventBus();

/** Broadcast a host-level event to every desktop window. */
export function broadcastHostEvent<K extends keyof IpcEvents>(
  channel: K,
  payload: IpcEvents[K],
): void {
  desktopEventBus.broadcast(channel, payload);
}
