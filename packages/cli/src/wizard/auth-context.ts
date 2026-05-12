/**
 * Helpers that bridge the CLI's runtime (vault store, stdout) to the
 * provider-agnostic `ProviderAuthContext` declared in `@moxxy/sdk`. Every
 * `moxxy login` and `moxxy init` call funnels through here so the OAuth
 * dance is identical regardless of which provider plugin owns it.
 */

import type { ProviderAuthContext, ProviderDef } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';

export interface BuildAuthContextOptions {
  readonly headless: boolean;
  /** Defaults to writing through `process.stdout`. Wizard hosts pass a clack-aware writer. */
  readonly write?: (chunk: string) => void;
}

export function buildProviderAuthContext(
  vault: VaultStore,
  opts: BuildAuthContextOptions,
): ProviderAuthContext {
  return {
    headless: opts.headless,
    write: opts.write ?? ((s) => process.stdout.write(s)),
    vault: {
      get: (key) => vault.get(key),
      set: (key, value, tags) => vault.set(key, value, tags ? [...tags] : undefined),
      delete: (key) => vault.delete(key),
    },
  };
}

/** True if the provider plugin advertises an OAuth login flow. */
export function isOAuthProvider(def: ProviderDef): boolean {
  return def.auth?.kind === 'oauth';
}
