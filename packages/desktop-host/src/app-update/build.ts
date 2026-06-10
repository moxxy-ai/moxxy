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
import { ESM_MARKER_PACKAGE_JSON } from './resolve.js';

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
  /**
   * The runner protocol version (`@moxxy/runner`'s `RUNNER_PROTOCOL_VERSION`)
   * this bundle's bundled client speaks. Stamped into the signed manifest so
   * the bootstrap can refuse to activate a JS bundle whose client would outrun
   * the reachable CLI's runner (the protocol-skew lockstep gate). Omit on
   * builds that predate the gate (treated as "no constraint").
   */
  runnerProtocol?: number;
  releaseUrl?: string;
  notes?: string;
}

export interface BuildOutput {
  manifest: AppManifest;
  manifestJson: string;
  bundleGz: Buffer;
}

export function buildAppBundle(input: BuildInput): BuildOutput {
  // The bootstrap loads the bundle's `dist-electron/main/index.js` as an ES
  // module (electron-vite emits it with `import` syntax). Node decides ESM-vs-CJS
  // from the nearest `package.json#type`, and a staged bundle under
  // `<userData>/app/<version>/` has NO package.json above its main — so without
  // this marker Node parses the ESM main as CommonJS and every override dies with
  // "Cannot use import statement outside a module", silently reverting to the
  // floor. Ship a minimal `type:module` marker at the bundle root (only if a
  // caller didn't already provide one) so the staged tree loads as ESM.
  const files: Record<string, Buffer> = { ...input.files };
  if (!files['package.json']) {
    files['package.json'] = Buffer.from(ESM_MARKER_PACKAGE_JSON, 'utf8');
  }

  // Per-file integrity map (sorted for a deterministic manifest + signing
  // payload): SHA-256 of each file's RAW bytes. Signed alongside the archive
  // hash so the stager AND the bootstrap can verify the extracted tree on disk
  // — the archive hash alone only protects the download, not what gets loaded.
  const filesB64: Record<string, string> = {};
  const fileHashes: Record<string, string> = {};
  // Plain code-unit sort (same as the canonicalizer's `.sort()`) — locale-aware
  // comparison would make the emitted manifest machine-dependent.
  for (const [rel, buf] of Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    filesB64[rel] = buf.toString('base64');
    fileHashes[rel] = createHash('sha256').update(buf).digest('hex');
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
    files: fileHashes,
    // Only stamped when supplied so a builder that hasn't wired the protocol
    // through still produces a byte-identical legacy manifest.
    ...(typeof input.runnerProtocol === 'number'
      ? { runnerProtocol: input.runnerProtocol }
      : {}),
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
