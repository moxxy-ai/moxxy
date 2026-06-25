/**
 * Onboarding / install / provider-login handlers.
 *
 * These drive the first-run wizard: probing for the CLI + Node, running
 * `npm install -g @moxxy/cli`, saving a provider key, and the OAuth
 * login flows. Anything that successfully wires up a provider pokes the
 * active supervisor's {@link RunnerSupervisor.forceRetry} so the next
 * turn picks up the new credential without a relaunch.
 */

import { app, shell, BrowserWindow as BrowserWindowApi } from 'electron';

import type { RunnerPool } from '../runner-pool';
import { probeOnboarding, provisionProvider, saveProviderKey } from '../onboarding';
import { installMoxxyCli, probeNode } from '../installer';
import { installManagedNode } from '../node-manager';
import { assertSafeExternalUrl } from '../security';
import { handle } from './shared';

export function registerOnboardingHandlers(pool: RunnerPool): void {
  // ---- Onboarding ----------------------------------------------------------

  handle('onboarding.status', () => probeOnboarding());
  handle('onboarding.probeNode', () => probeNode());
  handle('onboarding.installMoxxyCli', async () => {
    const target = BrowserWindowApi.getFocusedWindow() ?? BrowserWindowApi.getAllWindows()[0];
    if (!target) throw new Error('no window to stream install progress to');
    const code = await installMoxxyCli(target);
    if (code === 0) pool.active()?.forceRetry();
    return code;
  });
  handle('onboarding.installNode', async () => {
    const target = BrowserWindowApi.getFocusedWindow() ?? BrowserWindowApi.getAllWindows()[0];
    if (!target) throw new Error('no window to stream install progress to');
    const result = await installManagedNode(app.getPath('userData'), target);
    // The managed node is now on process.env.PATH; nudge the supervisor so a
    // subsequent CLI install / serve spawn resolves it (same as the CLI step).
    if (result.ok) pool.active()?.forceRetry();
    return result;
  });
  handle('onboarding.openExternal', async ({ url }) => {
    assertSafeExternalUrl(url);
    await shell.openExternal(url);
  });
  handle('onboarding.saveProviderKey', async ({ provider, secret }) => {
    await saveProviderKey(provider, secret);
    // Best-effort early activation for a BUNDLED (OAuth) provider — an unbundled
    // API-key provider isn't registered yet (it's installed by
    // provisionProvider below), so tolerate its "not registered" rejection
    // instead of leaving an unhandled promise.
    const session = pool.active()?.remote();
    if (session) void Promise.resolve(session.providers.setActive(provider)).catch(() => undefined);
  });
  handle('onboarding.provisionProvider', async ({ provider, model }) => {
    await provisionProvider(provider, model);
    // The provider package now lives in ~/.moxxy/plugins and the config names it
    // as the default — but the runner(s) booted before it existed. Restart every
    // runner so the fresh process discovers the package and its boot activation
    // walk makes the provider active, clearing the onboarding/recovery gate.
    await Promise.all(pool.list().map((e) => e.supervisor.restart()));
  });
  handle('onboarding.providerAuthKind', async ({ provider }) => {
    // Prefer the runner's own registry metadata — it knows every provider's
    // declared auth kind (including OAuth ones like claude-code), so no list
    // here can drift. Fall back to the known built-in OAuth providers only
    // when the runner isn't reachable yet (early in onboarding).
    const info = pool.active()?.remote()?.getInfo();
    const known = info?.providers.find((p) => p.name === provider);
    if (known) return known.authKind;
    const OAUTH_FALLBACK = new Set(['openai-codex', 'claude-code']);
    return OAUTH_FALLBACK.has(provider) ? 'oauth' : 'api-key';
  });
}
