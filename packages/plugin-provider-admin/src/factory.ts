import { defineProvider, MoxxyError, type ProviderDef } from '@moxxy/sdk';
import { OpenAIProvider, validateOpenAICompatKey } from '@moxxy/plugin-provider-openai';
import type { StoredProvider } from './types.js';

/**
 * Re-export the shared OpenAI-compatible key validator so existing
 * consumers (and `index.ts`) keep a single import surface. The probe
 * lives in `@moxxy/plugin-provider-openai` — we don't keep a local copy.
 */
export { validateOpenAICompatKey };

/**
 * Build a runtime ProviderDef from a stored entry. For `openai-compat`
 * we instantiate the existing OpenAI client but force the vendor's
 * baseURL + default model. validateKey hits the same baseURL so the
 * setup-wizard / `moxxy doctor --check-keys` paths work end-to-end.
 */
export function buildProviderDef(entry: StoredProvider): ProviderDef {
  if (entry.kind === 'openai-compat') {
    return defineProvider({
      name: entry.name,
      models: entry.models,
      createClient: (config) =>
        new OpenAIProvider({
          ...(config as Record<string, unknown>),
          baseURL: entry.baseURL,
          defaultModel: entry.defaultModel,
        }),
      validateKey: (key) => validateOpenAICompatKey(key, { baseURL: entry.baseURL }),
    });
  }
  throw new MoxxyError({
    code: 'CONFIG_INVALID',
    message: `provider-admin: unsupported kind ${(entry as { kind: string }).kind}`,
  });
}
