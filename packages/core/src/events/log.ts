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

/**
 * Per-listener watchdog for {@link EventLog.append}'s sequential fan-out. A
 * listener that never resolves (e.g. a persistence sidecar blocked on a stuck fs
 * handle) would otherwise block `append`'s promise forever and wedge the
 * appending turn. We bound each awaited listener: if it hasn't settled within
 * this window we log and continue rather than hang. Well-behaved listeners (the
 * common case) settle far inside it, so timing is unchanged for them.
 */
const LISTENER_TIMEOUT_MS = 30_000;

export class EventLog implements EventLogReader {
  private readonly events: MoxxyEvent[] = [];
  private readonly listeners = new Set<EventListener>();
  private readonly clearListeners = new Set<() => void>();
  private readonly now: () => number;
  /**
   * Lazy secondary indexes so `ofType`/`byTurn` are O(matches) instead of an
   * O(n) full-array `filter` per call (these back hot paths: token-accounting's
   * `ofType('provider_response')`, lazy-tool gating's
   * `ofType('tool_call_requested')`, and remote-session's per-turn
   * `byTurn(turnId)` priming). Built lazily on first query so a cold/seeded log
   * pays the one-time O(n) build only if anything ever queries it, then kept
   * O(1) per append/ingest. Reset to `null` (rebuild-on-next-query) by
   * `clear`/`rebase`, which mutate `events` wholesale.
   *
   * Each index holds the SAME event object references in their original
   * append order — so a query returns an array deep-equal to the old
   * `events.filter(...)` for every input.
   */
  private byType: Map<MoxxyEventType, MoxxyEvent[]> | null = null;
  private byTurnId: Map<TurnId, MoxxyEvent[]> | null = null;
  /**
   * Seq of the FIRST event this log holds. 0 for an authoring log; a mirror
   * primed by a partial attach replay (runner protocol v6 `replay.start`)
   * rebases to the first replayed seq so `ingest`'s contiguity gate lines up
   * with the runner's stream instead of expecting history we never received.
   * `seq === base + index` for every held event.
   */
  private base = 0;

  constructor(seed: ReadonlyArray<MoxxyEvent> = [], opts: { now?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
    for (const e of seed) this.events.push(e);
    // Align `base` to the first seeded event so `seq === base + index` holds
    // regardless of where the seed starts. Today every caller seeds a log
    // re-sequenced to 0..n-1 (so this is a no-op), but a caller seeding a tail
    // slice (e.g. seq 50..) would otherwise get silently wrong at()/slice()
    // seq-addressing and an off-by-`base` ingest() contiguity gate.
    if (seed.length > 0) this.base = seed[0]!.seq;
  }

  get length(): number {
    return this.events.length;
  }

  /** Seq of the first held event (see {@link rebase}). */
  get baseSeq(): number {
    return this.base;
  }

  at(seq: number): MoxxyEvent | undefined {
    const index = seq - this.base;
    if (index < 0 || index >= this.events.length) return undefined;
    return this.events[index];
  }

  slice(from = 0, to: number = this.base + this.events.length): ReadonlyArray<MoxxyEvent> {
    // Seq-addressed, like `at`. Events below the base were never held, so a
    // `from` before it just clamps to everything we have.
    return this.events.slice(Math.max(0, from - this.base), Math.max(0, to - this.base));
  }

  /** Build both secondary indexes from the current `events` array, preserving
   * append order. Bucket arrays hold the original event references. */
  private buildIndexes(): void {
    const byType = new Map<MoxxyEventType, MoxxyEvent[]>();
    const byTurnId = new Map<TurnId, MoxxyEvent[]>();
    for (const e of this.events) {
      let typeBucket = byType.get(e.type);
      if (!typeBucket) byType.set(e.type, (typeBucket = []));
      typeBucket.push(e);
      let turnBucket = byTurnId.get(e.turnId);
      if (!turnBucket) byTurnId.set(e.turnId, (turnBucket = []));
      turnBucket.push(e);
    }
    this.byType = byType;
    this.byTurnId = byTurnId;
  }

  /** Append one event to the live indexes (no-op while they're cold). Called
   * after the event is pushed to `events`, so order is preserved. */
  private indexEvent(e: MoxxyEvent): void {
    if (this.byType) {
      const bucket = this.byType.get(e.type);
      if (bucket) bucket.push(e);
      else this.byType.set(e.type, [e]);
    }
    if (this.byTurnId) {
      const bucket = this.byTurnId.get(e.turnId);
      if (bucket) bucket.push(e);
      else this.byTurnId.set(e.turnId, [e]);
    }
  }

  ofType<T extends MoxxyEventType>(type: T): ReadonlyArray<MoxxyEventOfType<T>> {
    if (!this.byType) this.buildIndexes();
    // The bucket already holds exactly the matching events in append order —
    // identical to the old `events.filter(e => e.type === type)`. Return a copy
    // so callers can't mutate the index (filter() also returned a fresh array).
    const bucket = this.byType!.get(type);
    // Bucket holds only events whose `type === T`, so the cast is sound; route
    // through `unknown` because TS can't narrow the heterogeneous union here.
    return (bucket ? [...bucket] : []) as unknown as ReadonlyArray<MoxxyEventOfType<T>>;
  }

  byTurn(turnId: TurnId): ReadonlyArray<MoxxyEvent> {
    if (!this.byTurnId) this.buildIndexes();
    const bucket = this.byTurnId!.get(turnId);
    return bucket ? [...bucket] : [];
  }

  toJSON(): ReadonlyArray<MoxxyEvent> {
    return [...this.events];
  }

  async append(partial: EmittedEvent): Promise<MoxxyEvent> {
    const event = materializeEvent(partial, this.base + this.events.length, this.now);
    this.events.push(event);
    this.indexEvent(event);
    // Snapshot listeners so a subscribe/unsubscribe during dispatch (e.g.,
    // a runTurn finishing and unsubscribing while we're still mid-fanout)
    // doesn't change the iteration target.
    const snapshot = [...this.listeners];
    for (const fn of snapshot) {
      try {
        await callListenerBounded(fn, event);
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
    // Contiguous, ordered delivery over a single socket means
    // seq === base + index. Accept ONLY the next-expected seq: this drops
    // duplicates (overlap between attach-replay and the live stream,
    // seq < base + length) AND refuses a gap (seq > base + length) rather than
    // pushing it at the wrong index, which would permanently desync `seq` from
    // the array index. A gap can't happen over the reliable in-order
    // transport, so refusing one is fail-safe.
    if (event.seq !== this.base + this.events.length) return;
    this.events.push(event);
    this.indexEvent(event);
    const snapshot = [...this.listeners];
    for (const fn of snapshot) {
      try {
        // Fire-and-forget, but attach a rejection handler: an async listener
        // that rejects must be swallowed the same way append()'s awaited
        // try/catch swallows it — otherwise it surfaces as an unhandled
        // rejection and (under Node's default policy) can kill the process.
        void Promise.resolve(fn(event)).catch(() => {
          // Mirror listeners must not break ingestion.
        });
      } catch {
        // Mirror listeners must not break ingestion (synchronous throw).
      }
    }
  }

  /**
   * Start this (empty) log at `seq` instead of 0. A mirror primed by a
   * PARTIAL attach replay (`replay: 'none'` / `{ tail }`) calls this with the
   * runner's announced first seq so {@link ingest}'s contiguity gate accepts
   * the stream. Only valid while empty — rebasing held events would detach
   * their seqs from their indices.
   */
  rebase(seq: number): void {
    if (this.events.length > 0) {
      throw new Error(`EventLog.rebase(${seq}): log already holds ${this.events.length} events`);
    }
    if (!Number.isInteger(seq) || seq < 0) {
      throw new Error(`EventLog.rebase(${seq}): seq must be a non-negative integer`);
    }
    this.base = seq;
    // Rebase only runs on an empty log, so the indexes (if warm) are already
    // empty — but null them to stay defensive about the events-array invariant.
    this.byType = null;
    this.byTurnId = null;
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
    // The secondary indexes mirror `events`; drop them so the next query
    // rebuilds from the now-empty array (cheap) rather than serving stale
    // buckets.
    this.byType = null;
    this.byTurnId = null;
    // A session reset restarts the authoritative stream at seq 0 — a rebased
    // mirror must follow, or it would wait forever for seqs that never come.
    this.base = 0;
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

/**
 * Await a listener but give up after {@link LISTENER_TIMEOUT_MS} so a hung
 * listener can't block the appending turn indefinitely. A synchronous (void)
 * listener resolves immediately and the timer is cleared before it can fire, so
 * fast listeners pay nothing. The timer is `unref`'d so it never keeps the
 * process alive on its own.
 */
async function callListenerBounded(fn: EventListener, event: MoxxyEvent): Promise<void> {
  const result = fn(event);
  if (!(result instanceof Promise)) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      process.stderr.write(
        `moxxy: event-log listener exceeded ${LISTENER_TIMEOUT_MS}ms on ${event.type} ` +
          `(seq ${event.seq}); continuing without it\n`,
      );
      resolve();
    }, LISTENER_TIMEOUT_MS);
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    await Promise.race([result, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
