import { readFile } from 'node:fs/promises';
import { createMutex, type Mutex } from './mutex.js';
import { writeFileAtomic, type WriteFileAtomicOptions } from './fs-utils.js';

/**
 * Generic whole-file JSON collection store: the single home for the repeated
 * "id-collection" persistence skeleton (invariant #5). It owns the in-memory
 * cache, the per-instance write mutex, the read-modify-write `.slice()` copy,
 * and the crash-atomic whole-file write via {@link writeFileAtomic} — so each
 * domain store (scheduler, webhooks, …) no longer re-derives that atomicity
 * by hand and can't silently regress it (forget the mutex, forget the copy,
 * hand-roll a non-unique tmp).
 *
 * The store persists `{ [itemsKey]: T[], ...extraFileFields }` — by default
 * `{ version: 1, items: [...] }`. The shape and key are configurable so a
 * domain store keeps its exact on-disk format.
 *
 * Parsing/validation and corruption policy stay with the caller via
 * {@link JsonFileStoreOptions.load}: it receives the raw file contents (or
 * `null` when the file is absent) and returns the validated item array. This
 * keeps each store's bespoke corrupt handling (silent reset vs. quarantine
 * aside) byte-for-byte unchanged while centralizing the atomicity invariant.
 *
 * SDK-internal-dep-free: uses only node builtins + the SDK's own
 * {@link createMutex} / {@link writeFileAtomic}.
 */
export interface JsonFileStoreOptions<T extends { id: string }> {
  /** Absolute path to the JSON file. */
  readonly file: string;
  /**
   * Parse + validate the file contents into the item array. Called once per
   * load with the raw UTF-8 string, or `null` when the file does not exist
   * (ENOENT). Owns all corruption policy (quarantine, silent reset, throw).
   * Any non-ENOENT read error is surfaced through {@link onReadError} first.
   */
  readonly load: (raw: string | null) => T[] | Promise<T[]>;
  /**
   * Called when reading the file fails with a non-ENOENT error (permissions,
   * I/O, …). Return an item array to recover, or throw to refuse to operate
   * (the safe direction when the file may hold the only copy of secrets).
   * Defaults to re-throwing the original error.
   */
  readonly onReadError?: (err: unknown) => T[] | Promise<T[]>;
  /**
   * Property name the items array is stored under. Default `'items'`.
   * (scheduler uses `'schedules'`, webhooks `'triggers'`.)
   */
  readonly itemsKey?: string;
  /**
   * Extra top-level fields written alongside the items. Default
   * `{ version: 1 }`. Pass `{}` for a versionless file.
   */
  readonly fileFields?: Record<string, unknown>;
  /**
   * How the persisted object is serialized. Default: pretty 2-space JSON
   * (matches the scheduler/webhooks format). Receives the full file object.
   */
  readonly stringify?: (fileObject: Record<string, unknown>) => string;
  /** Atomic-write options forwarded to {@link writeFileAtomic} (e.g. `mode`). */
  readonly writeOptions?: WriteFileAtomicOptions;
}

/**
 * The collection store handle. Domain stores compose this and add their own
 * id/createdAt minting and bespoke methods on top of {@link mutate}.
 */
export interface JsonFileStore<T extends { id: string }> {
  /**
   * Loaded snapshot: a fresh shallow copy of the array (safe to add/remove/
   * reorder). The item objects are shared with the live cache — do NOT mutate
   * them in place; replace them with new objects instead, or a later unrelated
   * `mutate()` will persist the drive-by change.
   */
  read(): Promise<T[]>;
  /** Find a single item by id, or `null`. */
  get(id: string): Promise<T | null>;
  /**
   * Read-modify-write under the write mutex. The mutator receives a fresh
   * shallow copy of the current items; whatever it returns becomes the new
   * state and is persisted atomically before {@link mutate} resolves.
   */
  mutate(fn: (items: T[]) => T[] | Promise<T[]>): Promise<void>;
  /** Drop the cache so the next access re-reads from disk. */
  invalidate(): void;
}

const prettyJson = (value: Record<string, unknown>): string => JSON.stringify(value, null, 2);

export function createJsonFileStore<T extends { id: string }>(
  opts: JsonFileStoreOptions<T>,
): JsonFileStore<T> {
  const {
    file,
    load,
    onReadError,
    itemsKey = 'items',
    fileFields = { version: 1 },
    stringify = prettyJson,
    writeOptions,
  } = opts;

  let cache: T[] | null = null;
  // In-flight load so a burst of concurrent cold reads coalesces into one
  // filesystem read + one parse pass, and the second loader can't clobber the
  // first's cache assignment with a stale/half-applied snapshot.
  let loading: Promise<void> | null = null;
  const mutex: Mutex = createMutex();

  async function loadIntoCache(): Promise<void> {
    let raw: string | null;
    try {
      raw = await readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        raw = null;
      } else if (onReadError) {
        cache = await onReadError(err);
        return;
      } else {
        throw err;
      }
    }
    cache = await load(raw);
  }

  function ensureLoaded(): Promise<void> {
    if (cache) return Promise.resolve();
    if (loading) return loading;
    loading = loadIntoCache().finally(() => {
      loading = null;
    });
    return loading;
  }

  async function persist(items: T[]): Promise<void> {
    const payload = stringify({ ...fileFields, [itemsKey]: items });
    await writeFileAtomic(file, payload, writeOptions ?? {});
  }

  return {
    async read(): Promise<T[]> {
      await ensureLoaded();
      return cache!.slice();
    },
    async get(id: string): Promise<T | null> {
      await ensureLoaded();
      return cache!.find((item) => item.id === id) ?? null;
    },
    async mutate(fn): Promise<void> {
      await mutex.run(async () => {
        await ensureLoaded();
        const updated = await fn(cache!.slice());
        // Persist first so a write failure (ENOSPC/EACCES/EIO) leaves the
        // in-memory cache consistent with disk — advancing the cache before the
        // durable write would commit a phantom state on the next successful
        // mutate and silently defeat the crash-atomic guarantee.
        await persist(updated);
        cache = updated;
      });
    },
    invalidate(): void {
      cache = null;
    },
  };
}
