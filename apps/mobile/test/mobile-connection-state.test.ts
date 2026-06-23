import { describe, expect, it } from 'vitest';

import { buildConnectionState } from '../src/connectionState';

const base = { hasToken: true, transportReady: false, sessionConnected: false, readOnly: false, error: null };

describe('mobile connection state model', () => {
  it('is unpaired with no stored token', () => {
    expect(buildConnectionState({ ...base, hasToken: false })).toMatchObject({
      status: 'unpaired',
      online: false,
      showBanner: true,
    });
  });

  it('shows a calm connecting banner while the bridge opens (no error yet)', () => {
    const state = buildConnectionState({ ...base, transportReady: false, error: null });
    expect(state.status).toBe('connecting');
    expect(state.online).toBe(false);
    expect(state.showBanner).toBe(true);
    expect(state.banner.steps).toEqual([]);
    expect(state.headerLabel).toBe('Connecting…');
  });

  it('surfaces gateway-off guidance when the bridge reports an error', () => {
    const state = buildConnectionState({ ...base, error: 'Mobile bridge disconnected. Re-pair this device to continue.' });
    expect(state.status).toBe('offline');
    expect(state.showBanner).toBe(true);
    expect(state.banner.steps.length).toBeGreaterThan(0);
    expect(state.banner.steps.join(' ')).toContain('Enable mobile gateway');
  });

  it('drops the banner once the bridge is open, even before the session is live', () => {
    const state = buildConnectionState({ ...base, transportReady: true, sessionConnected: false });
    expect(state.status).toBe('starting');
    expect(state.showBanner).toBe(false);
    expect(state.online).toBe(false);
  });

  it('is fully online when transport + session are connected', () => {
    expect(buildConnectionState({ ...base, transportReady: true, sessionConnected: true })).toMatchObject({
      status: 'connected',
      online: true,
      showBanner: false,
      headerLabel: 'Connected',
    });
  });

  it('reports read-only for a connected archived session', () => {
    expect(buildConnectionState({ ...base, transportReady: true, sessionConnected: true, readOnly: true })).toMatchObject({
      status: 'read-only',
      online: true,
      showBanner: false,
    });
  });
});
