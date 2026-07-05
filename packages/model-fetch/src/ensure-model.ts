/**
 * Convenience: ensure a model directory exists, downloading + extracting a
 * pinned `.tar.bz2` on first use. Idempotent — a completed extraction records a
 * `.model.ok` marker so subsequent calls short-circuit without touching the
 * network or disk. The staged archive is removed after a successful extraction
 * to reclaim the (typically tens-of-MB) download.
 */

import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { extractTarBz2 } from './extract.js';
import { fetchModelAsset, type FetchLike } from './fetch-asset.js';

export type EnsureModelPhase = 'downloading' | 'verifying' | 'extracting' | 'done';

export interface EnsureModelProgress {
  readonly phase: EnsureModelPhase;
  /** Bytes downloaded so far (download phases only; 0 otherwise). */
  readonly receivedBytes: number;
  /** Download total from Content-Length, or 0 when unknown. */
  readonly totalBytes: number;
  /** Entries extracted so far (extract phase only). */
  readonly entries: number;
}

export interface EnsureModelOptions {
  /** Archive URL — `https:` on an allow-listed host. */
  readonly url: string;
  /** Pinned hex sha256 of the archive. MANDATORY. */
  readonly sha256: string;
  /** Final extracted directory. Its `.model.ok` marker gates idempotence. */
  readonly dir: string;
  /** Where the archive is staged before extraction. Default: `dirname(dir)`. */
  readonly cacheDir?: string;
  /** Archive basename to stage as. Default: derived from `url`. */
  readonly archiveName?: string;
  readonly fetchImpl?: FetchLike;
  readonly onProgress?: (p: EnsureModelProgress) => void;
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
  readonly allowedHosts?: readonly string[];
}

/** Marker written INTO `dir` once extraction completes; records the archive
 *  hash so a re-run can trust the tree without re-hashing/re-extracting. */
const MODEL_MARKER = '.model.ok';

export interface EnsureModelResult {
  /** Absolute path to the ready model directory. */
  readonly dir: string;
  /** True when an existing complete directory was reused. */
  readonly skipped: boolean;
}

export async function ensureModel(opts: EnsureModelOptions): Promise<EnsureModelResult> {
  const { url, dir, onProgress, signal } = opts;
  const expected = opts.sha256.trim().toLowerCase();
  const markerPath = path.join(dir, MODEL_MARKER);

  // Fast path: a completed extraction with a matching recorded hash.
  if ((await readMarker(markerPath)) === expected) {
    onProgress?.({ phase: 'done', receivedBytes: 0, totalBytes: 0, entries: 0 });
    return { dir, skipped: true };
  }

  signal?.throwIfAborted();
  // A stale/partial directory (interrupted prior extraction, or a hash change)
  // is removed so the atomic rename in extract can land on a clean target.
  if (await dirExists(dir)) {
    await rm(dir, { recursive: true, force: true });
  }

  const cacheDir = opts.cacheDir ?? path.dirname(dir);
  const asset = await fetchModelAsset({
    url,
    sha256: expected,
    destDir: cacheDir,
    ...(opts.archiveName ? { fileName: opts.archiveName } : {}),
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.maxBytes !== undefined ? { maxBytes: opts.maxBytes } : {}),
    ...(signal ? { signal } : {}),
    ...(opts.allowedHosts ? { allowedHosts: opts.allowedHosts } : {}),
    // Forward download/verify progress; swallow fetch's own 'done' (extraction
    // is still ahead — the overall 'done' fires at the end of this function).
    onProgress: (p) => {
      if (p.phase === 'done') return;
      onProgress?.({
        phase: p.phase,
        receivedBytes: p.receivedBytes,
        totalBytes: p.totalBytes,
        entries: 0,
      });
    },
  });

  signal?.throwIfAborted();
  await extractTarBz2(asset.path, dir, {
    onProgress: (p) => {
      if (p.phase === 'done') return;
      onProgress?.({ phase: 'extracting', receivedBytes: 0, totalBytes: 0, entries: p.entries });
    },
  });

  await writeFile(markerPath, `${expected}\n`, 'utf8');
  // Reclaim the staged archive (+ its verification marker); the extracted tree
  // is now the source of truth and the marker guards re-download.
  await rm(asset.path, { force: true }).catch(() => {});
  await rm(`${asset.path}.ok`, { force: true }).catch(() => {});

  onProgress?.({ phase: 'done', receivedBytes: asset.bytes, totalBytes: asset.bytes, entries: 0 });
  return { dir, skipped: false };
}

async function readMarker(markerPath: string): Promise<string | null> {
  try {
    return (await readFile(markerPath, 'utf8')).trim().toLowerCase();
  } catch {
    return null;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}
