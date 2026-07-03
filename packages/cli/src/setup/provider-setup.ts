import type { Session } from '@moxxy/core';
import {
  MoxxyError,
  type ProviderAuthContext,
  type ProviderConnectIo,
  type ProviderSetupView,
} from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import { installPluginPackagePinned, setPluginEnabled } from '@moxxy/plugin-plugins-admin';
import { resolveProvider } from '../provision/provider-catalog.js';
import { validateProviderKey } from '../validate-key.js';
import { canonicalKey } from '../provider-keys.js';
import { buildProviderAuthContext } from '../wizard/auth-context.js';
import { cliVersion } from '../version.js';

export interface BuildProviderSetupOptions {
  readonly session: Session;
  readonly vault: VaultStore;
}

/**
 * The one provider-onboarding implementation behind every frontend: the
 * clack wizard (`moxxy init`), `moxxy login`, and the TUI's inline connect
 * dialog all route through these closures, so install/key/OAuth semantics
 * cannot drift between them. Attached as `session.providerSetup` after
 * provider activation in setup.ts; a RemoteSession never gets one.
 */
export function buildProviderSetupView(opts: BuildProviderSetupOptions): ProviderSetupView {
  const { session, vault } = opts;

  const registered = (providerId: string) =>
    session.providers.list().find((p) => p.name === providerId);

  const markReady = (providerId: string): void => {
    session.requirements.setRuntime(`auth:provider:${providerId}`, 'ready');
    session.readyProviders?.add(providerId);
  };

  return {
    authKind: (providerId) => {
      const def = registered(providerId);
      if (def) return def.auth?.kind === 'oauth' ? 'oauth' : 'apiKey';
      const entry = resolveProvider(providerId);
      if (!entry) return null;
      return entry.auth === 'oauth' ? 'oauth' : entry.auth === 'none' ? 'none' : 'apiKey';
    },

    ensureInstalled: async (providerId) => {
      if (registered(providerId)) return true;
      // Catalog-only provider (the slim build doesn't bundle it) — install +
      // enable from npm, pinned to the CLI version (404 → retry latest), then
      // it registers on the host reload. Mirrors init's ensureProvider.
      const entry = resolveProvider(providerId);
      if (!entry) return false;
      await installPluginPackagePinned({
        packageName: entry.packageName,
        ...(cliVersion() ? { cliVersion: cliVersion()! } : {}),
      });
      await setPluginEnabled(entry.packageName, true);
      await session.pluginHost.reload();
      return registered(providerId) !== undefined;
    },

    testKey: async (providerId, key) => {
      // A provider without validateKey can't reject a key — accept it rather
      // than surfacing a "does not support validation" pseudo-rejection.
      const def = registered(providerId);
      if (def && !def.validateKey) return { ok: true };
      return validateProviderKey(providerId, key, session.providers);
    },

    saveKey: async (providerId, key) => {
      await vault.set(canonicalKey(providerId), key, [providerId]);
      markReady(providerId);
    },

    loginOAuth: async (providerId, io) => {
      const def = registered(providerId);
      if (!def || def.auth?.kind !== 'oauth') {
        throw new MoxxyError({
          code: 'OAUTH_FLOW_NOT_SUPPORTED',
          message: `Provider "${providerId}" does not advertise an OAuth flow.`,
          hint:
            'This provider expects an API key. Enter it when prompted, or set the ' +
            'relevant *_API_KEY environment variable.',
          context: { provider: providerId },
        });
      }
      const ctx = io ? channelAuthContext(vault, io) : buildProviderAuthContext(vault, { headless: false });
      const result = await def.auth.login(ctx);
      markReady(providerId);
      return result;
    },
  };
}

/**
 * A `ProviderAuthContext` whose output/prompts route into a channel's own UI
 * (the TUI connect dialog) instead of clack/stdout. Never headless — the
 * channel IS the interactive surface, so browser-based flows stay available.
 */
function channelAuthContext(vault: VaultStore, io: ProviderConnectIo): ProviderAuthContext {
  return {
    headless: false,
    write: io.write,
    ...(io.prompt ? { prompt: io.prompt } : {}),
    vault: {
      get: (key) => vault.get(key),
      set: (key, value, tags) => vault.set(key, value, tags ? [...tags] : undefined),
      delete: (key) => vault.delete(key),
    },
  };
}
