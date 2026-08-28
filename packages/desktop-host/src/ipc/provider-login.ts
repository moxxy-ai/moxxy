/**
 * Interactive provider sign-in handlers (OAuth) shared by the onboarding
 * wizard and Settings → Providers. They spawn + drive `moxxy login <provider>`
 * via {@link startProviderLogin}; the renderer relays the user's pasted
 * answers. On a successful exit we nudge the active supervisor's
 * {@link RunnerSupervisor.forceRetry} so the next turn picks up the new
 * credential without a relaunch (the renderer separately activates the
 * provider via `session.setProvider`).
 */

import { BrowserWindow as BrowserWindowApi } from 'electron';

import type { RunnerPool } from '../runner-pool';
import {
  answerProviderLogin,
  cancelProviderLogin,
  startProviderLogin,
} from '../provider-login';
import { handle } from './shared';

export function registerProviderLoginHandlers(
  pool: RunnerPool,
  opts: { readonly openExternal?: (url: string) => Promise<void> } = {},
): void {
  handle('provider.login.start', async ({ loginId, provider }) => {
    // The provider catalog paints immediately, while the packaged first launch
    // seeds its plugin tree after first paint. Share the runner's preparation
    // gate so a fast click cannot spawn `moxxy login` against a partial tree.
    await pool.prepare();
    const target = BrowserWindowApi.getFocusedWindow() ?? BrowserWindowApi.getAllWindows()[0];
    if (!target) throw new Error('no window to drive the provider login');
    startProviderLogin(loginId, provider, target, {
      onExit: (code) => {
        if (code === 0) pool.active()?.forceRetry();
      },
      ...(opts.openExternal ? { openExternal: opts.openExternal } : {}),
    });
  });
  handle('provider.login.answer', async ({ loginId, value }) => {
    answerProviderLogin(loginId, value);
  });
  handle('provider.login.cancel', async ({ loginId }) => {
    cancelProviderLogin(loginId);
  });
}
