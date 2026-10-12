import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import type { MoxxyEvent } from '@moxxy/sdk';
import { AccountLimitBar } from './AccountLimitBar';
import { useAccountLimit } from '../useAccountLimit';

const at = (hour: number) => new Date(2026, 9, 12, hour, 0).getTime();
const limitEvent = (limit: Record<string, unknown>): MoxxyEvent =>
  ({ type: 'plugin_event', pluginId: '@moxxy/agent-connection', subtype: 'account_limit', payload: { provider: 'codex-agent', agent: 'Codex', limit } }) as unknown as MoxxyEvent;

afterEach(() => vi.useRealTimers());

describe('AccountLimitBar', () => {
  it("says the agent's limit is used up, and when it comes back", () => {
    render(<AccountLimitBar limit={{ provider: 'codex-agent', agent: 'Codex', limit: { state: 'reached', windowMinutes: 300, resetsAt: at(18) } }} nowMs={at(14)} />);
    const bar = screen.getByTestId('composer-account-limit');
    expect(bar.dataset.state).toBe('reached');
    expect(bar.textContent).toBe("Codex's 5-hour limit is used up · resets at 18:00");
  });
});

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

  it("says nothing for another agent's limit", () => {
    const { result } = renderHook(() => useAccountLimit([limitEvent({ state: 'reached' })], 'claude-code'));
    expect(result.current).toBeNull();
  });
});
