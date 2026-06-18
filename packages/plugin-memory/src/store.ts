import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createMutex, type EmbeddingProvider, type Mutex } from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
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
import { isEnoent, listEntries, readEntry, safeRead, writeIndex, type IndexRow } from './store/io.js';
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
  /**
   * Soft cap on the number of stored memories. WARN-ONLY by design: memories
   * are deliberately-saved user knowledge consumed both via `recall` and via
   * the MEMORY.md index agents read directly, so silent oldest-eviction would
   * be silent data loss. When a save pushes the store past this cap, the save
   * still succeeds but a warning is logged and surfaced through
   * {@link MemoryStore.capStatus} (the `memory_save` tool relays it to the
   * model so it can consolidate or `memory_forget` stale entries).
   */
  readonly maxMemories?: number;
}

/** Default soft cap — see {@link MemoryStoreOptions.maxMemories}. */
export const DEFAULT_MAX_MEMORIES = 500;

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
  private readonly maxMemories: number;
  // In-memory MEMORY.md rows (name → frontmatter+path), hydrated lazily from
  // disk ONCE, then maintained incrementally on save/update/forget — so a
  // write no longer re-reads + re-parses every memory file to rebuild the
  // index (the old O(N)-per-write rebuild). Entries written to the dir by
  // other processes appear after the next hydration (new store instance);
  // within one process this store is the only writer, same assumption the
  // mutex already makes.
  private indexRows: Map<string, IndexRow> | null = null;

  constructor(opts: MemoryStoreOptions = {}) {
    this.dir = opts.dir ?? defaultMemoryDir();
    this.persistOpt = opts.persistEmbeddings;
    this.maxMemories = opts.maxMemories ?? DEFAULT_MAX_MEMORIES;
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
        const rows = await this.rows();
        rows.delete(name);
        await this.writeIndexFromRows(rows);
        return true;
      } catch (err) {
        if (isEnoent(err)) return false;
        throw err;
      }
    });
  }

  /**
   * Soft-cap status (see {@link MemoryStoreOptions.maxMemories}). `over` means
   * the store holds more entries than the cap; nothing is ever evicted.
   */
  async capStatus(): Promise<{ count: number; max: number; over: boolean }> {
    const rows = await this.rows();
    return { count: rows.size, max: this.maxMemories, over: rows.size > this.maxMemories };
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
    // Incremental index maintenance: update THIS entry's row and re-render
    // MEMORY.md from the in-memory rows — no per-write re-read of every file.
    const rows = await this.rows();
    rows.set(frontmatter.name, { frontmatter, path: filePath });
    await this.writeIndexFromRows(rows);
    if (rows.size > this.maxMemories) {
      // Warn-only soft cap — eviction would silently destroy saved knowledge.
      console.warn(
        `[plugin-memory] memory store holds ${rows.size} entries (soft cap ${this.maxMemories}). ` +
          `Nothing is evicted; consider consolidating or forgetting stale memories.`,
      );
    }
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

  /** Hydrate the index-row cache from disk once, then serve it from memory.
   *  Callers that mutate it hold the store mutex (writeEntry/forget). */
  private async rows(): Promise<Map<string, IndexRow>> {
    if (!this.indexRows) {
      const entries = await listEntries(this.dir);
      this.indexRows = new Map(
        entries.map((e) => [e.frontmatter.name, { frontmatter: e.frontmatter, path: e.path }]),
      );
    }
    return this.indexRows;
  }

  /** Render MEMORY.md from the cached rows, name-sorted so the output is
   *  deterministic (readdir order, which the old full rebuild inherited,
   *  was platform-dependent anyway). */
  private writeIndexFromRows(rows: Map<string, IndexRow>): Promise<void> {
    const sorted = [...rows.values()].sort((a, b) =>
      a.frontmatter.name.localeCompare(b.frontmatter.name),
    );
    return writeIndex(this.dir, sorted);
  }
}
