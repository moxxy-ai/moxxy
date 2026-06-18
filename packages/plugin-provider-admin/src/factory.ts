import { defineProvider, MoxxyError, type ProviderDef } from '@moxxy/sdk';
import {
  OpenAIProvider,
  validateOpenAICompatKey,
  type OpenAIProviderConfig,
} from '@moxxy/plugin-provider-openai';
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
          // The registry hands us an untyped `Record<string, unknown>`; the
          // only field it actually carries is the resolved API key, so narrow
          // to that known optional string rather than smuggling the whole
          // record through a blanket cast.
          apiKey: typeof config.apiKey === 'string' ? config.apiKey : undefined,
          // The vendor's registered slug, NOT 'openai' — usage stats,
          // provider_request/response events and error context all read
          // `provider.name`, so without this every runtime vendor was
          // misattributed to OpenAI.
          name: entry.name,
          baseURL: entry.baseURL,
          defaultModel: entry.defaultModel,
          models: entry.models,
        } satisfies OpenAIProviderConfig),
      validateKey: (key) => validateOpenAICompatKey(key, { baseURL: entry.baseURL }),
    });
  }
  throw new MoxxyError({
    code: 'CONFIG_INVALID',
    message: `provider-admin: unsupported kind ${(entry as { kind: string }).kind}`,
  });
}
