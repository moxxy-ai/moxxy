/**
 * useChatMedia — one chat's photos, files and links, kept fresh by the chat's
 * own events. Driven through the fake `api` shim (the IPC transport).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ChatMediaItem, MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { __setApiOverride } from './transport.js';
import {
  readChatMediaImage,
  useChatMedia,
  useChatMediaThumbnail,
  __clearChatMediaThumbnails,
} from './useChatMedia.js';

type Listener = (payload: unknown) => void;

const link = (id: string): ChatMediaItem => ({
  kind: 'link',
  id,
  owner: 'agent',
  seq: 1,
  ts: 1,
  caption: '',
  url: `https://${id}.example/`,
  label: null,
});

function host(answer: (command: string, args: Record<string, unknown>) => unknown) {
  const listeners = new Map<string, Set<Listener>>();
  const invoke = vi.fn(async (command: string, args: Record<string, unknown>) => answer(command, args));
  __setApiOverride({
    invoke: invoke as unknown as MoxxyApi['invoke'],
    subscribe: ((channel: string, listener: Listener) => {
      const set = listeners.get(channel) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(channel, set);
      return () => set.delete(listener);
    }) as MoxxyApi['subscribe'],
  });
  const emit = (channel: string, payload: unknown): void =>
    act(() => {
      for (const listener of listeners.get(channel) ?? []) listener(payload);
    });
  const calls = (command: string) => invoke.mock.calls.filter(([name]) => name === command);
  return { invoke, emit, calls };
}

const runnerEvent = (workspaceId: string, type: string) => ({ workspaceId, event: { type, seq: 9 } });

afterEach(() => {
  __setApiOverride(null);
  __clearChatMediaThumbnails();
});

describe('useChatMedia', () => {
  it('loads the new chat even while the previous chat is still being read', async () => {
    const pending: Array<(value: unknown) => void> = [];
    host(() => new Promise((resolve) => pending.push(resolve)));
    const { result, rerender } = renderHook(({ id }) => useChatMedia(id), { initialProps: { id: 'w1' } });
    await waitFor(() => expect(pending).toHaveLength(1));
    rerender({ id: 'w2' });
    await act(async () => pending[0]?.({ items: [link('w1')] }));
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => pending[1]?.({ items: [link('w2')] }));
    await waitFor(() => expect(result.current.items).toEqual([link('w2')]));
  });
  it("loads the chat's library", async () => {
    const { calls } = host(() => ({ items: [link('a')] }));
    const { result } = renderHook(() => useChatMedia('w1'));
    await waitFor(() => expect(result.current.items).toEqual([link('a')]));
    expect(result.current.loading).toBe(false);
    expect(calls('chat.media')).toEqual([['chat.media', { workspaceId: 'w1' }]]);
  });

  it('reads again when this chat gets a message, a tool result or a reset — not for chunks or other chats', async () => {
    let version = 0;
    const { emit, calls } = host(() => ({ items: [link(`v${version}`)] }));
    const { result } = renderHook(() => useChatMedia('w1'));
    await waitFor(() => expect(result.current.items).toEqual([link('v0')]));

    emit('runner.event', runnerEvent('w1', 'assistant_chunk'));
    emit('runner.event', runnerEvent('w2', 'assistant_message'));
    await act(async () => undefined);
    expect(calls('chat.media')).toHaveLength(1);

    version = 1;
    emit('runner.event', runnerEvent('w1', 'assistant_message'));
    await waitFor(() => expect(result.current.items).toEqual([link('v1')]));

    version = 2;
    emit('runner.turn.complete', { workspaceId: 'w1', turnId: 't', error: null });
    await waitFor(() => expect(result.current.items).toEqual([link('v2')]));

    version = 3;
    emit('chat.cleared', { workspaceId: 'w1' });
    await waitFor(() => expect(result.current.items).toEqual([link('v3')]));
  });

  it('folds a burst of events into one more read after the one in flight', async () => {
    const pending: Array<(value: unknown) => void> = [];
    const { emit, calls } = host(() => new Promise((resolve) => pending.push(resolve)));
    const { result } = renderHook(() => useChatMedia('w1'));
    await waitFor(() => expect(pending).toHaveLength(1));

    emit('runner.event', runnerEvent('w1', 'tool_result'));
    emit('runner.event', runnerEvent('w1', 'assistant_message'));
    emit('runner.event', runnerEvent('w1', 'user_prompt'));
    expect(calls('chat.media')).toHaveLength(1);

    await act(async () => pending[0]?.({ items: [link('old')] }));
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => pending[1]?.({ items: [link('new')] }));
    await waitFor(() => expect(result.current.items).toEqual([link('new')]));
    expect(calls('chat.media')).toHaveLength(2);
  });

  it("never shows one chat's items under another", async () => {
    host((_command, args) => ({ items: [link(String(args.workspaceId))] }));
    const { result, rerender } = renderHook(({ id }) => useChatMedia(id), { initialProps: { id: 'w1' } });
    await waitFor(() => expect(result.current.items).toEqual([link('w1')]));
    rerender({ id: 'w2' });
    expect(result.current.items).toEqual([]);
    await waitFor(() => expect(result.current.items).toEqual([link('w2')]));
  });

  it('says when the library could not be read', async () => {
    host(() => {
      throw new Error('disk on fire');
    });
    const { result } = renderHook(() => useChatMedia('w1'));
    await waitFor(() => expect(result.current.error).toBe('disk on fire'));
    expect(result.current.loading).toBe(false);
  });
});

describe('useChatMediaThumbnail', () => {
  it('releases a tile image when it leaves the visible area', async () => {
    host(() => ({ mediaType: 'image/png', base64: 'AAAA' }));
    const { result, rerender } = renderHook(({ shown }) => useChatMediaThumbnail('w1', 't:1:0', shown), {
      initialProps: { shown: true },
    });
    await waitFor(() => expect(result.current).toBe('data:image/png;base64,AAAA'));
    rerender({ shown: false });
    expect(result.current).toBeNull();
  });
  it('asks only once the tile is shown, and once per image', async () => {
    const { calls } = host(() => ({ mediaType: 'image/jpeg', base64: 'AAAA' }));
    const { result, rerender } = renderHook(({ shown }) => useChatMediaThumbnail('w1', 't:1:0', shown), {
      initialProps: { shown: false },
    });
    expect(result.current).toBeNull();
    expect(calls('chat.mediaThumbnail')).toHaveLength(0);

    rerender({ shown: true });
    await waitFor(() => expect(result.current).toBe('data:image/jpeg;base64,AAAA'));

    const again = renderHook(() => useChatMediaThumbnail('w1', 't:1:0', true));
    expect(again.result.current).toBe('data:image/jpeg;base64,AAAA');
    expect(calls('chat.mediaThumbnail')).toHaveLength(1);
  });
});

describe('readChatMediaImage', () => {
  it('reads an image slice by slice', async () => {
    const whole = 'AAAABBBBCC';
    const { calls } = host((_command, args) => {
      const offset = Number(args.offset);
      return { mediaType: 'image/png', data: whole.slice(offset, offset + 4), total: whole.length };
    });
    expect(await readChatMediaImage('w1', 'a:0:0')).toEqual({ mediaType: 'image/png', base64: whole });
    expect(calls('chat.readMediaImage').map(([, args]) => (args as { offset: number }).offset)).toEqual([
      0, 4, 8,
    ]);
  });

  it('answers null for an image the chat no longer has', async () => {
    host(() => null);
    expect(await readChatMediaImage('w1', 'a:0:0')).toBeNull();
  });
});
