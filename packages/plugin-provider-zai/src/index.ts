import { defineProvider, definePlugin } from '@moxxy/sdk';
import { OpenAIProvider, validateOpenAICompatKey } from '@moxxy/plugin-provider-openai';
import { AnthropicProvider } from '@moxxy/plugin-provider-anthropic';
import { glmModels } from './models.js';

export { glmModels };

/** Pay-as-you-go OpenAI-compatible endpoint (standard z.ai API key). */
const ZAI_OPENAI_BASE_URL = 'https://api.z.ai/api/paas/v4';
/** GLM Coding Plan — Anthropic Messages-compatible endpoint (the one Claude Code uses). */
const ZAI_ANTHROPIC_BASE_URL = 'https://api.z.ai/api/anthropic';
const ZAI_DEFAULT_MODEL = 'glm-4.6';

/**
 * Narrow the registry's untyped `Record<string, unknown>` config down to the
 * handful of optional string fields both the OpenAI and Anthropic z.ai modes
 * actually forward (`apiKey`/`baseURL`/`defaultModel`). A blanket
 * `config as XProviderConfig` would silently smuggle through any wrong-typed
 * field; this pick keeps only known-good strings so a bad value falls back to
 * the z.ai defaults below instead of reaching the underlying client.
 */
function pickZaiConfig(config: Record<string, unknown>): {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly defaultModel?: string;
} {
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  return {
    apiKey: str(config.apiKey),
    baseURL: str(config.baseURL),
    defaultModel: str(config.defaultModel),
  };
}

/**
 * z.ai in "API key" mode: the standard, pay-as-you-go endpoint, which speaks
 * the OpenAI Chat Completions protocol. Reuses the shared {@link OpenAIProvider}
 * with the vendor slug + base URL + GLM catalog forced on (so usage stats,
 * provider events and error context attribute to `zai`, not `openai`).
 */
export const zaiProviderDef = defineProvider({
  name: 'zai',
  models: [...glmModels],
  createClient: (config) => {
    const cfg = pickZaiConfig(config);
    return new OpenAIProvider({
      apiKey: cfg.apiKey,
      name: 'zai',
      baseURL: cfg.baseURL ?? ZAI_OPENAI_BASE_URL,
      defaultModel: cfg.defaultModel ?? ZAI_DEFAULT_MODEL,
      models: glmModels,
    });
  },
  validateKey: (key) => validateOpenAICompatKey(key, { baseURL: ZAI_OPENAI_BASE_URL }),
  auth: {
    kind: 'apiKey',
    hint: 'z.ai API key (pay-as-you-go) from https://z.ai/manage-apikey/apikey-list',
  },
});

/**
 * z.ai in "plan" mode: the GLM Coding Plan, billed against a subscription and
 * served over an Anthropic Messages-compatible endpoint (the same one Claude
 * Code targets). Reuses {@link AnthropicProvider} with the GLM catalog and the
 * z.ai base URL — only the credential + endpoint differ from the plain
 * `anthropic` provider. No `validateKey`: z.ai's Anthropic endpoint exposes no
 * free model-list probe, and the plan key is proven by the first request.
 */
export const zaiCodingPlanProviderDef = defineProvider({
  name: 'zai-coding-plan',
  models: [...glmModels],
  createClient: (config) => {
    const cfg = pickZaiConfig(config);
    return new AnthropicProvider({
      apiKey: cfg.apiKey,
      name: 'zai-coding-plan',
      baseURL: cfg.baseURL ?? ZAI_ANTHROPIC_BASE_URL,
      defaultModel: cfg.defaultModel ?? ZAI_DEFAULT_MODEL,
      models: glmModels,
    });
  },
  auth: {
    kind: 'apiKey',
    hint: 'z.ai GLM Coding Plan key (Anthropic-compatible endpoint, like Claude Code)',
  },
});

export const zaiPlugin = definePlugin({
  name: '@moxxy/plugin-provider-zai',
  version: '0.0.0',
  providers: [zaiProviderDef, zaiCodingPlanProviderDef],
});

export default zaiPlugin;
