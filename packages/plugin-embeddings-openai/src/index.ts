import { defineEmbedder, definePlugin, type EmbedderDef, type Plugin } from '@moxxy/sdk';
import { createOpenAIEmbedder, type OpenAIEmbedderOptions } from './embedder.js';

export {
  OpenAIEmbedder,
  createOpenAIEmbedder,
  type OpenAIEmbedderOptions,
  type OpenAIEmbeddingModel,
} from './embedder.js';
// Re-export for backwards compatibility; new code should import directly from @moxxy/sdk.
export { CachedEmbeddingProvider } from '@moxxy/sdk';

/**
 * Registrable embedder def. `createClient` is cheap — `createOpenAIEmbedder`
 * just constructs a client; the network call happens on `embed()`.
 */
export const openaiEmbedderDef: EmbedderDef = defineEmbedder({
  name: 'openai',
  displayName: 'OpenAI embeddings',
  createClient: (config) => createOpenAIEmbedder(config as OpenAIEmbedderOptions),
});

/** Auto-discovery entry: lets a user-installed copy register the embedder. */
const plugin: Plugin = definePlugin({
  name: '@moxxy/plugin-embeddings-openai',
  embedders: [openaiEmbedderDef],
});
export default plugin;
