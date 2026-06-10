/**
 * useAgentTask — the shared "ask moxxy to do it" background-turn hook.
 * Locks down:
 *   1. start() invokes session.runTurn and hides the turn from the transcript.
 *   2. runner.event chunks are mirrored only for the matching turnId
 *      (assistant_message replaces the accumulated text).
 *   3. runner.turn.complete flips to done/error and unhides the turn;
 *      completes for other turns are ignored.
 *   4. Unmount unhides the turn even mid-stream (cleanup).
 *   5. Without a workspace, start() is a no-op.
 */

import { describe, expect, it, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { __setApiOverride, chatStore } from '@moxxy/client-core';
import { useAgentTask } from './useAgentTask';

interface IpcSpy {
  invokes: Array<{ channel: string; args: unknown }>;
  emit: (channel: string, payload: unknown) => void;
}

function installFakeApi(): IpcSpy {
  const invokes: Array<{ channel: string; args: unknown }> = [];
  const subs = new Map<string, Set<(payload: unknown) => void>>();

  __setApiOverride({
    invoke: ((channel: string, args: unknown) => {
      invokes.push({ channel, args });
      if (channel === 'session.runTurn') return Promise.resolve({ turnId: 't-1' });
      return Promise.resolve(undefined);
    }) as never,
    subscribe: ((channel: string, cb: (payload: unknown) => void) => {
      let set = subs.get(channel);
      if (!set) {
        set = new Set();
        subs.set(channel, set);
      }
      set.add(cb);
      return () => {
        set?.delete(cb);
      };
    }) as never,
  } as never);

  return {
    invokes,
    emit: (channel, payload) => {
      const set = subs.get(channel);
      if (set) for (const cb of set) cb(payload);
    },
  };
}

const chunk = (turnId: string, delta: string): unknown => ({
  workspaceId: 'ws-test',
  event: { type: 'assistant_chunk', turnId, delta },
});

const message = (turnId: string, content: string): unknown => ({
  workspaceId: 'ws-test',
  event: { type: 'assistant_message', turnId, content, stopReason: 'end_turn' },
});

const complete = (turnId: string, error: string | null): unknown => ({
  workspaceId: 'ws-test',
  turnId,
  error,
});

afterEach(() => {
  __setApiOverride(null);
  vi.restoreAllMocks();
});

describe('useAgentTask', () => {
  it('start() runs a hidden turn and mirrors only matching chunks', async () => {
    const spy = installFakeApi();
    const hide = vi.spyOn(chatStore, 'hideTurn');
    const { result } = renderHook(() => useAgentTask('ws-test'));

    expect(result.current.phase).toBe('idle');
    await act(async () => {
      await result.current.start('PROMPT');
    });

    const run = spy.invokes.find((i) => i.channel === 'session.runTurn');
    expect(run).toBeTruthy();
    expect(run!.args).toEqual({ workspaceId: 'ws-test', prompt: 'PROMPT' });
    expect(hide).toHaveBeenCalledWith('t-1');
    expect(result.current.phase).toBe('streaming');

    act(() => {
      spy.emit('runner.event', chunk('t-1', 'Hello '));
      spy.emit('runner.event', chunk('t-OTHER', 'NOPE'));
      spy.emit('runner.event', chunk('t-1', 'world'));
    });
    expect(result.current.output).toBe('Hello world');

    // assistant_message replaces the accumulated stream.
    act(() => {
      spy.emit('runner.event', message('t-1', 'final text'));
    });
    expect(result.current.output).toBe('final text');
  });

  it('turn completion flips to done and unhides; foreign completes are ignored', async () => {
    const spy = installFakeApi();
    const unhide = vi.spyOn(chatStore, 'unhideTurn');
    const { result } = renderHook(() => useAgentTask('ws-test'));

    await act(async () => {
      await result.current.start('PROMPT');
    });
    act(() => {
      spy.emit('runner.turn.complete', complete('t-OTHER', null));
    });
    expect(result.current.phase).toBe('streaming');

    act(() => {
      spy.emit('runner.turn.complete', complete('t-1', null));
    });
    expect(result.current.phase).toBe('done');
    expect(result.current.error).toBeNull();
    expect(unhide).toHaveBeenCalledWith('t-1');
  });

  it('turn completion with an error flips to error', async () => {
    const spy = installFakeApi();
    const { result } = renderHook(() => useAgentTask('ws-test'));

    await act(async () => {
      await result.current.start('PROMPT');
    });
    act(() => {
      spy.emit('runner.turn.complete', complete('t-1', 'provider exploded'));
    });
    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('provider exploded');
  });

  it('unmount unhides the in-flight turn (cleanup)', async () => {
    installFakeApi();
    const unhide = vi.spyOn(chatStore, 'unhideTurn');
    const { result, unmount } = renderHook(() => useAgentTask('ws-test'));

    await act(async () => {
      await result.current.start('PROMPT');
    });
    expect(unhide).not.toHaveBeenCalled();
    unmount();
    expect(unhide).toHaveBeenCalledWith('t-1');
  });

  it('is a no-op without an active workspace', async () => {
    const spy = installFakeApi();
    const { result } = renderHook(() => useAgentTask(null));

    await act(async () => {
      await result.current.start('PROMPT');
    });
    expect(spy.invokes.find((i) => i.channel === 'session.runTurn')).toBeUndefined();
    expect(result.current.phase).toBe('idle');
  });

  it('surfaces a runTurn rejection as an error phase', async () => {
    installFakeApi();
    __setApiOverride({
      invoke: (() => Promise.reject(new Error('runner offline'))) as never,
      subscribe: (() => () => undefined) as never,
    } as never);
    const { result } = renderHook(() => useAgentTask('ws-test'));

    await act(async () => {
      await result.current.start('PROMPT');
    });
    expect(result.current.phase).toBe('error');
    expect(result.current.error).toMatch(/runner offline/);
  });
});
