/**
 * Download + verify an installable desktop app's local assets.
 *
 * Some Apps-gallery apps need a one-time local asset fetch before first use —
 * the document anonymizer downloads an on-device NER model. That fetch is the
 * ONLY time the network is touched, runs in the MAIN process, and is gated
 * behind an explicit "Install" click. After install everything the app reads is
 * local, so its offline guarantee holds at use time.
 *
 * Kept free of any `electron` import (mirrors {@link ../loopback-server.ts}) so
 * it stays unit-testable in plain Node — the caller passes `appsRoot` (the
 * Electron `userData/moxxy-apps` dir) as a param.
 *
 * Security: every asset `dest` is a RELATIVE path resolved under the app's own
 * directory and confirmed (lexically AND via realpath) to stay inside it before
 * a single byte is written — the same path-traversal containment discipline as
 * {@link ../loopback-server.ts}. An absolute dest, a `..` segment, a NUL byte,
 * or a symlink that escapes the app dir is refused.
 *
 * Network egress is also locked down (mirrors the Tier-2 stager's
 * {@link ../app-update/stager.ts} `isAllowedUpdateHost` gate): every asset `url`
 * MUST be `https:` on an allow-listed host before a single byte is fetched (so a
 * future registry typo, a `file:`/`http:`/internal-host URL, or any other caller
 * can't turn this into an SSRF or local-file read), and each download is capped
 * at {@link MAX_ASSET_BYTES} so a hostile/buggy server can't fill the disk by
 * streaming an unbounded body.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { APP_ID_RE } from '@moxxy/desktop-app-sdk';
import type { AppInstallStatus, AppInstallProgress } from '@moxxy/desktop-ipc-contract';

/** One downloadable file of an app's install bundle. */
export interface AppAsset {
  /** Source URL fetched over the network (MAIN process only). */
  readonly url: string;
  /** Destination RELATIVE path under the app dir. No `..`, never absolute. */
  readonly dest: string;
  /** Expected size, when known (advisory only — Content-Length drives bars). */
  readonly bytes?: number;
  /** Optional integrity hash (hex sha256); verified post-download when set. */
  readonly sha256?: string;
}

/** The full install spec for one app. */
export interface AppInstallSpec {
  readonly id: string;
  /** Opaque version marker recorded in `installed.json`; a mismatch ⇒ stale. */
  readonly version: string;
  readonly assets: readonly AppAsset[];
  /** Hostnames this app may fetch its assets FROM (exact-or-subdomain match).
   *  Threads a discovered `manifest.install.allowedHosts` so each app's egress
   *  is explicit + auditable. Omitted ⇒ the global HF-only default applies. */
  readonly allowedHosts?: readonly string[];
}

/** Hosts an asset may be fetched FROM. Mirrors the Tier-2 updater's
 *  `ALLOWED_HOSTS` discipline: an exact-or-subdomain match so `huggingface.co`
 *  and its LFS CDN are admitted but `…huggingface.co.evil` is not. The registry
 *  only ships Hugging Face `resolve` URLs (which 30x-redirect to the HF CDN), so
 *  this is the closed set of origins the installer is ever expected to reach.
 *  Note: like the stager, the gate validates the INITIAL url only — a 30x to the
 *  HF CDN is allowed to follow (the redirect target is HF-operated); a hostile
 *  initial url can never reach the network at all. */
const ALLOWED_ASSET_HOSTS = [/(^|\.)huggingface\.co$/, /(^|\.)hf\.co$/];

/** Compile a list of bare hostnames into exact-or-subdomain matchers, matching
 *  {@link ALLOWED_ASSET_HOSTS}' discipline (so `huggingface.co` admits its
 *  subdomains/CDN but `…huggingface.co.evil` is refused). The hostname is
 *  regex-escaped so a `.` in a host can never act as a wildcard. Used to thread
 *  a per-app `manifest.install.allowedHosts` into the egress gate so no app
 *  inherits another's allow-list (and the global default stays HF-only). */
export function compileAllowedHosts(hosts: readonly string[]): RegExp[] {
  return hosts.map((h) => {
    const escaped = h.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\.)${escaped}$`);
  });
}

/** Hard ceiling on any single downloaded asset. The largest real asset is the
 *  ~109 MB quantised NER model; 512 MB leaves generous headroom while still
 *  bounding a hostile/buggy server that streams an unbounded body (disk-fill
 *  DoS). Tunable per call via {@link installApp}'s `maxAssetBytes`. */
export const MAX_ASSET_BYTES = 512 * 1024 * 1024;

/**
 * Whether `url` is a fetch target the installer may reach: `https:` on an
 * allow-listed host. Exported so the gate is unit-testable in isolation.
 *
 * `allowedHosts` is the compiled matcher set to test against — defaults to the
 * global HF-only {@link ALLOWED_ASSET_HOSTS}. The IPC layer threads a discovered
 * app's `manifest.install.allowedHosts` (via {@link compileAllowedHosts}) so a
 * per-app egress allow-list is enforced rather than every app inheriting the
 * global one.
 */
export function isAllowedAssetUrl(
  url: string,
  allowedHosts: readonly RegExp[] = ALLOWED_ASSET_HOSTS,
): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  return allowedHosts.some((re) => re.test(u.hostname));
}

/** Marker file written into an app's dir once every asset is present. */
const INSTALLED_MARKER = 'installed.json';

interface InstalledMarker {
  readonly version: string;
  readonly installedAt: number;
  readonly assets: readonly string[];
}

/** A `fetch`-compatible function. Defaults to the global `fetch` (Node 20+);
 *  tests inject a stub so no real network is touched. */
export type FetchLike = typeof fetch;

/**
 * Resolve an app's directory under `appsRoot`, asserting the id is a safe slug.
 * Exported so the asset protocol resolves the SAME dir for serving.
 */
export function appDir(appsRoot: string, appId: string): string {
  if (!APP_ID_RE.test(appId)) throw new Error(`invalid app id: ${JSON.stringify(appId)}`);
  return path.join(appsRoot, appId);
}

/**
 * Resolve an asset `dest` under `dir` and CONFIRM containment. Mirrors the
 * loopback server's discipline: reject NUL, reject absolute, then resolve and
 * verify the result is `dir` or a descendant of it (so `..` / encoded
 * traversal can never escape). Lexical check is the security boundary; a
 * realpath re-check (symlink-escape insurance) happens at write time.
 */
export function resolveAssetDest(dir: string, dest: string): string {
  if (typeof dest !== 'string' || dest.length === 0) throw new Error('empty asset dest');
  if (dest.includes('\0')) throw new Error('asset dest contains NUL');
  if (path.isAbsolute(dest)) throw new Error(`asset dest must be relative: ${JSON.stringify(dest)}`);
  const abs = path.resolve(dir, dest);
  if (abs !== dir && !abs.startsWith(dir + path.sep)) {
    throw new Error(`asset dest escapes app dir: ${JSON.stringify(dest)}`);
  }
  return abs;
}

/** Belt-and-braces symlink-escape re-check on a path that ALREADY passed the
 *  lexical containment check, against the app dir. No-op if realpath fails
 *  (the path may not exist yet — the lexical check above is authoritative). */
async function assertRealpathContained(dir: string, abs: string): Promise<void> {
  // Canonicalise the app dir once (macOS `/var` → `/private/var`, etc.) so the
  // comparison is like-for-like.
  let realDir: string;
  try {
    realDir = await realpath(dir);
  } catch {
    realDir = dir;
  }
  // The file's PARENT must canonicalise inside the app dir; the file itself may
  // not exist yet (we resolve the parent, which the caller mkdir'd).
  const parent = path.dirname(abs);
  try {
    const realParent = await realpath(parent);
    if (realParent !== realDir && !realParent.startsWith(realDir + path.sep)) {
      throw new Error(`asset path escapes app dir via symlink: ${abs}`);
    }
  } catch (e) {
    // Re-throw our own escape error; swallow a plain ENOENT (parent freshly
    // created, realpath race) and trust the lexical containment check.
    if (e instanceof Error && e.message.startsWith('asset path escapes')) throw e;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function readMarker(dir: string): Promise<InstalledMarker | null> {
  try {
    const raw = await readFile(path.join(dir, INSTALLED_MARKER), 'utf8');
    const parsed = JSON.parse(raw) as InstalledMarker;
    return parsed && typeof parsed.version === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** Compute the hex sha256 of a file by streaming it (constant memory). */
async function sha256File(p: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(p), hash);
  return hash.digest('hex');
}

/**
 * Report whether `spec`'s assets are fully installed under `appsRoot`.
 * 'installed' iff the marker exists, its `version` matches, AND every declared
 * asset file is present; anything else (no marker, stale version, a missing
 * file) reports 'not-installed' so a partial/aborted install re-installs.
 */
export async function appStatus(
  spec: AppInstallSpec,
  appsRoot: string,
): Promise<AppInstallStatus> {
  const dir = appDir(appsRoot, spec.id);
  const marker = await readMarker(dir);
  if (!marker || marker.version !== spec.version) {
    return { appId: spec.id, state: 'not-installed' };
  }
  for (const asset of spec.assets) {
    const abs = resolveAssetDest(dir, asset.dest);
    if (!(await fileExists(abs))) return { appId: spec.id, state: 'not-installed' };
  }
  return { appId: spec.id, state: 'installed', version: spec.version };
}

/** Sum the declared/known byte totals so the progress bar has a denominator
 *  before any Content-Length arrives. Falls back to 0 (indeterminate). */
function knownTotal(spec: AppInstallSpec): number {
  let total = 0;
  for (const a of spec.assets) total += a.bytes ?? 0;
  return total;
}

/**
 * Download + verify every asset of `spec` into `<appsRoot>/<id>/`, streaming
 * progress through `onProgress`. Idempotent: an asset already present with a
 * matching sha256 (or, when no hash is declared, simply present) is skipped, so
 * a re-run after a partial failure resumes rather than redownloads everything.
 *
 * Each asset streams to a `<dest>.partial` temp file then atomically `rename`s
 * into place, so a crash mid-download never leaves a truncated file masquerading
 * as complete. On success an `installed.json` marker is written; any failure
 * emits a final `phase:'error'` progress event and returns an `error` status.
 */
export async function installApp(
  spec: AppInstallSpec,
  appsRoot: string,
  onProgress: (p: AppInstallProgress) => void,
  fetchImpl: FetchLike = fetch,
  maxAssetBytes: number = MAX_ASSET_BYTES,
): Promise<AppInstallStatus> {
  const dir = appDir(appsRoot, spec.id);
  // Per-app egress allow-list (auditable, not inherited) — falls back to the
  // global HF-only default when the spec declares none.
  const allowedHosts = spec.allowedHosts?.length
    ? compileAllowedHosts(spec.allowedHosts)
    : ALLOWED_ASSET_HOSTS;
  // Sum of Content-Lengths discovered so far drives an honest total; seed it
  // with any declared `bytes` so the bar isn't 0/0 before the first response.
  let totalBytes = knownTotal(spec);
  let receivedBytes = 0;
  const emit = (
    phase: AppInstallProgress['phase'],
    extra: { file?: string; error?: string } = {},
  ): void => {
    onProgress({ appId: spec.id, phase, receivedBytes, totalBytes, ...extra });
  };
  // Throttle per-byte-chunk progress so a 100MB+ download doesn't flood the IPC
  // + WS bus with tens of thousands of events. Coalesce to ~10/sec; the
  // phase-transition emits (downloading-start, verifying, done, error) always
  // fire so the bar still snaps to each phase.
  let lastProgressAt = 0;
  const emitProgress = (file: string): void => {
    const now = Date.now();
    if (now - lastProgressAt < 100) return;
    lastProgressAt = now;
    emit('downloading', { file });
  };

  try {
    await mkdir(dir, { recursive: true });

    for (const asset of spec.assets) {
      const abs = resolveAssetDest(dir, asset.dest);
      // Skip an already-correct asset (idempotent re-run).
      if (await fileExists(abs)) {
        if (!asset.sha256 || (await sha256File(abs)) === asset.sha256.toLowerCase()) {
          // Count its bytes toward the running total so progress stays honest.
          try {
            receivedBytes += (await stat(abs)).size;
          } catch {
            /* ignore */
          }
          emit('downloading', { file: asset.dest });
          continue;
        }
      }

      // Egress allow-list: only https on an allow-listed host is ever fetched,
      // so a registry typo / injected url can never reach an arbitrary origin
      // (SSRF) or a local file. Checked BEFORE the network call.
      if (!isAllowedAssetUrl(asset.url, allowedHosts)) {
        throw new Error(`asset url is not on an allowed host: ${JSON.stringify(asset.url)}`);
      }

      await mkdir(path.dirname(abs), { recursive: true });
      await assertRealpathContained(dir, abs);

      const partial = `${abs}.partial`;
      // Any throw mid-asset (network drop, write error, end() flush error, hash
      // mismatch) MUST remove the temp file so a failed attempt never strands a
      // ~100MB orphan; the explicit over-cap/mismatch cleanups below are now
      // subsumed by this, kept only for the early `continue`-less paths.
      try {
        emit('downloading', { file: asset.dest });
        const res = await fetchImpl(asset.url);
        if (!res.ok || !res.body) {
          throw new Error(`download failed for ${asset.dest}: HTTP ${res.status}`);
        }
        // Parse Content-Length explicitly: a MISSING header (chunked HF CDN
        // responses) is NaN (skip the up-front cap; the streaming guard still
        // applies). An empty-string header is also treated as absent, not 0.
        const rawLen = res.headers.get('content-length');
        const len = rawLen == null || rawLen === '' ? NaN : Number(rawLen);
        // Reject an over-cap download up front when the server is honest about its
        // size (the streaming guard below still catches a lying / chunked server).
        if (Number.isFinite(len) && len > maxAssetBytes) {
          throw new Error(
            `asset ${asset.dest} exceeds the ${maxAssetBytes}-byte cap (content-length ${len})`,
          );
        }
        if (Number.isFinite(len) && len > 0) {
          // Replace this asset's advisory `bytes` contribution with the real one.
          totalBytes += len - (asset.bytes ?? 0);
        }

        const out = createWriteStream(partial);
        // A writable stream that emits 'error' with no listener throws as an
        // UNCAUGHT exception (fatal in the Electron main); and a mid-stream error
        // emits 'error', NOT 'drain', so a bare `out.once('drain')` wait would
        // hang the loop forever (ENOSPC/EIO/perm-revoke during a long download).
        // Capture the first write error and surface it on the next iteration /
        // drain wait so the loop bails deterministically.
        let writeErr: NodeJS.ErrnoException | null = null;
        out.on('error', (e: NodeJS.ErrnoException) => {
          writeErr = writeErr ?? e;
        });
        // Tee the stream so progress ticks as bytes land, then close it.
        const reader = res.body.getReader();
        let assetBytes = 0;
        let overCap = false;
        try {
          for (;;) {
            if (writeErr) throw writeErr;
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              assetBytes += value.byteLength;
              // Hard ceiling: a chunked / content-length-lying server can't stream
              // an unbounded body and fill the disk. Cancel the body and fail; the
              // (now bounded-at-cap) partial is removed below so the abort leaves
              // nothing large behind.
              if (assetBytes > maxAssetBytes) {
                overCap = true;
                await reader.cancel().catch(() => {});
                break;
              }
              receivedBytes += value.byteLength;
              // Backpressure: respect the write stream's drain signal, but race
              // it against 'error' so a failing write rejects instead of hanging
              // forever waiting for a 'drain' that will never come.
              if (!out.write(Buffer.from(value.buffer, value.byteOffset, value.byteLength))) {
                await new Promise<void>((resolve, reject) => {
                  out.once('drain', resolve);
                  out.once('error', reject);
                });
              }
              emitProgress(asset.dest);
            }
          }
          if (writeErr) throw writeErr;
        } finally {
          // Always release the body reader so a thrown error never leaks the
          // open response/socket.
          await reader.cancel().catch(() => {});
          if (writeErr) {
            // Stream already errored (and is destroyed); don't await `end()` — its
            // callback may never fire on a destroyed stream and would hang here.
            out.destroy();
          } else {
            // Flush + close, but race the close against a LATE 'error' (an open
            // failure / flush error that hasn't surfaced yet) so this can never
            // hang waiting for an `end` callback that won't fire on a stream that
            // is about to error.
            await new Promise<void>((resolve, reject) => {
              out.once('error', reject);
              out.end((err?: NodeJS.ErrnoException | null) =>
                err ? reject(err) : resolve(),
              );
            }).catch((e) => {
              writeErr = writeErr ?? (e as NodeJS.ErrnoException);
            });
          }
        }
        if (writeErr) throw writeErr;
        if (overCap) {
          throw new Error(`asset ${asset.dest} exceeds the ${maxAssetBytes}-byte cap mid-stream`);
        }

        if (asset.sha256) {
          emit('verifying', { file: asset.dest });
          const got = await sha256File(partial);
          if (got !== asset.sha256.toLowerCase()) {
            throw new Error(
              `integrity check failed for ${asset.dest}: expected ${asset.sha256}, got ${got}`,
            );
          }
        }

        // Atomic publish: a crash before this leaves only the `.partial`.
        await rename(partial, abs);
      } catch (assetErr) {
        // Remove the orphaned temp file before propagating, regardless of which
        // mid-asset step failed. force:true so an already-renamed/absent partial
        // is a no-op.
        await rm(partial, { force: true }).catch(() => {});
        throw assetErr;
      }
    }

    const marker: InstalledMarker = {
      version: spec.version,
      installedAt: Date.now(),
      assets: spec.assets.map((a) => a.dest),
    };
    await writeFile(path.join(dir, INSTALLED_MARKER), JSON.stringify(marker, null, 2), 'utf8');
    emit('done');
    return { appId: spec.id, state: 'installed', version: spec.version };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    emit('error', { error });
    return { appId: spec.id, state: 'error', error };
  }
}

/**
 * Remove an app's installed assets. `rm -rf` the app dir; reports
 * 'not-installed' (the post-condition) even if the dir was already absent.
 */
export async function uninstallApp(appId: string, appsRoot: string): Promise<AppInstallStatus> {
  const dir = appDir(appsRoot, appId);
  await rm(dir, { recursive: true, force: true });
  return { appId, state: 'not-installed' };
}
