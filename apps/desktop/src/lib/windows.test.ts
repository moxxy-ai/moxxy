import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWindows } from './windows';
import { mockTauri } from '@/__mocks__/tauri';

vi.mock('@/lib/tauri', () => import('@/__mocks__/tauri'));

describe('useWindows', () => {
  beforeEach(() => {
    mockTauri.reset();
  });

  it('starts not-opening with no error', () => {
    const { result } = renderHook(() => useWindows());
    expect(result.current.opening).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('openSession() returns the new window label', async () => {
    mockTauri.respond('open_session_window', () => 'session-abc');
    const { result } = renderHook(() => useWindows());
    let label: string | null = null;
    await act(async () => {
      label = await result.current.openSession();
    });
    expect(label).toBe('session-abc');
    expect(result.current.opening).toBe(false);
  });

  it('captures errors and clears opening state', async () => {
    mockTauri.respond('open_session_window', () => {
      throw new Error('spawn ephemeral: out of disk');
    });
    const { result } = renderHook(() => useWindows());
    let label: string | null = null;
    await act(async () => {
      label = await result.current.openSession();
    });
    expect(label).toBeNull();
    expect(result.current.error).toContain('out of disk');
    expect(result.current.opening).toBe(false);
  });

  it('close() forwards the label to the Rust command', async () => {
    mockTauri.respond('close_session_window', (args) => {
      expect(args).toEqual({ window: 'session-abc' });
      return null;
    });
    const { result } = renderHook(() => useWindows());
    await act(async () => {
      await result.current.close('session-abc');
    });
    expect(mockTauri.calls.find((c) => c.cmd === 'close_session_window')).toBeDefined();
  });

  it('parallel openSession() calls during a pending one are a no-op', async () => {
    let resolveOpen: (label: string) => void = () => {};
    mockTauri.respond(
      'open_session_window',
      () =>
        new Promise<string>((resolve) => {
          resolveOpen = resolve;
        }),
    );
    const { result } = renderHook(() => useWindows());

    // Kick off the first spawn — don't await.
    let firstP: Promise<string | null> | undefined;
    act(() => {
      firstP = result.current.openSession();
    });
    await waitFor(() => expect(result.current.opening).toBe(true));

    // Second call returns null immediately without invoking again.
    let secondLabel: string | null = 'unset';
    await act(async () => {
      secondLabel = await result.current.openSession();
    });
    expect(secondLabel).toBeNull();
    expect(
      mockTauri.calls.filter((c) => c.cmd === 'open_session_window').length,
    ).toBe(1);

    // Resolve the first.
    await act(async () => {
      resolveOpen('session-1');
      await firstP;
    });
  });
});
