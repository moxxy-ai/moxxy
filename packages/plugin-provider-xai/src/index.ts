import { defineProvider, definePlugin } from '@moxxy/sdk';
import {
  OpenAIProvider,
  validateOpenAICompatKey,
  type OpenAIProviderConfig,
} from '@moxxy/plugin-provider-openai';
import { grokModels } from './models.js';

export { grokModels };

const XAI_BASE_URL = 'https://api.x.ai/v1';
const XAI_DEFAULT_MODEL = 'grok-4';

/**
 * xAI (Grok). The xAI API speaks the OpenAI Chat Completions protocol, so this
 * reuses the shared {@link OpenAIProvider} with the `xai` slug + base URL +
 * Grok catalog forced on (so usage stats, provider events and error context
 * attribute to `xai`, not `openai`).
 */
export const xaiProviderDef = defineProvider({
  name: 'xai',
  models: [...grokModels],
  createClient: (config) => {
    const cfg = config as OpenAIProviderConfig;
    return new OpenAIProvider({
      ...cfg,
      name: 'xai',
      baseURL: cfg.baseURL ?? XAI_BASE_URL,
      defaultModel: cfg.defaultModel ?? XAI_DEFAULT_MODEL,
      models: grokModels,
    });
  },
  validateKey: (key) => validateOpenAICompatKey(key, { baseURL: XAI_BASE_URL }),
  auth: {
    kind: 'apiKey',
    hint: 'xAI API key (starts with `xai-`) from https://console.x.ai',
  },
});

export const xaiPlugin = definePlugin({
  name: '@moxxy/plugin-provider-xai',
  version: '0.0.0',
  providers: [xaiProviderDef],
});

export default xaiPlugin;
