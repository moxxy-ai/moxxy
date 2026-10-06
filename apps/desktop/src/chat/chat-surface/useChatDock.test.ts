/**
 * useChatDock — the floating composer over a full-view pane can be tucked away
 * into a small moxxy button, because over a page it sometimes covers what you
 * need to see. A question the agent is blocked on still shows, so a turn never
 * waits on something you cannot see.
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChatDock } from './useChatDock';

describe('useChatDock', () => {
  it('starts shown', () => {
    const { result } = renderHook(() => useChatDock(true, false));
    expect(result.current.minimized).toBe(false);
  });

  it('tucks the chat away and brings it back', () => {
    const { result } = renderHook(() => useChatDock(true, false));
    act(() => result.current.hide());
    expect(result.current.minimized).toBe(true);
    act(() => result.current.show());
    expect(result.current.minimized).toBe(false);
  });

  it('is never minimized outside full view', () => {
    const { result } = renderHook(() => useChatDock(false, false));
    act(() => result.current.hide());
    expect(result.current.minimized).toBe(false);
  });

  it('comes back shown the next time full view opens', () => {
    const { result, rerender } = renderHook(({ docked }) => useChatDock(docked, false), {
      initialProps: { docked: true },
    });
    act(() => result.current.hide());
    rerender({ docked: false });
    rerender({ docked: true });
    expect(result.current.minimized).toBe(false);
  });

  it('shows a question the agent waits on, and tucks away again once it is answered', () => {
    const { result, rerender } = renderHook(({ ask }) => useChatDock(true, ask), {
      initialProps: { ask: false },
    });
    act(() => result.current.hide());
    rerender({ ask: true });
    expect(result.current.minimized).toBe(false);
    rerender({ ask: false });
    expect(result.current.minimized).toBe(true);
  });
});
