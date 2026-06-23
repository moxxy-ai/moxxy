/**
 * Shared workspace/session registry for every Moxxy surface.
 *
 * SINGLE SOURCE OF TRUTH. A session lives in exactly one place — the runner's
 * per-session sidecar under `~/.moxxy/sessions/<id>.{jsonl,meta.json}` (written
 * by @moxxy/core's `SessionPersistence`, regardless of which channel spawned the
 * runner). This file persists ONLY the workspace overlay — the user's desks
 * (name/cwd/color) and the active pointers — to `~/.moxxy/desktop/desks.json`.
 * The per-desk session list is DERIVED at read time from the sidecars and
 * grouped into desks by cwd. So deleting a session (its sidecar) removes it from
 * every surface with nothing to resurrect it, and there is no second copy of
 * session metadata to drift out of sync.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  deleteSession,
  listSessionMetas,
  seedSessionMeta,
  setSessionGroup,
  setSessionTitle,
  type SessionMeta,
  type SessionSource,
} from '@moxxy/core';
import type { Desk, DeskSession, DesksOverview, SessionsOverview } from '@moxxy/desktop-ipc-contract';
import { createMutex, type Mutex } from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';

export const MOXXY_WORKSPACE_ID = 'moxxy';
export const MOXXY_WORKSPACE_NAME = 'Moxxy';
export const MOXXY_WORKSPACE_COLOR = '#ec4899';

const NEW_SESSION_NAME = 'New session';
const DOC_VERSION = 4;
/** Sidebar rows are narrow; the sidecar stores up to 80 chars of first prompt. */
const MAX_TITLE = 48;
const DEFAULT_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#10b981',
  '#8b5cf6',
  '#f59e0b',
  '#06b6d4',
];

/** The originating channel of a session — re-exported as the historical name. */
export type WorkspaceSessionSource = SessionSource;

/** One persisted desk (the overlay). Sessions are NOT stored here — they are
 *  derived from the sidecars at read time. */
interface DeskRecord {
  id: string;
  name: string;
  cwd: string;
  color: string;
  createdAt: number;
  activeSessionId: string | null;
}

interface DeskDoc {
  version: number;
  activeId: string | null;
  desks: DeskRecord[];
}

export function defaultWorkspaceRegistryPath(): string {
  return moxxyPath('desktop', 'desks.json');
}

export function cwdForSession(desk: Desk, sessionId: string | null | undefined): string {
  const session = sessionId ? desk.sessions.find((s) => s.id === sessionId) : null;
  if (session?.cwd && existsSync(session.cwd)) return session.cwd;
  ensureDirectoryIfMoxxyWorkspace(desk);
  if (existsSync(desk.cwd)) return desk.cwd;
  return ensureManagedMoxxyCwd();
}

export class WorkspaceRegistry {
  private readonly path: string;
  private readonly mutex: Mutex = createMutex();

  constructor(filePath: string = defaultWorkspaceRegistryPath()) {
    this.path = filePath;
  }

  // ---- Reads (lock-free; always derive a fresh view from the sidecars) ------

  async list(): Promise<Desk[]> {
    return (await this.derive()).desks;
  }

  /** Desks + active pointer in ONE derive — prefer this over `list()` +
   *  `getActive()` (two derives) when a caller needs both. */
  async overview(): Promise<DesksOverview> {
    const view = await this.derive();
    return { desks: view.desks, activeId: view.activeId };
  }

  async getActive(): Promise<Desk | null> {
    const view = await this.derive();
    return view.desks.find((desk) => desk.id === view.activeId) ?? null;
  }

  async listSessions(deskId?: string): Promise<SessionsOverview> {
    const view = await this.derive();
    const desk = this.resolveDesk(view, deskId);
    if (!desk) return { sessions: [], activeSessionId: null };
    return { sessions: desk.sessions, activeSessionId: desk.activeSessionId };
  }

  async deskForSession(sessionId: string): Promise<Desk | null> {
    const view = await this.derive();
    return (
      view.desks.find((desk) => desk.sessions.some((session) => session.id === sessionId)) ?? null
    );
  }

  // ---- Desk mutations (overlay only) ----------------------------------------

  async ensureMoxxyWorkspace(): Promise<Desk> {
    return this.mutex.run(async () => {
      const doc = await this.loadDoc();
      const record = ensureMoxxyRecord(doc);
      if (!doc.activeId) doc.activeId = record.id;
      await this.save(doc);
      ensureDirectoryIfMoxxyWorkspace(record);
      return (await this.derive()).desks.find((d) => d.id === record.id)!;
    });
  }

  async create(input: { name: string; cwd: string; color?: string }): Promise<Desk> {
    return this.mutex.run(async () => {
      const doc = await this.loadDoc();
      const id = randomUUID();
      const record: DeskRecord = {
        id,
        name: input.name.trim() || 'Unnamed desk',
        cwd: input.cwd,
        color: input.color ?? DEFAULT_COLORS[doc.desks.length % DEFAULT_COLORS.length]!,
        createdAt: Date.now(),
        activeSessionId: id,
      };
      doc.desks.push(record);
      if (!doc.activeId) doc.activeId = id;
      await this.save(doc);
      // Seed the first session's file with id === deskId (the invariant that
      // keeps the sticky runner log resuming) so the new desk shows a session
      // immediately, before its runner spawns. Its groupId is the desk itself.
      await seedSessionMeta(id, input.cwd, 'desktop', undefined, id);
      return (await this.derive()).desks.find((d) => d.id === id)!;
    });
  }

  async remove(id: string): Promise<Desk | null> {
    return this.mutex.run(async () => {
      // Snapshot the desk's derived sessions BEFORE we touch anything so the
      // caller can tear down their runners and we can erase their logs.
      const removed = (await this.derive()).desks.find((desk) => desk.id === id) ?? null;
      const doc = await this.loadDoc();
      doc.desks = doc.desks.filter((desk) => desk.id !== id);
      if (doc.activeId === id) doc.activeId = doc.desks[0]?.id ?? null;
      await this.save(doc);
      // Erase the conversations too — confirmed semantics. With single-source
      // this is what makes a workspace deletion stick: the sidecars are the only
      // record of these sessions, so removing them prevents any re-derivation.
      for (const session of removed?.sessions ?? []) {
        await deleteSession(session.id).catch(() => undefined);
      }
      return removed;
    });
  }

  async setActive(id: string): Promise<void> {
    return this.mutex.run(async () => {
      const doc = await this.loadDoc();
      if (!doc.desks.some((desk) => desk.id === id)) {
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
      const doc = await this.loadDoc();
      const record = doc.desks.find((d) => d.id === id);
      if (!record) throw new Error(`unknown desk: ${id}`);
      record.name = trimmed;
      await this.save(doc);
      return (await this.derive()).desks.find((d) => d.id === id)!;
    });
  }

  // ---- Session mutations (sidecars are the source of truth) ------------------

  async createSession(
    deskId?: string,
    name?: string,
    options: { cwd?: string; source?: WorkspaceSessionSource } = {},
  ): Promise<{ desk: Desk; session: DeskSession }> {
    return this.mutex.run(async () => {
      const doc = await this.loadDoc();
      const record = this.resolveRecord(doc, deskId);
      if (!record) throw new Error(deskId ? `unknown desk: ${deskId}` : 'no active desk');
      const sessionId = randomUUID();
      const cwd = options.cwd ?? record.cwd;
      await seedSessionMeta(sessionId, cwd, options.source ?? 'desktop', undefined, record.id);
      if (name?.trim()) await setSessionTitle(sessionId, name);
      record.activeSessionId = sessionId;
      await this.save(doc);
      const desk = (await this.derive()).desks.find((d) => d.id === record.id)!;
      const session = desk.sessions.find((s) => s.id === sessionId)!;
      return { desk, session };
    });
  }

  async setActiveSession(sessionId: string): Promise<Desk> {
    return this.mutex.run(async () => {
      const owner = (await this.derive()).desks.find((d) =>
        d.sessions.some((s) => s.id === sessionId),
      );
      if (!owner) throw new Error(`unknown session: ${sessionId}`);
      const doc = await this.loadDoc();
      const record = doc.desks.find((d) => d.id === owner.id) ?? ensureMoxxyRecord(doc);
      record.activeSessionId = sessionId;
      doc.activeId = record.id;
      await this.save(doc);
      return (await this.derive()).desks.find((d) => d.id === record.id)!;
    });
  }

  async removeSession(sessionId: string): Promise<Desk | null> {
    return this.mutex.run(async () => {
      const owner = (await this.derive()).desks.find((d) =>
        d.sessions.some((s) => s.id === sessionId),
      );
      await deleteSession(sessionId).catch(() => undefined);
      if (!owner) return null;
      const doc = await this.loadDoc();
      const record = doc.desks.find((d) => d.id === owner.id);
      const remaining = owner.sessions.filter((s) => s.id !== sessionId);
      // A normal project desk should never drop below one session — seed a fresh
      // one so the user always lands on a live chat surface.
      if (remaining.length === 0 && owner.id !== MOXXY_WORKSPACE_ID) {
        const replacementId = randomUUID();
        await seedSessionMeta(replacementId, owner.cwd, 'desktop', undefined, owner.id);
        if (record) record.activeSessionId = replacementId;
        await this.save(doc);
      } else if (record && record.activeSessionId === sessionId) {
        record.activeSessionId = remaining[0]?.id ?? null;
        await this.save(doc);
      }
      return (await this.derive()).desks.find((d) => d.id === owner.id) ?? null;
    });
  }

  async renameSession(sessionId: string, name: string): Promise<DeskSession> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('name must not be empty');
    const existing = (await this.derive()).desks
      .flatMap((d) => d.sessions)
      .find((s) => s.id === sessionId);
    if (!existing) throw new Error(`unknown session: ${sessionId}`);
    await setSessionTitle(sessionId, trimmed);
    return { ...existing, name: trimmed };
  }

  /** Move a session into another desk by stamping its `groupId`. The grouping is
   *  stored in the session's own file, so the move is visible on every surface. */
  async moveSession(sessionId: string, deskId: string): Promise<Desk> {
    return this.mutex.run(async () => {
      const doc = await this.loadDoc();
      const target = doc.desks.find((d) => d.id === deskId);
      if (!target) throw new Error(`unknown desk: ${deskId}`);
      await setSessionGroup(sessionId, deskId);
      return (await this.derive()).desks.find((d) => d.id === deskId)!;
    });
  }

  // ---- Internals ------------------------------------------------------------

  /** Read the persisted overlay. Old (v2/v3) docs are read in place: their desk
   *  fields carry over and the embedded `sessions[]` is simply ignored (sessions
   *  are derived now) — no migration step. The next `save()` writes v4. */
  private async loadDoc(): Promise<DeskDoc> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as { activeId?: unknown; desks?: unknown[] };
      if (!Array.isArray(parsed.desks)) return emptyDoc();
      const desks = parsed.desks.filter(isValidDeskInput).map(toDeskRecord);
      const activeId = typeof parsed.activeId === 'string' ? parsed.activeId : null;
      return { version: DOC_VERSION, activeId, desks };
    } catch {
      return emptyDoc();
    }
  }

  private async save(doc: DeskDoc): Promise<void> {
    const out = { version: DOC_VERSION, activeId: doc.activeId, desks: doc.desks };
    await writeFileAtomic(this.path, JSON.stringify(out, null, 2));
  }

  /** Build the full `Desk[]` view: overlay desks + sessions derived from the
   *  sidecars, grouped by cwd, with active pointers validated. */
  private async derive(): Promise<{ activeId: string | null; desks: Desk[] }> {
    const doc = await this.loadDoc();
    const listings = (await listSessionMetas()).filter(shouldShow);
    const desks = deriveDesks(doc, listings);
    const activeId = desks.some((d) => d.id === doc.activeId)
      ? doc.activeId
      : desks[0]?.id ?? null;
    return { activeId, desks };
  }

  private resolveDesk(
    view: { activeId: string | null; desks: Desk[] },
    deskId?: string,
  ): Desk | null {
    const id = deskId ?? view.activeId;
    if (!id) return null;
    return view.desks.find((desk) => desk.id === id) ?? null;
  }

  private resolveRecord(doc: DeskDoc, deskId?: string): DeskRecord | null {
    const id = deskId ?? doc.activeId;
    if (!id) return null;
    return doc.desks.find((desk) => desk.id === id) ?? null;
  }
}

export { WorkspaceRegistry as DeskStore };

// ---- Derivation -------------------------------------------------------------

function deriveDesks(doc: DeskDoc, listings: ReadonlyArray<SessionMeta>): Desk[] {
  const projectRecords = doc.desks.filter((r) => r.id !== MOXXY_WORKSPACE_ID);
  const buckets = new Map<string, DeskSession[]>();
  for (const r of doc.desks) buckets.set(r.id, []);
  const unmatched: DeskSession[] = [];

  for (const listing of listings) {
    const session = buildSession(listing);
    const desk = resolveDeskForListing(projectRecords, listing);
    if (desk) buckets.get(desk.id)!.push(session);
    else unmatched.push(session);
  }

  const moxxyRecord = doc.desks.find((r) => r.id === MOXXY_WORKSPACE_ID) ?? null;
  const result: Desk[] = doc.desks.map((record) =>
    finalizeDesk(record, record.id === MOXXY_WORKSPACE_ID ? unmatched : buckets.get(record.id)!),
  );
  // Unmatched sessions with no persisted Moxxy desk get one synthesized so they
  // always have a stable home.
  if (!moxxyRecord && unmatched.length > 0) {
    result.push(finalizeDesk(synthMoxxyRecord(), unmatched));
  }
  return result;
}

function finalizeDesk(record: DeskRecord, sessions: ReadonlyArray<DeskSession>): Desk {
  const ordered = [...sessions].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  const activeSessionId = ordered.some((s) => s.id === record.activeSessionId)
    ? record.activeSessionId
    : ordered[0]?.id ?? null;
  return {
    id: record.id,
    name: record.name,
    cwd: record.cwd,
    color: record.color,
    createdAt: record.createdAt,
    sessions: ordered,
    activeSessionId,
  };
}

/** Which desk a session belongs to: its explicit `groupId` when that desk still
 *  exists, else cwd-containment (CLI/TUI sessions, or a session whose group desk
 *  was deleted). An explicit Moxxy groupId routes to the Moxxy fallback (null). */
function resolveDeskForListing(
  records: ReadonlyArray<DeskRecord>,
  listing: SessionMeta,
): DeskRecord | null {
  if (listing.groupId) {
    if (listing.groupId === MOXXY_WORKSPACE_ID) return null;
    const explicit = records.find((r) => r.id === listing.groupId);
    if (explicit) return explicit;
  }
  return findBestDeskForCwd(records, listing.cwd);
}

function buildSession(listing: SessionMeta): DeskSession {
  return {
    id: listing.id,
    name: displayName(listing),
    createdAt: timestampFromIso(listing.startedAt),
    cwd: listing.cwd,
    firstPrompt: listing.firstPrompt,
    lastActivity: listing.lastActivity,
    eventCount: listing.eventCount,
    provider: listing.provider,
    model: listing.model,
    ...(listing.source ? { source: listing.source } : {}),
  };
}

/** Display name: a user rename wins; otherwise the first prompt (one-line,
 *  length-capped); otherwise a friendly placeholder for a fresh chat. */
function displayName(listing: SessionMeta): string {
  if (listing.title?.trim()) return listing.title.trim();
  return titleFromFirstPrompt(listing.firstPrompt) ?? NEW_SESSION_NAME;
}

function titleFromFirstPrompt(firstPrompt: string | null): string | null {
  if (typeof firstPrompt !== 'string') return null;
  const oneLine = firstPrompt.replace(/\s+/g, ' ').trim();
  if (!oneLine) return null;
  return oneLine.length > MAX_TITLE ? `${oneLine.slice(0, MAX_TITLE - 1).trimEnd()}…` : oneLine;
}

/** Which sidecars surface as sessions. App-created (desktop/mobile) sessions
 *  show even when brand-new/empty; cli/tui sidecars must have a real first
 *  prompt and a live cwd (else they're noise / point at a deleted folder). */
function shouldShow(listing: SessionMeta): boolean {
  const appSession = listing.source === 'desktop' || listing.source === 'mobile';
  if (appSession) return true;
  if (!listing.firstPrompt?.trim()) return false;
  return !listing.cwd || existsSync(listing.cwd);
}

// ---- cwd routing ------------------------------------------------------------

function findBestDeskForCwd(records: ReadonlyArray<DeskRecord>, cwd: string): DeskRecord | null {
  const matches = records
    .filter((desk) => desk.id !== MOXXY_WORKSPACE_ID && pathContains(desk.cwd, cwd))
    .sort((a, b) => normalizedPath(b.cwd).length - normalizedPath(a.cwd).length);
  return matches[0] ?? null;
}

function pathContains(parent: string, child: string): boolean {
  const from = normalizedPath(parent);
  const to = normalizedPath(child);
  const relative = path.relative(from, to);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizedPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

// ---- Moxxy workspace --------------------------------------------------------

function synthMoxxyRecord(): DeskRecord {
  return {
    id: MOXXY_WORKSPACE_ID,
    name: MOXXY_WORKSPACE_NAME,
    cwd: moxxyPath('workspaces', 'moxxy'),
    color: MOXXY_WORKSPACE_COLOR,
    createdAt: 0,
    activeSessionId: null,
  };
}

function ensureMoxxyRecord(doc: DeskDoc): DeskRecord {
  const existing = doc.desks.find((desk) => desk.id === MOXXY_WORKSPACE_ID);
  if (existing) return existing;
  const record = { ...synthMoxxyRecord(), createdAt: Date.now() };
  doc.desks.push(record);
  return record;
}

function ensureDirectoryIfMoxxyWorkspace(desk: { id: string; cwd: string }): void {
  if (desk.id !== MOXXY_WORKSPACE_ID) return;
  try {
    mkdirSync(desk.cwd, { recursive: true });
  } catch {
    // Registry reads should not fail just because the fallback directory cannot
    // be created; the caller will surface any later spawn/cwd error normally.
  }
}

function ensureManagedMoxxyCwd(): string {
  const cwd = moxxyPath('workspaces', 'moxxy');
  try {
    mkdirSync(cwd, { recursive: true });
  } catch {
    // Let the caller surface any later spawn/cwd error; returning a stable
    // managed path is still safer than a known-deleted workspace folder.
  }
  return cwd;
}

// ---- Doc helpers ------------------------------------------------------------

function emptyDoc(): DeskDoc {
  return { version: DOC_VERSION, activeId: null, desks: [] };
}

function isValidDeskInput(value: unknown): value is Record<string, unknown> {
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

function toDeskRecord(value: Record<string, unknown>): DeskRecord {
  return {
    id: value.id as string,
    name: value.name as string,
    cwd: value.cwd as string,
    color: value.color as string,
    createdAt: value.createdAt as number,
    activeSessionId: typeof value.activeSessionId === 'string' ? value.activeSessionId : null,
  };
}

function timestampFromIso(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}
