import { defineProvider, definePlugin } from '@moxxy/sdk';
import { defineOpenAICompatProvider, pickOpenAICompatConfig } from '@moxxy/plugin-provider-openai';
import { AnthropicProvider } from '@moxxy/plugin-provider-anthropic';
import { glmModels } from './models.js';

export { glmModels };

/** Pay-as-you-go OpenAI-compatible endpoint (standard z.ai API key). */
const ZAI_OPENAI_BASE_URL = 'https://api.z.ai/api/paas/v4';
/** GLM Coding Plan — Anthropic Messages-compatible endpoint (the one Claude Code uses). */
const ZAI_ANTHROPIC_BASE_URL = 'https://api.z.ai/api/anthropic';
const ZAI_DEFAULT_MODEL = 'glm-4.6';

/**
 * z.ai in "API key" mode: the standard, pay-as-you-go endpoint, which speaks
 * the OpenAI Chat Completions protocol. Reuses the shared
 * {@link defineOpenAICompatProvider} with the vendor slug + base URL + GLM
 * catalog forced on (so usage stats, provider events and error context
 * attribute to `zai`, not `openai`).
 *
 * `resolveApiKey` refuses an absent/empty key rather than letting
 * {@link OpenAIProvider} fall back to `process.env.OPENAI_API_KEY` — the
 * baseURL is pinned to api.z.ai, so that fallback would silently ship the
 * user's OpenAI credential to a third-party host on a misconfigured provider.
 */
export const zaiProviderDef = defineOpenAICompatProvider({
  name: 'zai',
  baseURL: ZAI_OPENAI_BASE_URL,
  defaultModel: ZAI_DEFAULT_MODEL,
  models: glmModels,
  resolveApiKey: (cfg) => {
    if (!cfg.apiKey) throw new Error('zai requires an API key (set the zai provider apiKey or ZAI_API_KEY)');
    return cfg.apiKey;
  },
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
    const cfg = pickOpenAICompatConfig(config);
    // Refuse to construct without a key: AnthropicProvider falls back to
    // process.env.ANTHROPIC_API_KEY when apiKey is absent, while baseURL is
    // pinned to z.ai's Anthropic endpoint — forwarding an empty key would
    // silently exfiltrate the user's real Anthropic credential to api.z.ai.
    if (!cfg.apiKey) throw new Error('zai-coding-plan requires an API key (set the zai-coding-plan provider apiKey)');
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
