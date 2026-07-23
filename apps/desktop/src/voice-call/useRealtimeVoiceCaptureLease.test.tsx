import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { __setApiOverride } from '@moxxy/client-core';
import { useRealtimeVoiceCaptureLease } from './useRealtimeVoiceCaptureLease';

afterEach(() => __setApiOverride(null));

describe('useRealtimeVoiceCaptureLease', () => {
  it('owns throttling only from the main renderer and releases it on close', async () => {
    const invoke = vi.fn(async () => undefined);
    __setApiOverride({ invoke, subscribe: vi.fn() } as unknown as MoxxyApi);
    const { rerender, unmount } = renderHook(
      ({ active, surface }) => useRealtimeVoiceCaptureLease(active, surface),
      { initialProps: { active: false, surface: 'main' as const } },
    );

    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith(
      'voice.setRealtimeCaptureActive',
      { active: false },
    ));

    rerender({ active: true, surface: 'main' });
    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith(
      'voice.setRealtimeCaptureActive',
      { active: true },
    ));

    act(() => unmount());
    expect(invoke).toHaveBeenLastCalledWith('voice.setRealtimeCaptureActive', { active: false });
  });

  it('never acquires the lease from Focus Mode', async () => {
    const invoke = vi.fn(async () => undefined);
    __setApiOverride({ invoke, subscribe: vi.fn() } as unknown as MoxxyApi);

    const { unmount } = renderHook(() => useRealtimeVoiceCaptureLease(true, 'focus'));
    unmount();
    await Promise.resolve();

    expect(invoke).not.toHaveBeenCalled();
  });
});
