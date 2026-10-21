import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { ChatMediaItem, MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { useMediaPane } from './useMediaPane';

const image = (id: string, owner: 'me' | 'agent', caption = ''): ChatMediaItem => ({
  kind: 'image',
  id,
  owner,
  seq: 1,
  ts: new Date('2026-10-10T10:00:00').getTime(),
  caption,
  mediaType: 'image/png',
  name: `${id}.png`,
  bytes: 1,
});

const ITEMS: ChatMediaItem[] = [
  image('i3', 'agent', 'cart page'),
  image('i2', 'me', 'concert poster'),
  image('i1', 'agent'),
  {
    kind: 'link',
    id: 'l:https://a.example/',
    owner: 'me',
    seq: 1,
    ts: 1,
    caption: '',
    url: 'https://a.example/',
    label: null,
  },
  {
    kind: 'file',
    id: 'a:1:0',
    owner: 'me',
    seq: 1,
    ts: 1,
    caption: '',
    name: 'Umowa.pdf',
    mediaType: 'application/pdf',
    bytes: 4,
    path: null,
  },
];

function host({ open = async () => ({ opened: 'app' }) }: { open?: () => Promise<unknown> } = {}) {
  const invoke = vi.fn(async (command: string, args: { id?: string; offset?: number }) => {
    if (command === 'chat.media') return { items: ITEMS };
    if (command === 'chat.readMediaImage')
      return { mediaType: 'image/png', data: `bytes-of-${args.id}`, total: `bytes-of-${args.id}`.length };
    if (command === 'chat.openMediaFile') return open();
    throw new Error(`unexpected ${command}`);
  });
  __setApiOverride({
    invoke: invoke as unknown as MoxxyApi['invoke'],
    subscribe: (() => () => undefined) as MoxxyApi['subscribe'],
  });
  return invoke;
}

afterEach(() => __setApiOverride(null));

describe('useMediaPane', () => {
  it('opens on the images, everyone’s, and narrows by owner and words', async () => {
    host();
    const { result } = renderHook(() => useMediaPane('w1'));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(['i3', 'i2', 'i1']));
    expect(result.current.groups.map((group) => group.items.length)).toEqual([3]);

    act(() => result.current.setOwner('me'));
    expect(result.current.items.map((item) => item.id)).toEqual(['i2']);

    act(() => {
      result.current.setOwner('all');
      result.current.setQuery('cart');
    });
    expect(result.current.items.map((item) => item.id)).toEqual(['i3']);

    act(() => {
      result.current.setQuery('');
      result.current.setKind('file');
    });
    expect(result.current.items.map((item) => item.id)).toEqual(['a:1:0']);
    expect(result.current.empty).toBe(false);
  });

  it('previews an image whole and steps through the images on the shelf', async () => {
    host();
    const { result } = renderHook(() => useMediaPane('w1'));
    await waitFor(() => expect(result.current.items).toHaveLength(3));

    act(() => result.current.openImage('i2'));
    await waitFor(() => expect(result.current.preview?.image?.base64).toBe('bytes-of-i2'));
    expect(result.current.preview).toMatchObject({ position: '2 of 3', hasPrevious: true, hasNext: true });

    act(() => result.current.preview?.next());
    await waitFor(() => expect(result.current.preview?.image?.base64).toBe('bytes-of-i1'));
    expect(result.current.preview?.hasNext).toBe(false);

    act(() => result.current.preview?.close());
    expect(result.current.preview).toBeNull();
  });

  it('opens a file through the host, and says so when it cannot', async () => {
    const invoke = host({
      open: async () => {
        throw new Error('file not found: /x');
      },
    });
    const { result } = renderHook(() => useMediaPane('w1'));
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    await act(async () => result.current.openFile('a:1:0'));
    expect(invoke).toHaveBeenCalledWith('chat.openMediaFile', { workspaceId: 'w1', id: 'a:1:0' });
    expect(result.current.notice).toBe('file not found: /x');
  });

  it('starts over on another chat', async () => {
    host();
    const { result, rerender } = renderHook(({ id }) => useMediaPane(id), { initialProps: { id: 'w1' } });
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    act(() => {
      result.current.setKind('link');
      result.current.setQuery('a.example');
    });
    rerender({ id: 'w2' });
    expect(result.current.kind).toBe('image');
    expect(result.current.query).toBe('');
  });
});
