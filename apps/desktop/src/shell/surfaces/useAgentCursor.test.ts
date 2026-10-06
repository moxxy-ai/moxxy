import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { BrowserCursor } from '@moxxy/desktop-ipc-contract';
import { useAgentCursor } from './useAgentCursor.js';

type Frame = { requestId: string; tabId: string; cursor: BrowserCursor | null };

function installApi() {
  const confirmed: string[] = [];
  let push: ((frame: Frame) => void) | null = null;
  __setApiOverride({
    invoke: ((channel: string, args: { requestId: string }) => {
      if (channel === 'browser.confirmCursor') confirmed.push(args.requestId);
      return Promise.resolve(undefined);
    }) as never,
    subscribe: ((channel: string, fn: (frame: Frame) => void) => {
      if (channel === 'browser.cursor') push = fn;
      return () => {
        push = null;
      };
    }) as never,
  } as never);
  return {
    confirmed,
    send: (frame: Frame) => act(() => push?.(frame)),
  };
}

const moving = (x: number, y: number, durationMs: number): BrowserCursor => ({ x, y, phase: 'moving', durationMs });

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  __setApiOverride(null as never);
});

describe('useAgentCursor', () => {
  it('shows the pointer on the tab in front and answers once it has glided there', () => {
    const api = installApi();
    const { result } = renderHook(() => useAgentCursor('t1', true));

    api.send({ requestId: 'c1', tabId: 't1', cursor: moving(10, 20, 0) });
    api.send({ requestId: 'c2', tabId: 't1', cursor: moving(70, 100, 130) });

    expect(result.current.cursor).toMatchObject({ x: 70, y: 100, phase: 'moving', durationMs: 130 });
    expect(api.confirmed).toEqual(['c1']);
    act(() => result.current.arrived());
    act(() => result.current.arrived());
    expect(api.confirmed).toEqual(['c1', 'c2']);
  });

  it('answers at once for a pointer it is not drawing, so the agent never waits on nothing', () => {
    const api = installApi();
    const { result, rerender } = renderHook(({ shown }) => useAgentCursor('t1', shown), {
      initialProps: { shown: false },
    });

    api.send({ requestId: 'c1', tabId: 't1', cursor: moving(10, 20, 200) });
    api.send({ requestId: 'c2', tabId: 't2', cursor: moving(10, 20, 200) });

    expect(result.current.cursor).toBeNull();
    expect(api.confirmed).toEqual(['c1', 'c2']);

    rerender({ shown: true });
    api.send({ requestId: 'c3', tabId: 't1', cursor: moving(90, 20, 200) });
    rerender({ shown: false });
    expect(api.confirmed).toEqual(['c1', 'c2', 'c3']);
  });

  it('counts each press, so every one is marked even at the same place', () => {
    const api = installApi();
    const { result } = renderHook(() => useAgentCursor('t1', true));
    api.send({ requestId: 'c1', tabId: 't1', cursor: moving(10, 20, 0) });

    api.send({ requestId: 'c2', tabId: 't1', cursor: { x: 10, y: 20, phase: 'delivered', durationMs: 0 } });
    const first = result.current.cursor?.press;
    api.send({ requestId: 'c3', tabId: 't1', cursor: { x: 10, y: 20, phase: 'failed', durationMs: 0 } });

    expect(result.current.cursor).toMatchObject({ phase: 'failed' });
    expect(result.current.cursor?.press).toBe((first ?? 0) + 1);
  });

  it('takes the pointer off the page when main does', () => {
    const api = installApi();
    const { result } = renderHook(() => useAgentCursor('t1', true));
    api.send({ requestId: 'c1', tabId: 't1', cursor: moving(10, 20, 0) });

    api.send({ requestId: 'c2', tabId: 't1', cursor: null });

    expect(result.current.cursor).toBeNull();
  });

  it('does not hold the agent for a glide the person asked not to see', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }));
    const api = installApi();
    renderHook(() => useAgentCursor('t1', true));

    api.send({ requestId: 'c1', tabId: 't1', cursor: moving(10, 20, 200) });

    expect(api.confirmed).toEqual(['c1']);
  });
});
