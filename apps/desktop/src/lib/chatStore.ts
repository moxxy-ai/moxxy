/**
 * Renderer-side store of every workspace's chat state. Module-level so a
 * workspace's history survives the user switching away and back.
 *
 * Each workspace owns a {@link ChatRuntime} — an append-only
 * `ChunkedBlockLog` of committed runner events plus the in-flight
 * streaming text. Events stream in on `runner.event` tagged with the
 * workspace id; the store routes each into the matching runtime via
 * {@link applyAction}. A per-workspace cached {@link ChatSnapshot} keeps
 * `useSyncExternalStore` happy: it is rebuilt only when `rev` changes,
 * and its `events` array reference is preserved across streaming-only
 * ticks so the transcript never re-folds while a chunk is arriving.
 *
 * Unread tracking: `rev` bumps on every change; the foreground
 * workspace's `lastSeenRev` is advanced on activation, so activity in a
 * *different* workspace pushes rev past lastSeenRev → unread dot.
 */

import type { MoxxyEvent } from '@moxxy/sdk';
import {
  applyAction,
  createRuntime,
  type ChatAction,
  type ChatRuntime,
  type Extension,
} from './chatModel';
import {
  loadPersistedEvents,
  persistEvents,
  removePersisted,
  loadAllPersisted,
  type PersistedChat,
} from './chatPersistence';

/** One queued turn — the user hit Enter while a previous turn was in
 *  flight. Drained automatically when the active turn completes. */
export interface QueuedTurn {
  readonly id: string;
  readonly prompt: string;
  readonly attachments?: ReadonlyArray<{ path: string; name: string }>;
}

/** Immutable view handed to the renderer. `events` is reference-stable
 *  across chunk-only changes so `Transcript`'s fold memo holds. */
export interface ChatSnapshot {
  readonly rev: number;
  readonly eventsVersion: number;
  readonly events: ReadonlyArray<MoxxyEvent>;
  readonly extensions: ReadonlyArray<Extension>;
  readonly streamingText: string;
  readonly sending: boolean;
  readonly activeTurnId: string | null;
  readonly error: string | null;
  readonly isEmpty: boolean;
}

interface Slot {
  readonly rt: ChatRuntime;
  snap: ChatSnapshot | null;
  model: string | null;
  lastSeenRev: number;
  queue: ReadonlyArray<QueuedTurn>;
}

const EMPTY_QUEUE: ReadonlyArray<QueuedTurn> = Object.freeze([]);
const EMPTY_EVENTS: ReadonlyArray<MoxxyEvent> = Object.freeze([]);
const EMPTY_EXTENSIONS: ReadonlyArray<Extension> = Object.freeze([]);

export const EMPTY_SNAPSHOT: ChatSnapshot = Object.freeze({
  rev: 0,
  eventsVersion: 0,
  events: EMPTY_EVENTS,
  extensions: EMPTY_EXTENSIONS,
  streamingText: '',
  sending: false,
  activeTurnId: null,
  error: null,
  isEmpty: true,
});

class ChatStore {
  private slots = new Map<string, Slot>();
  private activeId: string | null = null;
  private listeners = new Set<() => void>();
  private persistTimers = new Map<string, number>();
  private cachedUnread: ReadonlyArray<string> = [];
  private unreadDirty = true;

  // ---- hydration ---------------------------------------------------------

  /** Rehydrate persisted transcripts at app boot so conversations from
   *  before the last restart come back. */
  hydrate(): void {
    for (const { id, events } of loadAllPersisted()) {
      const slot = this.ensure(id);
      // Direct log seed — bypass applyEvent so we don't re-run the
      // assistant_chunk/streaming logic on already-committed events.
      for (const e of events) slot.rt.log.append(e);
      slot.rt.rev += 1;
    }
    this.unreadDirty = true;
    this.emit();
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

  /** Snapshot of a workspace's chat, rebuilt only when its `rev`
   *  changed. Returns a frozen empty snapshot for unknown workspaces. */
  getChat(workspaceId: string): ChatSnapshot {
    const slot = this.slots.get(workspaceId);
    if (!slot) return EMPTY_SNAPSHOT;
    const { rt } = slot;
    if (slot.snap && slot.snap.rev === rt.rev) return slot.snap;
    // Reuse the previous events array unless a committed event landed —
    // streaming-only ticks keep the same reference so the fold memo holds.
    const eventsChanged = !slot.snap || slot.snap.eventsVersion !== rt.log.version;
    const events = eventsChanged ? rt.log.toArray() : slot.snap!.events;
    slot.snap = {
      rev: rt.rev,
      eventsVersion: rt.log.version,
      events,
      extensions: rt.extensions,
      streamingText: rt.streamingText,
      sending: rt.sending,
      activeTurnId: rt.activeTurnId,
      error: rt.error,
      isEmpty: events.length === 0 && rt.extensions.length === 0 && rt.streamingText === '',
    };
    return slot.snap;
  }

  getModel(workspaceId: string): string | null {
    return this.slots.get(workspaceId)?.model ?? null;
  }

  setModel(workspaceId: string, model: string | null): void {
    const slot = this.ensure(workspaceId);
    if (slot.model === model) return;
    slot.model = model;
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
    const changed = applyAction(slot.rt, action);
    if (!changed) return;
    if (this.activeId === workspaceId) slot.lastSeenRev = slot.rt.rev;
    this.unreadDirty = true;
    this.schedulePersist(workspaceId);
    this.emit();
  }

  /** Drop one workspace's state — desk removed or conversation cleared
   *  out entirely. */
  drop(workspaceId: string): void {
    if (this.slots.delete(workspaceId)) {
      this.unreadDirty = true;
      removePersisted(workspaceId);
      this.emit();
    }
  }

  /** Reset a workspace's transcript without removing the workspace. */
  clear(workspaceId: string): void {
    const slot = this.ensure(workspaceId);
    applyAction(slot.rt, { type: 'clear' });
    slot.snap = null;
    this.unreadDirty = true;
    removePersisted(workspaceId);
    this.emit();
  }

  // ---- internals ---------------------------------------------------------

  private schedulePersist(workspaceId: string): void {
    const existing = this.persistTimers.get(workspaceId);
    if (existing !== undefined && typeof window !== 'undefined') {
      window.clearTimeout(existing);
    }
    if (typeof window === 'undefined') return;
    const handle = window.setTimeout(() => {
      this.persistTimers.delete(workspaceId);
      const slot = this.slots.get(workspaceId);
      if (!slot) {
        removePersisted(workspaceId);
        return;
      }
      const persisted: PersistedChat = { events: slot.rt.log.toArray() };
      persistEvents(workspaceId, persisted);
    }, 250);
    this.persistTimers.set(workspaceId, handle);
  }

  private ensure(workspaceId: string): Slot {
    let slot = this.slots.get(workspaceId);
    if (!slot) {
      const seed = loadPersistedEvents(workspaceId);
      slot = {
        rt: createRuntime(seed?.events ?? []),
        snap: null,
        model: null,
        lastSeenRev: 0,
        queue: EMPTY_QUEUE,
      };
      this.slots.set(workspaceId, slot);
    }
    return slot;
  }
}

export const chatStore = new ChatStore();
