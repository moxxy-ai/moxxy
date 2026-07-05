/**
 * Download one file over HTTPS and verify it against a pinned sha256.
 *
 * This is the extracted, Electron-free distillation of the desktop Apps
 * installer's download core (`packages/desktop-host/src/apps/installer.ts`):
 * an egress allow-list checked BEFORE the first byte, a streamed sha256, a
 * `.partial`-then-`rename` atomic publish, a hard size cap so a chunked /
 * content-length-lying server can't fill the disk, and throttled progress. The
 * one deliberate divergence: the sha256 here is MANDATORY (no unhashed mode) —
 * every asset this package fetches is content-addressed and pinned.
 */

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ModelFetchError } from './errors.js';

/** A `fetch`-compatible function. Defaults to the global `fetch` (Node 20+);
 *  tests inject a stub so no real network is touched. */
export type FetchLike = typeof fetch;

/**
 * Hosts an asset may be fetched FROM — exact-or-subdomain matchers (so
 * `github.com` admits `objects.githubusercontent.com`'s parent forms but
 * `…github.com.evil` is refused). GitHub release URLs 30x-redirect to
 * `release-assets.githubusercontent.com`; like the desktop installer's gate we
 * validate only the INITIAL url and let `fetch` follow the redirect to the
 * GitHub/HF-operated CDN (a hostile initial url never reaches the network at
 * all). The default set covers where moxxy's pinned models actually live.
 */
export const DEFAULT_ALLOWED_HOSTS: readonly string[] = [
  'github.com',
  'objects.githubusercontent.com',
  'huggingface.co',
  'cdn-lfs.huggingface.co',
];

/** Compile bare hostnames into exact-or-subdomain matchers. The hostname is
 *  regex-escaped so a `.` can never act as a wildcard. */
function compileHosts(hosts: readonly string[]): RegExp[] {
  return hosts.map((h) => {
    const escaped = h.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\.)${escaped}$`);
  });
}

/** Whether `url` is a fetch target we may reach: `https:` on an allow-listed
 *  host. Exported so the gate is unit-testable in isolation. */
export function isAllowedAssetUrl(
  url: string,
  allowedHosts: readonly string[] = DEFAULT_ALLOWED_HOSTS,
): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  return compileHosts(allowedHosts).some((re) => re.test(u.hostname));
}

/** Default hard ceiling on a single downloaded asset (1 GiB). Bounds a
 *  hostile/buggy server streaming an unbounded body (disk-fill DoS). */
export const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;

export type FetchPhase = 'downloading' | 'verifying' | 'done';

export interface FetchProgress {
  readonly phase: FetchPhase;
  readonly receivedBytes: number;
  /** Total from Content-Length, or 0 when the server didn't declare one. */
  readonly totalBytes: number;
}

export interface FetchModelAssetOptions {
  /** Source URL — must be `https:` on an allow-listed host. */
  readonly url: string;
  /** Expected hex sha256 (case-insensitive). MANDATORY. */
  readonly sha256: string;
  /** Directory the verified file lands in (created if missing). */
  readonly destDir: string;
  /** Basename to save as. Default: the last path segment of `url`. */
  readonly fileName?: string;
  /** Injected `fetch` (tests). Defaults to the global. */
  readonly fetchImpl?: FetchLike;
  /** Throttled (~10/s) progress callback. */
  readonly onProgress?: (p: FetchProgress) => void;
  /** Per-download size cap. Default 1 GiB. */
  readonly maxBytes?: number;
  /** Cancellation signal — aborts the download and cleans up the partial. */
  readonly signal?: AbortSignal;
  /** Override the host allow-list (defaults to {@link DEFAULT_ALLOWED_HOSTS}). */
  readonly allowedHosts?: readonly string[];
}

export interface FetchModelAssetResult {
  /** Absolute path of the verified file. */
  readonly path: string;
  /** Byte length of the file. */
  readonly bytes: number;
  /** The verified (lowercase hex) sha256. */
  readonly sha256: string;
  /** True when an existing verified file was reused (no bytes fetched). */
  readonly skipped: boolean;
}

/** Suffix of the sidecar marker recording a verified file's hash — its presence
 *  (with a matching hash) lets a re-run skip re-hashing a multi-hundred-MB
 *  file. Mirrors the installer's `installed.json` idea, per-file. */
const OK_SUFFIX = '.ok';

function deriveFileName(url: string): string {
  let name = '';
  try {
    name = path.posix.basename(new URL(url).pathname);
  } catch {
    /* fall through to the error below */
  }
  if (!name) {
    throw new ModelFetchError('HTTP_ERROR', `cannot derive a file name from url: ${url}`);
  }
  return name;
}

async function readOkMarker(markerPath: string): Promise<string | null> {
  try {
    return (await readFile(markerPath, 'utf8')).trim().toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Download `url` into `destDir`, streaming to `<dest>.partial` while hashing,
 * verify the pinned sha256, then atomically publish. Idempotent: a prior
 * verified file (its `<dest>.ok` marker records a matching hash) is reused
 * without touching the network.
 */
export async function fetchModelAsset(
  opts: FetchModelAssetOptions,
): Promise<FetchModelAssetResult> {
  const {
    url,
    destDir,
    onProgress,
    signal,
    fetchImpl = fetch,
    maxBytes = DEFAULT_MAX_BYTES,
    allowedHosts = DEFAULT_ALLOWED_HOSTS,
  } = opts;
  const expected = opts.sha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new ModelFetchError('INTEGRITY_MISMATCH', `sha256 must be 64 hex chars, got: ${opts.sha256}`);
  }
  signal?.throwIfAborted();

  const fileName = opts.fileName ?? deriveFileName(url);
  const abs = path.join(destDir, fileName);
  const marker = `${abs}${OK_SUFFIX}`;

  // Idempotent skip: a recorded matching hash + the file present ⇒ done. We
  // trust the marker rather than re-hash a ~64 MB file on every first-use check.
  const recorded = await readOkMarker(marker);
  if (recorded === expected && (await fileExists(abs))) {
    const bytes = await fileSize(abs);
    onProgress?.({ phase: 'done', receivedBytes: bytes, totalBytes: bytes });
    return { path: abs, bytes, sha256: expected, skipped: true };
  }

  // Egress gate: only https on an allow-listed host is ever fetched, checked
  // BEFORE the network call so a bad url can't reach an arbitrary origin (SSRF)
  // or a local file.
  if (!isAllowedAssetUrl(url, allowedHosts)) {
    throw new ModelFetchError('HOST_DENIED', `url is not on an allowed host: ${url}`, {
      host: safeHost(url),
    });
  }

  await mkdir(destDir, { recursive: true });
  const partial = `${abs}.partial`;
  try {
    const result = await streamToPartial({
      url,
      partial,
      expected,
      fetchImpl,
      maxBytes,
      signal,
      onProgress,
    });
    // Atomic publish: a crash before this leaves only the `.partial`.
    await rename(partial, abs);
    await writeFile(marker, `${expected}\n`, 'utf8');
    onProgress?.({ phase: 'done', receivedBytes: result.bytes, totalBytes: result.bytes });
    return { path: abs, bytes: result.bytes, sha256: expected, skipped: false };
  } catch (err) {
    // Never strand a partial download (orphaned ~100MB temp) on any failure.
    await rm(partial, { force: true }).catch(() => {});
    throw err;
  }
}

interface StreamArgs {
  readonly url: string;
  readonly partial: string;
  readonly expected: string;
  readonly fetchImpl: FetchLike;
  readonly maxBytes: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (p: FetchProgress) => void;
}

/** Stream the body to the partial file, hashing as bytes land, enforcing the
 *  cap and throttled progress; verify the hash before returning. Throws
 *  (leaving the partial for the caller to clean up) on any failure. */
async function streamToPartial(args: StreamArgs): Promise<{ bytes: number }> {
  const { url, partial, expected, fetchImpl, maxBytes, signal, onProgress } = args;

  let res: Response;
  try {
    res = await fetchImpl(url, signal ? { signal } : {});
  } catch (err) {
    if (signal?.aborted) throw abortedError(signal);
    throw new ModelFetchError('HTTP_ERROR', `download failed: ${errMsg(err)}`, { host: safeHost(url) });
  }
  if (!res.ok || !res.body) {
    throw new ModelFetchError('HTTP_ERROR', `download failed: HTTP ${res.status}`, {
      host: safeHost(url),
      status: res.status,
    });
  }

  // Parse Content-Length explicitly: absent/empty (chunked CDN responses) ⇒ 0
  // total (indeterminate bar; the streaming cap still applies). Reject an
  // honestly-over-cap body up front.
  const rawLen = res.headers.get('content-length');
  const declared = rawLen == null || rawLen === '' ? NaN : Number(rawLen);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ModelFetchError('TOO_LARGE', `asset exceeds the ${maxBytes}-byte cap (content-length ${declared})`);
  }
  const totalBytes = Number.isFinite(declared) && declared > 0 ? declared : 0;

  const hash = createHash('sha256');
  const out = createWriteStream(partial);
  let writeErr: NodeJS.ErrnoException | null = null;
  out.on('error', (e: NodeJS.ErrnoException) => {
    writeErr = writeErr ?? e;
  });

  const reader = res.body.getReader();
  let received = 0;
  let lastEmit = 0;
  let overCap = false;
  const emit = (): void => {
    const now = Date.now();
    if (now - lastEmit < 100) return;
    lastEmit = now;
    onProgress?.({ phase: 'downloading', receivedBytes: received, totalBytes });
  };

  try {
    for (;;) {
      if (writeErr) throw writeErr;
      if (signal?.aborted) throw abortedError(signal);
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > maxBytes) {
        overCap = true;
        break;
      }
      const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      hash.update(chunk);
      // Backpressure: honor the write stream's drain signal, but race it against
      // 'error' so a failing write rejects instead of hanging on a 'drain' that
      // will never come. Each listener removes the OTHER so they don't
      // accumulate across many chunks (a MaxListeners leak on a big download).
      if (!out.write(chunk)) {
        await new Promise<void>((resolve, reject) => {
          const onDrain = (): void => {
            out.removeListener('error', onError);
            resolve();
          };
          const onError = (e: Error): void => {
            out.removeListener('drain', onDrain);
            reject(e);
          };
          out.once('drain', onDrain);
          out.once('error', onError);
        });
      }
      emit();
    }
    if (writeErr) throw writeErr;
  } catch (err) {
    // A body-stream error while the caller has aborted is a cancellation, not a
    // transport failure — surface it as ABORTED regardless of which read/write
    // step raised.
    if (signal?.aborted && !(err instanceof ModelFetchError)) throw abortedError(signal);
    throw err;
  } finally {
    await reader.cancel().catch(() => {});
    if (writeErr) {
      out.destroy();
    } else {
      await new Promise<void>((resolve, reject) => {
        out.once('error', reject);
        out.end((e?: NodeJS.ErrnoException | null) => (e ? reject(e) : resolve()));
      }).catch((e) => {
        writeErr = writeErr ?? (e as NodeJS.ErrnoException);
      });
    }
  }
  if (writeErr) throw writeErr;
  if (overCap) {
    throw new ModelFetchError('TOO_LARGE', `asset exceeds the ${maxBytes}-byte cap mid-stream`);
  }

  onProgress?.({ phase: 'verifying', receivedBytes: received, totalBytes: totalBytes || received });
  const got = hash.digest('hex');
  if (got !== expected) {
    throw new ModelFetchError('INTEGRITY_MISMATCH', 'integrity check failed', {
      expected,
      actual: got,
    });
  }
  return { bytes: received };
}

function abortedError(signal: AbortSignal): ModelFetchError {
  const reason = signal.reason;
  const detail = reason instanceof Error ? reason.message : reason ? String(reason) : 'aborted';
  return new ModelFetchError('ABORTED', `download aborted: ${detail}`);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function fileSize(p: string): Promise<number> {
  try {
    return (await stat(p)).size;
  } catch {
    return 0;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid-url';
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
