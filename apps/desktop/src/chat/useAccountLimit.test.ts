import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MoxxyEvent } from '@moxxy/sdk';
import { useAccountLimit } from './useAccountLimit';

const at = (hour: number) => new Date(2026, 9, 12, hour, 0).getTime();
const limitEvent = (limit: Record<string, unknown>): MoxxyEvent =>
  ({ type: 'plugin_event', pluginId: '@moxxy/agent-connection', subtype: 'account_limit', payload: { provider: 'codex-agent', agent: 'Codex', limit } }) as unknown as MoxxyEvent;

afterEach(() => vi.useRealTimers());

describe('useAccountLimit', () => {
  it("holds the active agent's limit until it resets, then lets it go by itself", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(17));
    const events = [limitEvent({ state: 'reached', resetsAt: at(18) })];
    const { result } = renderHook(() => useAccountLimit(events, 'codex-agent'));
    expect(result.current?.limit.limit.state).toBe('reached');
    act(() => {
      vi.advanceTimersByTime(3_600_000);
    });
    expect(result.current).toBeNull();
  });

  it('also holds a limit that is still fine, so the model window can say how much is used', () => {
    const { result } = renderHook(() => useAccountLimit([limitEvent({ state: 'ok', usedPercent: 40 })], 'codex-agent'));
    expect(result.current?.limit.limit.usedPercent).toBe(40);
  });

  it("says nothing for another agent's limit", () => {
    const { result } = renderHook(() => useAccountLimit([limitEvent({ state: 'reached' })], 'claude-code'));
    expect(result.current).toBeNull();
  });
});
