import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  cwdForSession,
  MOXXY_WORKSPACE_ID,
  WorkspaceRegistry,
  syncSessionIndexIntoRegistry,
  type WorkspaceSessionSource,
} from './index';

let tmp: string;
let registryPath: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'workspace-registry-'));
  registryPath = path.join(tmp, 'desks.json');
});

function meta(input: {
  id: string;
  cwd: string;
  firstPrompt?: string | null;
  eventCount?: number;
  source?: WorkspaceSessionSource;
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

describe('WorkspaceRegistry session registration', () => {
  it('creates the global Moxxy workspace when no cwd matches a known workspace', async () => {
    const registry = new WorkspaceRegistry(registryPath);

    await registry.registerSessionFromMeta(
      meta({ id: 'session-1', cwd: tmp, firstPrompt: 'hello from outside', eventCount: 2 }),
      'tui',
    );

    const [desk] = await registry.list();
    expect(desk?.id).toBe(MOXXY_WORKSPACE_ID);
    expect(desk?.name).toBe('Moxxy');
    expect(desk?.activeSessionId).toBe('session-1');
    expect(desk?.sessions).toHaveLength(1);
    expect(desk?.sessions[0]).toMatchObject({
      id: 'session-1',
      cwd: tmp,
      firstPrompt: 'hello from outside',
      eventCount: 2,
      provider: 'anthropic',
      model: 'claude-sonnet',
      source: 'tui',
    });
  });

  it('assigns sessions to the existing workspace whose cwd contains the session cwd', async () => {
    const projectRoot = path.join(tmp, 'project');
    const sessionCwd = path.join(projectRoot, 'packages', 'cli');
    mkdirSync(sessionCwd, { recursive: true });
    const registry = new WorkspaceRegistry(registryPath);
    const desk = await registry.create({ name: 'Project', cwd: projectRoot });

    await registry.registerSessionFromMeta(
      meta({ id: 'session-2', cwd: sessionCwd, firstPrompt: 'inside project', eventCount: 1 }),
      'cli',
    );

    expect((await registry.deskForSession('session-2'))?.id).toBe(desk.id);
  });

  it('chooses the longest matching workspace for nested workspace paths', async () => {
    const root = path.join(tmp, 'repo');
    const nested = path.join(root, 'apps', 'desktop');
    const sessionCwd = path.join(nested, 'src');
    mkdirSync(sessionCwd, { recursive: true });
    const registry = new WorkspaceRegistry(registryPath);
    await registry.create({ name: 'Repo', cwd: root });
    const nestedDesk = await registry.create({ name: 'Desktop', cwd: nested });

    await registry.registerSessionFromMeta(
      meta({ id: 'session-3', cwd: sessionCwd, firstPrompt: 'nested project', eventCount: 1 }),
      'desktop',
    );

    expect((await registry.deskForSession('session-3'))?.id).toBe(nestedDesk.id);
  });

  it('updates an existing session instead of duplicating it', async () => {
    const registry = new WorkspaceRegistry(registryPath);
    await registry.registerSessionFromMeta(meta({ id: 'session-4', cwd: tmp }), 'tui');

    await registry.registerSessionFromMeta(
      meta({ id: 'session-4', cwd: tmp, firstPrompt: 'hello from tui', eventCount: 3 }),
      'tui',
    );

    const moxxy = (await registry.list()).find((desk) => desk.id === MOXXY_WORKSPACE_ID);
    expect(moxxy?.sessions.filter((session) => session.id === 'session-4')).toHaveLength(1);
    expect(moxxy?.sessions[0]).toMatchObject({
      firstPrompt: 'hello from tui',
      eventCount: 3,
    });
  });

  it('refreshes stale imported names when a sanitized first prompt changes', async () => {
    const registry = new WorkspaceRegistry(registryPath);
    await registry.registerSessionFromMeta(
      meta({ id: 'session-stale-title', cwd: tmp, firstPrompt: 'foreign syrup title', eventCount: 4 }),
      'cli',
    );

    await registry.registerSessionFromMeta(
      meta({ id: 'session-stale-title', cwd: tmp, firstPrompt: 'real matching title', eventCount: 2 }),
      'cli',
    );

    const moxxy = (await registry.list()).find((desk) => desk.id === MOXXY_WORKSPACE_ID);
    expect(moxxy?.sessions[0]).toMatchObject({
      id: 'session-stale-title',
      name: 'real matching title',
      firstPrompt: 'real matching title',
    });
  });

  it('does not overwrite a manually renamed session when metadata refreshes', async () => {
    const registry = new WorkspaceRegistry(registryPath);
    await registry.registerSessionFromMeta(
      meta({ id: 'session-manual-title', cwd: tmp, firstPrompt: 'initial prompt', eventCount: 1 }),
      'cli',
    );
    await registry.renameSession('session-manual-title', 'My hand-picked title');

    await registry.registerSessionFromMeta(
      meta({ id: 'session-manual-title', cwd: tmp, firstPrompt: 'new prompt', eventCount: 2 }),
      'cli',
    );

    const moxxy = (await registry.list()).find((desk) => desk.id === MOXXY_WORKSPACE_ID);
    expect(moxxy?.sessions[0]).toMatchObject({
      id: 'session-manual-title',
      name: 'My hand-picked title',
      firstPrompt: 'new prompt',
    });
  });
});

describe('WorkspaceRegistry session-index sync', () => {
  it('imports only user-visible sessions with an existing cwd', async () => {
    const original = process.env.MOXXY_HOME;
    const home = path.join(tmp, 'home');
    const sessionsDir = path.join(home, 'sessions');
    const liveCwd = path.join(tmp, 'project');
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(liveCwd, { recursive: true });
    process.env.MOXXY_HOME = home;
    try {
      writeSessionMeta(sessionsDir, {
        ...meta({ id: 'empty-session', cwd: liveCwd }),
        eventCount: 0,
        firstPrompt: null,
      });
      writeSessionMeta(sessionsDir, {
        ...meta({ id: 'event-only-session', cwd: liveCwd }),
        eventCount: 3,
        firstPrompt: null,
      });
      writeSessionMeta(sessionsDir, {
        ...meta({ id: 'stale-session', cwd: path.join(tmp, 'gone'), firstPrompt: 'stale' }),
        eventCount: 1,
      });
      writeSessionMeta(sessionsDir, {
        ...meta({ id: 'visible-session', cwd: liveCwd, firstPrompt: 'real prompt' }),
        eventCount: 2,
      });

      const registry = new WorkspaceRegistry(registryPath);
      await syncSessionIndexIntoRegistry(registry, 'cli');

      const desks = await registry.list();
      const sessions = desks.flatMap((desk) => desk.sessions);
      expect(sessions.map((session) => session.id)).toEqual(['visible-session']);
    } finally {
      if (original === undefined) delete process.env.MOXXY_HOME;
      else process.env.MOXXY_HOME = original;
    }
  });

  it('does not import a session whose visible prompt belongs to another session id', async () => {
    const original = process.env.MOXXY_HOME;
    const home = path.join(tmp, 'home');
    const sessionsDir = path.join(home, 'sessions');
    const liveCwd = path.join(tmp, 'project');
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(liveCwd, { recursive: true });
    process.env.MOXXY_HOME = home;
    try {
      writeSessionMeta(sessionsDir, {
        ...meta({ id: 'foreign-only-session', cwd: liveCwd, firstPrompt: 'foreign syrup' }),
        eventCount: 1,
      });
      writeFileSync(
        path.join(sessionsDir, 'foreign-only-session.jsonl'),
        JSON.stringify({
          id: 'event-foreign',
          type: 'user_prompt',
          text: 'foreign syrup',
          seq: 0,
          ts: 1,
          turnId: 'turn-1',
          sessionId: 'other-session',
          source: 'user',
        }) + '\n',
      );

      const registry = new WorkspaceRegistry(registryPath);
      await syncSessionIndexIntoRegistry(registry, 'cli');

      expect((await registry.list()).flatMap((desk) => desk.sessions)).toEqual([]);
    } finally {
      if (original === undefined) delete process.env.MOXXY_HOME;
      else process.env.MOXXY_HOME = original;
    }
  });
});

describe('WorkspaceRegistry compatibility', () => {
  it('reads a v2 desks document and persists it as version 3', async () => {
    writeFileSync(
      registryPath,
      JSON.stringify({
        version: 2,
        activeId: 'desk-a',
        desks: [
          {
            id: 'desk-a',
            name: 'A',
            cwd: path.join(tmp, 'a'),
            color: '#3b82f6',
            createdAt: 111,
            sessions: [{ id: 'session-a', name: 'Session 1', createdAt: 111 }],
            activeSessionId: 'session-a',
          },
        ],
      }),
    );

    const registry = new WorkspaceRegistry(registryPath);
    await registry.rename('desk-a', 'Renamed');

    const body = JSON.parse(readFileSync(registryPath, 'utf8'));
    expect(body.version).toBe(3);
    expect(body.desks[0].sessions).toHaveLength(1);
    expect(body.desks[0].activeSessionId).toBe('session-a');
  });

  it('drops polluted v2 CLI sessions that have no user-visible prompt', async () => {
    const deskCwd = path.join(tmp, 'a');
    mkdirSync(deskCwd, { recursive: true });
    writeFileSync(
      registryPath,
      JSON.stringify({
        version: 2,
        activeId: 'desk-a',
        desks: [
          {
            id: 'desk-a',
            name: 'A',
            cwd: deskCwd,
            color: '#3b82f6',
            createdAt: 111,
            sessions: [
              {
                id: 'placeholder',
                name: 'Current session',
                createdAt: 111,
                cwd: deskCwd,
                source: 'cli',
                firstPrompt: null,
                eventCount: 5,
              },
              {
                id: 'real',
                name: 'Real prompt',
                createdAt: 222,
                cwd: deskCwd,
                source: 'cli',
                firstPrompt: 'Real prompt',
                eventCount: 5,
              },
            ],
            activeSessionId: 'placeholder',
          },
        ],
      }),
    );

    const registry = new WorkspaceRegistry(registryPath);
    const [desk] = await registry.list();

    expect(desk?.sessions.map((session) => session.id)).toEqual(['real']);
    expect(desk?.activeSessionId).toBe('real');
  });

  it('uses the desktop chat mirror first prompt for legacy placeholder session names', async () => {
    const original = process.env.MOXXY_HOME;
    const home = path.join(tmp, 'home');
    const chatsDir = path.join(home, 'chats');
    const deskCwd = path.join(tmp, 'a');
    mkdirSync(chatsDir, { recursive: true });
    mkdirSync(deskCwd, { recursive: true });
    process.env.MOXXY_HOME = home;
    writeFileSync(
      path.join(chatsDir, 'desk-a.jsonl'),
      JSON.stringify({
        id: 'event-1',
        type: 'user_prompt',
        text: 'Cześć Moxie, przeanalizuj mi stronę',
        seq: 0,
        ts: 1,
        turnId: 'turn-1',
        sessionId: 'desk-a',
        source: 'user',
      }) + '\n',
    );
    writeFileSync(
      registryPath,
      JSON.stringify({
        version: 2,
        activeId: 'desk-a',
        desks: [
          {
            id: 'desk-a',
            name: 'A',
            cwd: deskCwd,
            color: '#3b82f6',
            createdAt: 111,
            sessions: [
              {
                id: 'desk-a',
                name: 'Current session',
                createdAt: 111,
                cwd: deskCwd,
                source: 'desktop',
              },
            ],
            activeSessionId: 'desk-a',
          },
        ],
      }),
    );

    try {
      const [desk] = await new WorkspaceRegistry(registryPath).list();

      expect(desk?.sessions[0]?.name).toBe('Cześć Moxie, przeanalizuj mi stronę');
      expect(desk?.sessions[0]?.firstPrompt).toBe('Cześć Moxie, przeanalizuj mi stronę');
    } finally {
      if (original === undefined) delete process.env.MOXXY_HOME;
      else process.env.MOXXY_HOME = original;
    }
  });

  it('ignores a legacy chat mirror first prompt from another session id', async () => {
    const original = process.env.MOXXY_HOME;
    const home = path.join(tmp, 'home');
    const chatsDir = path.join(home, 'chats');
    const deskCwd = path.join(tmp, 'a');
    mkdirSync(chatsDir, { recursive: true });
    mkdirSync(deskCwd, { recursive: true });
    process.env.MOXXY_HOME = home;
    writeFileSync(
      path.join(chatsDir, 'session-a.jsonl'),
      [
        {
          id: 'event-foreign',
          type: 'user_prompt',
          text: 'foreign syrup prompt',
          seq: 0,
          ts: 1,
          turnId: 'turn-1',
          sessionId: 'other-session',
          source: 'user',
        },
        {
          id: 'event-real',
          type: 'user_prompt',
          text: 'real session prompt',
          seq: 1,
          ts: 2,
          turnId: 'turn-2',
          sessionId: 'session-a',
          source: 'user',
        },
      ].map((event) => JSON.stringify(event)).join('\n') + '\n',
    );
    writeFileSync(
      registryPath,
      JSON.stringify({
        version: 2,
        activeId: 'desk-a',
        desks: [
          {
            id: 'desk-a',
            name: 'A',
            cwd: deskCwd,
            color: '#3b82f6',
            createdAt: 111,
            sessions: [
              {
                id: 'session-a',
                name: 'Current session',
                createdAt: 111,
                cwd: deskCwd,
                source: 'desktop',
              },
            ],
            activeSessionId: 'session-a',
          },
        ],
      }),
    );

    try {
      const [desk] = await new WorkspaceRegistry(registryPath).list();

      expect(desk?.sessions[0]?.name).toBe('real session prompt');
      expect(desk?.sessions[0]?.firstPrompt).toBe('real session prompt');
    } finally {
      if (original === undefined) delete process.env.MOXXY_HOME;
      else process.env.MOXXY_HOME = original;
    }
  });

  it('resolves a session cwd before falling back to the workspace cwd', async () => {
    const registry = new WorkspaceRegistry(registryPath);
    const desk = await registry.create({ name: 'Project', cwd: path.join(tmp, 'project') });
    const nestedCwd = path.join(tmp, 'project', 'nested');
    mkdirSync(nestedCwd, { recursive: true });
    const { session } = await registry.createSession(desk.id, 'Nested', {
      cwd: nestedCwd,
    });
    const [savedDesk] = await registry.list();

    expect(cwdForSession(savedDesk!, session.id)).toBe(session.cwd);
    expect(cwdForSession(savedDesk!, savedDesk!.sessions[0]!.id)).toBe(desk.cwd);
  });

  it('falls back to the workspace cwd when a session cwd no longer exists', async () => {
    const registry = new WorkspaceRegistry(registryPath);
    const desk = await registry.create({ name: 'Project', cwd: path.join(tmp, 'project') });
    mkdirSync(desk.cwd, { recursive: true });
    const { session } = await registry.createSession(desk.id, 'Stale', {
      cwd: path.join(tmp, 'deleted'),
    });
    const [savedDesk] = await registry.list();

    expect(cwdForSession(savedDesk!, session.id)).toBe(desk.cwd);
  });

  it('falls back to a managed Moxxy cwd when the workspace cwd no longer exists', async () => {
    const original = process.env.MOXXY_HOME;
    const home = path.join(tmp, 'home');
    process.env.MOXXY_HOME = home;
    const missingDeskCwd = path.join(tmp, 'deleted-workspace');
    const desk = {
      id: 'desk-a',
      name: 'Deleted',
      cwd: missingDeskCwd,
      color: '#3b82f6',
      createdAt: 111,
      sessions: [
        {
          id: 'session-a',
          name: 'Stale',
          createdAt: 111,
          cwd: path.join(tmp, 'deleted-session'),
          source: 'cli' as const,
        },
      ],
      activeSessionId: 'session-a',
    };
    try {
      const resolved = cwdForSession(desk, 'session-a');

      expect(resolved).not.toBe(missingDeskCwd);
      expect(resolved).toBe(path.join(home, 'workspaces', 'moxxy'));
    } finally {
      if (original === undefined) delete process.env.MOXXY_HOME;
      else process.env.MOXXY_HOME = original;
    }
  });
});

function writeSessionMeta(dir: string, sessionMeta: ReturnType<typeof meta>): void {
  writeFileSync(path.join(dir, `${sessionMeta.id}.meta.json`), JSON.stringify(sessionMeta), 'utf8');
  writeFileSync(path.join(dir, `${sessionMeta.id}.jsonl`), '', 'utf8');
}
