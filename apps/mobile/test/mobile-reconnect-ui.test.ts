import { describe, expect, it } from 'vitest';

import { buildReconnectUi } from '../src/reconnectUi';

describe('mobile reconnect UI model', () => {
  it('spins silently (no escape hatch) during the initial grace period', () => {
    expect(buildReconnectUi({ graceElapsed: false, error: null })).toMatchObject({
      showEscapeHatch: false,
    });
  });

  it('offers a way to re-pair once the grace period elapses without connecting', () => {
    expect(buildReconnectUi({ graceElapsed: true, error: null })).toMatchObject({
      showEscapeHatch: true,
    });
  });

  it('surfaces the bridge error immediately, before the grace period', () => {
    const error = 'Mobile bridge disconnected. Re-pair this device to continue.';
    expect(buildReconnectUi({ graceElapsed: false, error })).toEqual({
      showEscapeHatch: true,
      hint: error,
    });
  });

  it('falls back to a generic stale-gateway hint when no error was reported', () => {
    expect(buildReconnectUi({ graceElapsed: true, error: null }).hint).toContain(
      'Make sure Moxxy Desktop is open',
    );
  });
});
