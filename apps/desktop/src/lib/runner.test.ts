import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { isSidecarStatus, useSidecarStatus } from './runner';
import { mockTauri } from '@/__mocks__/tauri';

vi.mock('@/lib/tauri', () => import('@/__mocks__/tauri'));

describe('isSidecarStatus', () => {
  it.each(['starting', 'running', 'crashed', 'stopped'])(
    'accepts %s',
    (value) => {
      expect(isSidecarStatus(value)).toBe(true);
    },
  );

  it.each([null, undefined, 'paused', 42, {}])('rejects %p', (value) => {
    expect(isSidecarStatus(value)).toBe(false);
  });
});

describe('useSidecarStatus', () => {
  beforeEach(() => {
    mockTauri.reset();
  });

  it('starts at "starting" before the first response lands', () => {
    mockTauri.respond('sidecar_status', () => new Promise(() => {}));
    const { result } = renderHook(() => useSidecarStatus());
    expect(result.current).toBe('starting');
  });

  it('adopts the initial status from invoke()', async () => {
    mockTauri.respond('sidecar_status', () => 'running');
    const { result } = renderHook(() => useSidecarStatus());
    await waitFor(() => expect(result.current).toBe('running'));
  });

  it('updates when a sidecar.status event arrives', async () => {
    mockTauri.respond('sidecar_status', () => 'starting');
    const { result } = renderHook(() => useSidecarStatus());
    await waitFor(() => expect(result.current).toBe('starting'));

    mockTauri.emit('sidecar.status', 'running');
    await waitFor(() => expect(result.current).toBe('running'));

    mockTauri.emit('sidecar.status', 'crashed');
    await waitFor(() => expect(result.current).toBe('crashed'));
  });

  it('ignores malformed status payloads', async () => {
    mockTauri.respond('sidecar_status', () => 'running');
    const { result } = renderHook(() => useSidecarStatus());
    await waitFor(() => expect(result.current).toBe('running'));

    mockTauri.emit('sidecar.status', 'banana');
    expect(result.current).toBe('running');
  });

  it('falls back gracefully when the Rust command throws', async () => {
    mockTauri.respond('sidecar_status', () => {
      throw new Error('no command registered');
    });
    const { result } = renderHook(() => useSidecarStatus());
    await waitFor(() => expect(result.current).toBe('starting'));
  });

  it('unsubscribes from events on unmount', async () => {
    mockTauri.respond('sidecar_status', () => 'running');
    const { result, unmount } = renderHook(() => useSidecarStatus());
    await waitFor(() => expect(result.current).toBe('running'));

    unmount();
    await Promise.resolve();

    expect(() => mockTauri.emit('sidecar.status', 'crashed')).not.toThrow();
  });
});
