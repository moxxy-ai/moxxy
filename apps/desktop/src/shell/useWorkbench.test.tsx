/**
 * useWorkbench — which pane is open beside a chat, and whether it is in full
 * view. Full view only means something while a pane is open, so closing the
 * pane ends it, and asking for it with nothing open opens the browser: that is
 * the pane the gesture exists for.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { useWorkbench } from './useWorkbench';

beforeEach(() => {
  __setApiOverride({
    invoke: async () => undefined,
    subscribe: () => () => undefined,
  } as unknown as MoxxyApi);
});
afterEach(() => __setApiOverride(null));

describe('useWorkbench', () => {
  it('starts collapsed and not in full view', () => {
    const { result } = renderHook(() => useWorkbench('ws'));
    expect(result.current.tab).toBeNull();
    expect(result.current.full).toBe(false);
  });

  it('puts the open pane in full view and takes it out again', () => {
    const { result } = renderHook(() => useWorkbench('ws'));
    act(() => result.current.setTab('terminal'));
    act(() => result.current.toggleFull());
    expect(result.current).toMatchObject({ tab: 'terminal', full: true });
    act(() => result.current.toggleFull());
    expect(result.current).toMatchObject({ tab: 'terminal', full: false });
  });

  it('opens the browser in full view when nothing is open', () => {
    const { result } = renderHook(() => useWorkbench('ws'));
    act(() => result.current.toggleFull());
    expect(result.current).toMatchObject({ tab: 'browser', full: true });
  });

  it('ends full view when the pane is closed, so reopening it does not jump to full view', () => {
    const { result } = renderHook(() => useWorkbench('ws'));
    act(() => result.current.setTab('browser'));
    act(() => result.current.toggleFull());
    act(() => result.current.setTab(null));
    expect(result.current.full).toBe(false);
    act(() => result.current.setTab('browser'));
    expect(result.current.full).toBe(false);
  });

  it('keeps full view while switching to another pane', () => {
    const { result } = renderHook(() => useWorkbench('ws'));
    act(() => result.current.setTab('browser'));
    act(() => result.current.toggleFull());
    act(() => result.current.setTab('terminal'));
    expect(result.current).toMatchObject({ tab: 'terminal', full: true });
  });

  it('opens and closes as one toggle, on the diff the first time', () => {
    const { result } = renderHook(() => useWorkbench('ws'));
    expect(result.current.open).toBe(false);
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ open: true, tab: 'files' });
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ open: false, tab: null });
  });

  it('reopens on the pane that was last in use', () => {
    const { result } = renderHook(() => useWorkbench('ws'));
    act(() => result.current.setTab('terminal'));
    act(() => result.current.toggle());
    expect(result.current.open).toBe(false);
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ open: true, tab: 'terminal' });
  });
});
