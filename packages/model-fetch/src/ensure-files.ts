/**
 * Ensure a model made of several plain files is on disk: each file downloads
 * straight into the model directory, in parallel, verified against its pinned
 * size and sha256. Nothing is unpacked, so the model is ready as soon as its
 * bytes land — unpacking a `.tar.bz2` in JavaScript took far longer than the
 * download itself. Electron-free and free of the archive code, so the desktop
 * main process can bundle it alone (`@moxxy/model-fetch/files`).
 */

import { rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { ModelFetchError } from './errors.js';
import { fetchModelAsset, isVerifiedAsset, type FetchLike } from './fetch-asset.js';

/** One file of a model, pinned by size and content. */
export interface ModelFile {
  /** Basename inside the model directory. */
  readonly name: string;
  /** Source URL — `https:` on an allow-listed host, ideally pinned to a revision. */
  readonly url: string;
  /** Exact size in bytes; a larger body is refused. */
  readonly bytes: number;
  /** Hex sha256 of the file. */
  readonly sha256: string;
}

/** Progress over the whole model: every file counts, done ones in full. */
export interface ModelFilesProgress {
  readonly receivedBytes: number;
  readonly totalBytes: number;
}

export interface EnsureModelFilesOptions {
  readonly files: readonly ModelFile[];
  /** The model directory the files land in (created if missing). */
  readonly dir: string;
  readonly fetchImpl?: FetchLike;
  readonly onProgress?: (p: ModelFilesProgress) => void;
  /** Aborts every download and removes their partial files. */
  readonly signal?: AbortSignal;
  readonly allowedHosts?: readonly string[];
}

export interface EnsureModelFilesResult {
  readonly dir: string;
  /** True when every file was already there and nothing was fetched. */
  readonly skipped: boolean;
}

/** Whether every file of the model is on disk, verified and of its pinned size. */
export async function modelFilesReady(files: readonly ModelFile[], dir: string): Promise<boolean> {
  const ready = await Promise.all(files.map((file) => fileReady(file, dir)));
  return ready.every(Boolean);
}

export async function ensureModelFiles(opts: EnsureModelFilesOptions): Promise<EnsureModelFilesResult> {
  const { files, dir, onProgress, signal } = opts;
  for (const file of files) assertSafeName(file.name);
  if (signal?.aborted) throw abortedError();

  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const ready = await Promise.all(files.map((file) => fileReady(file, dir)));
  const received = files.map((file, i) => (ready[i] ? file.bytes : 0));
  const report = (): void => {
    onProgress?.({ receivedBytes: received.reduce((sum, n) => sum + n, 0), totalBytes });
  };
  if (ready.every(Boolean)) {
    report();
    return { dir, skipped: true };
  }

  // One failure stops the other downloads; the caller's abort stops them all.
  const controller = new AbortController();
  const stop = (): void => controller.abort(signal?.reason);
  signal?.addEventListener('abort', stop, { once: true });
  // The caller may have aborted while the files were being checked.
  if (signal?.aborted) stop();
  let firstError: unknown = null;
  try {
    await Promise.allSettled(
      files.map(async (file, i) => {
        if (ready[i]) return;
        try {
          // A marker left beside a file of the wrong size must not be trusted.
          await rm(`${path.join(dir, file.name)}.ok`, { force: true });
          await fetchModelAsset({
            url: file.url,
            sha256: file.sha256,
            destDir: dir,
            fileName: file.name,
            maxBytes: file.bytes,
            signal: controller.signal,
            ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
            ...(opts.allowedHosts ? { allowedHosts: opts.allowedHosts } : {}),
            onProgress: (p) => {
              received[i] = p.phase === 'done' ? file.bytes : Math.min(p.receivedBytes, file.bytes);
              report();
            },
          });
        } catch (error) {
          firstError ??= error;
          controller.abort(error);
        }
      }),
    );
  } finally {
    signal?.removeEventListener('abort', stop);
  }
  if (signal?.aborted) throw abortedError();
  if (firstError) throw firstError;
  report();
  return { dir, skipped: false };
}

function abortedError(): ModelFetchError {
  return new ModelFetchError('ABORTED', 'download aborted');
}

async function fileReady(file: ModelFile, dir: string): Promise<boolean> {
  const abs = path.join(dir, file.name);
  if (!(await isVerifiedAsset(abs, file.sha256))) return false;
  try {
    return (await stat(abs)).size === file.bytes;
  } catch {
    return false;
  }
}

/** A file name is a plain basename, so no file lands outside the model directory. */
function assertSafeName(name: string): void {
  if (!name || name === '.' || name === '..' || path.basename(name) !== name || name.includes('\0')) {
    throw new ModelFetchError('UNSAFE_ENTRY', `model file name must be a plain basename: ${JSON.stringify(name)}`);
  }
}
