import type { Session } from '@moxxy/core';
import type { EmbedderDef } from '@moxxy/sdk';
import type { EmbeddingsConfig } from '@moxxy/config';

type WarnLogger = { warn(msg: string, meta?: Record<string, unknown>): void };

/**
 * Activate the configured embedder on `session.embedders`, which
 * @moxxy/plugin-memory reads (lazily) for semantic recall.
 *
 * The registry is populated by plugin discovery — any installed `kind:
 * 'embedder'` plugin (incl. user-authored ones) is already registered by the
 * time this runs. The two first-party embedders (`openai`, `transformers`) are
 * bundled rather than discovered, so we lazy-register their def on demand here
 * — keeping the property that their heavy runtimes load only when selected.
 *
 * `'none'` leaves no active embedder (memory falls back to keyword recall);
 * `undefined`/`'tfidf'` selects the zero-dep TF-IDF embedder that
 * @moxxy/plugin-memory contributes. Unknown/failed selections warn and fall
 * back to TF-IDF.
 */
export async function selectEmbedder(
  session: Session,
  cfg: EmbeddingsConfig | undefined,
  logger: WarnLogger,
): Promise<void> {
  if (cfg?.provider === 'none') return;
  const name = cfg?.provider ?? 'tfidf';

  if (!session.embedders.has(name)) {
    await registerBuiltinEmbedder(session, name, logger);
  }
  if (!session.embedders.has(name)) {
    logger.warn(`embedder '${name}' is not available; falling back to TF-IDF`, {});
    activateTfIdf(session);
    return;
  }
  try {
    session.embedders.setActive(name, embedderConfig(cfg));
  } catch (err) {
    logger.warn(`failed to activate embedder '${name}'; falling back to TF-IDF`, {
      err: err instanceof Error ? err.message : String(err),
    });
    activateTfIdf(session);
  }
}

function activateTfIdf(session: Session): void {
  if (session.embedders.has('tfidf')) session.embedders.setActive('tfidf');
}

/** Map the embeddings config onto the flat config object an embedder factory reads. */
function embedderConfig(cfg: EmbeddingsConfig | undefined): Record<string, unknown> {
  return {
    ...(cfg?.model ? { model: cfg.model } : {}),
    ...(cfg?.dimensions !== undefined ? { dimensions: cfg.dimensions } : {}),
    ...(cfg?.apiKey ? { apiKey: cfg.apiKey } : {}),
    ...(cfg?.batchSize !== undefined ? { batchSize: cfg.batchSize } : {}),
    ...(cfg?.cacheDir ? { cacheDir: cfg.cacheDir } : {}),
  };
}

/** How to lazily import a bundled first-party embedder's def on demand. */
export interface BuiltinEmbedderSource {
  /** npm package that exports the embedder def. */
  readonly pkg: string;
  /** Named export on that package carrying the {@link EmbedderDef}. */
  readonly exportName: string;
}

/**
 * The bundled first-party embedders the CLI lazy-registers on demand (so their
 * heavy runtimes load only when selected). A registry seam, not an inline
 * branch: adding a bundled embedder is one entry here; everything else arrives
 * via the normal plugin-discovery path and never touches this table.
 */
export const BUILTIN_EMBEDDER_SOURCES: Readonly<Record<string, BuiltinEmbedderSource>> = {
  openai: { pkg: '@moxxy/plugin-embeddings-openai', exportName: 'openaiEmbedderDef' },
  transformers: { pkg: '@moxxy/plugin-embeddings-transformers', exportName: 'transformersEmbedderDef' },
};

/**
 * Lazy-register a bundled first-party embedder's def. No-op for names that
 * aren't first-party (those must arrive via a discovered plugin).
 */
async function registerBuiltinEmbedder(session: Session, name: string, logger: WarnLogger): Promise<void> {
  const src = BUILTIN_EMBEDDER_SOURCES[name];
  if (!src) return;
  try {
    const mod = (await import(src.pkg)) as Record<string, unknown>;
    const def = mod[src.exportName] as EmbedderDef | undefined;
    if (def && !session.embedders.has(def.name)) session.embedders.register(def);
  } catch (err) {
    logger.warn(`failed to load ${src.pkg}; falling back to TF-IDF`, {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
