import { defineEmbedder, definePlugin, type EmbedderDef, type Plugin } from '@moxxy/sdk';
import { createTransformersEmbedder, type TransformersEmbedderOptions } from './embedder.js';

export {
  TransformersEmbedder,
  createTransformersEmbedder,
  type TransformersEmbedderOptions,
  type PipelineFactory,
} from './embedder.js';

/**
 * Registrable embedder def. `createClient` is cheap — the heavy
 * `@huggingface/transformers` runtime is lazy-imported inside `embed()`, so
 * registering this (e.g. via discovery) never pulls onnx in until selected.
 */
export const transformersEmbedderDef: EmbedderDef = defineEmbedder({
  name: 'transformers',
  displayName: 'Transformers.js (on-device)',
  createClient: (config) => createTransformersEmbedder(config as TransformersEmbedderOptions),
});

/** Auto-discovery entry: lets a user-installed copy register the embedder. */
const plugin: Plugin = definePlugin({
  name: '@moxxy/plugin-embeddings-transformers',
  embedders: [transformersEmbedderDef],
});
export default plugin;
