import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import { useDictation } from './useDictation';

/** The IPC boundary is replaced; the microphone is never reached in these. */
function runner(hasTranscriber: boolean) {
  const invoke = vi.fn(async (command: string) =>
    command === 'session.hasTranscriber' ? hasTranscriber : undefined,
  );
  __setApiOverride({ invoke, subscribe: () => () => {} } as never);
  return invoke;
}

const options = { workspaceId: 'w-dictation', onTranscript: () => {} };

afterEach(() => {
  vi.useRealTimers();
  __setApiOverride(null);
});

describe('useDictation', () => {
  it('does not ask the runner or offer installation before the connection is up', async () => {
    const invoke = runner(true);
    const { result } = renderHook(() => useDictation({ ...options, ready: false, suspended: false }));
    await act(async () => { await result.current.press(); });
    expect(result.current.needsSetup).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('offers setup only after confirming that dictation is unavailable', async () => {
    runner(false);
    const { result } = renderHook(() => useDictation({ ...options, ready: true, suspended: false }));
    await act(async () => { await result.current.press(); });
    expect(result.current.phase).toBe('idle');
    expect(result.current.needsSetup).toBe(true);
    act(() => result.current.dismissSetup());
    expect(result.current.needsSetup).toBe(false);
  });

  it('does not suggest reinstalling a model when the availability check fails', async () => {
    const invoke = runner(false);
    invoke.mockRejectedValue(new Error('Disconnected'));
    const { result } = renderHook(() => useDictation({ ...options, ready: true, suspended: false }));
    await act(async () => { await result.current.press(); });
    expect(result.current.needsSetup).toBe(false);
    expect(result.current.notice).toMatch(/try again/i);
  });

  it('ignores a delayed check after Voice Mode takes the microphone', async () => {
    const invoke = runner(false);
    let finish: () => void = () => { throw new Error('Dictation check has not started'); };
    invoke.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = () => resolve(false); }));
    const { result, rerender } = renderHook(({ suspended }) => useDictation({ ...options, ready: true, suspended }),
      { initialProps: { suspended: false } });
    act(() => { result.current.press(); result.current.press(); });
    expect(invoke).toHaveBeenCalledTimes(1);
    rerender({ suspended: true });
    await act(async () => { finish(); });
    expect(result.current.needsSetup).toBe(false);
    expect(result.current.phase).toBe('idle');
  });

  it('starts idle with nothing to report', () => {
    runner(true);
    const { result } = renderHook(() => useDictation({ ...options, ready: true, suspended: false }));
    expect(result.current.phase).toBe('idle');
    expect(result.current.notice).toBeNull();
  });
});
