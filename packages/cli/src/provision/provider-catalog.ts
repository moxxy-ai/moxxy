/**
 * First-party provider catalog — the source of truth for `moxxy init` / `moxxy
 * provision` when picking a provider. Maps a provider **slug** (the contribution
 * name + vault-key base) to the npm package that contributes it, how its
 * credentials are collected, and a best-effort default model.
 *
 * Today the providers are still bundled into the CLI, so `provision()` skips the
 * install for any provider already registered in the session and just configures
 * it. Once providers are unbundled + published (Pillar 3 slimming), the same
 * catalog drives the on-demand install. `defaultModel` is only a pre-selection
 * hint — the provider's own `models` list is authoritative once it loads.
 */
export type ProviderAuthKind = 'key' | 'oauth' | 'none';

export interface ProviderCatalogEntry {
  /** Contribution name (registry key) + vault-key base (e.g. `anthropic`). */
  readonly slug: string;
  readonly label: string;
  readonly description: string;
  /** npm package that contributes this provider. */
  readonly packageName: string;
  /** How `init` collects credentials: an API key, an OAuth sign-in, or none. */
  readonly auth: ProviderAuthKind;
  /** Best-effort default model to pre-select (the loaded provider is authoritative). */
  readonly defaultModel?: string;
  /** Recommended default pick for a fresh setup. */
  readonly recommended?: boolean;
}

export const PROVIDER_CATALOG: ReadonlyArray<ProviderCatalogEntry> = [
  {
    slug: 'anthropic',
    label: 'Anthropic (Claude)',
    description: 'Claude models via the Anthropic API (API key).',
    packageName: '@moxxy/plugin-provider-anthropic',
    auth: 'key',
    defaultModel: 'claude-opus-4-8',
    recommended: true,
  },
  {
    slug: 'openai',
    label: 'OpenAI',
    description: 'OpenAI models via the OpenAI API (API key).',
    packageName: '@moxxy/plugin-provider-openai',
    auth: 'key',
  },
  {
    slug: 'claude-code',
    label: 'Claude (Pro/Max sign-in)',
    description: 'Claude via a Claude Pro/Max OAuth token — no separate API key.',
    packageName: '@moxxy/plugin-provider-claude-code',
    auth: 'oauth',
  },
  {
    slug: 'openai-codex',
    label: 'OpenAI Codex (ChatGPT sign-in)',
    description: "Codex models via a ChatGPT account's OAuth token.",
    packageName: '@moxxy/plugin-provider-openai-codex',
    auth: 'oauth',
  },
  {
    slug: 'google',
    label: 'Google Gemini',
    description: 'Gemini models via the Google Generative Language API (API key).',
    packageName: '@moxxy/plugin-provider-google',
    auth: 'key',
  },
  {
    slug: 'xai',
    label: 'xAI (Grok)',
    description: 'Grok models via the xAI API (API key).',
    packageName: '@moxxy/plugin-provider-xai',
    auth: 'key',
  },
  {
    slug: 'zai',
    label: 'z.ai (GLM)',
    description: 'GLM models via the z.ai API (API key).',
    packageName: '@moxxy/plugin-provider-zai',
    auth: 'key',
  },
  {
    slug: 'local',
    label: 'Local (Ollama / OpenAI-compatible)',
    description: 'A local OpenAI-compatible server (Ollama, LM Studio, …) — no key.',
    packageName: '@moxxy/plugin-provider-local',
    auth: 'none',
  },
];

/** Resolve a provider by slug or by package name. */
export function resolveProvider(slugOrPackage: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find(
    (p) => p.slug === slugOrPackage || p.packageName === slugOrPackage,
  );
}
