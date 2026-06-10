/**
 * The app-bundle manifest: the small signed document that names a hot-updatable
 * desktop bundle, gates its compatibility, and binds it to a verified payload.
 *
 * This module is the root of the self-update trust model and is deliberately
 * dependency-free (node built-ins only) so it can be baked, verbatim, into the
 * immutable bootstrap (`apps/desktop/electron/main/bootstrap.ts`) AND reused by
 * the download-side stager — the same canonicalization + verification on both
 * the publisher and the loader.
 *
 * Trust chain: the manifest is Ed25519-signed by the release owner's private key
 * (the `MOXXY_UPDATE_SIGNING_KEY` CI secret); the matching public key is baked
 * into the bootstrap. The signature covers the bundle's `sha256` (the gzipped
 * archive, checked at download time) AND — for manifests that carry one — a
 * per-file `files` hash map, re-checked against the extracted tree at stage time
 * and again by the bootstrap at every load. Verifying the (tiny) manifest thus
 * transitively authenticates the (large) bundle without signing it directly.
 * Legacy manifests (no `files` map) predate the per-file map and are only
 * archive-hash-checked at download — NOT load-time-verified.
 */

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

export interface AppManifest {
  /** Bundle version — also the on-disk dir name under `<userData>/app/<version>`. */
  version: string;
  /** Minimum Electron version (semver `x.y.z`) the bundle's main needs. */
  minElectron: string;
  /** Required Node/Electron ABI (`process.versions.modules`) — guards native
   *  module skew. `''` is a wildcard ("any ABI"); the desktop's only native dep
   *  is optional + unpackaged, so Electron-version gating normally suffices. */
  nodeAbi: string;
  /**
   * The runner protocol version (`@moxxy/runner`'s `RUNNER_PROTOCOL_VERSION`)
   * the bundle's bundled client speaks. Stamped at build time. The bootstrap
   * REFUSES to activate a bundle whose `runnerProtocol` exceeds what the
   * reachable (pinned, bundled) CLI's runner can serve — otherwise a JS
   * hot-update would strand the desktop with a client newer than its runner
   * (the protocol-skew reconnect loop). Absent on legacy manifests, which
   * predate the field and are treated as "no constraint" (compatible by
   * construction with the CLI they shipped beside).
   */
  runnerProtocol?: number;
  /** SHA-256 (hex) of the gzipped bundle payload. */
  sha256: string;
  /** Per-file integrity map: bundle-relative POSIX path → SHA-256 (hex) of the
   *  RAW file bytes. Signed (see {@link canonicalManifestBytes}) and re-verified
   *  against the extracted tree at stage time AND at every load, so a tampered
   *  on-disk file can't ride a genuine manifest. Absent on legacy manifests,
   *  which are therefore not load-time-verified. */
  files?: Record<string, string>;
  /** Ed25519 signature (base64) over {@link canonicalManifestBytes}. */
  signature: string;
  /** HTTPS URL of the gzipped bundle asset. */
  bundleUrl: string;
  /** Human-facing release page (optional). */
  releaseUrl?: string;
  /** Short release notes shown in the Updates UI (optional). */
  notes?: string;
}

/**
 * Scalar fields covered by the signature, in fixed order — the spine of the
 * canonical signing payload. The signature intentionally does NOT cover
 * `releaseUrl`/`notes` (presentational) but DOES cover `bundleUrl` + `sha256`
 * (so neither the source nor the payload can be swapped) and — when present —
 * the per-file `files` map, which {@link canonicalManifestBytes} appends with
 * sorted keys. Adding a security-relevant field means adding it HERE (or, for
 * non-string fields, to the canonicalizer) — the signer and verifier share this
 * one serialization.
 */
export const SIGNED_FIELDS = [
  'version',
  'minElectron',
  'nodeAbi',
  'sha256',
  'bundleUrl',
] as const;

type SignedField = (typeof SIGNED_FIELDS)[number];

/**
 * Deterministic bytes the signature is computed/verified over.
 *
 * The `files` map and `runnerProtocol` are appended only when present (files
 * with sorted keys), so:
 *   - legacy manifests (no map / no runnerProtocol) keep verifying byte-for-byte
 *     as before, and
 *   - stripping either from (or adding either to) a signed manifest changes the
 *     canonical bytes and breaks the signature — a downgrade can't be forged.
 */
export function canonicalManifestBytes(
  m: Pick<AppManifest, SignedField> & Pick<AppManifest, 'files' | 'runnerProtocol'>,
): Buffer {
  const ordered: Record<string, unknown> = {};
  for (const k of SIGNED_FIELDS) ordered[k] = String(m[k] ?? '');
  if (m.files) {
    const files: Record<string, string> = {};
    for (const rel of Object.keys(m.files).sort()) files[rel] = String(m.files[rel] ?? '');
    ordered.files = files;
  }
  // Appended after `files` (stable key order) so a manifest that carries the
  // protocol stamp signs it too — a tampered/dropped stamp breaks the signature.
  if (typeof m.runnerProtocol === 'number') {
    ordered.runnerProtocol = String(m.runnerProtocol);
  }
  return Buffer.from(JSON.stringify(ordered), 'utf8');
}

/**
 * True iff `m.signature` is a valid Ed25519 signature over the canonical bytes
 * for `publicKeyPem` (an SPKI PEM). Returns false — never throws — on any
 * malformed key/signature so the caller can simply fall back to the floor.
 */
export function verifyManifestSignature(m: AppManifest, publicKeyPem: string): boolean {
  if (!publicKeyPem || !m.signature) return false;
  try {
    const key = createPublicKey(publicKeyPem);
    return cryptoVerify(null, canonicalManifestBytes(m), key, Buffer.from(m.signature, 'base64'));
  } catch {
    return false;
  }
}

const HEX64 = /^[0-9a-f]{64}$/i;

/** Parse + shape-check a manifest JSON string. Returns null on anything off so
 *  a corrupt/hostile manifest is treated as "no update", not a crash. */
export function parseManifest(json: string): AppManifest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  // nodeAbi may be '' (the wildcard: "any ABI") but must be a string.
  if (!str(m.version) || !str(m.minElectron) || typeof m.nodeAbi !== 'string') return null;
  if (!str(m.sha256) || !HEX64.test(m.sha256)) return null;
  if (!str(m.signature) || !str(m.bundleUrl)) return null;
  const out: AppManifest = {
    version: m.version,
    minElectron: m.minElectron,
    nodeAbi: m.nodeAbi as string,
    sha256: m.sha256.toLowerCase(),
    signature: m.signature,
    bundleUrl: m.bundleUrl,
  };
  // Optional per-file map: every entry must be path → 64-hex. Kept VERBATIM
  // (no re-casing/re-ordering) — the signature covers these exact strings.
  if (m.files !== undefined) {
    if (!m.files || typeof m.files !== 'object' || Array.isArray(m.files)) return null;
    const files: Record<string, string> = {};
    for (const [rel, hash] of Object.entries(m.files as Record<string, unknown>)) {
      if (!rel || typeof hash !== 'string' || !HEX64.test(hash)) return null;
      files[rel] = hash;
    }
    out.files = files;
  }
  // Optional runner-protocol stamp: a non-negative integer when present.
  if (m.runnerProtocol !== undefined) {
    if (typeof m.runnerProtocol !== 'number' || !Number.isInteger(m.runnerProtocol) || m.runnerProtocol < 0) {
      return null;
    }
    out.runnerProtocol = m.runnerProtocol;
  }
  if (str(m.releaseUrl)) out.releaseUrl = m.releaseUrl;
  if (str(m.notes)) out.notes = m.notes;
  return out;
}
