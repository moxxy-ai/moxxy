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
 * Build a runtime ProviderDef from a stored entry. For `openai-compat`
 * we delegate to the shared {@link defineOpenAICompatProvider} factory that
 * the built-in vendor plugins (xai/zai/google/local) also use: it forces the
 * vendor's slug + baseURL + default model + catalog onto the shared OpenAI
 * client and wires validateKey against the same baseURL, so the
 * setup-wizard / `moxxy doctor --check-keys` paths work end-to-end. The
 * runtime config only carries the resolved API key, so the factory's narrow
 * pick keeps just that and the vendor's stored baseURL/defaultModel win.
 */
export function buildProviderDef(entry: StoredProvider): ProviderDef {
  if (entry.kind === 'openai-compat') {
    return defineOpenAICompatProvider({
      name: entry.name,
      baseURL: entry.baseURL,
      defaultModel: entry.defaultModel,
      models: entry.models,
    });
  }
  throw new MoxxyError({
    code: 'CONFIG_INVALID',
    message: `provider-admin: unsupported kind ${(entry as { kind: string }).kind}`,
  });
}
