import type { ProviderDef, ProviderHostContext } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
// Subpath, not the barrel: the barrel pulls in the OpenAI SDK (see key-name.ts).
import { storedProviderApiKeyName } from '@moxxy/plugin-provider-admin/key-name';
import { resolveProviderApiKey, type ResolveOptions } from './provider-keys.js';

/**
 * Resolve activation config without knowing any provider names. Providers with
 * non-key authentication own the resolution through `ProviderDef.resolveCredentials`;
 * API-key providers use the host's generic vault/env/prompt flow.
 */
export async function resolveProviderCredentials(
  provider: ProviderDef,
  vault: VaultStore,
  host: ProviderHostContext,
  opts: ResolveOptions = {},
): Promise<Record<string, unknown>> {
  const providerConfig = { ...(opts.providerConfig ?? {}) };
  if (provider.resolveCredentials) {
    return provider.resolveCredentials({ vault, providerConfig, host });
  }
  if (provider.auth?.kind === 'oauth') {
    throw new Error(
      `Provider "${provider.name}" declares OAuth authentication but does not implement resolveCredentials().`,
    );
  }
  if (provider.auth?.kind === 'none') return providerConfig;

  const configuredEnv = provider.auth?.kind === 'apiKey' ? provider.auth.envVar : undefined;
  const storedKeyName = configuredEnv ?? await storedProviderApiKeyName(provider.name).catch(() => null);
  const { providerConfig: resolved } = await resolveProviderApiKey(provider.name, vault, {
    ...opts,
    providerConfig,
    ...(storedKeyName ? { keyName: storedKeyName } : {}),
  });
  return resolved;
}
