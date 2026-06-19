import { MoxxyError, type ProviderDef } from '@moxxy/sdk';
import { defineOpenAICompatProvider, validateOpenAICompatKey } from '@moxxy/plugin-provider-openai';
import type { StoredProvider } from './types.js';

/**
 * Re-export the shared OpenAI-compatible key validator so existing
 * consumers (and `index.ts`) keep a single import surface. The probe
 * lives in `@moxxy/plugin-provider-openai` — we don't keep a local copy.
 */
export { validateOpenAICompatKey };

/**
 * Builder for one stored-provider `kind`. New wire-protocol families
 * (anthropic-compat, native SDKs) register a builder here instead of growing
 * an if/throw ladder — the rest of the pipeline (store + onInit) stays
 * kind-agnostic, honoring the forward-compat promise in `types.ts`.
 */
type ProviderDefBuilder = (entry: StoredProvider) => ProviderDef;

const PROVIDER_DEF_BUILDERS: Record<StoredProvider['kind'], ProviderDefBuilder> = {
  // For `openai-compat` we delegate to the shared {@link defineOpenAICompatProvider}
  // factory that the built-in vendor plugins (xai/zai/google/local) also use: it
  // forces the vendor's slug + baseURL + default model + catalog onto the shared
  // OpenAI client and wires validateKey against the same baseURL, so the
  // setup-wizard / `moxxy doctor --check-keys` paths work end-to-end. The runtime
  // config only carries the resolved API key, so the factory's narrow pick keeps
  // just that and the vendor's stored baseURL/defaultModel win.
  'openai-compat': (entry) =>
    defineOpenAICompatProvider({
      name: entry.name,
      baseURL: entry.baseURL,
      defaultModel: entry.defaultModel,
      models: entry.models,
    }),
};

/** Build a runtime ProviderDef from a stored entry by dispatching on `kind`. */
export function buildProviderDef(entry: StoredProvider): ProviderDef {
  const build = PROVIDER_DEF_BUILDERS[entry.kind];
  if (!build) {
    throw new MoxxyError({
      code: 'CONFIG_INVALID',
      message: `provider-admin: unsupported kind ${String((entry as { kind: unknown }).kind)}`,
    });
  }
  return build(entry);
}
