/**
 * Renderer-side store of every workspace's chat state. Module-level so a
 * workspace's history survives the user switching away and back.
 *
 * Each workspace owns a {@link Slot} wrapping a {@link ChatRuntime}: an
 * append-only `ChunkedBlockLog` of committed runner events plus the in-flight
 * streaming text. The log is a bounded WINDOW into the RUNNER's authoritative
 * event log: on first open we page the most-recent {@link INITIAL_WINDOW}
 * rendered events from the runner (via {@link ChatPersistence}); scrolling up
 * calls {@link ChatStore.loadOlder} to prepend the preceding page (seq-cursor
 * pagination). The store keeps no durable copy of its own — the runner persists
 * every event, so live events just update the in-memory window.
 *
 * The state types, empty defaults, and snapshot builder live in `./state`;
 * the provider-response token accounting lives in `./usage`.
 */

import type { MoxxyEvent, UserPromptAttachment } from '@moxxy/sdk';
import { applyAction, isRenderedEvent, uniqueEventsById, type ChatAction } from '../chatModel.js';
import { INITIAL_WINDOW, OLDER_PAGE, type ChatPersistence } from '../chatPersistence.js';

/**
 * Runner-history paging (the `session.loadHistory` path). The runner's pages are
 * RAW events — they include non-rendered events (assistant_chunk deltas,
 * provider bookends) that the renderer filters out — so one page yields fewer
 * RENDERED rows than its size. {@link ChatStore.loadRunnerWindow} therefore
 * walks several raw pages until it has enough rendered rows.
 */
// Raw events fetched per `session.loadHistory` round-trip (well under the
// runner's MAX_HISTORY_PAGE_LIMIT of 2000).
const RUNNER_RAW_PAGE = 200;
// Safety bound on the raw-page walk for ONE window: a window dominated by a long
// streamed reply (hundreds of assistant_chunks) can't spin forever — after this
// many pages we return what we have and let the next scroll-up continue.
const MAX_RUNNER_PAGES = 25;

/**
 * Project a RAW runner window (all event types, ascending `seq`) into the
 * rendered transcript the chat shows — the read-time equivalent of what the live
 * reducer commits. Keeps {@link isRenderedEvent} events AND reconstructs the
 * reply for a turn that streamed assistant text but ended UNSEALED (a fatal
 * error / abort with no `assistant_message`).
 *
 * Why the synth: the runner seals such turns into a real `assistant_message`
 * (`sealUnsealedStreamedText`) and the live renderer used to synthesize one on
 * `turn_complete` — but a LEGACY runner log written BEFORE the seal feature
 * holds chunks + the terminal error/abort and NO message, so filtering with
 * `isRenderedEvent` alone would silently drop the reply text. We detect the
 * unsealed turn by its TERMINAL fatal-error/abort row (NOT a turn boundary — a
 * SEALED reply whose chunks merely span a window edge must not be re-synthesized)
 * and emit the reconstructed reply right after it, matching the runner's own seq
 * order. The accumulator resets on a sealing `assistant_message` or a fresh
 * `provider_request` (a new iteration), so only the final iteration's unsealed
 * text is reconstructed — identical to the runner's seal.
 */
export function projectRunnerWindow(raw: ReadonlyArray<MoxxyEvent>): MoxxyEvent[] {
  // Turns that carry a REAL sealing assistant_message anywhere in this window
  // must never be reconstructed — a POST-seal runner errored turn holds chunks,
  // the error, AND the seal the runner appended at turn end, so synthesizing at
  // the error would double the reply. Only a LEGACY (pre-seal) turn lacks the
  // message and needs reconstruction.
  const sealedTurns = new Set<string>();
  for (const e of raw) if (e.type === 'assistant_message') sealedTurns.add(e.turnId);

  const out: MoxxyEvent[] = [];
  const unsealed = new Map<string, string>();
  for (const e of raw) {
    if (e.type === 'assistant_chunk') {
      const delta = (e as { delta?: string }).delta ?? '';
      unsealed.set(e.turnId, (unsealed.get(e.turnId) ?? '') + delta);
      continue;
    }
    // A sealing message or a new provider iteration drops the pending run.
    if (e.type === 'assistant_message' || e.type === 'provider_request') unsealed.delete(e.turnId);
    if (!isRenderedEvent(e)) continue;
    out.push(e);
    // Terminal unsealed end → reconstruct the reply after the error/abort row,
    // but ONLY for a turn the runner never sealed (a legacy log).
    const terminal =
      e.type === 'abort' || (e.type === 'error' && (e as { kind?: string }).kind === 'fatal');
    if (terminal && !sealedTurns.has(e.turnId)) {
      const text = unsealed.get(e.turnId);
      if (text && text.trim()) {
        out.push({
          type: 'assistant_message',
          content: text,
          stopReason: 'end_turn',
          // Stable per-turn id: the terminal event is unique to the turn, so this
          // synth is produced in exactly one window (no cross-window dup).
          id: `synth-unsealed:${e.turnId}`,
          seq: e.seq,
          ts: (e as { ts?: number }).ts ?? e.seq,
          sessionId: e.sessionId,
          turnId: e.turnId,
          source: 'model',
        } as unknown as MoxxyEvent);
      }
      unsealed.delete(e.turnId);
    }
  }
  return out;
}
import {
  buildSnapshot,
  createSlot,
  EMPTY_QUEUE,
  INITIAL_LOADING_SNAPSHOT,
  type ChatSnapshot,
  type QueuedTurn,
  type Slot,
} from './state.js';
import { EMPTY_USAGE, formatTokensShort, recordUsage, type UsageSnapshot } from './usage.js';

class ChatStore {
  private slots = new Map<string, Slot>();
  private activeId: string | null = null;
  private listeners = new Set<() => void>();
  private cachedUnread: ReadonlyArray<string> = [];
  private unreadDirty = true;
  private persistence: ChatPersistence | null = null;
  /** Turn ids whose events must NOT enter the visible transcript — used by
   *  background generations (e.g. AI skill drafting) that run as a real
   *  runner turn but should never show up in the chat. */
  private hiddenTurns = new Set<string>();

  /** Wire the durable backend (called once at boot by ChatStoreBridge). */
  setPersistence(p: ChatPersistence): void {
    this.persistence = p;
  }

  // ---- subscription ------------------------------------------------------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private emit(): void {
    for (const l of this.listeners) l();
  }

  // ---- read side ---------------------------------------------------------

  getActive(): string | null {
    return this.activeId;
  }

  getChat(workspaceId: string): ChatSnapshot {
    const slot = this.slots.get(workspaceId);
    if (!slot) return INITIAL_LOADING_SNAPSHOT;
    return buildSnapshot(slot);
  }

  getModel(workspaceId: string): string | null {
    return this.slots.get(workspaceId)?.model ?? null;
  }

  /** Token accounting folded from this workspace's provider responses.
   *  Reference-stable until the next response lands (safe for useSyncExternalStore). */
  getUsage(workspaceId: string): UsageSnapshot {
    return this.slots.get(workspaceId)?.usage ?? EMPTY_USAGE;
  }

  /** Mark a turn's events as background-only — they will be dropped from the
   *  visible transcript (and never persisted). For AI skill drafting etc. */
  hideTurn(turnId: string): void {
    this.hiddenTurns.add(turnId);
  }

  /** Stop hiding a turn (call once the background work has finished). */
  unhideTurn(turnId: string): void {
    this.hiddenTurns.delete(turnId);
  }

  /** Whether a turn id is a background/hidden turn whose events never enter
   *  the visible transcript. The queue drainer consults this so a background
   *  generation completing doesn't pop the user's pending queue. */
  isHidden(turnId: string): boolean {
    return this.hiddenTurns.has(turnId);
  }

  /** Toggle the manual-compaction lock for a workspace (composer disable). */
  setCompacting(workspaceId: string, value: boolean): void {
    const slot = this.ensure(workspaceId);
    if (slot.compacting === value) return;
    slot.compacting = value;
    slot.snap = null;
    this.emit();
  }

  setModel(workspaceId: string, model: string | null): void {
    const slot = this.ensure(workspaceId);
    if (slot.model === model) return;
    slot.model = model;
    this.emit();
  }

  getAutoApprove(workspaceId: string): boolean {
    return this.slots.get(workspaceId)?.autoApprove ?? false;
  }

  setAutoApprove(workspaceId: string, value: boolean): void {
    const slot = this.ensure(workspaceId);
    if (slot.autoApprove === value) return;
    slot.autoApprove = value;
    this.emit();
  }

  getQueue(workspaceId: string): ReadonlyArray<QueuedTurn> {
    return this.slots.get(workspaceId)?.queue ?? EMPTY_QUEUE;
  }

  enqueue(
    workspaceId: string,
    prompt: string,
    attachments?: ReadonlyArray<{ path: string; name: string }>,
    inlineAttachments?: ReadonlyArray<UserPromptAttachment>,
  ): string {
    const slot = this.ensure(workspaceId);
    // Monotonic id — deriving it from rev+length collides after a shiftQueue
    // (length shrinks while rev is unchanged), which would make dropFromQueue
    // silently drop a colliding twin and collide React keys.
    slot.queueSeq += 1;
    const id = `q-${slot.queueSeq}`;
    const queued: QueuedTurn = {
      id,
      prompt,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
      ...(inlineAttachments && inlineAttachments.length > 0 ? { inlineAttachments } : {}),
    };
    slot.queue = [...slot.queue, queued];
    this.emit();
    return id;
  }

  shiftQueue(workspaceId: string): QueuedTurn | null {
    const slot = this.slots.get(workspaceId);
    if (!slot || slot.queue.length === 0) return null;
    const [head, ...rest] = slot.queue;
    slot.queue = rest;
    this.emit();
    return head ?? null;
  }

  dropFromQueue(workspaceId: string, id: string): void {
    const slot = this.slots.get(workspaceId);
    if (!slot) return;
    slot.queue = slot.queue.filter((q) => q.id !== id);
    this.emit();
  }

  hasUnread(workspaceId: string): boolean {
    if (workspaceId === this.activeId) return false;
    const slot = this.slots.get(workspaceId);
    if (!slot) return false;
    return slot.rt.rev > slot.lastSeenRev;
  }

  unreadWorkspaces(): ReadonlyArray<string> {
    if (!this.unreadDirty) return this.cachedUnread;
    const next: string[] = [];
    for (const [id, slot] of this.slots) {
      if (id !== this.activeId && slot.rt.rev > slot.lastSeenRev) next.push(id);
    }
    const prev = this.cachedUnread;
    if (prev.length === next.length && prev.every((v, i) => v === next[i])) {
      this.unreadDirty = false;
      return prev;
    }
    this.cachedUnread = next;
    this.unreadDirty = false;
    return next;
  }

  // ---- async loading (cursor pagination) ---------------------------------

  /**
   * Load the most-recent window of a workspace's history on first open from the
   * RUNNER's authoritative log (`session.loadHistory`). Idempotent — guarded by
   * `loaded`. Loaded events are prepended (with id-dedup) so any turn that raced
   * ahead of the load stays newest. With no connected runner the transcript is
   * empty until the runner attaches and streams live events in.
   */
  async loadInitial(workspaceId: string): Promise<void> {
    const slot = this.ensure(workspaceId);
    if (slot.loaded) return;
    if (!this.persistence) {
      slot.loaded = true;
      slot.snap = null;
      this.emit();
      return;
    }
    slot.loaded = true; // set before await so concurrent calls bail
    slot.loadingInitial = true; // show the spinner while the read is in flight
    slot.snap = null;
    this.emit();
    const epoch = slot.resetEpoch;
    try {
      // History comes SOLELY from the runner's authoritative log. A null/empty
      // result (no connected runner for this workspace yet) just shows an empty
      // transcript until the runner attaches and streams live events in. (For the
      // mobile gateway the runner is the session's persisted log, surfaced via
      // the same `chat.loadHistory` IPC.)
      const runner = await this.collectRunnerInitial(workspaceId);
      if (slot.resetEpoch !== epoch) return;
      if (runner) {
        this.prependFresh(slot, runner.events);
        slot.oldestCursor = runner.prevCursor;
        slot.hasOlder = runner.prevCursor !== null;
      } else {
        // No connected runner yet (collectRunnerInitial → null). Allow a retry on
        // the next open so the most-recent-window backfill isn't permanently
        // skipped for a workspace whose runner attaches just after first open.
        slot.loaded = false;
      }
    } catch {
      if (slot.resetEpoch === epoch) {
        slot.loaded = false; // allow a retry on the next open
      }
    } finally {
      // Only finalize when no reset raced us (a return inside finally is unsafe).
      if (slot.resetEpoch === epoch) {
        slot.loadingInitial = false;
        slot.snap = null;
        this.emit();
      }
    }
  }

  /**
   * Pull the newest runner window for {@link loadInitial}, walking past
   * all-non-rendered windows (bounded) so a window that holds no rendered rows
   * YET doesn't read as "no history". Returns `null` when no runner is connected
   * for the workspace; otherwise the accumulated rendered events (possibly EMPTY
   * — a brand-new/empty runner log) and the cursor for the next older page.
   */
  private async collectRunnerInitial(
    workspaceId: string,
  ): Promise<{ events: MoxxyEvent[]; prevCursor: number | null } | null> {
    const first = await this.loadRunnerWindow(workspaceId, null, INITIAL_WINDOW);
    if (!first) return null;
    const events = [...first.events];
    let cursor = first.prevCursor;
    for (let pump = 0; pump < 10 && events.length === 0 && cursor !== null; pump += 1) {
      const more = await this.loadRunnerWindow(workspaceId, cursor, INITIAL_WINDOW);
      if (!more) break;
      events.unshift(...more.events);
      cursor = more.prevCursor;
    }
    return { events, prevCursor: cursor };
  }

  /** Fetch the page preceding the in-memory window (scroll-up) from the runner's
   *  authoritative log. */
  async loadOlder(workspaceId: string): Promise<void> {
    const slot = this.slots.get(workspaceId);
    if (!slot || !slot.hasOlder || slot.loadingOlder || !this.persistence) return;
    slot.loadingOlder = true;
    const epoch = slot.resetEpoch;
    try {
      const runner = await this.loadRunnerWindow(workspaceId, slot.oldestCursor, OLDER_PAGE);
      if (slot.resetEpoch !== epoch) return;
      if (runner) {
        this.prependFresh(slot, runner.events);
        slot.oldestCursor = runner.prevCursor;
        slot.hasOlder = runner.prevCursor !== null;
      }
      // runner === null means the runner dropped mid-scroll; leave the
      // cursor/hasOlder untouched so a later scroll retries.
    } catch {
      /* leave hasOlder set so the user can retry by scrolling */
    } finally {
      // Reset snap + emit in finally (like loadInitial) so the error path
      // also notifies subscribers — otherwise loadingOlder flips to false
      // with no re-render and the spinner/snapshot can wedge. Guarded by an
      // `if` (a return inside finally is unsafe) so a reset that raced us wins.
      if (slot.resetEpoch === epoch) {
        slot.loadingOlder = false;
        slot.snap = null;
        this.emit();
      }
    }
  }

  /** Best-effort recovery for thin clients that missed non-persisted lifecycle
   *  pushes while backgrounded/reconnecting. Pull the latest runner window,
   *  append any tail events we missed, and clear the active turn if the
   *  authoritative log now shows that same turn reached a terminal row. */
  async refreshLatest(workspaceId: string): Promise<void> {
    const slot = this.ensure(workspaceId);
    if (!this.persistence) return;
    const activeTurnId = slot.rt.activeTurnId;
    const epoch = slot.resetEpoch;
    const runner = await this.collectRunnerInitial(workspaceId);
    if (slot.resetEpoch !== epoch || !runner) return;

    let changed = this.appendFreshTail(slot, runner.events);
    if (activeTurnId && terminalEventForTurn(runner.events, activeTurnId)) {
      changed = applyAction(slot.rt, { type: 'turn_complete', turnId: activeTurnId, error: null }) || changed;
    }
    const openTurnId = latestOpenTurnId(runner.events);
    if (!slot.rt.activeTurnId && openTurnId) {
      changed = applyAction(slot.rt, { type: 'send_started', turnId: openTurnId }) || changed;
    }
    if (!changed) return;
    if (this.activeId === workspaceId) slot.lastSeenRev = slot.rt.rev;
    slot.snap = null;
    this.unreadDirty = true;
    this.emit();
  }

  /**
   * Page the RUNNER's authoritative log into a window of at least `minRendered`
   * RENDERED events (newest-first), filtering each raw page with
   * {@link isRenderedEvent}. Walks `session.loadHistory`'s `seq` cursor until it
   * has enough rendered rows, reaches the start of history, or the runner stops
   * serving.
   *
   * Returns `null` when the runner can't serve the FIRST page (no connected
   * runner for the workspace). A `null` on a LATER page (the runner dropped
   * mid-walk) just ends the window early with whatever rendered rows were
   * gathered, keeping the `seq` cursor so the next scroll-up can resume.
   */
  private async loadRunnerWindow(
    workspaceId: string,
    before: number | null,
    minRendered: number,
  ): Promise<{ events: MoxxyEvent[]; prevCursor: number | null } | null> {
    const loadHistory = this.persistence?.loadHistory.bind(this.persistence);
    if (!loadHistory) return null;
    // Accumulate the RAW window (ascending seq) and project it as a whole, so
    // an unsealed-turn reconstruction (projectRunnerWindow) sees a turn's chunks
    // and its terminal row together rather than split per page.
    const raw: MoxxyEvent[] = [];
    let cursor = before;
    // Count rendered rows INCREMENTALLY (cheap per-page scan) instead of
    // re-projecting the whole accumulated window each iteration — re-projecting
    // is O(raw.length), so doing it per page is O(pages² × pageSize) and blocks
    // the renderer on a long scroll-up. `isRenderedEvent` count is a safe lower
    // bound on the final projection length (projectRunnerWindow only ever ADDS
    // synth rows, never drops a rendered event), so crossing `minRendered` here
    // guarantees the projected window also has at least `minRendered` rows.
    let renderedCount = 0;
    for (let page = 0; page < MAX_RUNNER_PAGES; page += 1) {
      const result = await loadHistory(workspaceId, cursor, RUNNER_RAW_PAGE);
      if (result === null) {
        if (page === 0) return null; // no connected runner → empty transcript
        break; // dropped mid-walk → return what we have
      }
      // Pages arrive newest-first; prepend each older page ahead of the ones we
      // already have so `raw` stays ascending (oldest-first).
      raw.unshift(...result.events);
      for (const e of result.events) if (isRenderedEvent(e)) renderedCount += 1;
      cursor = result.prevCursor;
      if (cursor === null || renderedCount >= minRendered) break;
    }
    return { events: projectRunnerWindow(raw), prevCursor: cursor };
  }

  private prependFresh(slot: Slot, events: ReadonlyArray<MoxxyEvent>): void {
    if (events.length === 0) return;
    // `seenIds` is the authoritative membership set (kept in lockstep with the
    // log by applyEvent + here), so a page that overlaps events already
    // delivered by the runner's replay is de-duped without an O(n) rescan.
    const fresh = uniqueEventsById(events).filter((e) => !slot.rt.seenIds.has(e.id));
    if (fresh.length > 0) {
      slot.rt.log.prepend(fresh);
      for (const e of fresh) slot.rt.seenIds.add(e.id);
    }
  }

  private appendFreshTail(slot: Slot, events: ReadonlyArray<MoxxyEvent>): boolean {
    const maxSeq = maxEventSeq(slot.rt.log.toArray());
    const fresh = uniqueEventsById(events)
      .filter((event) => !slot.rt.seenIds.has(event.id))
      .filter((event) => maxSeq === null || eventSeq(event) > maxSeq)
      .sort((a, b) => eventSeq(a) - eventSeq(b));
    let changed = false;
    for (const event of fresh) {
      changed = applyAction(slot.rt, { type: 'event', event }) || changed;
    }
    return changed;
  }

  // ---- write side --------------------------------------------------------

  setActive(workspaceId: string | null): void {
    if (this.activeId === workspaceId) return;
    this.activeId = workspaceId;
    if (workspaceId !== null) {
      const slot = this.ensure(workspaceId);
      slot.lastSeenRev = slot.rt.rev;
    }
    this.unreadDirty = true;
    this.emit();
  }

  dispatch(workspaceId: string, action: ChatAction): void {
    const slot = this.ensure(workspaceId);

    // Background turns (e.g. AI skill drafting) never touch the transcript —
    // drop every event/lifecycle tagged with a hidden turn id.
    if (action.type === 'event' && this.hiddenTurns.has(action.event.turnId)) return;
    if (action.type === 'turn_complete' && this.hiddenTurns.has(action.turnId)) {
      this.hiddenTurns.delete(action.turnId);
      return;
    }

    // provider_response carries token usage but is not a rendered/persisted
    // event, so it never lands in the log. Fold its usage into the side-channel
    // accumulator (context meter) and stop — applyAction would no-op for it.
    if (action.type === 'event' && action.event.type === 'provider_response') {
      const next = recordUsage(slot.usage, action.event);
      if (next) {
        slot.usage = next;
        this.emit();
      }
      return;
    }

    // compaction summarizes old turns and shrinks the live context. It's not a
    // rendered event either, so: drop the context meter by the freed tokens,
    // and surface a visible notice in the transcript so the user sees it kick
    // in (whether triggered manually or by the 75% auto-compactor).
    if (action.type === 'event' && action.event.type === 'compaction') {
      const saved = action.event.tokensSaved ?? 0;
      if (saved > 0) {
        if (slot.usage.latestPrompt != null) {
          slot.usage = {
            ...slot.usage,
            latestPrompt: Math.max(0, slot.usage.latestPrompt - saved),
          };
        }
        slot.rt.extensions = [
          ...slot.rt.extensions,
          {
            kind: 'notice',
            id: action.event.id,
            afterCount: slot.rt.log.length,
            tone: 'info',
            text: `Context compacted — freed ~${formatTokensShort(saved)} tokens`,
          },
        ];
        slot.rt.rev += 1;
        slot.snap = null;
        this.unreadDirty = true;
        this.emit();
      }
      return;
    }

    const changed = applyAction(slot.rt, action);
    if (!changed) return;
    // The runner persists every committed event to its authoritative log (the
    // events streamed in here originate from it), so the store keeps no durable
    // copy of its own — history is paged back from the runner on next open.
    if (this.activeId === workspaceId) slot.lastSeenRev = slot.rt.rev;
    this.unreadDirty = true;
    this.emit();
  }

  /** Drop one workspace's in-memory state. The runner owns the durable log;
   *  erasing it is the session-removal flow's job (`sessions.remove`). */
  drop(workspaceId: string): void {
    if (this.slots.delete(workspaceId)) {
      this.unreadDirty = true;
      this.emit();
    }
  }

  /** Reset a workspace's in-memory transcript without removing the workspace.
   *  The runner's log is reset separately (the `/new` flow calls
   *  `session.newSession`). */
  clear(workspaceId: string): void {
    const slot = this.ensure(workspaceId);
    // The runner's log is reset separately (the `/new` flow calls
    // `session.newSession`); the old NDJSON mirror clear was retired.
    this.resetSlot(slot);
    this.emit();
  }

  /** Mirror a clear that already happened on another surface / host. */
  clearLocal(workspaceId: string): void {
    const slot = this.ensure(workspaceId);
    this.resetSlot(slot);
    this.emit();
  }

  // ---- internals ---------------------------------------------------------

  private resetSlot(slot: Slot): void {
    slot.resetEpoch += 1;
    applyAction(slot.rt, { type: 'clear' });
    slot.oldestCursor = null;
    slot.hasOlder = false;
    slot.loaded = true;
    slot.loadingInitial = false;
    slot.loadingOlder = false;
    slot.usage = EMPTY_USAGE;
    slot.compacting = false;
    slot.snap = null;
    this.unreadDirty = true;
    if (this.activeId !== null && this.slots.get(this.activeId) === slot) {
      slot.lastSeenRev = slot.rt.rev;
    }
  }

  private ensure(workspaceId: string): Slot {
    let slot = this.slots.get(workspaceId);
    if (!slot) {
      slot = createSlot();
      this.slots.set(workspaceId, slot);
    }
    return slot;
  }
}

export const chatStore = new ChatStore();

function eventSeq(event: MoxxyEvent): number {
  return typeof event.seq === 'number' && Number.isFinite(event.seq) ? event.seq : Number.NEGATIVE_INFINITY;
}

function maxEventSeq(events: ReadonlyArray<MoxxyEvent>): number | null {
  let max: number | null = null;
  for (const event of events) {
    const seq = eventSeq(event);
    if (seq === Number.NEGATIVE_INFINITY) continue;
    max = max === null ? seq : Math.max(max, seq);
  }
  return max;
}

function terminalEventForTurn(events: ReadonlyArray<MoxxyEvent>, turnId: string): MoxxyEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) continue;
    if (event.turnId !== turnId) continue;
    if (event.type === 'assistant_message') return event.stopReason === 'tool_use' ? null : event;
    if (event.type === 'abort') return event;
    if (event.type === 'error') return event.kind === 'fatal' ? event : null;
  }
  return null;
}

function latestOpenTurnId(events: ReadonlyArray<MoxxyEvent>): string | null {
  const turnId = latestTurnId(events);
  if (!turnId) return null;
  return terminalEventForTurn(events, turnId) ? null : turnId;
}

function latestTurnId(events: ReadonlyArray<MoxxyEvent>): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const turnId = events[index]?.turnId;
    if (typeof turnId === 'string' && turnId.length > 0) return turnId;
  }
  return null;
}
