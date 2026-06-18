/**
 * surface.* handler tests — the registrar is wired onto a fake CommandBus
 * (the setActiveBus seam every transport uses) over a recording RunnerPool +
 * RemoteSession stand-in, so the tests pin the relay contract: each handler
 * resolves the workspace's session and forwards to the matching surface op,
 * and `surface.list` degrades to [] before a session exists.
 */

import { describe, expect, it, vi } from 'vitest';

// shared.ts (the resolveCtx/handle choke point) transitively touches electron;
// importing it must not require the GUI binary.
vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import type { IpcCommandName } from '@moxxy/desktop-ipc-contract';
import type { RunnerPool } from '../runner-pool';
import { setActiveBus } from './shared';
import { registerSurfaceHandlers } from './surfaces';

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

interface SessionCall {
  readonly op: string;
  readonly args: ReadonlyArray<unknown>;
}

function fakeSession(): { session: object; calls: SessionCall[] } {
  const calls: SessionCall[] = [];
  const rec = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args });
    if (op === 'listSurfaces') return [{ id: 's1', kind: 'terminal' }];
    if (op === 'openSurface') return { surfaceId: 's2' };
    return undefined;
  };
  const session = {
    listSurfaces: rec('listSurfaces'),
    openSurface: rec('openSurface'),
    inputSurface: rec('inputSurface'),
    resizeSurface: rec('resizeSurface'),
    closeSurface: rec('closeSurface'),
  };
  return { session, calls };
}

/** Pool whose `get(id)` returns a supervisor whose `remote()` yields `session`
 *  (or null to simulate "not yet connected"). */
function fakePool(session: object | null): RunnerPool {
  return {
    activeWorkspaceId: () => 'ws1',
    get: (_id: string) => ({ remote: () => session }),
  } as unknown as RunnerPool;
}

function register(pool: RunnerPool): Map<string, Handler> {
  const { bus, handlers } = fakeBus();
  setActiveBus(bus);
  registerSurfaceHandlers(pool);
  return handlers;
}

describe('registerSurfaceHandlers', () => {
  it('registers exactly the five surface.* commands', () => {
    const handlers = register(fakePool(fakeSession().session));
    expect([...handlers.keys()].sort()).toEqual([
      'surface.close',
      'surface.input',
      'surface.list',
      'surface.open',
      'surface.resize',
    ]);
  });

  it('surface.list returns the session surfaces', async () => {
    const { session } = fakeSession();
    const handlers = register(fakePool(session));
    const result = await handlers.get('surface.list')!({ workspaceId: 'ws1' });
    expect(result).toEqual([{ id: 's1', kind: 'terminal' }]);
  });

  it('surface.list degrades to [] when no session is connected yet', async () => {
    const handlers = register(fakePool(null));
    const result = await handlers.get('surface.list')!({ workspaceId: 'ws1' });
    expect(result).toEqual([]);
  });

  it('surface.open forwards the kind and returns the open result', async () => {
    const { session, calls } = fakeSession();
    const handlers = register(fakePool(session));
    const result = await handlers.get('surface.open')!({ workspaceId: 'ws1', kind: 'terminal' });
    expect(result).toEqual({ surfaceId: 's2' });
    expect(calls).toContainEqual({ op: 'openSurface', args: ['terminal'] });
  });

  it('surface.input forwards surfaceId + message', async () => {
    const { session, calls } = fakeSession();
    const handlers = register(fakePool(session));
    await handlers.get('surface.input')!({ workspaceId: 'ws1', surfaceId: 's2', message: { data: 'ls\n' } });
    expect(calls).toContainEqual({ op: 'inputSurface', args: ['s2', { data: 'ls\n' }] });
  });

  it('surface.resize forwards surfaceId + size', async () => {
    const { session, calls } = fakeSession();
    const handlers = register(fakePool(session));
    await handlers.get('surface.resize')!({ workspaceId: 'ws1', surfaceId: 's2', size: { cols: 80, rows: 24 } });
    expect(calls).toContainEqual({ op: 'resizeSurface', args: ['s2', { cols: 80, rows: 24 }] });
  });

  it('surface.close forwards surfaceId', async () => {
    const { session, calls } = fakeSession();
    const handlers = register(fakePool(session));
    await handlers.get('surface.close')!({ workspaceId: 'ws1', surfaceId: 's2' });
    expect(calls).toContainEqual({ op: 'closeSurface', args: ['s2'] });
  });

  it('a mutating op throws when no session is connected (requireSession default)', async () => {
    const handlers = register(fakePool(null));
    await expect(
      handlers.get('surface.open')!({ workspaceId: 'ws1', kind: 'terminal' }),
    ).rejects.toThrow(/not connected/);
  });
});
