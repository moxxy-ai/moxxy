import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { writeFileAtomic } from '@moxxy/sdk/server';

const INDEX_FILE = '.embeddings.json';
const INDEX_VERSION = 1;

interface IndexFile {
  readonly version: typeof INDEX_VERSION;
  readonly embedder: string;
  /** Vector dimensionality the cache was built with (undefined = pre-dim format). */
  readonly dim?: number | 'dynamic';
  readonly entries: Record<string, IndexEntry>;
}

interface IndexEntry {
  readonly hash: string;
  readonly vector: ReadonlyArray<number>;
}

/**
 * Persists computed embeddings to `<memoryDir>/.embeddings.json` keyed by
 * content hash. The cache is invalidated when the embedder name OR its
 * dimensionality changes — a name alone is too coarse (e.g. the OpenAI embedder
 * reports a fixed name across models/`dimensions` settings, so a 1536→3072
 * model switch must invalidate on the dim mismatch or recall compares
 * incomparable vectors).
 */
export class EmbeddingIndex {
  private cache: Map<string, IndexEntry> = new Map();
  private dirty = false;
  private loaded = false;

  constructor(
    private readonly dir: string,
    private readonly embedderName: string,
    private readonly dim?: number | 'dynamic',
  ) {}

  static hash(text: string): string {
    return createHash('sha256').update(text).digest('hex').slice(0, 24);
  }

  private get filePath(): string {
    return path.join(this.dir, INDEX_FILE);
  }

  async load(): Promise<void> {
    // Read the on-disk cache at most once per instance. The store memoizes this
    // index for its lifetime and is the single writer (flush() keeps disk in
    // sync for our own writes), so re-reading + re-parsing the whole file on
    // every recall is pure overhead — the in-memory Map is already authoritative.
    if (this.loaded) return;
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      if (!isEnoent(err)) throw err;
      // No file on disk yet — still treat as loaded so subsequent recalls don't
      // re-stat. This process is the single writer; flush() creates the file.
      this.loaded = true;
      return;
    }
    // The cache is a pure optimization: a corrupt/garbled/half-synced file
    // (truncated JSON, manual edit, partial cloud-drive sync, schema drift) must
    // degrade to a COLD cache, never permanently break every recall. Parse and
    // shape-check defensively; on any failure, log and start empty.
    this.loaded = true;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.warn(`[plugin-memory] ignoring corrupt embedding cache (${this.filePath}): ${String(err)}`);
      return;
    }
    if (!isValidIndexFile(parsed)) return; // malformed shape → cold cache
    if (parsed.version !== INDEX_VERSION) return; // unknown format, ignore
    if (parsed.embedder !== this.embedderName) return; // embedder changed, invalidate
    // Dim mismatch (incl. an old file written before dim was tracked) → the
    // vectors are a different dimensionality; invalidate rather than mix them.
    if (this.dim !== undefined && parsed.dim !== this.dim) return;
    for (const [name, entry] of Object.entries(parsed.entries)) {
      if (isValidIndexEntry(entry)) this.cache.set(name, entry);
    }
  }

  /**
   * For a `(name, body)` pair, return either the cached vector (if the body
   * hash matches) or `null` (miss). Callers re-embed the misses and call
   * `set()` with the fresh vectors.
   */
  lookup(name: string, body: string): ReadonlyArray<number> | null {
    const entry = this.cache.get(name);
    if (!entry) return null;
    if (entry.hash !== EmbeddingIndex.hash(body)) return null;
    return entry.vector;
  }

  set(name: string, body: string, vector: ReadonlyArray<number>): void {
    const hash = EmbeddingIndex.hash(body);
    const existing = this.cache.get(name);
    if (existing && existing.hash === hash) return;
    this.cache.set(name, { hash, vector });
    this.dirty = true;
  }

  /** Drop entries that no longer correspond to existing memories. */
  prune(currentNames: ReadonlyArray<string>): void {
    const wanted = new Set(currentNames);
    for (const name of [...this.cache.keys()]) {
      if (!wanted.has(name)) {
        this.cache.delete(name);
        this.dirty = true;
      }
    }
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    const data: IndexFile = {
      version: INDEX_VERSION,
      embedder: this.embedderName,
      ...(this.dim !== undefined ? { dim: this.dim } : {}),
      entries: Object.fromEntries(this.cache),
    };
    await writeFileAtomic(this.filePath, JSON.stringify(data), { mode: 0o600 });
    this.dirty = false;
  }

  get size(): number {
    return this.cache.size;
  }
}

function isEnoent(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

/** Structural guard so a valid-JSON-but-wrong-shape file (e.g. a missing
 *  `entries`) degrades to a cold cache instead of throwing in load(). */
function isValidIndexFile(value: unknown): value is IndexFile {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.entries === 'object' && v.entries !== null;
}

function isValidIndexEntry(value: unknown): value is IndexEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.hash === 'string' &&
    Array.isArray(e.vector) &&
    e.vector.every((n) => typeof n === 'number')
  );
}
