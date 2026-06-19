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
 * Validate the untrusted config object (sourced from user/workspace config — a
 * trust boundary) before constructing, so a blind `as` cast can't launder a
 * wrong-typed `baseURL`/`model`/`batchSize`/`dimensions` into the embedder.
 * Numeric-range checks stay owned by the constructor.
 */
function coerceOptions(config: Record<string, unknown>): OpenAIEmbedderOptions {
  const out: {
    apiKey?: string;
    baseURL?: string;
    model?: OpenAIEmbedderOptions['model'];
    dimensions?: number;
    batchSize?: number;
    timeoutMs?: number;
    maxRetries?: number;
  } = {};
  const stringField = (key: 'apiKey' | 'baseURL'): void => {
    const v = config[key];
    if (v === undefined) return;
    if (typeof v !== 'string') {
      throw new Error(`@moxxy/plugin-embeddings-openai: '${key}' must be a string.`);
    }
    out[key] = v;
  };
  const numberField = (key: 'dimensions' | 'batchSize' | 'timeoutMs' | 'maxRetries'): void => {
    const v = config[key];
    if (v === undefined) return;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`@moxxy/plugin-embeddings-openai: '${key}' must be a finite number.`);
    }
    out[key] = v;
  };
  stringField('apiKey');
  stringField('baseURL');
  numberField('dimensions');
  numberField('batchSize');
  numberField('timeoutMs');
  numberField('maxRetries');
  if (config.model !== undefined) {
    if (typeof config.model !== 'string') {
      throw new Error("@moxxy/plugin-embeddings-openai: 'model' must be a string.");
    }
    out.model = config.model as OpenAIEmbedderOptions['model'];
  }
  if (config.client !== undefined) {
    // A pre-built client is only ever injected programmatically (tests), never via
    // serialized config; pass it through untouched.
    return { ...out, client: config.client as OpenAIEmbedderOptions['client'] };
  }
  return out;
}

/**
 * Registrable embedder def. `createClient` is cheap — `createOpenAIEmbedder`
 * just constructs a client; the network call happens on `embed()`.
 */
export const openaiEmbedderDef: EmbedderDef = defineEmbedder({
  name: 'openai',
  displayName: 'OpenAI embeddings',
  createClient: (config) => createOpenAIEmbedder(coerceOptions(config)),
});

/** Auto-discovery entry: lets a user-installed copy register the embedder. */
const plugin: Plugin = definePlugin({
  name: '@moxxy/plugin-embeddings-openai',
  embedders: [openaiEmbedderDef],
});
export default plugin;
