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

/** Only these hosts (and subdomains) are ever fetched — GitHub + its release
 *  asset CDN. The manifest's `bundleUrl` is signed, so it can't be repointed,
 *  but we host-check it anyway as defense in depth. */
const ALLOWED_HOSTS = [/^github\.com$/, /(^|\.)githubusercontent\.com$/, /^codeload\.github\.com$/];

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
  notes?: string;
  releaseUrl?: string;
}

/**
 * Fetch + verify the published manifest and compare it to the running version.
 * Never throws on a "no update" outcome (offline, 404, bad signature, same
 * version) — those return `available: false` so the UI stays quiet.
 */
export async function checkForUpdate(
  opts: {
    manifestUrl: string;
    currentVersion: string;
    publicKeyPem: string;
    shell: ShellInfo;
  },
  deps: StagerDeps = {},
): Promise<CheckResult> {
  const none: CheckResult = { available: false, latestVersion: null, compatible: false, manifest: null };
  const { manifestUrl, currentVersion, publicKeyPem, shell } = opts;
  if (!publicKeyPem || !isAllowedUpdateHost(manifestUrl)) return none;

  const fetchImpl = deps.fetchImpl ?? fetch;
  let text: string;
  try {
    const res = await fetchImpl(manifestUrl, { redirect: 'follow' });
    if (!res.ok) return none;
    text = await res.text();
  } catch {
    return none;
  }

  const manifest = parseManifest(text);
  if (!manifest) return none;
  if (!verifyManifestSignature(manifest, publicKeyPem)) return none;

  const newer = compareSemver(manifest.version, currentVersion) > 0;
  const result: CheckResult = {
    available: newer,
    latestVersion: manifest.version,
    compatible: isCompatible(manifest, shell),
    manifest: newer ? manifest : null,
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
    onProgress?: (p: Progress) => void;
  },
  deps: StagerDeps = {},
): Promise<{ version: string }> {
  const { userDataDir, manifest, publicKeyPem, onProgress } = opts;
  const report = onProgress ?? (() => {});

  if (!verifyManifestSignature(manifest, publicKeyPem)) {
    throw new Error('update manifest failed signature verification');
  }
  if (!isSafeVersion(manifest.version)) {
    throw new Error(`unsafe bundle version: ${manifest.version}`);
  }
  if (!isAllowedUpdateHost(manifest.bundleUrl)) {
    throw new Error('update bundle is not hosted on an allowed origin');
  }

  // 1. Download the gzipped bundle, streaming progress.
  report({ phase: 'download', message: 'Downloading…' });
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(manifest.bundleUrl, { redirect: 'follow' });
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
