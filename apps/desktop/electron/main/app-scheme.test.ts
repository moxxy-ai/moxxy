/**
 * Regression guard for the 0.10 → 0.8 self-update downgrade: the `moxxy-app://`
 * privileged scheme MUST be registered before `app` is ready, and the helper
 * MUST NOT call `registerSchemesAsPrivileged` once ready (Electron throws then,
 * which crashed the hot-updated override on load and reverted to the floor).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const registerSchemesAsPrivileged = vi.fn();
let ready = false;

vi.mock('electron', () => ({
  app: { isReady: () => ready },
  protocol: { registerSchemesAsPrivileged: (...a: unknown[]) => registerSchemesAsPrivileged(...a) },
}));

import { APP_ASSET_SCHEME, registerAppAssetSchemePrivileged } from './app-scheme.js';

afterEach(() => {
  registerSchemesAsPrivileged.mockClear();
  ready = false;
});

describe('registerAppAssetSchemePrivileged', () => {
  it('registers the privileged moxxy-app scheme when called before app is ready', () => {
    ready = false;
    registerAppAssetSchemePrivileged();
    expect(registerSchemesAsPrivileged).toHaveBeenCalledTimes(1);
    const [schemes] = registerSchemesAsPrivileged.mock.calls[0] as [
      Array<{ scheme: string; privileges: Record<string, boolean> }>,
    ];
    expect(schemes).toEqual([
      {
        scheme: APP_ASSET_SCHEME,
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          stream: true,
          corsEnabled: true,
        },
      },
    ]);
  });

  it('is a no-op once the app is ready (registering then throws → would crash the override)', () => {
    ready = true;
    registerAppAssetSchemePrivileged();
    expect(registerSchemesAsPrivileged).not.toHaveBeenCalled();
  });

  it('uses the same scheme string the desktop-host asset protocol serves', () => {
    expect(APP_ASSET_SCHEME).toBe('moxxy-app');
  });
});
