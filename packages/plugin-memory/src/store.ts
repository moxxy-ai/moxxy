import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createMutex, moxxyPath, writeFileAtomic, type EmbeddingProvider, type Mutex } from '@moxxy/sdk';
import { renderFrontmatter } from './parse.js';
import { TfIdfEmbedder } from './tfidf.js';
import { EmbeddingIndex } from './embedding-cache.js';
import {
  memoryFrontmatterSchema,
  type MemoryEntry,
  type MemoryFrontmatter,
  type MemoryType,
  type RecallMode,
} from './store/types.js';
import { isEnoent, listEntries, readEntry, safeRead, writeIndex } from './store/io.js';
import { rankByKeywords, recallVector, type RankedMemory } from './store/search.js';

export {
  memoryTypeSchema,
  memoryFrontmatterSchema,
  type MemoryEntry,
  type MemoryFrontmatter,
  type MemoryType,
  type RecallMode,
} from './store/types.js';
export type { RankedMemory } from './store/search.js';

export interface MemoryStoreOptions {
  readonly dir?: string;
  /**
   * Optional embedding provider. When supplied, `recall()` uses cosine
   * similarity over dense vectors. When omitted, the built-in TF-IDF
   * embedder is used. Pass `embedder: null` to force keyword-only recall.
   *
   * May also be a lazy resolver `() => EmbeddingProvider | null`, resolved once
   * on first recall — so the host can wire the registry-selected embedder
   * (`() => session.embedders.tryGetActive()`) that isn't known until plugins
   * have loaded, without forcing the store to be built after the session.
   */
  readonly embedder?: EmbeddingProvider | null | (() => EmbeddingProvider | null);
  /**
   * Cache computed embeddings on disk (`<dir>/.embeddings.json`) so unchanged
   * memories aren't re-embedded on every recall. Defaults to true for all
   * embedders EXCEPT TF-IDF (which derives vocab from the whole corpus, so
   * per-entry caching doesn't help).
   */
  readonly persistEmbeddings?: boolean;
}

export function defaultMemoryDir(): string {
  return moxxyPath('memory');
}

export class MemoryStore {
  readonly dir: string;
  private readonly resolveEmbedder: () => EmbeddingProvider | null;
  private readonly persistOpt: boolean | undefined;
  // Embedder + index are resolved LAZILY on first recall (memoized), so a host
  // that selects the embedder from a registry after plugins load can pass a
  // resolver here without the store needing to be built after the session.
  private embedderCache: EmbeddingProvider | null | undefined;
  private indexCache: EmbeddingIndex | null | undefined;
  // Per-instance mutex. save/update/forget/recall each read-modify-write the
  // entry file, MEMORY.md, and the embedding index; without serialization two
  // overlapping calls clobber MEMORY.md and race the embedding cache.
  private readonly mutex: Mutex = createMutex();

  constructor(opts: MemoryStoreOptions = {}) {
    this.dir = opts.dir ?? defaultMemoryDir();
    this.persistOpt = opts.persistEmbeddings;
    const e = opts.embedder;
    if (typeof e === 'function') {
      this.resolveEmbedder = e;
    } else if (e === null) {
      this.resolveEmbedder = () => null;
    } else if (e !== undefined) {
      this.resolveEmbedder = () => e;
    } else {
      const tfidf = new TfIdfEmbedder();
      this.resolveEmbedder = () => tfidf;
    }
  }

  private getEmbedder(): EmbeddingProvider | null {
    if (this.embedderCache === undefined) this.embedderCache = this.resolveEmbedder();
    return this.embedderCache;
  }

  private getIndex(): EmbeddingIndex | null {
    if (this.indexCache === undefined) {
      const emb = this.getEmbedder();
      // TF-IDF's vocab depends on the whole corpus, so per-entry caching is
      // useless — recompute every recall. For neural embedders, caching is
      // a big win since each entry's vector is corpus-independent.
      const isTfIdf = emb instanceof TfIdfEmbedder;
      const persist = this.persistOpt ?? (emb !== null && !isTfIdf);
      this.indexCache = persist && emb ? new EmbeddingIndex(this.dir, emb.name, emb.dim) : null;
    }
    return this.indexCache;
  }

  get embedderName(): string {
    return this.getEmbedder()?.name ?? 'keyword';
  }

  list(filterType?: MemoryType): Promise<ReadonlyArray<MemoryEntry>> {
    return listEntries(this.dir, filterType);
  }

  get(name: string): Promise<MemoryEntry | null> {
    return readEntry(this.fileFor(name));
  }

  save(
    input: Omit<MemoryFrontmatter, 'createdAt' | 'updatedAt'> & { body: string },
  ): Promise<MemoryEntry> {
    return this.mutex.run(() => this.writeEntry(input));
  }

  update(
    name: string,
    patch: { body?: string; description?: string; tags?: ReadonlyArray<string> },
  ): Promise<MemoryEntry | null> {
    // Read-modify-write under the mutex; calls the internal (unserialized)
    // writer so it doesn't deadlock on its own chain.
    return this.mutex.run(async () => {
      const existing = await readEntry(this.fileFor(name));
      if (!existing) return null;
      const mergedTags = patch.tags ?? existing.frontmatter.tags;
      return this.writeEntry({
        name: existing.frontmatter.name,
        type: existing.frontmatter.type,
        description: patch.description ?? existing.frontmatter.description,
        ...(mergedTags ? { tags: [...mergedTags] } : {}),
        body: patch.body ?? existing.body,
      });
    });
  }

  forget(name: string): Promise<boolean> {
    return this.mutex.run(async () => {
      const filePath = this.fileFor(name);
      try {
        await fs.unlink(filePath);
        await this.rebuildIndex();
        return true;
      } catch (err) {
        if (isEnoent(err)) return false;
        throw err;
      }
    });
  }

  /** The actual entry write. NOT serialized — callers hold the mutex. */
  private async writeEntry(
    input: Omit<MemoryFrontmatter, 'createdAt' | 'updatedAt'> & { body: string },
  ): Promise<MemoryEntry> {
    await fs.mkdir(this.dir, { recursive: true });
    const filePath = this.fileFor(input.name);
    const existing = await safeRead(filePath);
    const now = new Date().toISOString();
    const createdAt = existing?.frontmatter.createdAt ?? now;
    const frontmatter = memoryFrontmatterSchema.parse({
      name: input.name,
      type: input.type,
      description: input.description,
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      createdAt,
      updatedAt: now,
    });
    const content = `${renderFrontmatter(frontmatter)}\n\n${input.body.trimEnd()}\n`;
    await writeFileAtomic(filePath, content);
    await this.rebuildIndex();
    return { frontmatter, body: input.body.trimEnd(), path: filePath };
  }

  /**
   * Search memories by a free-text query. Uses vector cosine similarity when
   * an EmbeddingProvider is configured (the default is the built-in TF-IDF
   * embedder); falls back to keyword scoring when `mode: 'keyword'` or when
   * no embedder is wired.
   */
  async recall(
    query: string,
    opts: { limit?: number; type?: MemoryType; mode?: RecallMode } = {},
  ): Promise<ReadonlyArray<RankedMemory>> {
    const limit = opts.limit ?? 5;
    const mode = opts.mode ?? 'auto';
    const all = await this.list(opts.type);
    if (all.length === 0) return [];

    const embedder = this.getEmbedder();
    const useVector = mode === 'vector' || (mode === 'auto' && embedder !== null);
    if (useVector && embedder) {
      return recallVector(all, query, limit, embedder, this.getIndex(), this.mutex);
    }
    return rankByKeywords(all, query, limit);
  }

  private fileFor(name: string): string {
    return path.join(this.dir, `${name}.md`);
  }

  private async rebuildIndex(): Promise<void> {
    const entries = await this.list();
    await writeIndex(this.dir, entries);
  }
}
