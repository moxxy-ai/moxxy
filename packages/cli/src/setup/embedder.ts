import type { EmbeddingProvider } from '@moxxy/sdk';
import type { EmbeddingsConfig } from '@moxxy/config';
import { TfIdfEmbedder } from '@moxxy/plugin-memory';

type WarnLogger = { warn(msg: string, meta?: Record<string, unknown>): void };

/**
 * Build the configured EmbeddingProvider. `undefined` and `'tfidf'` both yield
 * the built-in TfIdfEmbedder (zero deps). `'none'` returns `null` so the
 * MemoryStore falls back to keyword recall. `'openai'` and `'transformers'`
 * dynamically import their plugins so users without one or the other
 * installed don't pay the load cost.
 */
export async function buildEmbedder(
  cfg: EmbeddingsConfig | undefined,
  logger: WarnLogger,
): Promise<EmbeddingProvider | null | undefined> {
  if (!cfg || cfg.provider === 'tfidf') return new TfIdfEmbedder();
  if (cfg.provider === 'none') return null;
  if (cfg.provider === 'openai') return loadOpenAI(cfg, logger);
  if (cfg.provider === 'transformers') return loadTransformers(cfg, logger);
  return new TfIdfEmbedder();
}

async function loadOpenAI(cfg: EmbeddingsConfig, logger: WarnLogger): Promise<EmbeddingProvider> {
  try {
    const mod = (await import('@moxxy/plugin-embeddings-openai')) as {
      createOpenAIEmbedder: (opts: Record<string, unknown>) => EmbeddingProvider;
    };
    return mod.createOpenAIEmbedder({
      ...(cfg.model ? { model: cfg.model } : {}),
      ...(cfg.dimensions !== undefined ? { dimensions: cfg.dimensions } : {}),
      ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
      ...(cfg.batchSize !== undefined ? { batchSize: cfg.batchSize } : {}),
    });
  } catch (err) {
    logger.warn('failed to load @moxxy/plugin-embeddings-openai; falling back to TF-IDF', {
      err: err instanceof Error ? err.message : String(err),
    });
    return new TfIdfEmbedder();
  }
}

async function loadTransformers(cfg: EmbeddingsConfig, logger: WarnLogger): Promise<EmbeddingProvider> {
  try {
    const mod = (await import('@moxxy/plugin-embeddings-transformers')) as {
      createTransformersEmbedder: (opts: Record<string, unknown>) => EmbeddingProvider;
    };
    return mod.createTransformersEmbedder({
      ...(cfg.model ? { model: cfg.model } : {}),
      ...(cfg.dimensions !== undefined ? { dimensions: cfg.dimensions } : {}),
      ...(cfg.cacheDir ? { cacheDir: cfg.cacheDir } : {}),
    });
  } catch (err) {
    logger.warn('failed to load @moxxy/plugin-embeddings-transformers; falling back to TF-IDF', {
      err: err instanceof Error ? err.message : String(err),
    });
    return new TfIdfEmbedder();
  }
}
