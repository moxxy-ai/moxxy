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
 * into the bootstrap. The signature covers the bundle's `sha256`, so verifying
 * the (tiny) manifest transitively authenticates the (large) bundle without
 * signing the bundle directly.
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
  /** SHA-256 (hex) of the gzipped bundle payload. */
  sha256: string;
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
 * Fields covered by the signature, in fixed order — the canonical signing
 * payload. The signature intentionally does NOT cover `releaseUrl`/`notes`
 * (presentational) but DOES cover `bundleUrl` + `sha256` (so neither the source
 * nor the payload can be swapped). Adding a security-relevant field means adding
 * it HERE — the signer and verifier share this one list.
 */
export const SIGNED_FIELDS = [
  'version',
  'minElectron',
  'nodeAbi',
  'sha256',
  'bundleUrl',
] as const;

type SignedField = (typeof SIGNED_FIELDS)[number];

/** Deterministic bytes the signature is computed/verified over. */
export function canonicalManifestBytes(m: Pick<AppManifest, SignedField>): Buffer {
  const ordered: Record<string, string> = {};
  for (const k of SIGNED_FIELDS) ordered[k] = String(m[k] ?? '');
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
  if (str(m.releaseUrl)) out.releaseUrl = m.releaseUrl;
  if (str(m.notes)) out.notes = m.notes;
  return out;
}
