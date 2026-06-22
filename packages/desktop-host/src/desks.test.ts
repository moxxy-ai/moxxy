import { describe, expect, it, beforeEach } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { cwdForSession, DeskStore, MOXXY_WORKSPACE_ID } from './desks';

let tmp: string;
let storePath: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'desks-'));
  storePath = path.join(tmp, 'desks.json');
});

describe('DeskStore', () => {
  it('returns an empty doc for a missing file', async () => {
    const s = new DeskStore(storePath);
    const list = await s.list();
    expect(list).toEqual([]);
    expect(await s.getActive()).toBeNull();
  });

  it('returns an empty doc for a malformed file', async () => {
    writeFileSync(storePath, '{not json');
    const s = new DeskStore(storePath);
    expect(await s.list()).toEqual([]);
  });

  it('normalizes a dangling activeId (points at a removed desk) to a real desk on load', async () => {
    // A hand-edited / stale desks.json whose activeId references a desk that no
    // longer exists must NOT leave getActive()/listSessions silently empty.
    const desk = {
      id: 'real-desk',
      name: 'Real',
      cwd: '/tmp',
      color: '#3b82f6',
      createdAt: 1,
      sessions: [{ id: 'real-desk', name: 'Session 1', createdAt: 1 }],
      activeSessionId: 'real-desk',
    };
    writeFileSync(
      storePath,
      JSON.stringify({ version: 2, activeId: 'ghost-desk', desks: [desk] }),
    );
    const s = new DeskStore(storePath);
    // activeId falls back to the only real desk rather than staying dangling.
    expect((await s.getActive())?.id).toBe('real-desk');
    const overview = await s.listSessions();
    expect(overview.sessions).toHaveLength(1);
  });

  it('keeps activeId null when the file has no desks', async () => {
    writeFileSync(storePath, JSON.stringify({ version: 2, activeId: 'ghost', desks: [] }));
    const s = new DeskStore(storePath);
    expect(await s.getActive()).toBeNull();
    expect(await s.list()).toEqual([]);
  });

  it('create() persists and auto-activates the first desk', async () => {
    const s = new DeskStore(storePath);
    const desk = await s.create({ name: 'Personal', cwd: '/tmp' });
    expect(desk.id).toBeTruthy();
    expect((await s.list())).toHaveLength(1);
    expect((await s.getActive())?.id).toBe(desk.id);

    // Persistence survives a fresh store instance.
    const fresh = new DeskStore(storePath);
    expect((await fresh.list())[0]!.name).toBe('Personal');
  });

  it('cycles default colors as desks are created', async () => {
    const s = new DeskStore(storePath);
    const a = await s.create({ name: 'A', cwd: '/a' });
    const b = await s.create({ name: 'B', cwd: '/b' });
    expect(a.color).not.toBe(b.color);
  });

  it('setActive() rejects unknown ids', async () => {
    const s = new DeskStore(storePath);
    await expect(s.setActive('nope')).rejects.toThrow(/unknown/);
  });

  it('remove() promotes another desk to active when active is removed', async () => {
    const s = new DeskStore(storePath);
    const a = await s.create({ name: 'A', cwd: '/a' });
    const b = await s.create({ name: 'B', cwd: '/b' });
    await s.setActive(a.id);
    await s.remove(a.id);
    expect((await s.getActive())?.id).toBe(b.id);
  });

  it('atomic write leaves no tmp file behind', async () => {
    const s = new DeskStore(storePath);
    await s.create({ name: 'X', cwd: '/x' });
    const leftovers = readdirSync(tmp).filter((n) => n.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('serializes concurrent creates without clobbering (no lost desks)', async () => {
    const s = new DeskStore(storePath);
    // Fire 8 creates concurrently. Without the mutex each would read the same
    // empty doc and the last save would win, leaving far fewer than 8 desks.
    await Promise.all(
      Array.from({ length: 8 }, (_unused, i) => s.create({ name: `D${i}`, cwd: `/d${i}` })),
    );
    expect(await s.list()).toHaveLength(8);
  });

  it('remove racing setActive never strands activeId on a deleted desk', async () => {
    const s = new DeskStore(storePath);
    const a = await s.create({ name: 'A', cwd: '/a' });
    const b = await s.create({ name: 'B', cwd: '/b' });
    // Interleave the two mutations; whatever the order, activeId must point at
    // a desk that still exists (or be null if everything was removed).
    await Promise.all([s.remove(a.id), s.setActive(a.id).catch(() => {})]);
    const active = await s.getActive();
    const ids = (await s.list()).map((d) => d.id);
    if (active) expect(ids).toContain(active.id);
    expect(ids).toContain(b.id);
  });

  it('write uses pretty JSON', async () => {
    const s = new DeskStore(storePath);
    await s.create({ name: 'X', cwd: '/x' });
    const body = readFileSync(storePath, 'utf8');
    expect(body).toContain('\n');
    expect(body).toContain('"name": "X"');
  });
});

describe('DeskStore v1→v2 migration (sessions)', () => {
  /** A pre-multi-session desks.json — no sessions, no activeSessionId. */
  function writeV1(desks: Array<{ id: string; name: string }>, activeId: string | null): void {
    writeFileSync(
      storePath,
      JSON.stringify({
        version: 1,
        activeId,
        desks: desks.map((d) => ({
          ...d,
          cwd: `/cwd/${d.id}`,
          color: '#3b82f6',
          createdAt: 111,
        })),
      }),
    );
  }

  it('seeds each v1 desk with one session whose id === the desk id', async () => {
    writeV1([{ id: 'desk-a', name: 'A' }, { id: 'desk-b', name: 'B' }], 'desk-b');
    const s = new DeskStore(storePath);
    const desks = await s.list();
    expect(desks).toHaveLength(2);
    for (const desk of desks) {
      expect(desk.sessions).toHaveLength(1);
      // THE migration invariant: the seeded session id equals the desk id, so
      // the runner's sticky ~/.moxxy/sessions/<deskId>.jsonl and the chat
      // mirror ~/.moxxy/chats/<deskId>.jsonl resume untouched.
      expect(desk.sessions[0]!.id).toBe(desk.id);
      expect(desk.sessions[0]!.createdAt).toBe(desk.createdAt);
      expect(desk.activeSessionId).toBe(desk.id);
    }
    expect((await s.getActive())?.id).toBe('desk-b');
  });

  it('create() seeds the first session with id === desk id', async () => {
    const s = new DeskStore(storePath);
    const desk = await s.create({ name: 'Fresh', cwd: '/f' });
    expect(desk.sessions).toHaveLength(1);
    expect(desk.sessions[0]!.id).toBe(desk.id);
    expect(desk.activeSessionId).toBe(desk.id);
  });

  it('repairs a desk whose activeSessionId points at a deleted session', async () => {
    writeV1([{ id: 'desk-a', name: 'A' }], 'desk-a');
    // Hand-corrupt: sessions present but activeSessionId dangling.
    const doc = JSON.parse(readFileSync(storePath, 'utf8'));
    doc.desks[0].sessions = [{ id: 's1', name: 'Session 1', createdAt: 1 }];
    doc.desks[0].activeSessionId = 'gone';
    writeFileSync(storePath, JSON.stringify(doc));
    const s = new DeskStore(storePath);
    const [desk] = await s.list();
    expect(desk!.activeSessionId).toBe('s1');
  });

  it('uses firstPrompt as the display name for placeholder session names', async () => {
    writeV1([{ id: 'desk-a', name: 'A' }], 'desk-a');
    const doc = JSON.parse(readFileSync(storePath, 'utf8'));
    doc.desks[0].sessions = [
      {
        id: 'desk-a',
        name: 'Current session',
        createdAt: 1,
        firstPrompt: 'znasz grę 007 first light ?',
      },
      {
        id: 's2',
        name: 'Session 2',
        createdAt: 2,
        firstPrompt: 'napisz maila do klienta',
      },
      {
        id: 'custom',
        name: 'Manual name',
        createdAt: 3,
        firstPrompt: 'this should not replace custom',
      },
    ];
    writeFileSync(storePath, JSON.stringify(doc));

    const [desk] = await new DeskStore(storePath).list();

    expect(desk?.sessions.map((session) => session.name)).toEqual([
      'znasz grę 007 first light ?',
      'napisz maila do klienta',
      'Manual name',
    ]);
  });

  it('a v2 doc round-trips: mutation persists sessions + version 3', async () => {
    writeV1([{ id: 'desk-a', name: 'A' }], 'desk-a');
    const s = new DeskStore(storePath);
    await s.rename('desk-a', 'Renamed');
    const body = JSON.parse(readFileSync(storePath, 'utf8'));
    expect(body.version).toBe(3);
    expect(body.desks[0].sessions).toHaveLength(1);
    expect(body.desks[0].activeSessionId).toBe('desk-a');
  });
});

describe('WorkspaceRegistry session registration', () => {
  function meta(input: {
    id: string;
    cwd: string;
    firstPrompt?: string | null;
    eventCount?: number;
  }) {
    return {
      id: input.id,
      cwd: input.cwd,
      startedAt: '2026-06-12T10:00:00.000Z',
      lastActivity: '2026-06-12T10:05:00.000Z',
      eventCount: input.eventCount ?? 0,
      firstPrompt: input.firstPrompt ?? null,
      provider: 'anthropic',
      model: 'claude-sonnet',
    };
  }

  it('creates the global Moxxy workspace when no cwd matches an existing desk', async () => {
    const s = new DeskStore(storePath);
    const cwd = path.join(tmp, 'outside');
    mkdirSync(cwd, { recursive: true });
    await s.registerSessionFromMeta(
      meta({ id: 'session-1', cwd, firstPrompt: 'hello from outside', eventCount: 2 }),
      'tui',
    );

    const [desk] = await s.list();
    expect(desk?.id).toBe(MOXXY_WORKSPACE_ID);
    expect(desk?.name).toBe('Moxxy');
    expect(desk?.sessions).toHaveLength(1);
    expect(desk?.sessions[0]).toMatchObject({
      id: 'session-1',
      cwd,
      firstPrompt: 'hello from outside',
      eventCount: 2,
      provider: 'anthropic',
      model: 'claude-sonnet',
      source: 'tui',
    });
    expect(desk?.activeSessionId).toBe('session-1');
  });

  it('assigns a session to an existing workspace when cwd is inside the desk cwd', async () => {
    const projectRoot = path.join(tmp, 'project');
    const sessionCwd = path.join(projectRoot, 'packages', 'cli');
    mkdirSync(sessionCwd, { recursive: true });
    const s = new DeskStore(storePath);
    const desk = await s.create({ name: 'Project', cwd: projectRoot });

    await s.registerSessionFromMeta(
      meta({ id: 'session-2', cwd: sessionCwd, firstPrompt: 'inside project', eventCount: 1 }),
      'cli',
    );

    expect((await s.deskForSession('session-2'))?.id).toBe(desk.id);
  });

  it('chooses the longest matching workspace for nested desk paths', async () => {
    const root = path.join(tmp, 'repo');
    const nested = path.join(root, 'apps', 'desktop');
    const sessionCwd = path.join(nested, 'src');
    mkdirSync(sessionCwd, { recursive: true });
    const s = new DeskStore(storePath);
    await s.create({ name: 'Repo', cwd: root });
    const nestedDesk = await s.create({ name: 'Desktop', cwd: nested });

    await s.registerSessionFromMeta(
      meta({ id: 'session-3', cwd: sessionCwd, firstPrompt: 'nested project', eventCount: 1 }),
      'desktop',
    );

    expect((await s.deskForSession('session-3'))?.id).toBe(nestedDesk.id);
  });

  it('does not duplicate a session when the same id is registered again', async () => {
    const s = new DeskStore(storePath);
    const cwd = path.join(tmp, 'x');
    mkdirSync(cwd, { recursive: true });
    await s.registerSessionFromMeta(
      meta({ id: 'session-4', cwd, firstPrompt: 'old prompt', eventCount: 1 }),
      'tui',
    );
    await s.registerSessionFromMeta(
      meta({
        id: 'session-4',
        cwd,
        firstPrompt: 'hello from tui',
        eventCount: 3,
      }),
      'tui',
    );

    const moxxy = (await s.list()).find((desk) => desk.id === MOXXY_WORKSPACE_ID);
    expect(moxxy?.sessions.filter((session) => session.id === 'session-4')).toHaveLength(1);
    expect(moxxy?.sessions[0]).toMatchObject({
      firstPrompt: 'hello from tui',
      eventCount: 3,
    });
  });

  it('cwdForSession returns the session cwd before falling back to the desk cwd', async () => {
    const s = new DeskStore(storePath);
    const desk = await s.create({ name: 'Project', cwd: path.join(tmp, 'project') });
    const { session } = await s.createSession(desk.id, 'Other');
    session.cwd = path.join(tmp, 'project', 'nested');
    mkdirSync(session.cwd, { recursive: true });

    expect(cwdForSession({ ...desk, sessions: [desk.sessions[0]!, session] }, session.id)).toBe(
      session.cwd,
    );
    expect(cwdForSession(desk, desk.id)).toBe(desk.cwd);
  });
});

describe('DeskStore sessions', () => {
  async function seeded() {
    const s = new DeskStore(storePath);
    const desk = await s.create({ name: 'A', cwd: '/a' });
    return { s, desk };
  }

  it('createSession appends an auto-named session without changing the active one', async () => {
    const { s, desk } = await seeded();
    const { session } = await s.createSession(desk.id);
    expect(session.name).toBe('Session 2');
    const overview = await s.listSessions(desk.id);
    expect(overview.sessions.map((x) => x.id)).toEqual([desk.id, session.id]);
    expect(overview.activeSessionId).toBe(desk.id);
  });

  it('createSession defaults to the active desk and honors an explicit name', async () => {
    const { s, desk } = await seeded();
    const { desk: owner, session } = await s.createSession(undefined, '  Research  ');
    expect(owner.id).toBe(desk.id);
    expect(session.name).toBe('Research');
  });

  it('createSession never mints a duplicate auto-name after deletions', async () => {
    const { s, desk } = await seeded();
    const { session: s2 } = await s.createSession(desk.id);
    const { session: s3 } = await s.createSession(desk.id);
    expect(s3.name).toBe('Session 3');
    await s.removeSession(s2.id);
    const { session: s4 } = await s.createSession(desk.id);
    // 2 sessions left → count+1 = 3 is taken, so bump past it.
    expect(s4.name).not.toBe(s3.name);
  });

  it('createSession rejects an unknown desk', async () => {
    const { s } = await seeded();
    await expect(s.createSession('nope')).rejects.toThrow(/unknown desk/);
  });

  it('setActiveSession activates the session AND its desk', async () => {
    const { s, desk } = await seeded();
    const other = await s.create({ name: 'B', cwd: '/b' });
    const { session } = await s.createSession(other.id);
    const owner = await s.setActiveSession(session.id);
    expect(owner.id).toBe(other.id);
    expect(owner.activeSessionId).toBe(session.id);
    expect((await s.getActive())?.id).toBe(other.id);
    // The first desk's own active session is untouched.
    expect((await s.listSessions(desk.id)).activeSessionId).toBe(desk.id);
  });

  it('setActiveSession rejects unknown ids', async () => {
    const { s } = await seeded();
    await expect(s.setActiveSession('nope')).rejects.toThrow(/unknown session/);
  });

  it('removeSession promotes another session when the active one is removed', async () => {
    const { s, desk } = await seeded();
    const { session } = await s.createSession(desk.id);
    await s.setActiveSession(session.id);
    const updated = await s.removeSession(session.id);
    expect(updated!.sessions.map((x) => x.id)).toEqual([desk.id]);
    expect(updated!.activeSessionId).toBe(desk.id);
  });

  it('removeSession of the LAST session seeds a fresh replacement (desk keeps >= 1)', async () => {
    const { s, desk } = await seeded();
    const updated = await s.removeSession(desk.id);
    expect(updated!.sessions).toHaveLength(1);
    const fresh = updated!.sessions[0]!;
    expect(fresh.id).not.toBe(desk.id);
    expect(updated!.activeSessionId).toBe(fresh.id);
  });

  it('removeSession returns null for unknown ids', async () => {
    const { s } = await seeded();
    expect(await s.removeSession('nope')).toBeNull();
  });

  it('renameSession persists; empty names rejected', async () => {
    const { s, desk } = await seeded();
    const renamed = await s.renameSession(desk.id, '  Deep dive ');
    expect(renamed.name).toBe('Deep dive');
    expect((await s.listSessions(desk.id)).sessions[0]!.name).toBe('Deep dive');
    await expect(s.renameSession(desk.id, '   ')).rejects.toThrow(/empty/);
    await expect(s.renameSession('nope', 'x')).rejects.toThrow(/unknown session/);
  });

  it('deskForSession finds the owning desk', async () => {
    const { s, desk } = await seeded();
    const { session } = await s.createSession(desk.id);
    expect((await s.deskForSession(session.id))?.id).toBe(desk.id);
    expect(await s.deskForSession('nope')).toBeNull();
  });

  it('remove() returns the removed desk with its sessions', async () => {
    const { s, desk } = await seeded();
    const { session } = await s.createSession(desk.id);
    const removed = await s.remove(desk.id);
    expect(removed?.id).toBe(desk.id);
    expect(removed?.sessions.map((x) => x.id)).toEqual([desk.id, session.id]);
    expect(await s.remove('nope')).toBeNull();
  });

  it('listSessions of an unknown desk returns an empty overview', async () => {
    const { s } = await seeded();
    expect(await s.listSessions('nope')).toEqual({ sessions: [], activeSessionId: null });
  });
});
