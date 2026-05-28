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
   */
  readonly embedder?: EmbeddingProvider | null;
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
  private readonly embedder: EmbeddingProvider | null;
  private readonly index: EmbeddingIndex | null;
  // Per-instance mutex. save/update/forget/recall each read-modify-write the
  // entry file, MEMORY.md, and the embedding index; without serialization two
  // overlapping calls clobber MEMORY.md and race the embedding cache.
  private readonly mutex: Mutex = createMutex();

  constructor(opts: MemoryStoreOptions = {}) {
    this.dir = opts.dir ?? defaultMemoryDir();
    if (opts.embedder === null) {
      this.embedder = null;
    } else if (opts.embedder !== undefined) {
      this.embedder = opts.embedder;
    } else {
      this.embedder = new TfIdfEmbedder();
    }
    // TF-IDF's vocab depends on the whole corpus, so per-entry caching is
    // useless — recompute every recall. For neural embedders, caching is
    // a big win since each entry's vector is corpus-independent.
    const isTfIdf = this.embedder instanceof TfIdfEmbedder;
    const persist = opts.persistEmbeddings ?? (this.embedder !== null && !isTfIdf);
    this.index =
      persist && this.embedder
        ? new EmbeddingIndex(this.dir, this.embedder.name, this.embedder.dim)
        : null;
  }

  get embedderName(): string {
    return this.embedder?.name ?? 'keyword';
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

    const useVector = mode === 'vector' || (mode === 'auto' && this.embedder !== null);
    if (useVector && this.embedder) {
      return recallVector(all, query, limit, this.embedder, this.index, this.mutex);
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
