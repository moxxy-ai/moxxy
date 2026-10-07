import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useVoiceCallRequest } from '@/lib/voiceCallRequest';
import { useShellNavigation } from './useShellNavigation';

const noop = (): void => undefined;

function setup(locked = false) {
  return renderHook(
    ({ sessionLoading }: { sessionLoading: boolean }) =>
      useShellNavigation({ sessionLoading, onShowShortcuts: noop, onOpenPalette: noop }),
    { initialProps: { sessionLoading: locked } },
  );
}

describe('useShellNavigation', () => {
  it('starts on the run and goes where it is told', () => {
    const { result } = setup();
    expect(result.current.view).toBe('chat');
    act(() => result.current.go('settings'));
    expect(result.current.view).toBe('settings');
  });

  it('refuses a place that needs a loaded session while one is loading', () => {
    const { result } = setup(true);
    expect(result.current.isDisabled('automations')).toBe(true);
    expect(result.current.isDisabled('settings')).toBe(false);
    act(() => result.current.go('automations'));
    expect(result.current.view).toBe('chat');
  });

  it('falls back to the run when the session starts loading under a locked view', () => {
    const { result, rerender } = setup(false);
    act(() => result.current.go('apps'));
    expect(result.current.view).toBe('apps');
    rerender({ sessionLoading: true });
    expect(result.current.view).toBe('chat');
  });

  it('opens voice on the run rather than as a view', () => {
    const onVoice = vi.fn();
    const { result } = renderHook(() => {
      useVoiceCallRequest(onVoice);
      return useShellNavigation({ sessionLoading: false, onShowShortcuts: noop, onOpenPalette: noop });
    });
    act(() => result.current.go('settings'));
    act(() => result.current.go('voice'));
    expect(result.current.view).toBe('chat');
    expect(onVoice).toHaveBeenCalledOnce();
  });
});
