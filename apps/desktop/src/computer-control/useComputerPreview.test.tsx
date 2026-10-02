import { afterEach, beforeEach, expect, it } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride, connectionStore } from '@moxxy/client-core';
import type { ConnectionPhase } from '@moxxy/desktop-ipc-contract';
import { reloadPreviewHiddenFromStorage } from './preview-model';
import { useComputerPreview } from './useComputerPreview';
import type { VideoCodecs } from './video-preview';

const CONNECTED: ConnectionPhase = { phase: 'connected', socket: '/tmp/serve.sock', sessionId: 's', activeProvider: null, activeMode: null };
const image = { mediaType: 'image/jpeg' as const, base64: 'abc', width: 640, height: 400 };
interface SurfaceData { workspaceId: string; data: { surfaceId: string; payload: unknown } }

function installApi() {
  const calls: Array<{ channel: string; args: unknown }> = [];
  let listener: ((data: SurfaceData) => void) | null = null;
  __setApiOverride({
    invoke: (async (channel: string, args: unknown) => {
      calls.push({ channel, args });
      return channel === 'surface.open' ? { surfaceId: 'preview-1', kind: 'computer-preview', snapshot: { state: 'live', frame: { seq: 1, image } } } : undefined;
    }) as never,
    subscribe: ((event: string, callback: (data: SurfaceData) => void) => {
      if (event === 'surface.data') listener = callback;
      return () => { listener = null; };
    }) as never,
  } as never);
  return {
    calls,
    channels: () => calls.map((call) => call.channel),
    push: (payload: unknown) => act(() => listener?.({ workspaceId: 'ws', data: { surfaceId: 'preview-1', payload } })),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  reloadPreviewHiddenFromStorage();
  act(() => connectionStore.setSnapshot('ws', { phase: CONNECTED, cliPath: null, attempts: 0, log: [] }));
});
afterEach(() => { cleanup(); __setApiOverride(null); });

it('watches the preview only while a turn uses the computer, and follows its frames', async () => {
  const fake = installApi();
  const { result, rerender } = renderHook(({ active }) => useComputerPreview('ws', active), { initialProps: { active: false } });
  expect(result.current.view).toBeNull();
  expect(fake.channels()).toEqual([]);
  rerender({ active: true });
  await waitFor(() => expect(result.current.view?.frame?.seq).toBe(1));
  expect(fake.calls[0]).toEqual({ channel: 'surface.open', args: { workspaceId: 'ws', kind: 'computer-preview' } });
  fake.push({ type: 'frame', seq: 2, image: { ...image, base64: 'def' } });
  expect(result.current.view?.frame?.image.base64).toBe('def');
  rerender({ active: false });
  await waitFor(() => expect(fake.channels()).toContain('surface.close'));
  expect(result.current.view).toBeNull();
});

it('stops watching when the user hides it, here or everywhere, and can show it again', async () => {
  const fake = installApi();
  const { result } = renderHook(() => useComputerPreview('ws', true));
  await waitFor(() => expect(result.current.view).not.toBeNull());
  act(() => result.current.hide('conversation'));
  await waitFor(() => expect(fake.channels()).toContain('surface.close'));
  expect(result.current.view).toBeNull();
  expect(result.current.hidden).toBe(true);
  act(() => result.current.show());
  await waitFor(() => expect(result.current.view).not.toBeNull());
  expect(result.current.hidden).toBe(false);
});

it('tells the surface it can decode video, feeds chunks to the decoder and asks for a key frame when it falls behind', async () => {
  const fake = installApi();
  const decoded: string[] = [];
  let queue = 0;
  class Decoder {
    get decodeQueueSize() { return queue; }
    configure() { decoded.push('configure'); }
    decode(chunk: { type: string }) { decoded.push(chunk.type); }
    close() { decoded.push('close'); }
  }
  class Chunk { readonly type: string; constructor(init: { type: string }) { this.type = init.type; } }
  const codecs = { Decoder, Chunk } as unknown as VideoCodecs;
  const { result, unmount } = renderHook(() => useComputerPreview('ws', true, codecs));
  await waitFor(() => expect(fake.calls.some((call) => call.channel === 'surface.input')).toBe(true));
  expect(fake.calls.find((call) => call.channel === 'surface.input')?.args).toEqual({ workspaceId: 'ws', surfaceId: 'preview-1', message: { type: 'configure', codecs: ['h264', 'jpeg'] } });
  const chunk = { type: 'chunk', seq: 1, key: true, codec: 'avc1.4d001f', data: btoa('unit'), timestamp: 0, width: 640, height: 400 };
  fake.push(chunk);
  fake.push({ ...chunk, seq: 2, key: false });
  expect(decoded).toEqual(['configure', 'key', 'delta']);
  expect(result.current.view).toEqual({ state: 'live', video: { width: 640, height: 400 } });
  queue = 9;
  fake.push({ ...chunk, seq: 3, key: false });
  await waitFor(() => expect(fake.calls.at(-1)).toEqual({ channel: 'surface.input', args: { workspaceId: 'ws', surfaceId: 'preview-1', message: { type: 'keyframe' } } }));
  unmount();
  expect(decoded.at(-1)).toBe('close');
});

it('asks for pictures only where the browser has no video decoder', async () => {
  const fake = installApi();
  const { result } = renderHook(() => useComputerPreview('ws', true));
  await waitFor(() => expect(result.current.view).not.toBeNull());
  expect(fake.channels()).not.toContain('surface.input');
});
