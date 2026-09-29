import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import type { MoxxyEvent } from '@moxxy/sdk';
import { __setApiOverride } from './transport.js';
import { useChannelTranscript } from './useChannelTranscript.js';

afterEach(() => __setApiOverride(null));

const ev = (seq: number): MoxxyEvent =>
  ({
    id: `e${seq}`,
    seq,
    ts: seq,
    sessionId: 'moxxy-channel-discord',
    turnId: `t${seq}`,
    source: 'user',
    type: 'user_prompt',
    text: `m${seq}`,
  }) as MoxxyEvent;
const seqs = (events: ReadonlyArray<MoxxyEvent>) => events.map((e) => e.seq);

/** Fake IPC transport — the renderer ↔ main boundary — over an in-memory log. */
function fakeApi(log: MoxxyEvent[]) {
  const listeners: Array<(p: { channelId: string }) => void> = [];
  const invoke = vi.fn(async (cmd: string, args?: unknown) => {
    if (cmd !== 'channels.history') throw new Error(`unexpected ${cmd}`);
    const { before, limit } = args as { before: number | null; limit: number };
    if (log.length === 0) return null;
    const upTo = before === null ? log.length : log.findIndex((e) => e.seq >= before);
    const end = upTo < 0 ? log.length : upTo;
    const start = Math.max(0, end - limit);
    const page = log.slice(start, end);
    return { events: page, prevCursor: start > 0 ? (page[0]?.seq ?? null) : null };
  });
  const api: MoxxyApi = {
    invoke: invoke as unknown as MoxxyApi['invoke'],
    subscribe: ((event: string, fn: (p: { channelId: string }) => void) => {
      if (event === 'channels.historyChanged') listeners.push(fn);
      return () => {};
    }) as unknown as MoxxyApi['subscribe'],
  };
  return { api, invoke, changed: (channelId: string) => listeners.forEach((l) => l({ channelId })) };
}

async function mounted(log: MoxxyEvent[], pageSize = 3) {
  const fake = fakeApi(log);
  __setApiOverride(fake.api);
  const hook = renderHook(() => useChannelTranscript('discord', { pageSize }));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { ...fake, hook };
}

describe('useChannelTranscript', () => {
  it('loads the latest page of the bot conversation', async () => {
    const { hook, invoke } = await mounted([ev(1), ev(2), ev(3), ev(4), ev(5)]);

    expect(invoke).toHaveBeenCalledWith('channels.history', { channelId: 'discord', before: null, limit: 3 });
    expect(seqs(hook.result.current.events)).toEqual([3, 4, 5]);
    expect(hook.result.current.hasOlder).toBe(true);
  });

  it('is empty (not an error) while the bot has no conversation yet', async () => {
    const { hook } = await mounted([]);
    expect(hook.result.current.events).toEqual([]);
    expect(hook.result.current.error).toBeNull();
  });

  it('pages older messages on demand', async () => {
    const { hook } = await mounted([ev(1), ev(2), ev(3), ev(4), ev(5)]);

    await act(async () => hook.result.current.loadOlder());

    expect(seqs(hook.result.current.events)).toEqual([1, 2, 3, 4, 5]);
    expect(hook.result.current.hasOlder).toBe(false);
  });

  it('shows new messages when the log changes, keeping already-loaded older pages', async () => {
    const log = [ev(1), ev(2), ev(3), ev(4), ev(5)];
    const { hook, changed } = await mounted(log);
    await act(async () => hook.result.current.loadOlder());

    log.push(ev(6), ev(7));
    await act(async () => changed('discord'));

    await waitFor(() => expect(seqs(hook.result.current.events)).toEqual([1, 2, 3, 4, 5, 6, 7]));
  });

  it('ignores changes to other channels', async () => {
    const { invoke, changed } = await mounted([ev(1)]);
    const calls = invoke.mock.calls.length;

    await act(async () => changed('telegram'));

    expect(invoke.mock.calls.length).toBe(calls);
  });
});
