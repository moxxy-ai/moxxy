/**
 * Process-wide fan-out for main→renderer events to NON-Electron transports.
 *
 * The Electron windows keep their existing, battle-tested delivery path
 * (`SessionDriver`'s window set, `bindWindow`, `sendEvent`) untouched — this bus
 * is purely *additive*: every event emit also calls {@link wsEventBus}`.broadcast`,
 * which fans the event to whatever extra sinks are registered (today: the
 * WebSocket bridge). When no WS bridge is running the sink set is empty and
 * `broadcast` is a no-op, so the desktop pays nothing.
 *
 * Keeping the Electron path and the WS path separate (rather than routing
 * windows through this bus too) is a deliberate conservatism: it guarantees the
 * desktop's event delivery is byte-for-byte what it was before the WS work.
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
 * The singleton every host emit site mirrors to. The WebSocket bridge registers
 * its `WebSocketCommandBus` as a sink at startup; with no bridge running this
 * has zero sinks and `broadcast` is free.
 */
export const wsEventBus = new EventBus();
