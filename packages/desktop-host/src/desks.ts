/**
 * Desks — isolated workspaces. A desk is a name + bound directory; the
 * supervisor spawns its moxxy runner with that directory as cwd, so
 * moxxy's own config loader picks up the project's `moxxy.config.yaml`
 * and the session/inbox files land scoped to it.
 *
 * Persisted as a small JSON document under
 * `~/.moxxy/desktop/desks.json` so the user's workspaces survive a
 * relaunch. Atomic writes (tmp + rename) so a crash mid-write can't
 * truncate the file.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMutex, type Mutex } from '@moxxy/sdk';
import { writeFileAtomic } from '@moxxy/sdk/server';
import type { Desk, DeskSession, SessionsOverview } from '@moxxy/desktop-ipc-contract';

/**
 * v2: each desk carries `sessions` (>= 1 of them) + `activeSessionId`.
 * A v1 doc (or any desk missing/holding a malformed sessions array) is
 * migrated in memory on load: the desk gets exactly ONE session whose id
 * equals the desk id — which is precisely the sticky session id the
 * runner pool used to derive FROM the desk id, so the runner's persisted
 * log `~/.moxxy/sessions/<deskId>.jsonl` and the chat NDJSON mirror
 * `~/.moxxy/chats/<deskId>.jsonl` resume untouched. The migrated shape
 * is persisted on the next mutation (every save writes version 2).
 */
interface DeskDoc {
  version: 2;
  activeId: string | null;
  desks: Desk[];
}

const DESK_FILE = path.join(homedir(), '.moxxy', 'desktop', 'desks.json');
const DEFAULT_COLORS = [
  '#3b82f6', // blue   — Growth Team accent
  '#ef4444', // red    — Product Launch accent
  '#10b981', // green  — Sales Ops accent
  '#8b5cf6', // purple — Research Hub accent
  '#f59e0b', // amber  — Personal accent
  '#06b6d4', // cyan
];

export class DeskStore {
  private readonly path: string;
  /** Serializes every load→modify→save cycle. Without it two concurrent
   *  mutations (create/remove/setActive/rename) both read the same doc and the
   *  second save clobbers the first — losing a desk or stranding activeId on a
   *  deleted desk. The lock makes each mutation see the previous one's result. */
  private readonly mutex: Mutex = createMutex();

  constructor(filePath: string = DESK_FILE) {
    this.path = filePath;
  }

  async load(): Promise<DeskDoc> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as { activeId?: string | null; desks?: unknown[] };
      // Light-touch validation: bad shape → start fresh rather than
      // throw and stall onboarding.
      if (!Array.isArray(parsed.desks)) return emptyDoc();
      return {
        version: 2,
        activeId: parsed.activeId ?? null,
        // normalizeSessions is the v1→v2 migration (and the repair path
        // for a hand-edited file): every desk comes out with >= 1 valid
        // session and an activeSessionId that points at one of them.
        desks: parsed.desks.filter(isValidDesk).map(normalizeSessions),
      };
    } catch {
      return emptyDoc();
    }
  }

  async save(doc: DeskDoc): Promise<void> {
    // Crash-atomic write (unique temp + rename, dir created as needed) via the
    // framework's shared helper — no truncated file if a write is interrupted.
    await writeFileAtomic(this.path, JSON.stringify(doc, null, 2));
  }

  async list(): Promise<Desk[]> {
    return (await this.load()).desks;
  }

  async getActive(): Promise<Desk | null> {
    const doc = await this.load();
    return doc.desks.find((d) => d.id === doc.activeId) ?? null;
  }

  async create(input: { name: string; cwd: string; color?: string }): Promise<Desk> {
    return this.mutex.run(async () => {
      const doc = await this.load();
      const id = randomUUID();
      const createdAt = Date.now();
      const desk: Desk = {
        id,
        name: input.name.trim() || 'Unnamed desk',
        cwd: input.cwd,
        color:
          input.color ??
          DEFAULT_COLORS[doc.desks.length % DEFAULT_COLORS.length]!,
        createdAt,
        // First session id === desk id, matching the migration invariant:
        // the pool key (and so the runner log + chat mirror filename) for a
        // fresh desk's default session is the same string it always was.
        sessions: [{ id, name: DEFAULT_SESSION_NAME, createdAt }],
        activeSessionId: id,
      };
      doc.desks.push(desk);
      // First desk auto-becomes active.
      if (!doc.activeId) doc.activeId = desk.id;
      await this.save(doc);
      return desk;
    });
  }

  /** Remove a desk. Returns the removed desk (so the caller can tear down
   *  every one of its session runners) or null when the id was unknown. */
  async remove(id: string): Promise<Desk | null> {
    return this.mutex.run(async () => {
      const doc = await this.load();
      const removed = doc.desks.find((d) => d.id === id) ?? null;
      doc.desks = doc.desks.filter((d) => d.id !== id);
      if (doc.activeId === id) doc.activeId = doc.desks[0]?.id ?? null;
      await this.save(doc);
      return removed;
    });
  }

  async setActive(id: string): Promise<void> {
    return this.mutex.run(async () => {
      const doc = await this.load();
      if (!doc.desks.some((d) => d.id === id)) {
        throw new Error(`unknown desk: ${id}`);
      }
      doc.activeId = id;
      await this.save(doc);
    });
  }

  async rename(id: string, name: string): Promise<Desk> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('name must not be empty');
    return this.mutex.run(async () => {
      const doc = await this.load();
      const desk = doc.desks.find((d) => d.id === id);
      if (!desk) throw new Error(`unknown desk: ${id}`);
      desk.name = trimmed;
      await this.save(doc);
      return desk;
    });
  }

  // ---- Sessions (multiple conversations per desk) -------------------------

  /** Sessions of one desk (default: the active desk). Unknown/absent desk →
   *  an empty overview rather than a throw, so the renderer can render a
   *  bare list while desks are still loading. */
  async listSessions(deskId?: string): Promise<SessionsOverview> {
    const doc = await this.load();
    const desk = this.resolveDesk(doc, deskId);
    if (!desk) return { sessions: [], activeSessionId: null };
    return { sessions: desk.sessions, activeSessionId: desk.activeSessionId };
  }

  /** The desk that owns `sessionId`, or null. */
  async deskForSession(sessionId: string): Promise<Desk | null> {
    const doc = await this.load();
    return doc.desks.find((d) => d.sessions.some((s) => s.id === sessionId)) ?? null;
  }

  /** Add a session to a desk (default: the active desk). Does NOT change
   *  the desk's active session — that's `setActiveSession`'s job, mirroring
   *  how desks.create doesn't auto-activate (beyond the first). */
  async createSession(
    deskId?: string,
    name?: string,
  ): Promise<{ desk: Desk; session: DeskSession }> {
    return this.mutex.run(async () => {
      const doc = await this.load();
      const desk = this.resolveDesk(doc, deskId);
      if (!desk) throw new Error(deskId ? `unknown desk: ${deskId}` : 'no active desk');
      const session: DeskSession = {
        id: randomUUID(),
        name: name?.trim() || nextSessionName(desk.sessions),
        createdAt: Date.now(),
      };
      desk.sessions.push(session);
      await this.save(doc);
      return { desk, session };
    });
  }

  /** Foreground a session: its desk becomes the active desk and the session
   *  becomes that desk's active session. Returns the owning desk (the caller
   *  needs its cwd to spawn/foreground the runner). */
  async setActiveSession(sessionId: string): Promise<Desk> {
    return this.mutex.run(async () => {
      const doc = await this.load();
      const desk = doc.desks.find((d) => d.sessions.some((s) => s.id === sessionId));
      if (!desk) throw new Error(`unknown session: ${sessionId}`);
      desk.activeSessionId = sessionId;
      doc.activeId = desk.id;
      await this.save(doc);
      return desk;
    });
  }

  /**
   * Remove a session from its desk. A desk always keeps >= 1 session, so
   * removing the last one seeds a fresh empty replacement; removing the
   * ACTIVE session promotes another. Returns the updated owning desk (its
   * `activeSessionId` is what the caller should spawn/foreground next) or
   * null when the session id was unknown.
   */
  async removeSession(sessionId: string): Promise<Desk | null> {
    return this.mutex.run(async () => {
      const doc = await this.load();
      const desk = doc.desks.find((d) => d.sessions.some((s) => s.id === sessionId));
      if (!desk) return null;
      desk.sessions = desk.sessions.filter((s) => s.id !== sessionId);
      if (desk.sessions.length === 0) {
        desk.sessions = [
          { id: randomUUID(), name: DEFAULT_SESSION_NAME, createdAt: Date.now() },
        ];
      }
      if (desk.activeSessionId === sessionId) {
        desk.activeSessionId = desk.sessions[0]!.id;
      }
      await this.save(doc);
      return desk;
    });
  }

  async renameSession(sessionId: string, name: string): Promise<DeskSession> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('name must not be empty');
    return this.mutex.run(async () => {
      const doc = await this.load();
      const session = doc.desks
        .flatMap((d) => d.sessions)
        .find((s) => s.id === sessionId);
      if (!session) throw new Error(`unknown session: ${sessionId}`);
      session.name = trimmed;
      await this.save(doc);
      return session;
    });
  }

  /** Desk by id, or the active desk when no id was given. */
  private resolveDesk(doc: DeskDoc, deskId?: string): Desk | null {
    const id = deskId ?? doc.activeId;
    if (!id) return null;
    return doc.desks.find((d) => d.id === id) ?? null;
  }
}

const DEFAULT_SESSION_NAME = 'Session 1';

/** "Session N" with N picked past every existing auto-generated name, so
 *  create → delete → create never mints a duplicate label. */
function nextSessionName(sessions: ReadonlyArray<DeskSession>): string {
  let n = sessions.length + 1;
  const taken = new Set(sessions.map((s) => s.name));
  while (taken.has(`Session ${n}`)) n += 1;
  return `Session ${n}`;
}

function emptyDoc(): DeskDoc {
  return { version: 2, activeId: null, desks: [] };
}

function isValidDesk(value: unknown): value is Desk {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.cwd === 'string' &&
    typeof v.color === 'string' &&
    typeof v.createdAt === 'number'
  );
}

function isValidSession(value: unknown): value is DeskSession {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' && typeof v.name === 'string' && typeof v.createdAt === 'number'
  );
}

/**
 * The v1→v2 migration + self-repair: guarantee `sessions` holds >= 1 valid
 * session and `activeSessionId` points at one of them. A v1 desk (no
 * sessions at all) is seeded with one session whose id === the desk id —
 * exactly the sticky session id the pool used to derive from the desk id,
 * so existing runner logs and chat mirrors keep resuming.
 */
function normalizeSessions(desk: Desk): Desk {
  const raw = Array.isArray(desk.sessions) ? desk.sessions : [];
  let sessions = raw.filter(isValidSession);
  if (sessions.length === 0) {
    sessions = [{ id: desk.id, name: DEFAULT_SESSION_NAME, createdAt: desk.createdAt }];
  }
  const activeSessionId = sessions.some((s) => s.id === desk.activeSessionId)
    ? desk.activeSessionId
    : sessions[0]!.id;
  return { ...desk, sessions, activeSessionId };
}
