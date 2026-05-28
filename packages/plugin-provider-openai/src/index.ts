import { defineProvider, definePlugin } from '@moxxy/sdk';
import { OpenAIProvider, openAIModels, type OpenAIProviderConfig } from './provider.js';

export { OpenAIProvider, openAIModels };
export type { OpenAIProviderConfig };
export { toOpenAIMessages, toOpenAITools } from './translate.js';
export { validateKey, type ValidateKeyDeps, type ValidationResult } from './validate.js';
// DI-friendly alias: any OpenAI-compatible vendor (same `models.list` probe)
// can reuse this validator. Re-exported under a vendor-neutral name so other
// packages don't couple to the OpenAI-specific `validateKey` symbol.
export { validateKey as validateOpenAICompatKey } from './validate.js';

import { validateKey as validateOpenAIKey } from './validate.js';

export const openaiProviderDef = defineProvider({
  name: 'openai',
  models: [...openAIModels],
  createClient: (config) => new OpenAIProvider(config as OpenAIProviderConfig),
  validateKey: (key) => validateOpenAIKey(key),
});

export const openaiPlugin = definePlugin({
  name: '@moxxy/plugin-provider-openai',
  version: '0.0.0',
  providers: [openaiProviderDef],
});

export default openaiPlugin;
