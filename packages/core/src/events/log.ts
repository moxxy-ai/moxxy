import type {
  EmittedEvent,
  EventLogReader,
  MoxxyEvent,
  MoxxyEventOfType,
  MoxxyEventType,
  TurnId,
} from '@moxxy/sdk';
import { materializeEvent } from './factory.js';

export type EventListener = (event: MoxxyEvent) => void | Promise<void>;

export class EventLog implements EventLogReader {
  private readonly events: MoxxyEvent[] = [];
  private readonly listeners = new Set<EventListener>();
  private readonly now: () => number;

  constructor(seed: ReadonlyArray<MoxxyEvent> = [], opts: { now?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
    for (const e of seed) this.events.push(e);
  }

  get length(): number {
    return this.events.length;
  }

  at(seq: number): MoxxyEvent | undefined {
    if (seq < 0 || seq >= this.events.length) return undefined;
    return this.events[seq];
  }

  slice(from = 0, to: number = this.events.length): ReadonlyArray<MoxxyEvent> {
    return this.events.slice(from, to);
  }

  ofType<T extends MoxxyEventType>(type: T): ReadonlyArray<MoxxyEventOfType<T>> {
    return this.events.filter((e): e is MoxxyEventOfType<T> => e.type === type);
  }

  byTurn(turnId: TurnId): ReadonlyArray<MoxxyEvent> {
    return this.events.filter((e) => e.turnId === turnId);
  }

  toJSON(): ReadonlyArray<MoxxyEvent> {
    return [...this.events];
  }

  async append(partial: EmittedEvent): Promise<MoxxyEvent> {
    const event = materializeEvent(partial, this.events.length, this.now);
    this.events.push(event);
    // Snapshot listeners so a subscribe/unsubscribe during dispatch (e.g.,
    // a runTurn finishing and unsubscribing while we're still mid-fanout)
    // doesn't change the iteration target.
    const snapshot = [...this.listeners];
    for (const fn of snapshot) {
      try {
        await fn(event);
      } catch {
        // Listeners must not block the log; failures are non-fatal here. Hook
        // failures are recorded as ErrorEvents by the dispatcher above this.
      }
    }
    return event;
  }

  subscribe(fn: EventListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  asReader(): EventLogReader {
    return this;
  }
}
