/**
 * sessions.* handler tests — the registrar is wired onto a fake
 * CommandBus (via setActiveBus, same seam every transport uses) with a
 * recording RunnerPool stand-in and a REAL DeskStore on a tmp file, so
 * the tests exercise the actual persistence + pool-keying contract:
 * the pool is driven with SESSION ids, removal erases the session's
 * on-disk runner log + chat mirror, and a desk never drops below one
 * session.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// shared.ts (the `handle` choke point) transitively touches electron;
// importing it must not require the GUI binary. Same stub as shared.test.ts.
vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

// The handlers delete the runner's persisted session log via @moxxy/core —
// record the calls instead of touching ~/.moxxy. The derived-title pass
// (session-titles.ts) reads meta sidecars from defaultSessionsDir(); point
// it at a directory that doesn't exist so every stored name passes through.
const deleteSessionMock = vi.fn(async (_id: string) => {});
vi.mock('@moxxy/core', () => ({
  deleteSession: (id: string) => deleteSessionMock(id),
  defaultSessionsDir: () => '/nonexistent-session-titles-dir',
  readSessionIndex: async () => [],
}));

// Chat NDJSON mirror removal — record instead of touching the disk.
const clearLogMock = vi.fn(async (_id: string) => {});
vi.mock('../chat-log', () => ({
  clearLog: (id: string) => clearLogMock(id),
}));

import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import type { IpcCommandName } from '@moxxy/desktop-ipc-contract';
import { DeskStore } from '../desks';
import type { RunnerPool } from '../runner-pool';
import { setActiveBus } from './shared';
import { registerSessionsHandlers } from './sessions';

type Handler = (...args: unknown[]) => Promise<unknown>;

function fakeBus(): { bus: CommandBus; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const bus = {
    handle: (channel: IpcCommandName, fn: Handler) => {
      handlers.set(channel, fn);
    },
  } as unknown as CommandBus;
  return { bus, handlers };
}

interface PoolCall {
  readonly op: 'getOrCreate' | 'setActive' | 'remove';
  readonly id: string;
  readonly cwd?: string | null;
}

function fakePool(): { pool: RunnerPool; calls: PoolCall[] } {
  const calls: PoolCall[] = [];
  const known = new Set<string>();
  const pool = {
    getOrCreate: async (id: string, cwd: string | null) => {
      calls.push({ op: 'getOrCreate', id, cwd });
      known.add(id);
      return {} as never;
    },
    setActive: (id: string) => {
      calls.push({ op: 'setActive', id });
      if (!known.has(id)) throw new Error(`RunnerPool.setActive: unknown workspace ${id}`);
    },
    remove: async (id: string) => {
      calls.push({ op: 'remove', id });
      known.delete(id);
    },
    activeWorkspaceId: () => null,
  } as unknown as RunnerPool;
  return { pool, calls };
}

let desks: DeskStore;
let handlers: Map<string, Handler>;
let calls: PoolCall[];
let cwdA: string;
let cwdB: string;

beforeEach(async () => {
  vi.clearAllMocks();
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'sessions-ipc-'));
  cwdA = path.join(tmp, 'a');
  cwdB = path.join(tmp, 'b');
  mkdirSync(cwdA, { recursive: true });
  mkdirSync(cwdB, { recursive: true });
  desks = new DeskStore(path.join(tmp, 'desks.json'));
  const { bus, handlers: h } = fakeBus();
  const { pool, calls: c } = fakePool();
  handlers = h;
  calls = c;
  setActiveBus(bus);
  registerSessionsHandlers(pool, desks);
});

const invoke = (channel: string, args?: unknown): Promise<unknown> =>
  handlers.get(channel)!(args);

describe('sessions.* handlers', () => {
  it('registers the full command set', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'sessions.create',
      'sessions.list',
      'sessions.remove',
      'sessions.rename',
      'sessions.setActive',
    ]);
  });

  it('list defaults to the active desk', async () => {
    const desk = await desks.create({ name: 'A', cwd: cwdA });
    const overview = (await invoke('sessions.list')) as {
      sessions: Array<{ id: string }>;
      activeSessionId: string | null;
    };
    expect(overview.sessions.map((s) => s.id)).toEqual([desk.id]);
    expect(overview.activeSessionId).toBe(desk.id);
  });

  it('create persists under the desk and spawns the session runner with the desk cwd', async () => {
    const desk = await desks.create({ name: 'A', cwd: cwdA });
    const session = (await invoke('sessions.create', { deskId: desk.id })) as { id: string };
    expect(calls).toContainEqual({ op: 'getOrCreate', id: session.id, cwd: cwdA });
    const overview = await desks.listSessions(desk.id);
    expect(overview.sessions.map((s) => s.id)).toContain(session.id);
    // Not auto-foregrounded.
    expect(calls.find((c) => c.op === 'setActive')).toBeUndefined();
  });

  it('setActive persists, ensures a runner, and foregrounds the SESSION id', async () => {
    const desk = await desks.create({ name: 'A', cwd: cwdA });
    const session = (await invoke('sessions.create', { deskId: desk.id })) as { id: string };
    await invoke('sessions.setActive', { id: session.id });
    expect((await desks.listSessions(desk.id)).activeSessionId).toBe(session.id);
    expect(calls).toContainEqual({ op: 'getOrCreate', id: session.id, cwd: cwdA });
    expect(calls).toContainEqual({ op: 'setActive', id: session.id });
  });

  it('setActive starts a Moxxy workspace session with the session cwd, not the workspace cwd', async () => {
    const sessionCwd = path.join(os.tmpdir(), 'moxxy-session-cwd');
    mkdirSync(sessionCwd, { recursive: true });
    await desks.registerSessionFromMeta(
      {
        id: 'moxxy-session',
        cwd: sessionCwd,
        startedAt: '2026-06-12T10:00:00.000Z',
        lastActivity: '2026-06-12T10:05:00.000Z',
        eventCount: 1,
        firstPrompt: 'from tui',
        provider: null,
        model: null,
      },
      'tui',
    );

    await invoke('sessions.setActive', { id: 'moxxy-session' });

    expect(calls).toContainEqual({ op: 'getOrCreate', id: 'moxxy-session', cwd: sessionCwd });
  });

  it('remove tears down the runner and erases BOTH on-disk logs', async () => {
    const desk = await desks.create({ name: 'A', cwd: cwdA });
    const session = (await invoke('sessions.create', { deskId: desk.id })) as { id: string };
    await invoke('sessions.remove', { id: session.id });
    expect(calls).toContainEqual({ op: 'remove', id: session.id });
    expect(deleteSessionMock).toHaveBeenCalledWith(session.id);
    expect(clearLogMock).toHaveBeenCalledWith(session.id);
    expect((await desks.listSessions(desk.id)).sessions.map((s) => s.id)).toEqual([desk.id]);
  });

  it('removing the active desk\'s foregrounded session promotes its replacement', async () => {
    const desk = await desks.create({ name: 'A', cwd: cwdA });
    // Remove the desk's only session: a fresh one is seeded + foregrounded.
    await invoke('sessions.remove', { id: desk.id });
    const overview = await desks.listSessions(desk.id);
    expect(overview.sessions).toHaveLength(1);
    const fresh = overview.sessions[0]!;
    expect(fresh.id).not.toBe(desk.id);
    expect(calls).toContainEqual({ op: 'getOrCreate', id: fresh.id, cwd: cwdA });
    expect(calls).toContainEqual({ op: 'setActive', id: fresh.id });
  });

  it('removing a BACKGROUND desk\'s session never re-foregrounds that desk', async () => {
    const a = await desks.create({ name: 'A', cwd: cwdA });
    const b = await desks.create({ name: 'B', cwd: cwdB });
    const session = (await invoke('sessions.create', { deskId: b.id })) as { id: string };
    await desks.setActive(a.id);
    calls.length = 0;
    await invoke('sessions.remove', { id: session.id });
    expect(calls.find((c) => c.op === 'setActive')).toBeUndefined();
    expect(calls.find((c) => c.op === 'getOrCreate')).toBeUndefined();
  });

  it('remove of an unknown session still best-effort clears its logs', async () => {
    await desks.create({ name: 'A', cwd: cwdA });
    await invoke('sessions.remove', { id: 'ghost' });
    expect(deleteSessionMock).toHaveBeenCalledWith('ghost');
    expect(clearLogMock).toHaveBeenCalledWith('ghost');
    expect(calls.find((c) => c.op === 'setActive')).toBeUndefined();
  });

  it('rename round-trips through the store', async () => {
    const desk = await desks.create({ name: 'A', cwd: cwdA });
    const renamed = (await invoke('sessions.rename', { id: desk.id, name: 'Deep dive' })) as {
      name: string;
    };
    expect(renamed.name).toBe('Deep dive');
    expect((await desks.listSessions(desk.id)).sessions[0]!.name).toBe('Deep dive');
  });
});
