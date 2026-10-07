import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useActiveMode } from './useActiveMode';

/**
 * The session's info is fetched again at the start and end of every turn and
 * is briefly unknown while it is. The mode shown must not blink away then.
 */

afterEach(cleanup);

describe('useActiveMode', () => {
  it('is the mode the session reports', () => {
    const { result } = renderHook(() => useActiveMode('w1', { activeMode: 'plan' }));
    expect(result.current).toBe('plan');
  });

  it('keeps the last mode it knew while the info is being fetched again', () => {
    const { result, rerender } = renderHook(({ info }) => useActiveMode('w1', info), {
      initialProps: { info: { activeMode: 'goal' } as { activeMode: string | null } | null },
    });
    rerender({ info: null });
    expect(result.current).toBe('goal');
    rerender({ info: { activeMode: 'default' } });
    expect(result.current).toBe('default');
  });

  it('forgets it when the conversation changes', () => {
    const { result, rerender } = renderHook(({ id, info }) => useActiveMode(id, info), {
      initialProps: { id: 'w1', info: { activeMode: 'goal' } as { activeMode: string | null } | null },
    });
    rerender({ id: 'w2', info: null });
    expect(result.current).toBeNull();
  });
});
