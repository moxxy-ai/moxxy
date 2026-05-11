import { defineProvider, definePlugin } from '@moxxy/sdk';
import { AnthropicProvider, anthropicModels, type AnthropicProviderConfig } from './provider.js';

export { AnthropicProvider, anthropicModels };
export type { AnthropicProviderConfig };
export { toAnthropicMessages, toAnthropicTools } from './translate.js';

export const anthropicProviderDef = defineProvider({
  name: 'anthropic',
  models: [...anthropicModels],
  createClient: (config) => new AnthropicProvider(config as AnthropicProviderConfig),
});

export const anthropicPlugin = definePlugin({
  name: '@moxxy/plugin-provider-anthropic',
  version: '0.0.0',
  providers: [anthropicProviderDef],
});

export default anthropicPlugin;
