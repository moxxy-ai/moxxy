import type { MoxxyEvent, RunTurnOptions, TurnId } from '@moxxy/sdk';

/**
 * Turn machinery shared by messaging channels that multiplex onto ONE shared
 * Session (AGENTS.md invariant #8: filter event-log subscribers by turnId —
 * `session.log` fans out to every listener, so concurrent turns on the same
 * Session cross-contaminate without it).
 *
 * Pieces are deliberately composable rather than one monolithic runner so each
 * channel keeps its exact flush / typing / unwind ordering:
 *   - {@link TurnCoordinator} — single-flight `busy` guard, per-turn
 *     AbortController, bounded own-turn-id tracking, foreign-turn mirror gate.
 *   - {@link subscribeTurn} — turnId-filtered `session.log.subscribe`.
 *   - {@link driveTurn} — drain `session.runTurn` for a pre-minted turnId.
 */

/** The slice of a session a channel turn needs: the live event log. */
export interface TurnEventSource {
  readonly log: {
    subscribe(fn: (event: MoxxyEvent) => void | Promise<void>): () => void;
  };
}

/** The slice of a session `driveTurn` needs. `ClientSession` satisfies it. */
export interface TurnSession extends TurnEventSource {
  runTurn(prompt: string, opts?: RunTurnOptions): AsyncIterable<MoxxyEvent>;
}

/**
 * Subscribe to ONLY the given turn's events. Returns the unsubscribe function.
 * The caller controls unsubscribe placement (channels keep their final flush
 * inside the subscription window so trailing events still feed the renderer).
 */
export function subscribeTurn(
  source: TurnEventSource,
  turnId: TurnId,
  onEvent: (event: MoxxyEvent) => void,
): () => void {
  return source.log.subscribe((event) => {
    if (event.turnId !== turnId) return;
    onEvent(event);
  });
}

export interface DriveTurnOptions {
  readonly turnId: TurnId;
  readonly prompt: string;
  readonly model?: string | undefined;
  readonly signal: AbortSignal;
}

/**
 * Run one turn to completion, draining the `runTurn` iterator. Rendering is
 * expected to happen via a {@link subscribeTurn} subscription, not the yielded
 * events (which are identical); errors propagate to the caller.
 */
export async function driveTurn(session: TurnSession, opts: DriveTurnOptions): Promise<void> {
  for await (const _event of session.runTurn(opts.prompt, {
    turnId: opts.turnId,
    ...(opts.model ? { model: opts.model } : {}),
    signal: opts.signal,
  })) {
    void _event;
  }
}

/** A granted turn slot. Call `end()` in a `finally` to release single-flight. */
export interface TurnLease {
  readonly turnId: TurnId;
  /** Per-turn controller so a /cancel or channel stop aborts ONLY this turn
   *  without poisoning the session-level signal other channels share. */
  readonly controller: AbortController;
  end(): void;
}

export interface TurnCoordinatorOptions {
  /**
   * Bound on remembered own-turn ids so a long-lived channel can't leak; a
   * handful of recent ids is enough to dedup late/replayed events. Default 64.
   */
  readonly maxOwnTurnIds?: number;
}

/**
 * Single-flight turn state for a channel: one turn at a time, a per-turn
 * AbortController, and a bounded set of turnIds THIS channel initiated.
 *
 * The own-turn-id set is what {@link mirrorText} filters on (invariant #8)
 * rather than the coarse `busy` flag alone — so an `assistant_message`
 * dispatched for our own turn AFTER `busy` flips false (async event ordering /
 * RemoteSession replay) isn't re-mirrored as foreign.
 */
export class TurnCoordinator {
  private busyFlag = false;
  private active: AbortController | null = null;
  private readonly ownTurnIds = new Set<string>();
  private readonly maxOwnTurnIds: number;

  constructor(opts: TurnCoordinatorOptions = {}) {
    this.maxOwnTurnIds = opts.maxOwnTurnIds ?? 64;
  }

  get busy(): boolean {
    return this.busyFlag;
  }

  /** The in-flight turn's controller (null when idle) — for /cancel handlers. */
  get controller(): AbortController | null {
    return this.active;
  }

  /**
   * Atomically claim the single turn slot. Synchronous on purpose: set `busy`
   * BEFORE any await so a concurrently dispatched second turn can't slip past
   * the guard. Returns null when a turn is already running (the channel replies
   * "still working"); otherwise a lease whose `end()` releases the slot.
   */
  begin(turnId: TurnId): TurnLease | null {
    if (this.busyFlag) return null;
    this.busyFlag = true;
    const controller = new AbortController();
    this.active = controller;
    this.ownTurnIds.add(turnId);
    if (this.ownTurnIds.size > this.maxOwnTurnIds) {
      const oldest = this.ownTurnIds.values().next().value;
      if (oldest !== undefined) this.ownTurnIds.delete(oldest);
    }
    return {
      turnId,
      controller,
      end: () => {
        this.busyFlag = false;
        if (this.active === controller) this.active = null;
      },
    };
  }

  /** Abort the in-flight turn (stop / cancel paths). No-op when idle. */
  abort(reason: string): void {
    if (this.active && !this.active.signal.aborted) this.active.abort(reason);
  }

  isOwn(turnId: string): boolean {
    return this.ownTurnIds.has(turnId);
  }

  /**
   * Foreign-turn mirror gate: returns the assistant prose to mirror for a turn
   * this channel did NOT initiate (e.g. a co-attached surface ran one), or null
   * when the event must not be mirrored — not an `assistant_message`, one of
   * our own turnIds (invariant #8), a turn of ours currently rendering via the
   * frame pump (`busy`), or empty content. The channel adds its own
   * "have I served a target yet" check and does the send.
   */
  mirrorText(event: MoxxyEvent): string | null {
    if (event.type !== 'assistant_message') return null;
    if (this.ownTurnIds.has(event.turnId)) return null;
    if (this.busyFlag) return null;
    const text = event.content.trim();
    return text ? text : null;
  }
}
