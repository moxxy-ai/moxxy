/**
 * desks.* handler tests — same seam as sessions.test.ts: the registrar is
 * wired onto a fake CommandBus with a recording RunnerPool stand-in and a REAL
 * DeskStore on a tmp file. The load-bearing case here is that removing a desk
 * ERASES every one of its sessions' on-disk runner logs — otherwise the next
 * launch's syncSessionIndexIntoRegistry() re-imports them and the workspace
 * resurrects (the "delete doesn't survive restart" bug).
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// shared.ts (the `handle` choke point) transitively touches electron;
// importing it must not require the GUI binary. Same stub as sessions.test.ts
// (pickFolder's dialog/BrowserWindow are never invoked from these tests).
vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

// The handler erases each removed desk's persisted session logs via @moxxy/core
// — record the calls instead of touching ~/.moxxy. The derived-title pass
// (session-titles.ts) reads meta sidecars from defaultSessionsDir(); point it
// at a directory that doesn't exist so every stored name passes through.
const deleteSessionMock = vi.fn(async (_id: string) => {});
const coreMockState = vi.hoisted(() => ({
  sessionTitlesDir: '/nonexistent-session-titles-dir',
}));
vi.mock('@moxxy/core', () => ({
  deleteSession: (id: string) => deleteSessionMock(id),
  defaultSessionsDir: () => coreMockState.sessionTitlesDir,
  readSessionIndex: async () => [],
}));

import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import type { IpcCommandName } from '@moxxy/desktop-ipc-contract';
import { DeskStore } from '../desks';
import type { RunnerPool } from '../runner-pool';
import { setActiveBus } from './shared';
import { registerDesksHandlers } from './desks';

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

beforeEach(() => {
  vi.clearAllMocks();
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'desks-ipc-'));
  coreMockState.sessionTitlesDir = path.join(tmp, 'session-titles');
  mkdirSync(coreMockState.sessionTitlesDir, { recursive: true });
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
  registerDesksHandlers(pool, desks);
});

const invoke = (channel: string, args?: unknown): Promise<unknown> =>
  handlers.get(channel)!(args);

describe('desks.* handlers', () => {
  it('registers the full command set', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'desks.create',
      'desks.list',
      'desks.pickFolder',
      'desks.remove',
      'desks.rename',
      'desks.setActive',
    ]);
  });

  it('remove erases the on-disk runner log of EVERY session in the desk', async () => {
    const desk = await desks.create({ name: 'A', cwd: cwdA });
    // A desk can hold several conversations; add a second so we prove the erase
    // covers all of them, not just the first.
    const { session: second } = await desks.createSession(desk.id);

    await invoke('desks.remove', { id: desk.id });

    // Both runners torn down...
    expect(calls).toContainEqual({ op: 'remove', id: desk.id });
    expect(calls).toContainEqual({ op: 'remove', id: second.id });
    // ...and both on-disk logs erased, so syncSessionIndexIntoRegistry() can't
    // resurrect them on the next launch.
    expect(deleteSessionMock).toHaveBeenCalledWith(desk.id);
    expect(deleteSessionMock).toHaveBeenCalledWith(second.id);
    // The desk is gone from the persisted registry.
    expect((await desks.list()).some((d) => d.id === desk.id)).toBe(false);
  });

  it('remove foregrounds the next desk and never erases its sessions', async () => {
    const a = await desks.create({ name: 'A', cwd: cwdA });
    const b = await desks.create({ name: 'B', cwd: cwdB });
    await desks.setActive(a.id);
    calls.length = 0;
    deleteSessionMock.mockClear();

    await invoke('desks.remove', { id: a.id });

    // Surviving desk B's session is spun up to keep a live chat surface...
    expect(calls).toContainEqual({ op: 'getOrCreate', id: b.id, cwd: cwdB });
    // ...and never had its log erased.
    expect(deleteSessionMock).not.toHaveBeenCalledWith(b.id);
    expect(deleteSessionMock).toHaveBeenCalledWith(a.id);
  });
});
