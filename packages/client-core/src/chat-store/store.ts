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
  EMPTY_SNAPSHOT,
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
    const id = `q-${slot.rt.rev}-${slot.queue.length}`;
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
      // Prefer the runner, but only adopt it as the source if it actually
      // yields RENDERED rows. An empty result — no runner backend, a `<v10`
      // runner, or a legacy-only chat whose runner session resumed EMPTY — falls
      // through to the NDJSON mirror so its history is never hidden behind an
      // empty runner session.
      const runner = this.persistence.loadHistory
        ? await this.collectRunnerInitial(workspaceId)
        : null;
      if (slot.resetEpoch !== epoch) return;
      if (runner && runner.events.length > 0) {
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
        if (slot.resetEpoch !== epoch) return;
        slot.loaded = events.length > 0 || prevCursor !== null;
        this.prependFresh(slot, events);
        slot.oldestCursor = prevCursor;
        slot.hasOlder = prevCursor !== null;
      }
    } catch {
      if (slot.resetEpoch === epoch) {
        slot.loaded = false; // allow a retry on the next open
      }
    } finally {
      if (slot.resetEpoch !== epoch) return;
      slot.loadingInitial = false;
      slot.snap = null;
      this.emit();
    }
  }

  /**
   * Pull the newest runner window for {@link loadInitial}, walking past
   * all-non-rendered windows (bounded) so a window that holds no rendered rows
   * YET doesn't read as "no history". Returns `null` when there is no runner
   * backend / the runner can't serve the first page; otherwise the accumulated
   * rendered events (possibly EMPTY — an empty runner log, e.g. a legacy-only
   * chat) and the cursor for the next older page.
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

  /** Fetch the page preceding the in-memory window (scroll-up), from whichever
   *  source {@link loadInitial} settled on for this slot. */
  async loadOlder(workspaceId: string): Promise<void> {
    const slot = this.slots.get(workspaceId);
    if (!slot || !slot.hasOlder || slot.loadingOlder || !this.persistence) return;
    slot.loadingOlder = true;
    const epoch = slot.resetEpoch;
    try {
      if (slot.historySource === 'runner') {
        const runner = await this.loadRunnerWindow(workspaceId, slot.oldestCursor, OLDER_PAGE);
        if (slot.resetEpoch !== epoch) return;
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
        if (slot.resetEpoch !== epoch) return;
        this.prependFresh(slot, events);
        slot.oldestCursor = prevCursor;
        slot.hasOlder = prevCursor !== null;
      }
    } catch {
      /* leave hasOlder set so the user can retry by scrolling */
    } finally {
      if (slot.resetEpoch !== epoch) return;
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
    // Accumulate the RAW window (ascending seq) and project it as a whole, so
    // an unsealed-turn reconstruction (projectRunnerWindow) sees a turn's chunks
    // and its terminal row together rather than split per page.
    const raw: MoxxyEvent[] = [];
    let cursor = before;
    for (let page = 0; page < MAX_RUNNER_PAGES; page += 1) {
      const result = await loadHistory(workspaceId, cursor, RUNNER_RAW_PAGE);
      if (result === null) {
        if (page === 0) return null; // runner can't serve → NDJSON fallback
        break; // dropped mid-walk → return what we have
      }
      // Pages arrive newest-first; prepend each older page ahead of the ones we
      // already have so `raw` stays ascending (oldest-first).
      raw.unshift(...result.events);
      cursor = result.prevCursor;
      if (cursor === null || projectRunnerWindow(raw).length >= minRendered) break;
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
    this.resetSlot(slot);
    void this.persistence?.clear(workspaceId).catch(() => {});
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
