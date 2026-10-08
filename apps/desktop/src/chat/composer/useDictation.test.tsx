import { act, renderHook, waitFor } from '@testing-library/react';
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
  it('does not ask the runner about a transcriber before the connection is up', () => {
    const invoke = runner(true);
    renderHook(() => useDictation({ ...options, ready: false, suspended: false }));
    expect(invoke).not.toHaveBeenCalled();
  });

  it('says why nothing happens when the runner has no transcriber, then lets go of the notice', async () => {
    const invoke = runner(false);
    const { result } = renderHook(() => useDictation({ ...options, ready: true, suspended: false }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('session.hasTranscriber'));

    vi.useFakeTimers();
    act(() => result.current.press());
    expect(result.current.phase).toBe('idle');
    expect(result.current.notice).toBe('No transcriber configured on the runner.');

    act(() => vi.advanceTimersByTime(2500));
    expect(result.current.notice).toBeNull();
  });

  it('starts idle with nothing to report', () => {
    runner(true);
    const { result } = renderHook(() => useDictation({ ...options, ready: true, suspended: false }));
    expect(result.current.phase).toBe('idle');
    expect(result.current.notice).toBeNull();
  });
});
