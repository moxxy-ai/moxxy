/**
 * Renderer-side store of every workspace's chat state. Module-level so a
 * workspace's history survives the user switching away and back.
 *
 * Each workspace owns a {@link Slot} wrapping a {@link ChatRuntime}: an
 * append-only `ChunkedBlockLog` of committed runner events plus the in-flight
 * streaming text. The log is a bounded WINDOW into the durable main-process
 * NDJSON log: on first open we load the most-recent {@link INITIAL_WINDOW}
 * events; scrolling up calls {@link ChatStore.loadOlder} to prepend the
 * preceding page (cursor pagination). New committed events are appended to
 * both the in-memory window and the durable log via the injected
 * {@link ChatPersistence}.
 *
 * The state types, empty defaults, and snapshot builder live in `./state`;
 * the provider-response token accounting lives in `./usage`.
 */

import type { MoxxyEvent } from '@moxxy/sdk';
import { applyAction, isRenderedEvent, type ChatAction } from '../chatModel.js';
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
import {
  buildSnapshot,
  createSlot,
  EMPTY_QUEUE,
  EMPTY_SNAPSHOT,
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
    if (!slot) return EMPTY_SNAPSHOT;
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
  ): string {
    const slot = this.ensure(workspaceId);
    const id = `q-${slot.rt.rev}-${slot.queue.length}`;
    slot.queue = [
      ...slot.queue,
      attachments && attachments.length > 0 ? { id, prompt, attachments } : { id, prompt },
    ];
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
   * Load the most-recent window of a workspace's history on first open.
   * Idempotent — guarded by `loaded`. Loaded events are prepended (with
   * id-dedup) so any turn that raced ahead of the load stays newest.
   *
   * Prefers the RUNNER's authoritative log (`session.loadHistory`): the first
   * load decides the slot's {@link Slot.historySource}. When the runner can't
   * serve it (no connected runner for the workspace, a `<v10` runner, or a
   * legacy-only chat with no runner session) it falls back to the NDJSON store —
   * so no transcript goes blank. The two cursor spaces (runner `seq` vs NDJSON
   * line-index) never mix within a slot.
   */
  async loadInitial(workspaceId: string): Promise<void> {
    const slot = this.ensure(workspaceId);
    if (slot.loaded || !this.persistence) return;
    slot.loaded = true; // set before await so concurrent calls bail
    slot.loadingInitial = true; // show the spinner while the read is in flight
    slot.snap = null;
    this.emit();
    try {
      const runner = await this.loadRunnerWindow(workspaceId, null, INITIAL_WINDOW);
      if (runner) {
        slot.historySource = 'runner';
        this.prependFresh(slot, runner.events);
        slot.oldestCursor = runner.prevCursor;
        slot.hasOlder = runner.prevCursor !== null;
      } else {
        slot.historySource = 'ndjson';
        const { events, prevCursor } = await this.persistence.loadSegment(
          workspaceId,
          null,
          INITIAL_WINDOW,
        );
        this.prependFresh(slot, events);
        slot.oldestCursor = prevCursor;
        slot.hasOlder = prevCursor !== null;
      }
    } catch {
      slot.loaded = false; // allow a retry on the next open
    } finally {
      slot.loadingInitial = false;
      slot.snap = null;
      this.emit();
    }
  }

  /** Fetch the page preceding the in-memory window (scroll-up), from whichever
   *  source {@link loadInitial} settled on for this slot. */
  async loadOlder(workspaceId: string): Promise<void> {
    const slot = this.slots.get(workspaceId);
    if (!slot || !slot.hasOlder || slot.loadingOlder || !this.persistence) return;
    slot.loadingOlder = true;
    try {
      if (slot.historySource === 'runner') {
        const runner = await this.loadRunnerWindow(workspaceId, slot.oldestCursor, OLDER_PAGE);
        if (runner) {
          this.prependFresh(slot, runner.events);
          slot.oldestCursor = runner.prevCursor;
          slot.hasOlder = runner.prevCursor !== null;
        }
        // runner === null here means the runner dropped mid-scroll; leave the
        // cursor/hasOlder untouched so a later scroll retries — we never switch
        // cursor spaces to NDJSON mid-slot (its line-index cursor is unrelated).
      } else {
        const { events, prevCursor } = await this.persistence.loadSegment(
          workspaceId,
          slot.oldestCursor,
          OLDER_PAGE,
        );
        this.prependFresh(slot, events);
        slot.oldestCursor = prevCursor;
        slot.hasOlder = prevCursor !== null;
      }
    } catch {
      /* leave hasOlder set so the user can retry by scrolling */
    } finally {
      // Reset snap + emit in finally (like loadInitial) so the error path
      // also notifies subscribers — otherwise loadingOlder flips to false
      // with no re-render and the spinner/snapshot can wedge.
      slot.loadingOlder = false;
      slot.snap = null;
      this.emit();
    }
  }

  /**
   * Page the RUNNER's authoritative log into a window of at least `minRendered`
   * RENDERED events (newest-first), filtering each raw page with
   * {@link isRenderedEvent}. Walks `session.loadHistory`'s `seq` cursor until it
   * has enough rendered rows, reaches the start of history, or the runner stops
   * serving.
   *
   * Returns `null` (→ caller falls back to NDJSON) when the runner can't serve
   * the FIRST page — no `loadHistory` backend, no connected runner, or a `<v10`
   * runner. A `null` on a LATER page (the runner dropped mid-walk) just ends the
   * window early with whatever rendered rows were gathered, keeping the `seq`
   * cursor so the next scroll-up can resume.
   */
  private async loadRunnerWindow(
    workspaceId: string,
    before: number | null,
    minRendered: number,
  ): Promise<{ events: MoxxyEvent[]; prevCursor: number | null } | null> {
    const loadHistory = this.persistence?.loadHistory?.bind(this.persistence);
    if (!loadHistory) return null;
    const rendered: MoxxyEvent[] = [];
    let cursor = before;
    let renderedCount = 0;
    for (let page = 0; page < MAX_RUNNER_PAGES; page += 1) {
      const result = await loadHistory(workspaceId, cursor, RUNNER_RAW_PAGE);
      if (result === null) {
        if (page === 0) return null; // runner can't serve → NDJSON fallback
        break; // dropped mid-walk → return what we have
      }
      // Pages arrive newest-first; prepend each older page ahead of the ones we
      // already have so `rendered` stays ascending (oldest-first) for prepend.
      rendered.unshift(...result.events.filter(isRenderedEvent));
      renderedCount = rendered.length;
      cursor = result.prevCursor;
      if (cursor === null || renderedCount >= minRendered) break;
    }
    return { events: rendered, prevCursor: cursor };
  }

  private prependFresh(slot: Slot, events: ReadonlyArray<MoxxyEvent>): void {
    if (events.length === 0) return;
    // `seenIds` is the authoritative membership set (kept in lockstep with the
    // log by applyEvent + here), so a page that overlaps events already
    // delivered by the runner's replay is de-duped without an O(n) rescan.
    const fresh = events.filter((e) => !slot.rt.seenIds.has(e.id));
    if (fresh.length > 0) {
      slot.rt.log.prepend(fresh);
      for (const e of fresh) slot.rt.seenIds.add(e.id);
    }
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

    const before = slot.rt.log.length;
    const changed = applyAction(slot.rt, action);
    if (!changed) return;
    // Persist exactly the events this dispatch committed (dispatch only
    // ever appends; prepends come from pagination and are already
    // durable). The tail delta is precisely the new runner events.
    const added = slot.rt.log.length - before;
    if (added > 0 && this.persistence) {
      void this.persistence.append(workspaceId, slot.rt.log.tail(added)).catch(() => {});
    }
    if (this.activeId === workspaceId) slot.lastSeenRev = slot.rt.rev;
    this.unreadDirty = true;
    this.emit();
  }

  /** Drop one workspace's state + its durable log. */
  drop(workspaceId: string): void {
    if (this.slots.delete(workspaceId)) {
      this.unreadDirty = true;
      void this.persistence?.clear(workspaceId).catch(() => {});
      this.emit();
    }
  }

  /** Reset a workspace's transcript without removing the workspace. */
  clear(workspaceId: string): void {
    const slot = this.ensure(workspaceId);
    applyAction(slot.rt, { type: 'clear' });
    slot.oldestCursor = null;
    slot.hasOlder = false;
    slot.usage = EMPTY_USAGE;
    slot.snap = null;
    this.unreadDirty = true;
    void this.persistence?.clear(workspaceId).catch(() => {});
    this.emit();
  }

  // ---- internals ---------------------------------------------------------

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
