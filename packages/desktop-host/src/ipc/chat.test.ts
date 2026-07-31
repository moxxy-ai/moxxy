import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

import type { EventPage } from '@moxxy/core';
import type { IpcCommandName } from '@moxxy/desktop-ipc-contract';
import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import type { MoxxyEvent } from '@moxxy/sdk';
import type { DeskStore } from '../desks';
import type { RunnerPool } from '../runner-pool';
import { UNBOUND_ID } from '../runner-pool';
import type { RunnerSupervisor } from '../runner-supervisor';
import { registerChatHandlers } from './chat';
import { setActiveBus } from './shared';

type Handler = (...args: unknown[]) => Promise<unknown>;

const event: MoxxyEvent = {
  id: 'event-1',
  seq: 1,
  ts: 1,
  turnId: 'turn-1',
  sessionId: 'session-1',
  source: 'user',
  type: 'user_prompt',
  text: 'hello',
};

function setup({
  remote = null,
  known = true,
}: {
  readonly remote?: { loadHistory: (before: number | null, limit: number) => Promise<EventPage> } | null;
  readonly known?: boolean;
} = {}): {
  readonly invoke: (workspaceId?: string) => Promise<unknown>;
  readonly readHistory: ReturnType<typeof vi.fn>;
  readonly deskForSession: ReturnType<typeof vi.fn>;
} {
  const handlers = new Map<string, Handler>();
  const bus = {
    handle: (channel: IpcCommandName, handler: Handler) => handlers.set(channel, handler),
  } as unknown as CommandBus;
  const pool = {
    activeWorkspaceId: () => 'session-1',
    get: () => ({ remote: () => remote }) as unknown as RunnerSupervisor,
  } as unknown as RunnerPool;
  const deskForSession = vi.fn(async () => (known ? { id: 'desk-1' } : null));
  const desks = { deskForSession } as unknown as DeskStore;
  const readHistory = vi.fn(
    async (): Promise<EventPage> => ({ events: [event], prevCursor: null }),
  );

  setActiveBus(bus);
  registerChatHandlers(pool, desks, readHistory);
  const handler = handlers.get('chat.loadHistory');
  if (!handler) throw new Error('chat.loadHistory handler was not registered');

  return {
    invoke: (workspaceId = 'session-1') => handler({ workspaceId, before: null, limit: 50 }),
    readHistory,
    deskForSession,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('chat.loadHistory cache-first paging', () => {
  it('prefers the connected runner live log', async () => {
    const livePage = { events: [event], prevCursor: null };
    const loadHistory = vi.fn(async () => livePage);
    const { invoke, readHistory, deskForSession } = setup({ remote: { loadHistory } });

    await expect(invoke()).resolves.toEqual(livePage);
    expect(loadHistory).toHaveBeenCalledWith(null, 50);
    expect(readHistory).not.toHaveBeenCalled();
    expect(deskForSession).not.toHaveBeenCalled();
  });

  it('pages validated disk history before a known session runner connects', async () => {
    const { invoke, readHistory, deskForSession } = setup();

    await expect(invoke()).resolves.toEqual({ events: [event], prevCursor: null });
    expect(deskForSession).toHaveBeenCalledWith('session-1');
    expect(readHistory).toHaveBeenCalledWith('session-1', { before: null, limit: 50 });
  });

  it('falls back to disk when the runner drops during the read', async () => {
    const loadHistory = vi.fn(async () => {
      throw new Error('runner disconnected');
    });
    const { invoke, readHistory } = setup({ remote: { loadHistory } });

    await expect(invoke()).resolves.toEqual({ events: [event], prevCursor: null });
    expect(readHistory).toHaveBeenCalledTimes(1);
  });

  it('fails closed for an unknown session id', async () => {
    const { invoke, readHistory } = setup({ known: false });

    await expect(invoke('guessed-session')).resolves.toBeNull();
    expect(readHistory).not.toHaveBeenCalled();
  });

  it('allows only the explicit unbound startup session without a desk lookup', async () => {
    const { invoke, readHistory, deskForSession } = setup({ known: false });

    await expect(invoke(UNBOUND_ID)).resolves.toEqual({ events: [event], prevCursor: null });
    expect(deskForSession).not.toHaveBeenCalled();
    expect(readHistory).toHaveBeenCalledWith(UNBOUND_ID, { before: null, limit: 50 });
  });
});
