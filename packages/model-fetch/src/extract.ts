/**
 * Extract a `.tar.bz2` archive into a directory with hostile-archive defences.
 *
 * No tar/bzip2 capability exists elsewhere in the workspace, so this uses the
 * pure-JS `unbzip2-stream` (bzip2 decompress) piped into `tar-stream` (tar
 * parse). The security posture mirrors the desktop installer's containment
 * discipline, applied per tar ENTRY: an entry whose name is absolute, contains
 * a `..` traversal segment or a NUL, or that is a symlink / hard link / device
 * node is REFUSED before a byte is written — a malicious tarball can't drop a
 * file outside the destination or plant a symlink that later escapes it.
 *
 * Extraction runs into a sibling `.extracting-*` temp dir and is `rename`d into
 * place only on success, so an interrupted extraction never leaves a partial
 * tree masquerading as a complete model.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import bz2 from 'unbzip2-stream';
import { extract as tarExtract, type Headers } from 'tar-stream';

import { ModelFetchError } from './errors.js';

export interface ExtractProgress {
  readonly phase: 'extracting' | 'done';
  /** Number of file/dir entries written so far. */
  readonly entries: number;
}

export interface ExtractTarBz2Options {
  readonly onProgress?: (p: ExtractProgress) => void;
  /** Injected reader factory (tests). Defaults to `fs.createReadStream`. */
  readonly createReadStreamImpl?: typeof createReadStream;
}

/** tar entry types we materialise. `contiguous-file` is an old synonym for a
 *  regular file. Everything else (symlink/link/devices/fifo) is refused. */
const FILE_TYPES = new Set(['file', 'contiguous-file']);
/** tar meta-entries the parser may surface; drained and skipped, never written. */
const META_TYPES = new Set(['pax-header', 'pax-global-header', 'gnu-long-path', 'gnu-long-link-path']);

/** Validate a tar entry name and resolve it safely under `root`. Throws
 *  `UNSAFE_ENTRY` on anything that could escape. Exported for unit tests. */
export function safeEntryPath(root: string, name: string): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new ModelFetchError('UNSAFE_ENTRY', 'tar entry has an empty name');
  }
  if (name.includes('\0')) {
    throw new ModelFetchError('UNSAFE_ENTRY', 'tar entry name contains NUL');
  }
  // Normalise separators (tar always uses `/`) and reject absolute paths.
  const normalized = name.replace(/\\/g, '/');
  if (path.posix.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) {
    throw new ModelFetchError('UNSAFE_ENTRY', `tar entry name is absolute: ${name}`);
  }
  // Reject any `..` traversal segment outright — cheaper and stricter than
  // relying solely on the post-resolve containment check.
  if (normalized.split('/').some((seg) => seg === '..')) {
    throw new ModelFetchError('UNSAFE_ENTRY', `tar entry name escapes with '..': ${name}`);
  }
  const abs = path.resolve(root, normalized);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new ModelFetchError('UNSAFE_ENTRY', `tar entry escapes destination: ${name}`);
  }
  return abs;
}

/**
 * Extract `archivePath` (a `.tar.bz2`) into `destDir`. `destDir` must NOT
 * already exist — extraction lands in a temp sibling and is renamed into place
 * atomically. Rejects on the first unsafe entry, cleaning up the temp tree.
 */
export async function extractTarBz2(
  archivePath: string,
  destDir: string,
  opts: ExtractTarBz2Options = {},
): Promise<void> {
  const openRead = opts.createReadStreamImpl ?? createReadStream;
  const parent = path.dirname(destDir);
  await mkdir(parent, { recursive: true });
  const tmpDir = `${destDir}.extracting-${process.pid}-${Date.now().toString(36)}`;
  await mkdir(tmpDir, { recursive: true });

  const seenDirs = new Set<string>();
  let entries = 0;
  let lastEmit = 0;

  // `tarExtract()` is a terminal Writable: tar bytes are written INTO it and it
  // emits an 'entry' per member. It serialises entries — the next 'entry' won't
  // fire until we call `next()` — so processing one at a time is safe, ordered,
  // and its 'finish' (which resolves the pipeline) only fires after the last
  // entry's `next()`, i.e. after every file has been fully written.
  const extractor = tarExtract();
  extractor.on('entry', (header: Headers, stream, next) => {
    handleEntry(header, stream, tmpDir, seenDirs)
      .then((wrote) => {
        if (wrote) {
          entries += 1;
          const now = Date.now();
          if (now - lastEmit >= 100) {
            lastEmit = now;
            opts.onProgress?.({ phase: 'extracting', entries });
          }
        }
        next();
      })
      .catch((err) => {
        // Drain the current entry so the parser doesn't stall, then tear down
        // the pipeline with the real error.
        stream.resume();
        extractor.destroy(err instanceof Error ? err : new Error(String(err)));
      });
  });

  try {
    await pipeline(openRead(archivePath), bz2() as unknown as NodeJS.ReadWriteStream, extractor);
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    if (err instanceof ModelFetchError) throw err;
    throw new ModelFetchError('EXTRACT_FAILED', `failed to extract ${path.basename(archivePath)}: ${errMsg(err)}`);
  }

  try {
    await rename(tmpDir, destDir);
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw new ModelFetchError('EXTRACT_FAILED', `failed to publish extracted dir: ${errMsg(err)}`);
  }
  opts.onProgress?.({ phase: 'done', entries });
}

/** Process one tar entry. Returns true when a file/dir was written, false when
 *  the entry was a drained meta-header. Throws `UNSAFE_ENTRY` for anything that
 *  could escape (validated BEFORE any write). */
async function handleEntry(
  header: Headers,
  stream: NodeJS.ReadableStream,
  root: string,
  seenDirs: Set<string>,
): Promise<boolean> {
  const type = header.type ?? 'file';

  if (META_TYPES.has(type)) {
    stream.resume();
    return false;
  }

  if (type === 'directory') {
    const abs = safeEntryPath(root, header.name);
    await ensureDir(abs, seenDirs);
    stream.resume();
    return true;
  }

  if (!FILE_TYPES.has(type)) {
    // symlink / link / character-device / block-device / fifo — any of these
    // could be used to escape the destination or read/clobber an external path.
    throw new ModelFetchError('UNSAFE_ENTRY', `refusing unsafe tar entry type '${type}': ${header.name}`);
  }

  const abs = safeEntryPath(root, header.name);
  await ensureDir(path.dirname(abs), seenDirs);
  // Backpressure-correct copy of the entry body to disk.
  await pipeline(stream, createWriteStream(abs));
  return true;
}

async function ensureDir(dir: string, seen: Set<string>): Promise<void> {
  if (seen.has(dir)) return;
  await mkdir(dir, { recursive: true });
  seen.add(dir);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
