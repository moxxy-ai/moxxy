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
  disk = [event],
}: {
  readonly remote?: {
    loadHistory?: (before: number | null, limit: number) => Promise<EventPage>;
    readAttachment?: (seq: number, index: number, offset: number) => Promise<{ data: string; total: number }>;
  } | null;
  readonly known?: boolean;
  readonly disk?: ReadonlyArray<MoxxyEvent>;
} = {}): {
  readonly invoke: (workspaceId?: string) => Promise<unknown>;
  readonly readAttachment: (args: { workspaceId?: string; seq: number; index: number; offset: number }) => Promise<unknown>;
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
    async (_id: string, opts: { before: number | null; limit: number }): Promise<EventPage> => {
      const older = disk.filter((e) => opts.before === null || e.seq < opts.before);
      return { events: older.slice(-opts.limit), prevCursor: null };
    },
  );

  setActiveBus(bus);
  registerChatHandlers(pool, desks, readHistory);
  const handler = handlers.get('chat.loadHistory');
  if (!handler) throw new Error('chat.loadHistory handler was not registered');
  const attachmentHandler = handlers.get('chat.readAttachment');
  if (!attachmentHandler) throw new Error('chat.readAttachment handler was not registered');

  return {
    invoke: (workspaceId = 'session-1') => handler({ workspaceId, before: null, limit: 50 }),
    readAttachment: ({ workspaceId = 'session-1', ...rest }) => attachmentHandler({ workspaceId, ...rest }),
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

  it("pages a catalog channel bot's log while the bot is offline", async () => {
    const { invoke, readHistory } = setup({ known: false });

    await expect(invoke('moxxy-channel-discord')).resolves.toEqual({ events: [event], prevCursor: null });
    expect(readHistory).toHaveBeenCalledWith('moxxy-channel-discord', { before: null, limit: 50 });
  });

  it('fails closed for a channel-looking id outside the catalog', async () => {
    const { invoke, readHistory } = setup({ known: false });

    await expect(invoke('moxxy-channel-nope')).resolves.toBeNull();
    expect(readHistory).not.toHaveBeenCalled();
  });
});

describe('large attachments in chat history', () => {
  const scan = 'A'.repeat(3 * 1024 * 1024);
  const withScan: MoxxyEvent = {
    ...event,
    seq: 4,
    attachments: [{ kind: 'document', content: scan, mediaType: 'application/pdf', name: 'scan.pdf' }],
  } as MoxxyEvent;

  it('leaves the bytes out of a page read from disk while the runner starts', async () => {
    const { invoke } = setup({ disk: [withScan] });
    const page = (await invoke()) as EventPage;
    const prompt = page.events[0];
    expect(prompt?.type === 'user_prompt' && prompt.attachments?.[0]).toMatchObject({
      content: '',
      name: 'scan.pdf',
      omittedBytes: Math.floor((scan.length * 3) / 4),
    });
  });

  it('reads an attachment slice from the runner when it is connected', async () => {
    const readAttachment = vi.fn(async () => ({ data: 'AAAA', total: 4 }));
    const { readAttachment: invoke, readHistory } = setup({ remote: { readAttachment } });
    await expect(invoke({ seq: 4, index: 0, offset: 0 })).resolves.toEqual({ data: 'AAAA', total: 4 });
    expect(readAttachment).toHaveBeenCalledWith(4, 0, 0);
    expect(readHistory).not.toHaveBeenCalled();
  });

  it('reads an attachment slice from the persisted log while the runner starts', async () => {
    const { readAttachment } = setup({ disk: [withScan] });
    const chunk = (await readAttachment({ seq: 4, index: 0, offset: 0 })) as { data: string; total: number };
    expect(chunk.total).toBe(scan.length);
    expect(chunk.data.length).toBeGreaterThan(0);
    expect(chunk.data.length).toBeLessThan(scan.length);
  });

  it('fails closed for an unknown session id', async () => {
    const { readAttachment, readHistory } = setup({ known: false });
    await expect(readAttachment({ workspaceId: 'guessed', seq: 4, index: 0, offset: 0 })).resolves.toBeNull();
    expect(readHistory).not.toHaveBeenCalled();
  });
});
