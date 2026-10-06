import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { DesksOverview, MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { __setApiOverride } from './transport';
import { ConnectionBridge, connectionStore } from './useConnection';
import { __resetDesksStoreForTests, useDesks } from './useDesks';

const SESSION = 'session-1';
const overview: DesksOverview = {
  activeId: 'desk-1',
  desks: [
    {
      id: 'desk-1',
      name: 'Project',
      cwd: '/tmp/project',
      color: '#000',
      createdAt: 1,
      activeSessionId: SESSION,
      sessions: [],
    } as unknown as DesksOverview['desks'][number],
  ],
};

/** A host whose desks are known but whose runner is still starting: the pool
 *  has not foregrounded anything yet, so it has no active workspace. */
function installStartingHost() {
  const invoke = vi.fn(async (cmd: string) => {
    if (cmd === 'desks.list') return overview;
    if (cmd === 'connection.snapshotAll') return [];
    if (cmd === 'connection.activeWorkspace') return null;
    return undefined;
  });
  __setApiOverride({ invoke, subscribe: () => () => undefined } as unknown as MoxxyApi);
  return invoke;
}

function DesksPrimer(): null {
  useDesks();
  return null;
}

afterEach(() => {
  cleanup();
  act(() => {
    __resetDesksStoreForTests();
    connectionStore.setActive(null);
  });
  __setApiOverride(null);
});

describe('ConnectionBridge', () => {
  it('keeps the saved active session when a runner-less host has no active workspace yet', async () => {
    const invoke = installStartingHost();
    const view = render(
      <>
        <DesksPrimer />
        <ConnectionBridge />
      </>,
    );
    await waitFor(() => expect(connectionStore.active$()).toBe(SESSION));

    // The app shell swapping in remounts the bridge, which primes again.
    view.rerender(
      <div>
        <DesksPrimer />
        <ConnectionBridge />
      </div>,
    );
    await waitFor(() =>
      expect(invoke.mock.calls.filter(([cmd]) => cmd === 'connection.activeWorkspace')).toHaveLength(2),
    );
    await act(async () => undefined);

    expect(connectionStore.active$()).toBe(SESSION);
  });

  it('picks up the workspace the host foregrounds once a desk without sessions gets its runner', async () => {
    let runnerUp = false;
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'desks.list') {
        return { ...overview, desks: overview.desks.map((d) => ({ ...d, activeSessionId: null })) };
      }
      if (cmd === 'connection.snapshotAll') return [];
      if (cmd === 'connection.activeWorkspace') return runnerUp ? '__unbound__' : null;
      return undefined;
    });
    __setApiOverride({ invoke, subscribe: () => () => undefined } as unknown as MoxxyApi);
    render(
      <>
        <DesksPrimer />
        <ConnectionBridge />
      </>,
    );
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('connection.activeWorkspace'));

    runnerUp = true;

    await waitFor(() => expect(connectionStore.active$()).toBe('__unbound__'), { timeout: 3_000 });
  });
});
