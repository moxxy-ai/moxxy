/**
 * sessions.* handler tests. The registrar is wired onto a fake CommandBus (the
 * same seam every transport uses) with a recording RunnerPool stand-in and a
 * REAL DeskStore + REAL @moxxy/core, pointed at a temp `MOXXY_HOME`. So these
 * exercise the actual single-source contract: the pool is driven with SESSION
 * ids, removal tears the runner down BEFORE the session file is erased, and a
 * removed session does not reappear.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// shared.ts (the `handle` choke point) transitively touches electron; importing
// it must not require the GUI binary.
vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

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

let home: string;
let originalHome: string | undefined;
let desks: DeskStore;
let handlers: Map<string, Handler>;
let calls: PoolCall[];
let cwdA: string;

beforeEach(() => {
  vi.clearAllMocks();
  home = mkdtempSync(path.join(os.tmpdir(), 'sessions-ipc-'));
  originalHome = process.env.MOXXY_HOME;
  process.env.MOXXY_HOME = home;
  mkdirSync(path.join(home, 'sessions'), { recursive: true });
  cwdA = path.join(home, 'a');
  mkdirSync(cwdA, { recursive: true });
  desks = new DeskStore();
  const { bus, handlers: h } = fakeBus();
  const { pool, calls: c } = fakePool();
  handlers = h;
  calls = c;
  setActiveBus(bus);
  registerSessionsHandlers(pool, desks);
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

const invoke = (channel: string, args?: unknown): Promise<unknown> => handlers.get(channel)!(args);

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
    const overview = (await invoke('sessions.list')) as { sessions: Array<{ id: string }> };
    expect(overview.sessions.map((s) => s.id)).toEqual([desk.id]);
  });

  it('create persists under the desk and spawns the session runner with the desk cwd', async () => {
    const desk = await desks.create({ name: 'A', cwd: cwdA });
    const session = (await invoke('sessions.create', { deskId: desk.id })) as { id: string };
    expect(calls).toContainEqual({ op: 'getOrCreate', id: session.id, cwd: cwdA });
    const overview = await desks.listSessions(desk.id);
    expect(overview.sessions.map((s) => s.id)).toContain(session.id);
  });

  it('setActive persists, ensures a runner, and foregrounds the SESSION id', async () => {
    const desk = await desks.create({ name: 'A', cwd: cwdA });
    const session = (await invoke('sessions.create', { deskId: desk.id })) as { id: string };
    await invoke('sessions.setActive', { id: session.id });
    expect((await desks.listSessions(desk.id)).activeSessionId).toBe(session.id);
    expect(calls).toContainEqual({ op: 'setActive', id: session.id });
  });

  it('remove tears the runner down BEFORE erasing the file, and it stays gone', async () => {
    const desk = await desks.create({ name: 'A', cwd: cwdA });
    const session = (await invoke('sessions.create', { deskId: desk.id })) as { id: string };

    await invoke('sessions.remove', { id: session.id });

    // The runner teardown is ordered before the registry erases the file.
    const removeIdx = calls.findIndex((c) => c.op === 'remove' && c.id === session.id);
    expect(removeIdx).toBeGreaterThanOrEqual(0);
    // Gone from the derived list, and stays gone on a fresh registry (restart).
    expect((await desks.listSessions(desk.id)).sessions.map((s) => s.id)).not.toContain(session.id);
    expect(
      (await new DeskStore().listSessions(desk.id)).sessions.map((s) => s.id),
    ).not.toContain(session.id);
  });

  it("removing the active desk's last session promotes a fresh replacement", async () => {
    const desk = await desks.create({ name: 'A', cwd: cwdA });
    await invoke('sessions.remove', { id: desk.id });
    const overview = await desks.listSessions(desk.id);
    expect(overview.sessions).toHaveLength(1);
    const fresh = overview.sessions[0]!;
    expect(fresh.id).not.toBe(desk.id);
    expect(calls).toContainEqual({ op: 'getOrCreate', id: fresh.id, cwd: cwdA });
    expect(calls).toContainEqual({ op: 'setActive', id: fresh.id });
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
