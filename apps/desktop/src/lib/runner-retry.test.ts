import { describe, expect, it, vi } from 'vitest';
import { retryWhileReconnecting } from './runner-retry';

const NOT_CONNECTED = { code: 'not-connected' };
const isReconnecting = (e: unknown): boolean =>
  !!e && typeof e === 'object' && (e as { code?: string }).code === 'not-connected';

// Deterministic clock + no real waiting.
function fakeTime(start = 0): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let t = start;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

describe('retryWhileReconnecting', () => {
  it('returns immediately on success without retrying', async () => {
    const action = vi.fn().mockResolvedValue('ok');
    const { now, sleep } = fakeTime();
    expect(await retryWhileReconnecting(action, { isReconnecting, now, sleep })).toBe('ok');
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('retries across a reconnect gap, then succeeds', async () => {
    const action = vi
      .fn()
      .mockRejectedValueOnce(NOT_CONNECTED)
      .mockRejectedValueOnce(NOT_CONNECTED)
      .mockResolvedValue('connected');
    const { now, sleep } = fakeTime();
    expect(await retryWhileReconnecting(action, { isReconnecting, now, sleep })).toBe('connected');
    expect(action).toHaveBeenCalledTimes(3);
  });

  it('rethrows a non-reconnect error immediately (no retry)', async () => {
    const other = { code: 'invalid-payload', message: 'bad' };
    const action = vi.fn().mockRejectedValue(other);
    const { now, sleep } = fakeTime();
    await expect(retryWhileReconnecting(action, { isReconnecting, now, sleep })).rejects.toBe(other);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('gives up after the timeout, rethrowing the last not-connected error', async () => {
    const action = vi.fn().mockRejectedValue(NOT_CONNECTED);
    const { now, sleep } = fakeTime();
    await expect(
      retryWhileReconnecting(action, { isReconnecting, now, sleep, timeoutMs: 5_000, intervalMs: 1_000 }),
    ).rejects.toBe(NOT_CONNECTED);
    // 5s budget / 1s interval → ~6 attempts before the deadline trips.
    expect(action.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(action.mock.calls.length).toBeLessThanOrEqual(7);
  });
});
