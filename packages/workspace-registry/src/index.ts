/**
 * Shared workspace/session registry for every Moxxy surface.
 *
 * The file intentionally stays at ~/.moxxy/desktop/desks.json so the desktop
 * keeps reading the user's existing workspace list. v3 extends the old desk
 * document with session metadata copied from ~/.moxxy/sessions/*.meta.json.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { readSessionIndex, type SessionMeta } from '@moxxy/core';
import type { Desk, DeskSession, SessionsOverview } from '@moxxy/desktop-ipc-contract';
import { createMutex, moxxyPath, writeFileAtomic, type Mutex } from '@moxxy/sdk';

export const MOXXY_WORKSPACE_ID = 'moxxy';
export const MOXXY_WORKSPACE_NAME = 'Moxxy';
export const MOXXY_WORKSPACE_COLOR = '#ec4899';

const DEFAULT_SESSION_NAME = 'Session 1';
const CURRENT_SESSION_NAME = 'Current session';
const DOC_VERSION = 3;
const DEFAULT_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#10b981',
  '#8b5cf6',
  '#f59e0b',
  '#06b6d4',
];

interface DeskDoc {
  version: 3;
  activeId: string | null;
  desks: Desk[];
}

interface ActivePointerSnapshot {
  readonly activeId: string | null;
  readonly desks: ReadonlyArray<{
    readonly id: string;
    readonly activeSessionId: string | null;
  }>;
}

export type WorkspaceSessionSource = NonNullable<DeskSession['source']>;

interface RegisterSessionOptions {
  readonly activate?: boolean;
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

export async function syncSessionIndexIntoRegistry(
  registry: WorkspaceRegistry = new WorkspaceRegistry(),
  source: WorkspaceSessionSource = 'cli',
): Promise<void> {
  await registry.registerSessionsFromMeta(
    (await readSessionIndex()).filter(shouldImportSessionMeta),
    source,
  );
}

export class WorkspaceRegistry {
  private readonly path: string;
  private readonly mutex: Mutex = createMutex();

  constructor(filePath: string = defaultWorkspaceRegistryPath()) {
    this.path = filePath;
  }

  async load(): Promise<DeskDoc> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as { activeId?: string | null; desks?: unknown[] };
      if (!Array.isArray(parsed.desks)) return emptyDoc();
      const normalized = parsed.desks.filter(isValidDesk).map((desk) => normalizeSessions(desk));
      const needsSessionIndex = normalized.some((desk) => desk.sessions.some(isImportedSession));
      const indexedSessions = needsSessionIndex ? await readSessionIndex().catch(() => []) : [];
      const indexedById = new Map(indexedSessions.map((meta) => [meta.id, meta]));
      const desks = await Promise.all(
        normalized.map((desk) => hydrateLegacySessionNames(desk, indexedById)),
      );
      const activeId = desks.some((desk) => desk.id === parsed.activeId)
        ? parsed.activeId ?? null
        : desks[0]?.id ?? null;
      return { version: DOC_VERSION, activeId, desks };
    } catch {
      return emptyDoc();
    }
  }

  async save(doc: DeskDoc): Promise<void> {
    await writeFileAtomic(this.path, JSON.stringify({ ...doc, version: DOC_VERSION }, null, 2));
  }

  async list(): Promise<Desk[]> {
    return (await this.load()).desks;
  }

  async getActive(): Promise<Desk | null> {
    const doc = await this.load();
    return doc.desks.find((desk) => desk.id === doc.activeId) ?? null;
  }

  async ensureMoxxyWorkspace(): Promise<Desk> {
    return this.mutex.run(async () => {
      const doc = await this.load();
      const desk = ensureMoxxyWorkspaceInDoc(doc);
      if (!doc.activeId) doc.activeId = desk.id;
      await this.save(doc);
      return desk;
    });
  }

  async registerSessionFromMeta(
    meta: SessionMeta,
    source: WorkspaceSessionSource,
    options: RegisterSessionOptions = {},
  ): Promise<{ desk: Desk; session: DeskSession }> {
    return this.mutex.run(async () => {
      const doc = await this.load();
      const registered = registerSessionInDoc(doc, meta, source, options);
      await this.saveRegistrationDoc(doc, options);
      return registered;
    });
  }

  async registerSessionsFromMeta(
    metas: ReadonlyArray<SessionMeta>,
    source: WorkspaceSessionSource,
  ): Promise<void> {
    if (metas.length === 0) return;
    await this.mutex.run(async () => {
      const doc = await this.load();
      for (const meta of metas) {
        registerSessionInDoc(doc, meta, source);
      }
      await this.saveRegistrationDoc(doc, {});
    });
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
        color: input.color ?? DEFAULT_COLORS[doc.desks.length % DEFAULT_COLORS.length]!,
        createdAt,
        sessions: [
          {
            id,
            name: DEFAULT_SESSION_NAME,
            createdAt,
            cwd: input.cwd,
            source: 'desktop',
          },
        ],
        activeSessionId: id,
      };
      doc.desks.push(desk);
      if (!doc.activeId) doc.activeId = desk.id;
      await this.save(doc);
      return desk;
    });
  }

  async remove(id: string): Promise<Desk | null> {
    return this.mutex.run(async () => {
      const doc = await this.load();
      const removed = doc.desks.find((desk) => desk.id === id) ?? null;
      doc.desks = doc.desks.filter((desk) => desk.id !== id);
      if (doc.activeId === id) doc.activeId = doc.desks[0]?.id ?? null;
      await this.save(doc);
      return removed;
    });
  }

  async setActive(id: string): Promise<void> {
    return this.mutex.run(async () => {
      const doc = await this.load();
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
      const doc = await this.load();
      const desk = doc.desks.find((d) => d.id === id);
      if (!desk) throw new Error(`unknown desk: ${id}`);
      desk.name = trimmed;
      await this.save(doc);
      return desk;
    });
  }

  async listSessions(deskId?: string): Promise<SessionsOverview> {
    const doc = await this.load();
    const desk = this.resolveDesk(doc, deskId);
    if (!desk) return { sessions: [], activeSessionId: null };
    return { sessions: desk.sessions, activeSessionId: desk.activeSessionId };
  }

  async deskForSession(sessionId: string): Promise<Desk | null> {
    const doc = await this.load();
    return doc.desks.find((desk) => desk.sessions.some((session) => session.id === sessionId)) ?? null;
  }

  async createSession(
    deskId?: string,
    name?: string,
    options: { cwd?: string; source?: WorkspaceSessionSource } = {},
  ): Promise<{ desk: Desk; session: DeskSession }> {
    return this.mutex.run(async () => {
      const doc = await this.load();
      const desk = this.resolveDesk(doc, deskId);
      if (!desk) throw new Error(deskId ? `unknown desk: ${deskId}` : 'no active desk');
      const session: DeskSession = {
        id: randomUUID(),
        name: name?.trim() || nextSessionName(desk.sessions),
        createdAt: Date.now(),
        cwd: options.cwd ?? desk.cwd,
        source: options.source ?? 'desktop',
      };
      desk.sessions.push(session);
      if (!desk.activeSessionId) desk.activeSessionId = session.id;
      await this.save(doc);
      return { desk, session };
    });
  }

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

  async removeSession(sessionId: string): Promise<Desk | null> {
    return this.mutex.run(async () => {
      const doc = await this.load();
      const desk = doc.desks.find((d) => d.sessions.some((s) => s.id === sessionId));
      if (!desk) return null;
      desk.sessions = desk.sessions.filter((session) => session.id !== sessionId);
      if (desk.sessions.length === 0 && desk.id !== MOXXY_WORKSPACE_ID) {
        desk.sessions = [
          {
            id: randomUUID(),
            name: DEFAULT_SESSION_NAME,
            createdAt: Date.now(),
            cwd: desk.cwd,
            source: 'desktop',
          },
        ];
      }
      if (desk.activeSessionId === sessionId) {
        desk.activeSessionId = desk.sessions[0]?.id ?? null;
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
      const session = doc.desks.flatMap((desk) => desk.sessions).find((s) => s.id === sessionId);
      if (!session) throw new Error(`unknown session: ${sessionId}`);
      session.name = trimmed;
      await this.save(doc);
      return session;
    });
  }

  private resolveDesk(doc: DeskDoc, deskId?: string): Desk | null {
    const id = deskId ?? doc.activeId;
    if (!id) return null;
    return doc.desks.find((desk) => desk.id === id) ?? null;
  }

  private async saveRegistrationDoc(
    doc: DeskDoc,
    options: RegisterSessionOptions,
  ): Promise<void> {
    if (!options.activate) {
      preserveLatestActivePointers(doc, await this.loadActivePointerSnapshot());
    }
    await this.save(doc);
  }

  protected async loadActivePointerSnapshot(): Promise<ActivePointerSnapshot | null> {
    return readActivePointerSnapshot(this.path);
  }
}

export { WorkspaceRegistry as DeskStore };

function emptyDoc(): DeskDoc {
  return { version: DOC_VERSION, activeId: null, desks: [] };
}

function ensureMoxxyWorkspaceInDoc(doc: DeskDoc): Desk {
  const existing = doc.desks.find((desk) => desk.id === MOXXY_WORKSPACE_ID);
  if (existing) {
    ensureDirectoryIfMoxxyWorkspace(existing);
    return existing;
  }
  const desk: Desk = {
    id: MOXXY_WORKSPACE_ID,
    name: MOXXY_WORKSPACE_NAME,
    cwd: moxxyPath('workspaces', 'moxxy'),
    color: MOXXY_WORKSPACE_COLOR,
    createdAt: Date.now(),
    sessions: [],
    activeSessionId: null,
  };
  ensureDirectoryIfMoxxyWorkspace(desk);
  doc.desks.push(desk);
  return desk;
}

function findBestDeskForCwd(doc: DeskDoc, cwd: string): Desk | null {
  const matches = doc.desks
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

function findSession(
  doc: DeskDoc,
  sessionId: string,
): { desk: Desk; session: DeskSession } | null {
  for (const desk of doc.desks) {
    const session = desk.sessions.find((candidate) => candidate.id === sessionId);
    if (session) return { desk, session };
  }
  return null;
}

function registerSessionInDoc(
  doc: DeskDoc,
  meta: SessionMeta,
  source: WorkspaceSessionSource,
  options: RegisterSessionOptions = {},
): { desk: Desk; session: DeskSession } {
  const existing = findSession(doc, meta.id);
  if (existing) {
    Object.assign(existing.session, sessionPatchFromMeta(existing.session, meta, source));
    if (options.activate) {
      existing.desk.activeSessionId = existing.session.id;
      doc.activeId = existing.desk.id;
    }
    return existing;
  }

  const desk = findBestDeskForCwd(doc, meta.cwd) ?? ensureMoxxyWorkspaceInDoc(doc);
  const session: DeskSession = sessionFromMeta(meta, source);
  desk.sessions.push(session);
  if (!desk.activeSessionId || options.activate) desk.activeSessionId = session.id;
  if (!doc.activeId || options.activate) doc.activeId = desk.id;
  return { desk, session };
}

async function readActivePointerSnapshot(filePath: string): Promise<ActivePointerSnapshot | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const value = parsed as { activeId?: unknown; desks?: unknown[] };
  return {
    activeId: typeof value.activeId === 'string' ? value.activeId : null,
    desks: Array.isArray(value.desks)
      ? value.desks.flatMap((desk) => {
          if (!desk || typeof desk !== 'object') return [];
          const candidate = desk as { id?: unknown; activeSessionId?: unknown };
          if (typeof candidate.id !== 'string') return [];
          return [
            {
              id: candidate.id,
              activeSessionId:
                typeof candidate.activeSessionId === 'string'
                  ? candidate.activeSessionId
                  : null,
            },
          ];
        })
      : [],
  };
}

function preserveLatestActivePointers(
  doc: DeskDoc,
  latest: ActivePointerSnapshot | null,
): void {
  if (!latest) return;
  if (latest.activeId && doc.desks.some((desk) => desk.id === latest.activeId)) {
    doc.activeId = latest.activeId;
  }
  for (const desk of doc.desks) {
    const latestDesk = latest.desks.find((candidate) => candidate.id === desk.id);
    const latestActiveSessionId = latestDesk?.activeSessionId;
    if (
      latestActiveSessionId &&
      desk.sessions.some((session) => session.id === latestActiveSessionId)
    ) {
      desk.activeSessionId = latestActiveSessionId;
    }
  }
}

function sessionFromMeta(meta: SessionMeta, source: WorkspaceSessionSource): DeskSession {
  return {
    id: meta.id,
    name: sessionNameFromMeta(meta),
    createdAt: timestampFromIso(meta.startedAt),
    ...metaFields(meta, source),
  };
}

function sessionPatchFromMeta(
  existing: DeskSession,
  meta: SessionMeta,
  source: WorkspaceSessionSource,
): Partial<DeskSession> {
  const partialResume = isPartialResumeMeta(existing, meta);
  return {
    ...metaFields(meta, source, partialResume ? existing : null),
    name: partialResume
      ? existing.name
      : shouldRefreshSessionNameFromMeta(existing, meta)
        ? sessionNameFromMeta(meta)
        : existing.name,
  };
}

function metaFields(
  meta: SessionMeta,
  source: WorkspaceSessionSource,
  preserve?: Pick<DeskSession, 'firstPrompt' | 'eventCount'> | null,
): Partial<DeskSession> {
  return {
    cwd: meta.cwd,
    firstPrompt: preserve ? preserve.firstPrompt : meta.firstPrompt,
    lastActivity: meta.lastActivity,
    eventCount: preserve ? preserve.eventCount : meta.eventCount,
    provider: meta.provider,
    model: meta.model,
    source,
  };
}

function isPartialResumeMeta(existing: DeskSession, meta: SessionMeta): boolean {
  if (!hasUserVisibleContent(existing)) return false;
  if (!meta.firstPrompt?.trim()) return false;
  if (meta.firstPrompt.trim() === existing.firstPrompt?.trim()) return false;
  if (typeof existing.eventCount !== 'number') return false;
  if (meta.eventCount >= existing.eventCount) return false;
  return timestampFromIso(meta.startedAt) > existing.createdAt;
}

function sessionNameFromMeta(meta: SessionMeta): string {
  return meta.firstPrompt?.trim() || CURRENT_SESSION_NAME;
}

function shouldRefreshSessionName(name: string): boolean {
  return name === CURRENT_SESSION_NAME || /^Session \d+$/.test(name);
}

function shouldRefreshSessionNameFromMeta(existing: DeskSession, meta: SessionMeta): boolean {
  if (shouldRefreshSessionName(existing.name)) return true;
  const previousPrompt = existing.firstPrompt?.trim();
  return Boolean(
    previousPrompt &&
      meta.firstPrompt?.trim() &&
      previousPrompt !== meta.firstPrompt.trim() &&
      existing.name === previousPrompt,
  );
}

function timestampFromIso(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function nextSessionName(sessions: ReadonlyArray<DeskSession>): string {
  let n = sessions.length + 1;
  const taken = new Set(sessions.map((s) => s.name));
  while (taken.has(`Session ${n}`)) n += 1;
  return `Session ${n}`;
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

function normalizeSessions(desk: Desk): Desk {
  const raw = Array.isArray(desk.sessions) ? desk.sessions : [];
  ensureDirectoryIfMoxxyWorkspace(desk);
  let sessions = raw
    .filter(isValidSession)
    .map(normalizeSession)
    .filter((session) => shouldKeepSession(desk, session));
  if (sessions.length === 0 && desk.id !== MOXXY_WORKSPACE_ID) {
    sessions = [
      {
        id: desk.id,
        name: DEFAULT_SESSION_NAME,
        createdAt: desk.createdAt,
        cwd: desk.cwd,
        source: 'desktop',
      },
    ];
  }
  const activeSessionId = sessions.some((s) => s.id === desk.activeSessionId)
    ? desk.activeSessionId
    : sessions[0]?.id ?? null;
  return { ...desk, sessions, activeSessionId };
}

function shouldImportSessionMeta(meta: SessionMeta): boolean {
  return hasUserVisibleContent(meta) && existsSync(meta.cwd);
}

function shouldKeepSession(desk: Desk, session: DeskSession): boolean {
  if (session.source == null || session.source === 'desktop' || session.id === desk.id) return true;
  if (session.source === 'mobile' && session.id === desk.activeSessionId) return true;
  return hasUserVisibleContent(session) && (!session.cwd || existsSync(session.cwd));
}

function hasUserVisibleContent(value: {
  readonly firstPrompt?: string | null;
  readonly eventCount?: number;
}): boolean {
  return Boolean(value.firstPrompt?.trim());
}

function ensureDirectoryIfMoxxyWorkspace(desk: Desk): void {
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

function isValidSession(value: unknown): value is DeskSession {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' && typeof v.name === 'string' && typeof v.createdAt === 'number'
  );
}

function normalizeSession(session: DeskSession): DeskSession {
  const firstPrompt =
    typeof session.firstPrompt === 'string' && session.firstPrompt.trim()
      ? session.firstPrompt.trim()
      : null;
  const normalized: DeskSession = {
    id: session.id,
    name: firstPrompt && shouldRefreshSessionName(session.name) ? firstPrompt : session.name,
    createdAt: session.createdAt,
  };
  if (typeof session.cwd === 'string') normalized.cwd = session.cwd;
  if (firstPrompt || session.firstPrompt === null) {
    normalized.firstPrompt = session.firstPrompt;
  }
  if (typeof session.lastActivity === 'string') normalized.lastActivity = session.lastActivity;
  if (typeof session.eventCount === 'number') normalized.eventCount = session.eventCount;
  if (typeof session.provider === 'string' || session.provider === null) {
    normalized.provider = session.provider;
  }
  if (typeof session.model === 'string' || session.model === null) normalized.model = session.model;
  if (isSessionSource(session.source)) normalized.source = session.source;
  return normalized;
}

async function hydrateLegacySessionNames(
  desk: Desk,
  indexedById: ReadonlyMap<string, SessionMeta>,
): Promise<Desk> {
  const hydrated = await Promise.all(
    desk.sessions.map(async (session) => {
      if (session.source === 'mobile' && session.id === desk.activeSessionId) return session;
      if (isImportedSession(session)) {
        const meta = indexedById.get(session.id);
        if (meta) {
          if (!shouldImportSessionMeta(meta)) {
            return hasUserVisibleContent(session) || session.id === desk.activeSessionId
              ? session
              : null;
          }
          return {
            ...session,
            ...metaFields(meta, session.source),
            name: shouldRefreshSessionNameFromMeta(session, meta)
              ? sessionNameFromMeta(meta)
              : session.name,
          };
        }
        if (existsSync(moxxyPath('sessions', `${session.id}.jsonl`))) return null;
        return session;
      }
      if (session.firstPrompt?.trim() || !shouldRefreshSessionName(session.name)) return session;
      const firstPrompt = await firstPromptFromJsonl(
        moxxyPath('chats', `${session.id}.jsonl`),
        session.id,
      );
      if (!firstPrompt) return session;
      return { ...session, name: firstPrompt, firstPrompt };
    }),
  );
  let sessions = hydrated.filter((session): session is DeskSession => session !== null);
  if (sessions.length === 0 && desk.id !== MOXXY_WORKSPACE_ID) {
    sessions = [
      {
        id: desk.id,
        name: DEFAULT_SESSION_NAME,
        createdAt: desk.createdAt,
        cwd: desk.cwd,
        source: 'desktop',
      },
    ];
  }
  const activeSessionId = sessions.some((session) => session.id === desk.activeSessionId)
    ? desk.activeSessionId
    : sessions[0]?.id ?? null;
  return { ...desk, sessions, activeSessionId };
}

async function firstPromptFromJsonl(filePath: string, sessionId: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as { sessionId?: unknown; type?: unknown; text?: unknown };
      if (
        event.sessionId === sessionId &&
        event.type === 'user_prompt' &&
        typeof event.text === 'string'
      ) {
        const text = event.text.trim();
        if (text) return text.slice(0, 80);
      }
    } catch {
      // Keep scanning: one corrupt chat mirror line should not hide a later prompt.
    }
  }
  return null;
}

function isSessionSource(value: unknown): value is WorkspaceSessionSource {
  return value === 'desktop' || value === 'tui' || value === 'mobile' || value === 'cli';
}

function isImportedSession(session: DeskSession): session is DeskSession & {
  source: WorkspaceSessionSource;
} {
  return session.source === 'cli' || session.source === 'tui' || session.source === 'mobile';
}
