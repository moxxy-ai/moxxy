/**
 * The publisher side: turn a built `dist/` + `dist-electron/` tree into the two
 * release assets a client needs — the gzipped bundle payload and the signed
 * manifest that authenticates it.
 *
 * Pure (node built-ins only) and shared by the `scripts/build-app-bundle.mjs`
 * CLI and the integration test, so "what gets signed/produced" and "what the
 * stager + bootstrap verify" can never drift apart.
 */

import { createHash, createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { type AppManifest, canonicalManifestBytes } from './manifest.js';

export interface BuildInput {
  version: string;
  minElectron: string;
  /** `''` ⇒ ABI wildcard. */
  nodeAbi: string;
  /** Absolute HTTPS URL the bundle will be published at. */
  bundleUrl: string;
  /** Ed25519 PRIVATE key (PEM). */
  privateKeyPem: string;
  /** Bundle contents: dist-relative POSIX path → raw bytes. */
  files: Record<string, Buffer>;
  releaseUrl?: string;
  notes?: string;
}

export interface BuildOutput {
  manifest: AppManifest;
  manifestJson: string;
  bundleGz: Buffer;
}

export function buildAppBundle(input: BuildInput): BuildOutput {
  const filesB64: Record<string, string> = {};
  for (const [rel, buf] of Object.entries(input.files)) {
    filesB64[rel] = buf.toString('base64');
  }
  const payload = JSON.stringify({ version: input.version, files: filesB64 });
  const bundleGz = gzipSync(Buffer.from(payload, 'utf8'));
  const sha256 = createHash('sha256').update(bundleGz).digest('hex');

  const signed = {
    version: input.version,
    minElectron: input.minElectron,
    nodeAbi: input.nodeAbi,
    sha256,
    bundleUrl: input.bundleUrl,
  };
  const signature = cryptoSign(
    null,
    canonicalManifestBytes(signed),
    createPrivateKey(input.privateKeyPem),
  ).toString('base64');

  const manifest: AppManifest = { ...signed, signature };
  if (input.releaseUrl) manifest.releaseUrl = input.releaseUrl;
  if (input.notes) manifest.notes = input.notes;

  return { manifest, manifestJson: JSON.stringify(manifest, null, 2), bundleGz };
}
