import type { MoxxyEvent } from './events.js';
import type { SessionId } from './ids.js';

/**
 * The storage backend behind a session's event log — a swappable block. Core
 * seeds a protected JSONL default (`~/.moxxy/sessions/<id>.jsonl` + a `.json`
 * meta sidecar); a plugin can register an alternative (SQLite, remote, encrypted,
 * in-memory) and the user activates it via `plugins.eventStore.default`. Because
 * the registry uses throw-on-duplicate `register` (not blind override) and the
 * floor auto-adopts first, a discovered plugin's store is registered but never
 * silently becomes active — the user must opt in by name. The store sees every
 * event (prompts, tool I/O), so that explicit opt-in is the trust boundary.
 */

/** Originating channel of a session (persisted into the meta sidecar). */
export type SessionSource = 'cli' | 'tui' | 'desktop' | 'mobile';

/**
 * The single per-session metadata record (the JSONL impl writes it to
 * `~/.moxxy/sessions/<id>.json`). ONE per session — the unit every surface
 * (TUI/desktop/mobile) lists, searches and caches; the conversation itself is
 * the append-only event stream. Fields split by owner: the runner owns the
 * content fields (`firstPrompt`/`eventCount`/`lastActivity`/`provider`/`model`/
 * `startedAt`/`source`); the UI owns `title` (rename) and `groupId` (desk).
 */
export interface SessionMeta {
  /** Schema version; absent on older files (treated as v0). */
  readonly version?: number;
  readonly id: string;
  readonly cwd: string;
  readonly startedAt: string;
  readonly lastActivity: string;
  readonly eventCount: number;
  /** First ~80 chars of the first user_prompt — the list/search label. */
  readonly firstPrompt: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  /** Originating channel, when known. */
  readonly source?: SessionSource;
  /** Explicit workspace/desk membership (UI-owned). */
  readonly groupId?: string | null;
  /** User-set display name (UI-owned). */
  readonly title?: string | null;
}

/** One newest-first page of a session's events (history paging). */
export interface EventPage {
  /** The events in this page, ascending `seq` order (oldest-first within page). */
  readonly events: MoxxyEvent[];
  /**
   * Cursor for the NEXT (older) page — the `seq` of this page's OLDEST event;
   * `null` once the start of history is included (no older page).
   */
  readonly prevCursor: number | null;
}

/**
 * The minimal event-log surface an {@link EventStoreSession} subscribes to:
 * append (via `subscribe`) and truncate (via `onClear`). Core's `EventLog`
 * structurally satisfies it, so a store never needs the concrete core type.
 */
export interface EventLogLike {
  subscribe(listener: (event: MoxxyEvent) => void | Promise<void>): () => void;
  onClear(fn: () => void): () => void;
}

/** Identifies the session a store is opened for. */
export interface EventStoreScope {
  readonly sessionId: SessionId;
  readonly cwd: string;
  /** Override the storage root (tests). */
  readonly dir?: string;
  readonly providerName?: string;
  readonly modelId?: string;
  readonly source?: SessionSource;
}

/**
 * An open handle bound to one session's storage. `attach` wires it to the live
 * log; the write path MUST be non-blocking (buffer + flush async) so a slow
 * disk never wedges a turn, and MUST surface durable failure via `degraded`
 * rather than throwing into the log's listener chain.
 */
export interface EventStoreSession {
  /**
   * Subscribe to the log (append + clear) and write the initial listing row;
   * returns a detach that schedules the final listing write.
   */
  attach(log: EventLogLike): () => void;
  /** Force the pending listing/metadata write; resolve once durable. */
  flush(): Promise<void>;
  /** Resolve once every queued event write has settled (graceful shutdown). */
  settleWrites(): Promise<void>;
  /** Update header fields (provider/model) on a mid-session switch. */
  updateHeader(patch: { providerName?: string; modelId?: string }): void;
  /** True while writes are failing (history is going dark). */
  readonly degraded: boolean;
}

/**
 * A registered event-store backend. `open` is the per-session write path;
 * `restore`/`readPage` are the read path (full resume + newest-first paging).
 * Implementations MUST validate the session id against path traversal before
 * touching storage (the JSONL default's `SAFE_SESSION_ID` guard).
 */
export interface EventStoreDef {
  readonly name: string;
  /** Open/attach to one session's storage for writing. */
  open(scope: EventStoreScope): EventStoreSession;
  /** Restore a session's full event history (resume). */
  restore(sessionId: string, dir?: string): Promise<MoxxyEvent[]>;
  /** Read one newest-first page (thin-client history paging). */
  readPage(
    sessionId: string,
    opts: { before: number | null; limit: number },
    dir?: string,
  ): Promise<EventPage>;
}
