import { defineSecretProvider, type SecretProviderDef } from '@moxxy/sdk';
import type { Session } from '@moxxy/core';
import type { VaultStore } from '@moxxy/plugin-vault';

/**
 * The local vault, expressed as a {@link SecretProviderDef} so it can be the
 * protected floor of the registry.
 *
 * Registered by the HOST rather than by core: core never imports a plugin, and
 * the vault lives in `@moxxy/plugin-vault`. Making it the floor rather than a
 * hardcoded special case is what lets an external store sit above it without
 * anyone having to migrate every secret first.
 */
export function vaultSecretProvider(vault: VaultStore): SecretProviderDef {
  return defineSecretProvider({
    name: 'vault',
    description: 'the local AES-256-GCM vault (~/.moxxy/vault.json)',
    open: () => ({
      get: (name) => vault.get(name),
      close: async () => {},
    }),
  });
}

/**
 * Resolve a named secret through the ACTIVE provider, falling back to the
 * vault.
 *
 * The fallback is what makes adopting an external store incremental: a team can
 * point `plugins.secretProvider.default` at HashiCorp Vault and move secrets
 * over one at a time instead of in a big bang.
 *
 * A provider that THROWS is not treated as a miss. An unreachable store or an
 * expired token must surface as a failure, because silently falling through to
 * the local vault would mean a machine quietly running on stale credentials the
 * operator believes they revoked.
 */
export function buildSecretResolver(
  // Late-bound: the resolver must be handed to `buildSession` at construction,
  // but it needs the registry the session itself creates. A getter closes that
  // loop without adding a setter to Session's public surface.
  getSession: () => Session | undefined,
  vault: VaultStore,
  cwd: string,
): (name: string) => Promise<string | null> {
  // One session per provider, opened lazily and reused: an external store
  // typically holds a connection or a cached auth token, and opening one per
  // `getSecret` call would re-authenticate on every tool invocation.
  let openedFor: string | null = null;
  let active: ReturnType<SecretProviderDef['open']> | null = null;

  return async (name: string): Promise<string | null> => {
    const def = getSession()?.secretProviders.getActive();
    if (def && def.name !== 'vault') {
      if (openedFor !== def.name || !active) {
        await active?.close().catch(() => undefined);
        active = def.open({ cwd });
        openedFor = def.name;
      }
      const found = await active.get(name);
      if (found !== null) return found;
    }
    return vault.get(name);
  };
}
