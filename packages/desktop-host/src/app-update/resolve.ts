/**
 * The self-update GATE: given the desktop's writable userData, decide which app
 * bundle to run — a verified, user-installed override under
 * `<userData>/app/<version>/`, or null to mean "use the bundled floor".
 *
 * This runs inside the immutable bootstrap, so it is dependency-free (node
 * built-ins only) and fully SYNCHRONOUS — it must not delay process start. Every
 * failure mode (missing/poisoned/incompatible/unsigned/malformed/tampered)
 * resolves to `null`, i.e. fall back to the floor. A bundle is only ever
 * returned after its manifest's Ed25519 signature, version binding, and
 * Electron/ABI compatibility all pass — and, for manifests that carry a signed
 * per-file `files` map, after every listed file's sha256 matches the bytes on
 * disk. Legacy manifests (no `files` map) skip that last gate: their signature
 * only ever bound the gzipped download (checked by the stager), so their staged
 * tree is NOT re-verified at load time.
 *
 * On-disk layout under `<userData>/app/`:
 *   active.json        { version }       — the version the bootstrap should load
 *   bad.json           { versions: [] }  — versions poisoned by a failed boot
 *   last-attempt.json  { version, ts }   — breadcrumb written before loading an override
 *   confirmed.json     { version }       — last version that booted healthily
 *   <version>/         the extracted bundle (dist/ + dist-electron/ + manifest.json)
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { type AppManifest, parseManifest, verifyManifestSignature } from './manifest.js';

export interface ShellInfo {
  /** `process.versions.electron`. */
  electron: string;
  /** `process.versions.modules` — the Node ABI the shell provides. */
  nodeAbi: string;
}

export interface ResolvedBundle {
  /** Absolute bundle root (contains `dist/` + `dist-electron/`). */
  root: string;
  version: string;
}

/** A bundle version must be a safe path segment — no traversal, no separators —
 *  since it names a directory under userData and comes from on-disk state. */
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/;

export function isSafeVersion(v: string): boolean {
  return SAFE_VERSION.test(v) && !v.includes('..');
}

/** Reject any bundle-relative path that is absolute or escapes the bundle root.
 *  Single-sourced here for the stager's archive extraction AND the per-file
 *  integrity checks (both join these paths under a trusted root). */
export function safeRelPath(rel: string): string | null {
  if (!rel || rel.startsWith('/') || rel.includes('\\')) return null;
  const norm = path.posix.normalize(rel);
  if (norm.startsWith('..') || norm.startsWith('/') || path.posix.isAbsolute(norm)) return null;
  if (norm.split('/').some((seg) => seg === '..')) return null;
  return norm;
}

/** First failing entry of a signed per-file integrity check, for diagnostics. */
export interface FileIntegrityFailure {
  file: string;
  problem: 'unsafe-path' | 'missing' | 'mismatch';
}

/**
 * Verify a bundle tree against its manifest's signed `files` map: every listed
 * file must exist under `root` with the exact sha256. Returns the first failure,
 * or null when all entries check out. EXTRA on-disk files are deliberately
 * ignored — `manifest.json` (and, for legacy bundles, the stager's ESM-marker
 * safety-net) necessarily sit alongside the listed files, and an unlisted file
 * is never loaded by name the bootstrap trusts. Synchronous on purpose: it runs
 * in the bootstrap, and hashing a few MB of JS is cheap next to loading it.
 */
export function verifyBundleFiles(
  root: string,
  files: Record<string, string>,
): FileIntegrityFailure | null {
  for (const [rel, expected] of Object.entries(files)) {
    const safe = safeRelPath(rel);
    if (!safe) return { file: rel, problem: 'unsafe-path' };
    let data: Buffer;
    try {
      data = readFileSync(path.join(root, safe));
    } catch {
      return { file: rel, problem: 'missing' };
    }
    if (createHash('sha256').update(data).digest('hex') !== expected.toLowerCase()) {
      return { file: rel, problem: 'mismatch' };
    }
  }
  return null;
}

export function appUpdateDir(userDataDir: string): string {
  return path.join(userDataDir, 'app');
}
export function bundleRoot(userDataDir: string, version: string): string {
  return path.join(appUpdateDir(userDataDir), version);
}

/**
 * The minimal `package.json` that MUST sit at a staged bundle's root so Node
 * loads the bundle's ES-module `dist-electron/main/index.js` as ESM. A staged
 * bundle under `<userData>/app/<version>/` has no package.json above its main,
 * so without this Node parses the ESM main as CommonJS and the bootstrap's
 * `import()` throws "Cannot use import statement outside a module" — reverting
 * to the floor on every override. Single-sourced here so the producer
 * (`buildAppBundle`) and the stager safety-net can never disagree on it.
 */
export const ESM_MARKER_PACKAGE_JSON = `${JSON.stringify({ type: 'module' }, null, 2)}\n`;
const activePath = (d: string): string => path.join(appUpdateDir(d), 'active.json');
const badPath = (d: string): string => path.join(appUpdateDir(d), 'bad.json');
const breadcrumbPath = (d: string): string => path.join(appUpdateDir(d), 'last-attempt.json');
const confirmedPath = (d: string): string => path.join(appUpdateDir(d), 'confirmed.json');

function tryRead(p: string): string | null {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/** tmp-write + rename so a crash can't leave a half-written pointer. */
function writeJsonAtomic(p: string, value: unknown): void {
  mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, p);
}

export function readActiveVersion(userDataDir: string): string | null {
  const raw = tryRead(activePath(userDataDir));
  if (!raw) return null;
  try {
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof v === 'string' && isSafeVersion(v) ? v : null;
  } catch {
    return null;
  }
}

export function setActiveVersion(userDataDir: string, version: string): void {
  writeJsonAtomic(activePath(userDataDir), { version });
}

export function readBadVersions(userDataDir: string): Set<string> {
  const raw = tryRead(badPath(userDataDir));
  if (!raw) return new Set();
  try {
    const arr = (JSON.parse(raw) as { versions?: unknown }).versions;
    return new Set(Array.isArray(arr) ? arr.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Poison a version so it is never loaded again, and clear `active` if it points
 *  there (so the next launch falls straight through to the floor). */
export function markBad(userDataDir: string, version: string): void {
  const bad = readBadVersions(userDataDir);
  bad.add(version);
  writeJsonAtomic(badPath(userDataDir), { versions: [...bad] });
  if (readActiveVersion(userDataDir) === version) {
    try {
      rmSync(activePath(userDataDir), { force: true });
    } catch {
      /* best effort */
    }
  }
}

/** Clear a version's poison mark. Called when the user EXPLICITLY (re)installs
 *  that version, so a one-off failed boot — e.g. a slow first render that tripped
 *  the boot-probe, or a transient white-screen — can't wedge it as permanently
 *  unloadable: without this, the freshly re-staged copy is rejected by
 *  {@link resolveActiveBundle} on the very next launch and the app silently stays
 *  on the floor forever. The boot-probe still re-poisons the version if the fresh
 *  copy is genuinely broken, so this only ever grants ONE more attempt. */
export function unmarkBad(userDataDir: string, version: string): void {
  const bad = readBadVersions(userDataDir);
  if (!bad.delete(version)) return; // not poisoned → nothing to rewrite
  writeJsonAtomic(badPath(userDataDir), { versions: [...bad] });
}

export function writeBreadcrumb(userDataDir: string, version: string, now = Date.now()): void {
  writeJsonAtomic(breadcrumbPath(userDataDir), { version, ts: now });
}

export function readBreadcrumb(userDataDir: string): { version: string; ts: number } | null {
  const raw = tryRead(breadcrumbPath(userDataDir));
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { version?: unknown; ts?: unknown };
    if (typeof o.version === 'string' && typeof o.ts === 'number') {
      return { version: o.version, ts: o.ts };
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function markConfirmed(userDataDir: string, version: string): void {
  writeJsonAtomic(confirmedPath(userDataDir), { version });
}

export function readConfirmed(userDataDir: string): string | null {
  const raw = tryRead(confirmedPath(userDataDir));
  if (!raw) return null;
  try {
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** Numeric major.minor.patch compare (ignores any prerelease/build suffix). */
export function compareSemver(a: string, b: string): number {
  const parse = (s: string): number[] =>
    (s.split('-')[0] ?? '')
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** True iff the running shell satisfies the bundle's Electron + ABI floor. A
 *  false result means this update needs a NEW shell (Tier-2), not a JS swap. An
 *  empty manifest `nodeAbi` is a wildcard (skip the ABI check). */
export function isCompatible(m: AppManifest, shell: ShellInfo): boolean {
  if (compareSemver(shell.electron, m.minElectron) < 0) return false;
  return m.nodeAbi === '' || shell.nodeAbi === m.nodeAbi;
}

export interface ResolveOpts {
  userDataDir: string;
  /** Baked Ed25519 public key (SPKI PEM). Empty disables all overrides. */
  publicKeyPem: string;
  shell: ShellInfo;
}

/** Why {@link resolveActiveBundleDetailed} declined to load an override bundle.
 *  Logged to the boot-log so a silent fall-to-floor names its exact cause. */
export type ResolveRejectReason =
  | 'disabled' // no signing key baked → self-update off
  | 'no-active' // nothing staged
  | 'poisoned' // active version is on the bad list
  | 'manifest-missing' // no manifest.json under the bundle dir
  | 'manifest-malformed' // manifest failed shape checks
  | 'version-mismatch' // manifest.version ≠ active version
  | 'bad-signature' // Ed25519 verification failed
  | 'incompatible' // Electron/ABI floor not met (needs a shell update)
  | 'main-missing' // dist-electron/main/index.js absent on disk
  | 'file-tampered'; // a file in the signed `files` map is missing/modified on disk

export type ResolveResult =
  | { bundle: ResolvedBundle; reason?: undefined }
  | { bundle: null; reason: ResolveRejectReason };

/**
 * The gate, with the reject reason exposed for observability.
 *
 * Order matters — cheapest + most-decisive checks first, signature before any
 * trust is extended, the (hashing, hence priciest) per-file check last:
 *   key configured → active version is safe + not poisoned → manifest present,
 *   well-formed, and bound to the active version → signature valid →
 *   Electron/ABI compatible → real main exists on disk → every file in the
 *   signed `files` map matches its sha256 on disk (manifests that carry one;
 *   legacy manifests have no map and get no load-time file verification).
 */
export function resolveActiveBundleDetailed(opts: ResolveOpts): ResolveResult {
  const { userDataDir, publicKeyPem, shell } = opts;
  if (!publicKeyPem) return { bundle: null, reason: 'disabled' };

  const version = readActiveVersion(userDataDir);
  if (!version) return { bundle: null, reason: 'no-active' };
  if (readBadVersions(userDataDir).has(version)) return { bundle: null, reason: 'poisoned' };

  const root = bundleRoot(userDataDir, version);
  const manifestRaw = tryRead(path.join(root, 'manifest.json'));
  if (!manifestRaw) return { bundle: null, reason: 'manifest-missing' };
  const manifest = parseManifest(manifestRaw);
  if (!manifest) return { bundle: null, reason: 'manifest-malformed' };
  if (manifest.version !== version) return { bundle: null, reason: 'version-mismatch' };
  if (!verifyManifestSignature(manifest, publicKeyPem)) return { bundle: null, reason: 'bad-signature' };
  if (!isCompatible(manifest, shell)) return { bundle: null, reason: 'incompatible' };

  const mainEntry = path.join(root, 'dist-electron', 'main', 'index.js');
  if (!existsSync(mainEntry)) return { bundle: null, reason: 'main-missing' };

  // Load-time integrity: the archive sha256 only ever protected the DOWNLOAD;
  // this is what stops an unprivileged write under `<userData>/app/` from
  // pairing a genuine manifest with a tampered main. Signed-map-carrying
  // manifests only — a stripped map breaks the signature above, and legacy
  // manifests never had one to verify.
  if (manifest.files && verifyBundleFiles(root, manifest.files)) {
    return { bundle: null, reason: 'file-tampered' };
  }

  return { bundle: { root, version } };
}

/**
 * The gate. Returns the override bundle to load, or null to use the floor.
 * Thin wrapper over {@link resolveActiveBundleDetailed} that drops the reason.
 */
export function resolveActiveBundle(opts: ResolveOpts): ResolvedBundle | null {
  return resolveActiveBundleDetailed(opts).bundle;
}

export interface BootRecovery {
  /** A version poisoned because it was loaded but never confirmed healthy. */
  poisoned: string | null;
  /** The confirmed-good version `active` was rolled back to (if available). */
  rolledBackTo: string | null;
}

/**
 * Detect a bundle that loaded last launch but never reached a healthy render
 * (white-screen / async main crash) and poison it. The breadcrumb records the
 * version the bootstrap last *attempted*; the app writes `confirmed` only after
 * the renderer mounts. So `attempted === active && confirmed !== attempted`
 * means "it failed to boot" — poison it, and roll `active` back to the last
 * confirmed-good if that bundle is still installed.
 *
 * Gives a freshly-installed version exactly ONE chance (its breadcrumb is only
 * written when it's actually loaded), then auto-recovers on the next launch.
 * Runs in the bootstrap BEFORE {@link resolveActiveBundle}.
 */
export function recoverFromFailedBoot(userDataDir: string): BootRecovery {
  const crumb = readBreadcrumb(userDataDir);
  if (!crumb) return { poisoned: null, rolledBackTo: null };

  const active = readActiveVersion(userDataDir);
  const confirmed = readConfirmed(userDataDir);
  if (!active || active !== crumb.version || confirmed === crumb.version) {
    return { poisoned: null, rolledBackTo: null };
  }

  markBad(userDataDir, crumb.version); // also clears `active`
  if (
    confirmed &&
    confirmed !== crumb.version &&
    isSafeVersion(confirmed) &&
    !readBadVersions(userDataDir).has(confirmed) &&
    existsSync(path.join(bundleRoot(userDataDir, confirmed), 'manifest.json'))
  ) {
    setActiveVersion(userDataDir, confirmed);
    return { poisoned: crumb.version, rolledBackTo: confirmed };
  }
  return { poisoned: crumb.version, rolledBackTo: null };
}

/**
 * Drop installed bundle dirs except the ones in `keep` (typically the active +
 * previous-good). Never touches the floor (which lives in resources, not here)
 * and tolerates a partially-populated `app/` dir. Best-effort; runs at launch
 * before resolution.
 */
export function pruneBundles(userDataDir: string, keep: ReadonlyArray<string>): void {
  const dir = appUpdateDir(userDataDir);
  const keepSet = new Set(keep);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!isSafeVersion(name)) continue; // only ever remove version dirs
    if (keepSet.has(name)) continue;
    if (!existsSync(path.join(dir, name, 'manifest.json'))) continue; // not a bundle dir
    try {
      rmSync(path.join(dir, name), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

/** Installed bundle version dirs currently present under `<userData>/app/`
 *  (those with a `manifest.json`). Read-only — used by the diagnostics IPC.
 *  Tolerates a missing/partial `app/` dir. */
export function listStagedVersions(userDataDir: string): string[] {
  const dir = appUpdateDir(userDataDir);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => isSafeVersion(name) && existsSync(path.join(dir, name, 'manifest.json')))
    .sort((a, b) => compareSemver(a, b));
}
