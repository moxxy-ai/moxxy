/**
 * The download side of self-update: check the published manifest, then fetch,
 * verify, and atomically install a bundle under `<userData>/app/<version>/` so
 * the bootstrap can activate it on the next launch.
 *
 * Pure transport + crypto (node built-ins + global `fetch`) — no electron — so
 * it unit-tests with an injected `fetchImpl`. Authenticity is enforced twice:
 * here (so a bad download fails fast with a clear error) and authoritatively in
 * the bootstrap at load time. The signed manifest binds the bundle via its
 * `sha256`, and only allowlisted hosts are ever contacted.
 */

import { createHash } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { existsSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

import {
  type AppManifest,
  parseManifest,
  verifyManifestSignature,
} from './manifest.js';
import {
  type ShellInfo,
  appUpdateDir,
  bundleRoot,
  compareSemver,
  isCompatible,
  isSafeVersion,
  setActiveVersion,
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

export interface StagerDeps {
  fetchImpl?: typeof fetch;
}

export interface CheckResult {
  /** A newer, signature-valid bundle is published. */
  available: boolean;
  latestVersion: string | null;
  /** The running shell satisfies the bundle (false ⇒ a shell/Tier-2 update is needed). */
  compatible: boolean;
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

/**
 * Find the newest published `desktop-v*` release via the GitHub Releases API and
 * return its manifest + bundle asset URLs.
 *
 * Why the API and not `releases/latest/download/…`: GitHub's "latest release" is
 * the most recent published release of the WHOLE repo — in a monorepo that also
 * cuts `@moxxy/cli@x` npm releases, that's usually NOT the desktop, so the fixed
 * `releases/latest/...` URL 404s. We instead pick the highest `desktop-v*` tag.
 */
async function resolveDesktopRelease(
  repo: string,
  fetchImpl: typeof fetch,
): Promise<DesktopRelease | null> {
  const api = `https://api.github.com/repos/${repo}/releases?per_page=30`;
  if (!isAllowedUpdateHost(api)) return null;
  let releases: unknown;
  try {
    const res = await fetchImpl(api, {
      redirect: 'follow',
      // GitHub's API rejects requests without a User-Agent.
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'moxxy-desktop' },
    });
    if (!res.ok) return null;
    releases = await res.json();
  } catch {
    return null;
  }
  if (!Array.isArray(releases)) return null;

  const candidates = releases
    .filter(
      (r): r is { tag_name: string; assets: unknown } =>
        !!r &&
        typeof (r as { tag_name?: unknown }).tag_name === 'string' &&
        !(r as { draft?: unknown }).draft &&
        !(r as { prerelease?: unknown }).prerelease &&
        (r as { tag_name: string }).tag_name.startsWith(DESKTOP_TAG_PREFIX),
    )
    .map((r) => ({
      version: r.tag_name.slice(DESKTOP_TAG_PREFIX.length),
      assets: Array.isArray(r.assets) ? (r.assets as Array<{ name?: unknown; browser_download_url?: unknown }>) : [],
    }))
    .filter((r) => isSafeVersion(r.version))
    .sort((a, b) => compareSemver(a.version, b.version));

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
  if (manifestUrlOverride) {
    manifestUrl = manifestUrlOverride; // dev override — not host-pinned
  } else {
    const release = await resolveDesktopRelease(repo, fetchImpl);
    if (!release) return none('Could not find a published desktop release to update from.');
    manifestUrl = release.manifestUrl;
    bundleUrl = release.bundleUrl;
  }

  let text: string;
  try {
    const res = await fetchImpl(manifestUrl, { redirect: 'follow' });
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
  const result: CheckResult = {
    available: newer,
    latestVersion: manifest.version,
    compatible: isCompatible(manifest, shell),
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

/** Reject any archive path that is absolute or escapes the bundle root. */
function safeRelPath(rel: string): string | null {
  if (!rel || rel.startsWith('/') || rel.includes('\\')) return null;
  const norm = path.posix.normalize(rel);
  if (norm.startsWith('..') || norm.startsWith('/') || path.posix.isAbsolute(norm)) return null;
  if (norm.split('/').some((seg) => seg === '..')) return null;
  return norm;
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
  if (!isAllowedUpdateHost(downloadUrl)) {
    throw new Error('update bundle is not hosted on an allowed origin');
  }

  // 1. Download the gzipped bundle, streaming progress.
  report({ phase: 'download', message: 'Downloading…' });
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(downloadUrl, { redirect: 'follow' });
  if (!res.ok) throw new Error(`bundle download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || undefined;
  const gz = await readAll(res, total, (received) => report({ phase: 'download', received, total }));

  // 2. Integrity: the gzip's hash must equal the signed manifest's.
  report({ phase: 'verify', message: 'Verifying…' });
  const digest = createHash('sha256').update(gz).digest('hex');
  if (digest !== manifest.sha256) {
    throw new Error('bundle hash does not match the signed manifest');
  }

  // 3. Decode the bundle.
  let payload: BundlePayload;
  try {
    payload = JSON.parse(gunzipSync(gz).toString('utf8')) as BundlePayload;
  } catch {
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
    // Write the verified manifest LAST so a half-extracted dir never looks valid.
    writeFileSync(path.join(incoming, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // 5. Activate: swap the dir into place, then flip the active pointer.
    report({ phase: 'activate', message: 'Finishing…' });
    const finalRoot = bundleRoot(userDataDir, manifest.version);
    if (existsSync(finalRoot)) rmSync(finalRoot, { recursive: true, force: true });
    renameSync(incoming, finalRoot);
    setActiveVersion(userDataDir, manifest.version);
  } finally {
    if (existsSync(incoming)) rmSync(incoming, { recursive: true, force: true });
  }

  return { version: manifest.version };
}

/** Drain a fetch Response body into one Buffer, reporting cumulative bytes. */
async function readAll(
  res: Response,
  _total: number | undefined,
  onChunk: (received: number) => void,
): Promise<Buffer> {
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    onChunk(buf.length);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      const buf = Buffer.from(value);
      chunks.push(buf);
      received += buf.length;
      onChunk(received);
    }
  }
  return Buffer.concat(chunks);
}
