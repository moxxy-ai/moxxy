import OpenAI from 'openai';
import { defineProvider, type ProviderDef, type ProviderKeyValidation } from '@moxxy/sdk';
import { OpenAIProvider } from '@moxxy/plugin-provider-openai';
import type { StoredProvider } from './types.js';

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
      validateKey: (key) => validateOpenAICompatKey(key, entry.baseURL),
    });
  }
  throw new Error(`provider-admin: unsupported kind ${(entry as { kind: string }).kind}`);
}

/**
 * Cheap "is this key accepted by the vendor?" probe via the OpenAI
 * `/models` endpoint. Most OpenAI-compatible vendors implement it; the
 * few that don't (or that return a non-2xx for other reasons) surface
 * the raw error so the user can decide whether to proceed.
 */
export async function validateOpenAICompatKey(
  key: string,
  baseURL: string,
): Promise<ProviderKeyValidation> {
  if (!key || key.trim().length < 4) {
    return { ok: false, message: 'key looks too short' };
  }
  try {
    const client = new OpenAI({ apiKey: key, baseURL });
    await client.models.list();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
