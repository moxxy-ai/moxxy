import { readProvidersConfig } from './store.js';

/**
 * THE canonical derivation of the vault/env key name that holds a
 * provider's API key. Every consumer (provider-admin tools, the CLI's
 * credential resolution, the desktop's provider discovery) must agree on
 * this name or keys stored by one surface become invisible to another —
 * previously the CLI, the admin tools and the desktop each derived it
 * slightly differently (the CLI didn't map `-` → `_` and ignored the
 * stored `envVar` override).
 *
 * Rules:
 *  - a stored `envVar` override always wins;
 *  - otherwise the provider slug is upper-snaked and suffixed with
 *    `_API_KEY` (`z-ai` → `Z_AI_API_KEY`) — hyphens become underscores
 *    so the result is a valid POSIX env-var name.
 */
export function providerApiKeyName(
  provider: string | { readonly name: string; readonly envVar?: string },
): string {
  if (typeof provider !== 'string' && provider.envVar) return provider.envVar;
  const name = typeof provider === 'string' ? provider : provider.name;
  return `${name.toUpperCase().replace(/-/g, '_')}_API_KEY`;
}

/**
 * Key name for a provider honoring any `envVar` override persisted in
 * ~/.moxxy/providers.json. Returns `null` when the provider isn't a
 * stored (runtime-registered) one — callers fall back to
 * `providerApiKeyName(name)` for built-ins.
 */
export async function storedProviderApiKeyName(
  providerName: string,
  configPath?: string,
): Promise<string | null> {
  const cfg = await readProvidersConfig(configPath);
  const entry = cfg.providers.find((p) => p.name === providerName);
  return entry ? providerApiKeyName(entry) : null;
}
