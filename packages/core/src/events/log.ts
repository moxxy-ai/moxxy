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
  private readonly clearListeners = new Set<() => void>();
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

  /**
   * Append an already-materialized event, preserving its `id`/`seq`/`ts`
   * rather than minting new ones. This is how a thin client mirrors the
   * runner's log: the server is the sole authority for event identity, so the
   * mirror must keep the originals. De-dupes by `seq` (idempotent replay) and
   * fires listeners fire-and-forget - a mirror has no dispatcher to await.
   *
   * Not for normal authoring; use {@link append} for that.
   */
  ingest(event: MoxxyEvent): void {
    // Contiguous, ordered delivery over a single socket means seq === index.
    // Accept ONLY the next-expected seq: this drops duplicates (overlap
    // between attach-replay and the live stream, seq < length) AND refuses a
    // gap (seq > length) rather than pushing it at the wrong index, which
    // would permanently desync `seq` from the array index. A gap can't happen
    // over the reliable in-order transport, so refusing one is fail-safe.
    if (event.seq !== this.events.length) return;
    this.events.push(event);
    const snapshot = [...this.listeners];
    for (const fn of snapshot) {
      try {
        void fn(event);
      } catch {
        // Mirror listeners must not break ingestion.
      }
    }
  }

  /**
   * Drop every event from the log. Used by `/new` to start a fresh
   * session without rebuilding the entire Session object — the
   * registries, resolvers, and active provider stay; only the
   * conversation context vanishes. Per-event listeners are NOT
   * notified (there's no "event removed" event in the schema), but
   * {@link onClear} subscribers fire — that's how the persistence
   * sidecar truncates its JSONL (so `--resume` can't resurrect wiped
   * history) and how the runner broadcasts a reset to attached
   * mirrors, in lockstep with the wipe.
   *
   * Safe to call only when no turn is in flight — callers should abort
   * their AbortController and await any pending runTurn() first.
   */
  clear(): void {
    this.events.length = 0;
    const snapshot = [...this.clearListeners];
    for (const fn of snapshot) {
      try {
        fn();
      } catch {
        // A clear listener must not block the wipe.
      }
    }
  }

  /**
   * Subscribe to {@link clear}. Fires synchronously after the events array
   * empties, so a listener reading the log observes the post-wipe state.
   * Returns the unsubscribe callback.
   */
  onClear(fn: () => void): () => void {
    this.clearListeners.add(fn);
    return () => this.clearListeners.delete(fn);
  }

  asReader(): EventLogReader {
    return this;
  }
}
