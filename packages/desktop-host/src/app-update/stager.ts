/**
 * The download side of self-update: check the published manifest, then fetch,
 * verify, and atomically install a bundle under `<userData>/app/<version>/` so
 * the bootstrap can activate it on the next launch.
 *
 * Pure transport + crypto (node built-ins + global `fetch`) — no electron — so
 * it unit-tests with an injected `fetchImpl`. Integrity model: the signed
 * manifest binds the gzipped DOWNLOAD via `sha256` (checked here, before
 * extraction) and — for manifests that carry a signed per-file `files` map —
 * binds every extracted file by hash, checked here after extraction (so a bad
 * stage fails fast, before activation) and again by the bootstrap at every
 * load. Legacy manifests have no `files` map, so for them only the download
 * hash is ever verified — their staged tree is NOT re-checked at load time.
 * Only allowlisted hosts are ever contacted.
 */

import { createHash } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { existsSync, mkdirSync, writeFileSync, renameSync, rmSync, cpSync } from 'node:fs';
import path from 'node:path';

import {
  type AppManifest,
  parseManifest,
  verifyManifestSignature,
} from './manifest.js';
import {
  type ShellInfo,
  ESM_MARKER_PACKAGE_JSON,
  appUpdateDir,
  bundleRoot,
  compareSemver,
  exceedsCliRunnerProtocol,
  isCompatible,
  isSafeVersion,
  safeRelPath,
  setActiveVersion,
  unmarkBad,
  verifyBundleFiles,
} from './resolve.js';

/** Only these hosts (and subdomains) are ever fetched — GitHub's API, web, and
 *  release-asset CDN. `(^|\.)github\.com$` covers both `github.com` and
 *  `api.github.com` (the releases API) without admitting `…github.com.evil`. */
const ALLOWED_HOSTS = [/(^|\.)github\.com$/, /(^|\.)githubusercontent\.com$/];

export function isAllowedUpdateHost(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/** Per-request network timeout. A hung connection (no bytes, half-open socket)
 *  must not wedge an in-flight update forever — abort and surface a real error. */
const FETCH_TIMEOUT_MS = 60_000;
/** Cap how many redirect hops we manually follow. Bounds work and stops a
 *  redirect loop from spinning forever. */
const MAX_REDIRECTS = 5;
/** Hard ceiling on a downloaded bundle, well above any real release (current
 *  bundles are a few MB; even the largest plausible dist tree is far under
 *  this). A response that streams past it — chunked with no content-length, or
 *  steered to a hostile host — is aborted before it can OOM the process. */
const MAX_BUNDLE_BYTES = 512 * 1024 * 1024;
/** Mirror of {@link MAX_BUNDLE_BYTES} for the inflated payload: a hash-matching
 *  but pathological gzip (signing-key compromise / builder bug) can't be allowed
 *  to inflate without bound. */
const MAX_INFLATED_BYTES = 1024 * 1024 * 1024;

/**
 * `fetch` that enforces the host allowlist on EVERY hop. The platform `fetch`
 * with `redirect:'follow'` only validates the URL we hand it, never the 302
 * targets — GitHub release-asset downloads redirect to object-store hostnames
 * outside the allowlist, so the SSRF/privacy boundary ("only allowlisted hosts
 * are ever contacted") would silently stop holding past the first hop. We follow
 * manually with `redirect:'manual'` and re-run {@link isAllowedUpdateHost} on
 * each `Location` before refetching. Also wires an AbortController timeout so a
 * hung connection can't wedge the update.
 */
async function fetchAllowed(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedUpdateHost(current)) {
      throw new Error('update host is not on an allowed origin');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetchImpl(current, { ...init, redirect: 'manual', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    // A `redirect:'manual'` response surfaces 3xx as an opaque/`type:'opaqueredirect'`
    // response or a normal 3xx with a `Location`. Some test/polyfill fetches
    // ignore `redirect:'manual'` and pre-follow; in that case status is 2xx and
    // there is no Location, so we return it (the final URL was the allowlisted
    // one we asked for).
    const status = res.status;
    const isRedirect = res.type === 'opaqueredirect' || (status >= 300 && status < 400);
    if (!isRedirect) return res;
    const location = res.headers.get('location');
    if (!location) {
      // Opaque redirect with no readable target — can't re-validate, so refuse
      // rather than blindly follow.
      throw new Error('update redirect target could not be validated');
    }
    current = new URL(location, current).toString();
  }
  throw new Error('too many update redirects');
}

/** Like {@link fetchAllowed} but WITHOUT the host allowlist — only the timeout.
 *  For the dev/test manifest override, which is intentionally off-allowlist (it
 *  is only ever forwarded on an unpackaged build) but must still bound a hung
 *  connection. */
async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, redirect: 'follow', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface StagerDeps {
  fetchImpl?: typeof fetch;
}

export interface CheckResult {
  /** A newer, signature-valid bundle is published. */
  available: boolean;
  latestVersion: string | null;
  /** The running shell satisfies the bundle (false ⇒ a shell/Tier-2 update is needed). */
  compatible: boolean;
  /** True ⇒ the bundle's signed `runnerProtocol` outruns the CLI the desktop
   *  can spawn: a hot-update would be staged but REFUSED at every boot
   *  (`runner-protocol-skew`), so this update needs the full app installer
   *  (Tier-2). Only computed when the caller supplies `cliRunnerProtocol`. */
  requiresFullUpdate?: boolean;
  manifest: AppManifest | null;
  /** Where to download the bundle — the discovered release asset URL (preferred
   *  over the manifest's signed `bundleUrl`, which integrity-binds via sha256). */
  bundleUrl?: string;
  notes?: string;
  releaseUrl?: string;
  /** Set when the check itself FAILED (offline, 404, bad signature, …) — distinct
   *  from a successful "you're up to date" (available:false, no error). Without
   *  this every failure masquerades as up-to-date. */
  error?: string;
}

/** The newest published `desktop-v*` release + the asset URLs the updater needs. */
interface DesktopRelease {
  version: string;
  manifestUrl: string;
  bundleUrl?: string;
}

const DESKTOP_TAG_PREFIX = 'desktop-v';
/** Cap how many release pages we walk: bounds the work when a repo has a very
 *  long release history and no desktop-v* tag is published. 3 × per_page=100 =
 *  300 releases of headroom. */
const MAX_RELEASE_PAGES = 3;

interface DesktopCandidate {
  version: string;
  assets: Array<{ name?: unknown; browser_download_url?: unknown }>;
}

/** Parse a GitHub `Link` header and return the `rel="next"` URL, if any. */
function nextLink(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (m) return m[1];
  }
  return undefined;
}

/**
 * Find the newest published `desktop-v*` release via the GitHub Releases API and
 * return its manifest + bundle asset URLs.
 *
 * Why the API and not `releases/latest/download/…`: GitHub's "latest release" is
 * the most recent published release of the WHOLE repo — in a monorepo that also
 * cuts `@moxxy/cli@x` npm releases, that's usually NOT the desktop, so the fixed
 * `releases/latest/...` URL 404s. We instead pick the highest `desktop-v*` tag.
 *
 * We page with `per_page=100` and follow `Link: rel="next"` up to
 * {@link MAX_RELEASE_PAGES} so a burst of newer non-desktop releases (frequent
 * `@moxxy/cli` npm cuts) can't bury the latest `desktop-v*` below the first page
 * and make a real update masquerade as "no release found". Releases come back
 * newest-first, so once a page yields ANY `desktop-v*` candidate we stop paging:
 * a later page can only hold older tags.
 */
async function resolveDesktopRelease(
  repo: string,
  fetchImpl: typeof fetch,
): Promise<DesktopRelease | null> {
  let url: string | undefined = `https://api.github.com/repos/${repo}/releases?per_page=100`;
  const candidates: DesktopCandidate[] = [];
  for (let page = 0; page < MAX_RELEASE_PAGES && url; page++) {
    if (!isAllowedUpdateHost(url)) return null;
    let releases: unknown;
    let linkHeader: string | null;
    try {
      const res = await fetchAllowed(fetchImpl, url, {
        // GitHub's API rejects requests without a User-Agent.
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'moxxy-desktop' },
      });
      if (!res.ok) return null;
      linkHeader = res.headers.get('link');
      releases = await res.json();
    } catch {
      return null;
    }
    if (!Array.isArray(releases)) return null;

    const before = candidates.length;
    for (const r of releases) {
      if (
        !!r &&
        typeof (r as { tag_name?: unknown }).tag_name === 'string' &&
        !(r as { draft?: unknown }).draft &&
        !(r as { prerelease?: unknown }).prerelease &&
        (r as { tag_name: string }).tag_name.startsWith(DESKTOP_TAG_PREFIX)
      ) {
        const version = (r as { tag_name: string }).tag_name.slice(DESKTOP_TAG_PREFIX.length);
        if (!isSafeVersion(version)) continue;
        candidates.push({
          version,
          assets: Array.isArray((r as { assets?: unknown }).assets)
            ? ((r as { assets: Array<{ name?: unknown; browser_download_url?: unknown }> }).assets)
            : [],
        });
      }
    }
    // Newest-first ordering: a page that produced a candidate has the newest
    // desktop-v* on it, so no later page can beat it — stop walking.
    if (candidates.length > before) break;
    url = nextLink(linkHeader);
  }

  // Sort newest-LAST. compareSemver returns 0 for same-core tags that differ only
  // in their build/prerelease suffix, so add a deterministic tie-break (tag
  // compare) — otherwise two equal-core tags order unspecified and "the highest"
  // isn't stable across runs.
  candidates.sort((a, b) => compareSemver(a.version, b.version) || (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
  const latest = candidates[candidates.length - 1];
  if (!latest) return null;

  const assetUrl = (name: string): string | undefined => {
    const a = latest.assets.find((x) => x && x.name === name && typeof x.browser_download_url === 'string');
    return a?.browser_download_url as string | undefined;
  };
  const manifestUrl = assetUrl('moxxy-app-manifest.json');
  if (!manifestUrl || !isAllowedUpdateHost(manifestUrl)) return null;

  const out: DesktopRelease = { version: latest.version, manifestUrl };
  const bundleUrl = assetUrl(`moxxy-app-bundle-${latest.version}.json.gz`);
  if (bundleUrl && isAllowedUpdateHost(bundleUrl)) out.bundleUrl = bundleUrl;
  return out;
}

/**
 * Discover the latest desktop release, fetch + verify its manifest, and compare
 * to the running version. Returns `available:false` for a genuine no-update, and
 * `available:false` WITH an `error` when the check itself failed — so a 404 /
 * offline / bad-signature can no longer masquerade as "up to date".
 *
 * `manifestUrlOverride` (dev/test only — the IPC handler passes it only when the
 * app is NOT packaged) fetches a manifest directly and skips API discovery.
 */
export async function checkForUpdate(
  opts: {
    repo: string;
    currentVersion: string;
    publicKeyPem: string;
    shell: ShellInfo;
    /** Runner protocol the spawnable (floor) CLI speaks — same ceiling the boot
     *  gate enforces. Supplying it lets the check flag a bundle the bootstrap
     *  would refuse (`requiresFullUpdate`) BEFORE anything is staged. Omit to
     *  skip the gate (legacy callers / tests that don't model the CLI). */
    cliRunnerProtocol?: number;
    manifestUrlOverride?: string;
  },
  deps: StagerDeps = {},
): Promise<CheckResult> {
  const none = (error?: string): CheckResult => ({
    available: false,
    latestVersion: null,
    compatible: false,
    manifest: null,
    ...(error ? { error } : {}),
  });
  const { repo, currentVersion, publicKeyPem, shell, manifestUrlOverride } = opts;
  if (!publicKeyPem) return none('Automatic updates are not configured for this build.');

  const fetchImpl = deps.fetchImpl ?? fetch;

  let manifestUrl: string;
  let bundleUrl: string | undefined;
  // The discovered (prod) manifest URL is allowlist-pinned on every hop; the
  // dev/test override is intentionally off-allowlist (the IPC gate only forwards
  // it on an unpackaged build), but still require https so it can't be silently
  // downgraded to http even in dev.
  let pinManifestHost = true;
  if (manifestUrlOverride) {
    if (!/^https:\/\//i.test(manifestUrlOverride)) {
      return none('The update manifest URL must use https.');
    }
    manifestUrl = manifestUrlOverride;
    pinManifestHost = false;
  } else {
    const release = await resolveDesktopRelease(repo, fetchImpl);
    if (!release) return none('Could not find a published desktop release to update from.');
    manifestUrl = release.manifestUrl;
    bundleUrl = release.bundleUrl;
  }

  let text: string;
  try {
    const res = pinManifestHost
      ? await fetchAllowed(fetchImpl, manifestUrl)
      : await fetchWithTimeout(fetchImpl, manifestUrl);
    if (!res.ok) return none(`Update manifest not reachable (HTTP ${res.status}).`);
    text = await res.text();
  } catch {
    return none('Could not reach the update server.');
  }

  const manifest = parseManifest(text);
  if (!manifest) return none('The update manifest was malformed.');
  if (!verifyManifestSignature(manifest, publicKeyPem)) {
    return none('The update manifest failed signature verification.');
  }

  const newer = compareSemver(manifest.version, currentVersion) > 0;
  // Mirror the boot gate at CHECK time: a bundle whose runner protocol outruns
  // the spawnable CLI would stage fine but be rejected on every launch
  // (`runner-protocol-skew`) — report it as needing the full installer instead
  // of letting the flow claim a success that can never take effect.
  const requiresFullUpdate = exceedsCliRunnerProtocol(manifest, opts.cliRunnerProtocol);
  const result: CheckResult = {
    available: newer,
    latestVersion: manifest.version,
    compatible: isCompatible(manifest, shell) && !requiresFullUpdate,
    ...(requiresFullUpdate ? { requiresFullUpdate } : {}),
    manifest: newer ? manifest : null,
    // Prefer the discovered release asset URL; fall back to the (signed) one.
    bundleUrl: bundleUrl ?? manifest.bundleUrl,
  };
  if (manifest.notes) result.notes = manifest.notes;
  if (manifest.releaseUrl) result.releaseUrl = manifest.releaseUrl;
  return result;
}

export type ProgressPhase = 'download' | 'verify' | 'extract' | 'activate';
export interface Progress {
  phase: ProgressPhase;
  received?: number;
  total?: number;
  message?: string;
}

interface BundlePayload {
  version: string;
  files: Record<string, string>;
}

/**
 * Download → integrity-check → extract → atomically install. Throws (with a
 * human-readable message the UI surfaces) on any failure; on success the bundle
 * is installed and marked active, ready for the next launch.
 */
export async function downloadAndStage(
  opts: {
    userDataDir: string;
    manifest: AppManifest;
    publicKeyPem: string;
    /** Where to fetch the bundle (the discovered release asset URL). Defaults to
     *  the manifest's signed `bundleUrl`. Integrity is bound by `sha256` either
     *  way, so a stale/wrong signed `bundleUrl` doesn't compromise safety. */
    bundleUrl?: string;
    /** Runner protocol the spawnable (floor) CLI speaks. When supplied, a
     *  bundle whose signed `runnerProtocol` exceeds it is refused HERE —
     *  staging it would only produce a "updated, relaunch" that the boot gate
     *  silently rejects (`runner-protocol-skew`) on every launch. */
    cliRunnerProtocol?: number;
    onProgress?: (p: Progress) => void;
  },
  deps: StagerDeps = {},
): Promise<{ version: string }> {
  const { userDataDir, manifest, publicKeyPem, onProgress } = opts;
  const report = onProgress ?? (() => {});
  const downloadUrl = opts.bundleUrl ?? manifest.bundleUrl;

  if (!verifyManifestSignature(manifest, publicKeyPem)) {
    throw new Error('update manifest failed signature verification');
  }
  if (!isSafeVersion(manifest.version)) {
    throw new Error(`unsafe bundle version: ${manifest.version}`);
  }
  // Stage-time mirror of the bootstrap's runner-protocol lockstep gate (checked
  // AFTER the signature so the stamp is trusted): refuse before any download
  // rather than activate a bundle every subsequent boot will refuse.
  if (exceedsCliRunnerProtocol(manifest, opts.cliRunnerProtocol)) {
    throw new Error(
      'this update changes the runner protocol and needs the full app installer — a hot-update would be refused at startup',
    );
  }
  if (!isAllowedUpdateHost(downloadUrl)) {
    throw new Error('update bundle is not hosted on an allowed origin');
  }

  // 1. Download the gzipped bundle, streaming progress. The allowlist is
  // re-checked on EVERY redirect hop (object-store 302s leave github.com), and a
  // timeout bounds a hung connection.
  report({ phase: 'download', message: 'Downloading…' });
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchAllowed(fetchImpl, downloadUrl);
  if (!res.ok) throw new Error(`bundle download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || undefined;
  // Reject a declared-oversize download before reading a single byte.
  if (typeof total === 'number' && total > MAX_BUNDLE_BYTES) {
    throw new Error('update bundle is larger than the maximum allowed size');
  }
  const gz = await readAll(
    res,
    (received) => report({ phase: 'download', received, total }),
    MAX_BUNDLE_BYTES,
  );
  // Reconcile the bar with the bytes actually received: a chunked / proxy-
  // stripped response has no content-length (total undefined → indeterminate
  // bar), and a transport-compressed content-length can differ from the
  // decoded byte count, leaving the bar short of 100%. A final event with
  // total === received lands it at 100% exactly. Integrity is sha256-bound,
  // so this is cosmetic only.
  report({ phase: 'download', received: gz.length, total: gz.length });

  // 2. Integrity: the gzip's hash must equal the signed manifest's.
  report({ phase: 'verify', message: 'Verifying…' });
  const digest = createHash('sha256').update(gz).digest('hex');
  if (digest !== manifest.sha256) {
    throw new Error('bundle hash does not match the signed manifest');
  }

  // 3. Decode the bundle. Bound the inflate so a hash-matching but pathological
  // archive (signing-key compromise / builder bug) can't OOM where a bounded
  // inflate fails cleanly — gunzipSync throws RangeError past maxOutputLength.
  let payload: BundlePayload;
  try {
    payload = JSON.parse(
      gunzipSync(gz, { maxOutputLength: MAX_INFLATED_BYTES }).toString('utf8'),
    ) as BundlePayload;
  } catch (e) {
    if (e instanceof RangeError) throw new Error('bundle payload too large');
    throw new Error('bundle payload is corrupt');
  }
  if (payload.version !== manifest.version || !payload.files || typeof payload.files !== 'object') {
    throw new Error('bundle payload does not match its manifest');
  }

  // 4. Extract into a fresh incoming dir (never write in place).
  report({ phase: 'extract', message: 'Installing…' });
  const dir = appUpdateDir(userDataDir);
  mkdirSync(dir, { recursive: true });
  const incoming = path.join(dir, `${manifest.version}.incoming-${randomBytes(6).toString('hex')}`);
  try {
    mkdirSync(incoming, { recursive: true });
    for (const [rel, b64] of Object.entries(payload.files)) {
      const safe = safeRelPath(rel);
      if (!safe) throw new Error(`unsafe path in bundle: ${rel}`);
      const dest = path.join(incoming, safe);
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, Buffer.from(b64, 'base64'));
    }
    // Guarantee the staged tree loads as ESM even for bundles produced before
    // `buildAppBundle` started shipping the marker (e.g. an already-published
    // release): the real main is ES-module syntax and nothing above it declares
    // `type:module`, so without this Node parses it as CommonJS and the bootstrap
    // can never load the override ("Cannot use import statement outside a
    // module"). Skip if the bundle already carries its own package.json.
    const pkgJsonPath = path.join(incoming, 'package.json');
    if (!existsSync(pkgJsonPath)) writeFileSync(pkgJsonPath, ESM_MARKER_PACKAGE_JSON);

    // Defense in depth: re-verify the signed per-file hashes against what
    // actually landed on disk, so a payload/manifest mismatch (e.g. a build
    // pipeline signing the wrong tree) is caught HERE with a clear error and
    // nothing activated — the bootstrap repeats the same check at load time.
    if (manifest.files) {
      const failure = verifyBundleFiles(incoming, manifest.files);
      if (failure) {
        throw new Error(`staged file failed integrity check: ${failure.file} (${failure.problem})`);
      }
    }

    // Write the verified manifest LAST so a half-extracted dir never looks valid.
    writeFileSync(path.join(incoming, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // 5. Activate: swap the dir into place, then flip the active pointer.
    report({ phase: 'activate', message: 'Finishing…' });
    const finalRoot = bundleRoot(userDataDir, manifest.version);
    if (existsSync(finalRoot)) rmSync(finalRoot, { recursive: true, force: true });
    movePopulatedDir(incoming, finalRoot);
    setActiveVersion(userDataDir, manifest.version);
    // The user explicitly chose to install this version — clear any prior poison
    // mark so a one-off failed boot can't leave it permanently unloadable (the
    // freshly-staged copy would otherwise be rejected as `bad` on the next launch
    // and the app would silently stay on the floor). The boot-probe re-poisons it
    // if this copy is genuinely broken, so this grants exactly one fresh attempt.
    unmarkBad(userDataDir, manifest.version);
  } finally {
    if (existsSync(incoming)) rmSync(incoming, { recursive: true, force: true });
  }

  return { version: manifest.version };
}

/** Drain a fetch Response body into one Buffer, reporting cumulative bytes and
 *  aborting once `maxBytes` is exceeded — a chunked / no-content-length response
 *  must not grow the buffer without bound (OOM DoS). */
async function readAll(
  res: Response,
  onChunk: (received: number) => void,
  maxBytes: number,
): Promise<Buffer> {
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('update bundle exceeded the maximum allowed size');
    onChunk(buf.length);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        const buf = Buffer.from(value);
        received += buf.length;
        if (received > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error('update bundle exceeded the maximum allowed size');
        }
        chunks.push(buf);
        onChunk(received);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

/** Move a fully-populated incoming dir onto `finalRoot`. `renameSync` is atomic
 *  on the same filesystem (the normal case — both live under `<userData>/app/`),
 *  but a relocated/network-redirected userData can land them on different devices
 *  where rename throws EXDEV. Fall back to a recursive copy + remove so a staged
 *  install isn't a silent dead-end. The caller's `finally` rmSyncs any leftover
 *  `incoming`. */
function movePopulatedDir(incoming: string, finalRoot: string): void {
  try {
    renameSync(incoming, finalRoot);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'EXDEV') throw e;
    cpSync(incoming, finalRoot, { recursive: true });
    rmSync(incoming, { recursive: true, force: true });
  }
}
