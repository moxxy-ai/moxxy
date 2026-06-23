import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  cwdForSession,
  MOXXY_WORKSPACE_ID,
  WorkspaceRegistry,
  type WorkspaceSessionSource,
} from './index';

let home: string;
let sessionsDir: string;
let originalHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'wsreg-'));
  sessionsDir = path.join(home, 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  originalHome = process.env.MOXXY_HOME;
  process.env.MOXXY_HOME = home;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

/** Write a session's single metadata file (`<id>.json`) + its event log. */
function writeSession(input: {
  id: string;
  cwd: string;
  source?: WorkspaceSessionSource;
  groupId?: string | null;
  title?: string | null;
  firstPrompt?: string | null;
  startedAt?: string;
  realizeCwd?: boolean;
}): void {
  const startedAt = input.startedAt ?? '2026-06-23T10:00:00.000Z';
  // cli/tui sessions only surface when their cwd exists on disk, so realize it
  // (unless a test is exercising the missing-cwd path).
  if (input.realizeCwd !== false) mkdirSync(input.cwd, { recursive: true });
  const meta = {
    version: 1,
    id: input.id,
    cwd: input.cwd,
    startedAt,
    lastActivity: startedAt,
    eventCount: input.firstPrompt ? 1 : 0,
    firstPrompt: input.firstPrompt ?? null,
    provider: null,
    model: null,
    ...(input.source ? { source: input.source } : {}),
    ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
  };
  writeFileSync(path.join(sessionsDir, `${input.id}.json`), JSON.stringify(meta), 'utf8');
  writeFileSync(path.join(sessionsDir, `${input.id}.jsonl`), '', 'utf8');
}

const registry = (): WorkspaceRegistry => new WorkspaceRegistry();

describe('WorkspaceRegistry — derived session list', () => {
  it('groups a session into the desk whose cwd contains it', async () => {
    const reg = registry();
    const desk = await reg.create({ name: 'Project', cwd: path.join(home, 'project') });
    writeSession({ id: 's1', cwd: path.join(home, 'project'), firstPrompt: 'hello', source: 'cli' });

    const fresh = (await reg.list()).find((d) => d.id === desk.id)!;
    expect(fresh.sessions.map((s) => s.id)).toContain('s1');
  });

  it('routes an unmatched session to the Moxxy workspace', async () => {
    const reg = registry();
    writeSession({ id: 'lonely', cwd: home, firstPrompt: 'outside any desk', source: 'tui' });

    const desks = await reg.list();
    const moxxy = desks.find((d) => d.id === MOXXY_WORKSPACE_ID);
    expect(moxxy?.sessions.map((s) => s.id)).toEqual(['lonely']);
  });

  it('honors an explicit groupId over cwd', async () => {
    const reg = registry();
    const a = await reg.create({ name: 'A', cwd: path.join(home, 'a') });
    const b = await reg.create({ name: 'B', cwd: path.join(home, 'b') });
    // cwd is under A, but groupId pins it to B.
    writeSession({
      id: 'pinned',
      cwd: path.join(home, 'a'),
      groupId: b.id,
      firstPrompt: 'pinned to B',
      source: 'cli',
    });

    const desks = await reg.list();
    expect(desks.find((d) => d.id === a.id)!.sessions.some((s) => s.id === 'pinned')).toBe(false);
    expect(desks.find((d) => d.id === b.id)!.sessions.some((s) => s.id === 'pinned')).toBe(true);
  });

  it('shows empty desktop/mobile sessions but hides empty cli/tui ones', async () => {
    const reg = registry();
    await reg.create({ name: 'Proj', cwd: path.join(home, 'proj') });
    writeSession({ id: 'fresh-desktop', cwd: path.join(home, 'proj'), source: 'desktop' });
    writeSession({ id: 'fresh-cli', cwd: path.join(home, 'proj'), source: 'cli' });

    const ids = (await reg.list()).flatMap((d) => d.sessions.map((s) => s.id));
    expect(ids).toContain('fresh-desktop');
    expect(ids).not.toContain('fresh-cli');
  });

  it('hides a cli session whose cwd no longer exists', async () => {
    const reg = registry();
    writeSession({ id: 'stale', cwd: path.join(home, 'gone'), firstPrompt: 'stale', source: 'cli', realizeCwd: false });
    expect((await reg.list()).flatMap((d) => d.sessions)).toEqual([]);
  });

  it('names a session: title > first prompt > placeholder', async () => {
    const reg = registry();
    await reg.create({ name: 'Proj', cwd: path.join(home, 'proj') });
    writeSession({ id: 'renamed', cwd: path.join(home, 'proj'), title: 'My deep dive', firstPrompt: 'hi', source: 'cli' });
    writeSession({ id: 'prompted', cwd: path.join(home, 'proj'), firstPrompt: 'explain the build', source: 'cli' });
    writeSession({ id: 'blank', cwd: path.join(home, 'proj'), source: 'desktop' });

    const byId = new Map(
      (await reg.list()).flatMap((d) => d.sessions).map((s) => [s.id, s.name]),
    );
    expect(byId.get('renamed')).toBe('My deep dive');
    expect(byId.get('prompted')).toBe('explain the build');
    expect(byId.get('blank')).toBe('New session');
  });
});

describe('WorkspaceRegistry — desk + session mutations', () => {
  it('create seeds a first session (id === desk id) that shows immediately', async () => {
    const reg = registry();
    const desk = await reg.create({ name: 'Proj', cwd: path.join(home, 'proj') });
    expect(desk.sessions.map((s) => s.id)).toEqual([desk.id]);
    expect(desk.activeSessionId).toBe(desk.id);
  });

  it('createSession adds a session under the desk and foregrounds it', async () => {
    const reg = registry();
    const desk = await reg.create({ name: 'Proj', cwd: path.join(home, 'proj') });
    const { session } = await reg.createSession(desk.id, 'Second');
    const fresh = (await reg.list()).find((d) => d.id === desk.id)!;
    expect(fresh.sessions.map((s) => s.id)).toContain(session.id);
    expect(fresh.activeSessionId).toBe(session.id);
    expect(fresh.sessions.find((s) => s.id === session.id)!.name).toBe('Second');
  });

  it('renameSession persists a title that the derived name reflects', async () => {
    const reg = registry();
    const desk = await reg.create({ name: 'Proj', cwd: path.join(home, 'proj') });
    await reg.renameSession(desk.id, 'Renamed');
    const fresh = (await reg.list()).find((d) => d.id === desk.id)!;
    expect(fresh.sessions.find((s) => s.id === desk.id)!.name).toBe('Renamed');
  });

  it('removeSession deletes the session for good — it never reappears (resurrection regression)', async () => {
    const reg = registry();
    const desk = await reg.create({ name: 'Proj', cwd: path.join(home, 'proj') });
    const { session } = await reg.createSession(desk.id, 'Doomed');

    await reg.removeSession(session.id);

    // Gone now AND on a fresh registry instance (i.e. survives a "restart").
    expect((await reg.list()).flatMap((d) => d.sessions).some((s) => s.id === session.id)).toBe(false);
    expect((await registry().list()).flatMap((d) => d.sessions).some((s) => s.id === session.id)).toBe(false);
  });

  it("removeSession of a desk's last session seeds a fresh replacement", async () => {
    const reg = registry();
    const desk = await reg.create({ name: 'Proj', cwd: path.join(home, 'proj') });
    await reg.removeSession(desk.id);
    const fresh = (await reg.list()).find((d) => d.id === desk.id)!;
    expect(fresh.sessions).toHaveLength(1);
    expect(fresh.sessions[0]!.id).not.toBe(desk.id);
  });

  it('remove erases every session in the desk (workspace deletion sticks)', async () => {
    const reg = registry();
    const desk = await reg.create({ name: 'Proj', cwd: path.join(home, 'proj') });
    const { session } = await reg.createSession(desk.id);

    await reg.remove(desk.id);

    const desks = await registry().list();
    expect(desks.some((d) => d.id === desk.id)).toBe(false);
    // The sessions' files are gone, so they can't resurface under Moxxy either.
    const allIds = desks.flatMap((d) => d.sessions.map((s) => s.id));
    expect(allIds).not.toContain(desk.id);
    expect(allIds).not.toContain(session.id);
  });

  it('moveSession re-homes a session into another desk', async () => {
    const reg = registry();
    const a = await reg.create({ name: 'A', cwd: path.join(home, 'a') });
    const b = await reg.create({ name: 'B', cwd: path.join(home, 'b') });

    await reg.moveSession(a.id, b.id);

    const desks = await reg.list();
    expect(desks.find((d) => d.id === a.id)!.sessions.some((s) => s.id === a.id)).toBe(false);
    expect(desks.find((d) => d.id === b.id)!.sessions.some((s) => s.id === a.id)).toBe(true);
  });

  it('setActiveSession foregrounds the owning desk', async () => {
    const reg = registry();
    const a = await reg.create({ name: 'A', cwd: path.join(home, 'a') });
    const b = await reg.create({ name: 'B', cwd: path.join(home, 'b') });
    await reg.setActive(a.id);

    await reg.setActiveSession(b.id);

    expect((await reg.getActive())?.id).toBe(b.id);
  });
});

describe('WorkspaceRegistry — overlay persistence (no migration)', () => {
  it('keeps desk definitions from an existing doc and ignores any embedded sessions', async () => {
    // An older-shape doc with embedded sessions[]: desk defs carry over, the
    // embedded sessions are ignored (sessions derive from the session files).
    mkdirSync(path.join(home, 'desktop'), { recursive: true });
    mkdirSync(path.join(home, 'legacy'), { recursive: true });
    writeFileSync(
      path.join(home, 'desktop', 'desks.json'),
      JSON.stringify({
        version: 3,
        activeId: 'legacy-desk',
        desks: [
          {
            id: 'legacy-desk',
            name: 'Legacy',
            cwd: path.join(home, 'legacy'),
            color: '#abcabc',
            createdAt: 1,
            activeSessionId: 'ghost',
            sessions: [{ id: 'ghost', name: 'Should be ignored', createdAt: 1 }],
          },
        ],
      }),
      'utf8',
    );

    const desks = await registry().list();
    const legacy = desks.find((d) => d.id === 'legacy-desk');
    expect(legacy?.name).toBe('Legacy');
    expect(legacy?.sessions.some((s) => s.id === 'ghost')).toBe(false);
  });
});

describe('cwdForSession', () => {
  it('prefers an existing session cwd, then the desk cwd', async () => {
    const reg = registry();
    const deskCwd = path.join(home, 'proj');
    mkdirSync(deskCwd, { recursive: true });
    const desk = await reg.create({ name: 'Proj', cwd: deskCwd });
    const live = (await reg.list()).find((d) => d.id === desk.id)!;
    expect(cwdForSession(live, desk.id)).toBe(deskCwd);
  });
});
