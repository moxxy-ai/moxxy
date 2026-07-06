/**
 * prefs IPC handler tests:
 *   1. prefs.update merges through the store and returns the result.
 *   2. A `theme` patch runs the nativeTheme sync WITHOUT throwing in a
 *      non-electron (plain node vitest) environment — the guard that keeps
 *      these handlers testable and WS-bridge-safe.
 *   3. prefs.read delegates to the store.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DesktopPrefs } from '@moxxy/desktop-ipc-contract';
import { setActiveBus } from './shared';
import { registerPrefsHandlers } from './prefs';
import { assertDefined } from '@moxxy/sdk';

const BASE: DesktopPrefs = {
  onboardingComplete: true,
  clerkUserId: null,
  clerkDisplayName: null,
  signedInAt: null,
  mobileGatewayEnabled: false,
  theme: 'system',
  focusMiniTextSize: null,
  version: 1,
};

vi.mock('../prefs', () => {
  let current: DesktopPrefs = {
    onboardingComplete: true,
    clerkUserId: null,
    clerkDisplayName: null,
    signedInAt: null,
    mobileGatewayEnabled: false,
    theme: 'system',
    focusMiniTextSize: null,
    version: 1,
  };
  return {
    readPrefs: vi.fn(() => current),
    updatePrefs: vi.fn((patch: Partial<DesktopPrefs>) => {
      current = { ...current, ...patch, version: 1 as const };
      return Promise.resolve(current);
    }),
  };
});

type Handler = (...args: unknown[]) => Promise<unknown>;

function captureHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  setActiveBus({
    handle: (channel: string, fn: Handler) => {
      handlers.set(channel, fn);
    },
  } as never);
  registerPrefsHandlers();
  return handlers;
}

describe('prefs IPC handlers', () => {
  let handlers: Map<string, Handler>;

  beforeEach(() => {
    handlers = captureHandlers();
  });

  it('registers both prefs commands', () => {
    expect(handlers.has('prefs.read')).toBe(true);
    expect(handlers.has('prefs.update')).toBe(true);
  });

  it('prefs.read returns the stored prefs (theme defaults to system)', async () => {
    const readHandler = handlers.get('prefs.read');
    assertDefined(readHandler, 'prefs.read handler');
    const prefs = (await readHandler()) as DesktopPrefs;
    expect(prefs).toEqual(BASE);
  });

  it('prefs.update merges and returns the patched prefs', async () => {
    const updateHandler = handlers.get('prefs.update');
    assertDefined(updateHandler, 'prefs.update handler');
    const next = (await updateHandler({
      mobileGatewayEnabled: true,
    })) as DesktopPrefs;
    expect(next.mobileGatewayEnabled).toBe(true);
    expect(next.theme).toBe('system');
  });

  it('a theme patch persists and survives the nativeTheme sync outside electron', async () => {
    // In plain-node vitest the `electron` module is either missing or exports
    // a binary-path string with no `nativeTheme` — the handler must not throw.
    const updateHandler = handlers.get('prefs.update');
    assertDefined(updateHandler, 'prefs.update handler');
    const next = (await updateHandler({ theme: 'dark' })) as DesktopPrefs;
    expect(next.theme).toBe('dark');
    const readHandler = handlers.get('prefs.read');
    assertDefined(readHandler, 'prefs.read handler');
    const read = (await readHandler()) as DesktopPrefs;
    expect(read.theme).toBe('dark');
  });
});
