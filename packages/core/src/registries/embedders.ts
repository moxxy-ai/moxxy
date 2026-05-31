import type { EmbedderDef, EmbeddingProvider } from '@moxxy/sdk';
import { ActiveBackendRegistry } from './active-backend-registry.js';

/**
 * Registry of text-embedding backends:
 *   - plugins call `register(def)` at load time (via `PluginSpec.embedders`)
 *   - the host/CLI calls `setActive(name, config)` once an embedder is chosen
 *   - @moxxy/plugin-memory reads `getActive()` / `tryGetActive()` for recall
 *
 * At most one embedder is active at a time, selected explicitly. `createClient`
 * is called lazily on first activation, so a registered-but-unselected embedder
 * (e.g. the heavy transformers one) never instantiates its runtime.
 */
export class EmbedderRegistry extends ActiveBackendRegistry<EmbedderDef, EmbeddingProvider> {
  constructor() {
    super({ noun: 'Embedder', build: (def, config) => def.createClient(config) });
  }
}
