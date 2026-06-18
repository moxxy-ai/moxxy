#!/usr/bin/env node
/**
 * Produce the two desktop self-update release assets from the freshly-built
 * renderer + main:
 *
 *   moxxy-app-bundle-<version>.json.gz   the gzipped {version, files:{path:b64}}
 *   moxxy-app-manifest.json              the Ed25519-signed manifest
 *
 * "App bundle" = everything the immutable bootstrap LOADS — all of
 * `apps/desktop/dist/` (renderer) + `apps/desktop/dist-electron/` (real main +
 * preload), MINUS the bootstrap itself and sourcemaps. Shipped + activated as
 * one unit so renderer/main/IPC always move together (skew-free protocol
 * changes). Signed with the release owner's Ed25519 private key so the client
 * only ever loads bundles it can authenticate.
 *
 * Run AFTER `pnpm build` (needs @moxxy/desktop-host/dist + apps/desktop/dist*).
 *
 * Env:
 *   MOXXY_UPDATE_SIGNING_KEY   (required) Ed25519 PRIVATE key PEM
 *   MOXXY_BUNDLE_BASE_URL      base of the published asset URLs
 *                              (default: GitHub latest-release download URL)
 *   MOXXY_RELEASE_URL          human release page (default: latest release)
 *   MOXXY_BUNDLE_MIN_ELECTRON  override min Electron (default: <major>.0.0)
 *   MOXXY_BUNDLE_NODE_ABI      required Electron ABI, '' = any (default: '')
 *   MOXXY_BUNDLE_NOTES         short release notes for the Updates UI
 *   MOXXY_BUNDLE_OUT_DIR       output dir (default: apps/desktop/release/update)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Built output of the shared, tested builder — same code the integration test
// and (transitively) the client verifier use, so producer + consumer can't drift.
import { buildAppBundle } from '../packages/desktop-host/dist/app-update/index.js';
// The runner protocol the bundle's bundled client speaks — stamped into the
// signed manifest so the bootstrap's lockstep gate can refuse a JS hot-update
// whose client would outrun the pinned CLI's runner.
import { RUNNER_PROTOCOL_VERSION } from '../packages/runner/dist/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopDir = path.join(repoRoot, 'apps', 'desktop');

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** Walk a dir, returning dist-relative POSIX paths of every file under it. */
function walk(absDir, relPrefix, out) {
  for (const name of readdirSync(absDir)) {
    const abs = path.join(absDir, name);
    const rel = `${relPrefix}/${name}`;
    if (statSync(abs).isDirectory()) walk(abs, rel, out);
    else out.push(rel);
  }
  return out;
}

function main() {
  const privateKeyPem = process.env.MOXXY_UPDATE_SIGNING_KEY;
  if (!privateKeyPem || !privateKeyPem.includes('PRIVATE KEY')) {
    console.error(
      'build-app-bundle: MOXXY_UPDATE_SIGNING_KEY (Ed25519 private key PEM) is required to sign the manifest.',
    );
    process.exit(1);
  }

  const version = readJson(path.join(desktopDir, 'package.json')).version;
  let minElectron = process.env.MOXXY_BUNDLE_MIN_ELECTRON;
  if (!minElectron) {
    const ev = readJson(path.join(desktopDir, 'node_modules', 'electron', 'package.json')).version;
    minElectron = `${ev.split('.')[0]}.0.0`;
  }
  const nodeAbi = process.env.MOXXY_BUNDLE_NODE_ABI ?? '';
  // Per-TAG asset URLs (not `releases/latest/...`). In a monorepo that also cuts
  // `@moxxy/cli@x` releases, GitHub's "latest release" is usually NOT the
  // desktop, so `releases/latest/download/...` 404s. The desktop release is
  // tagged `desktop-v<version>`; pin the asset URLs to it.
  const tag = `desktop-v${version}`;
  const baseUrl =
    process.env.MOXXY_BUNDLE_BASE_URL ??
    `https://github.com/moxxy-ai/moxxy/releases/download/${tag}`;
  const releaseUrl =
    process.env.MOXXY_RELEASE_URL ?? `https://github.com/moxxy-ai/moxxy/releases/tag/${tag}`;
  const bundleName = `moxxy-app-bundle-${version}.json.gz`;
  const bundleUrl = `${baseUrl}/${bundleName}`;

  // Collect the bundle files: dist/** + dist-electron/**, minus the floor
  // bootstrap + sourcemaps (runtime doesn't need maps; bootstrap is the floor).
  const rels = [];
  walk(path.join(desktopDir, 'dist'), 'dist', rels);
  walk(path.join(desktopDir, 'dist-electron'), 'dist-electron', rels);
  const files = {};
  let bytes = 0;
  for (const rel of rels) {
    if (rel === 'dist-electron/main/bootstrap.js') continue;
    if (rel.endsWith('.map')) continue;
    const buf = readFileSync(path.join(desktopDir, rel));
    files[rel] = buf;
    bytes += buf.length;
  }
  if (!files['dist-electron/main/index.js'] || !files['dist/index.html']) {
    console.error('build-app-bundle: dist/ or dist-electron/ not built — run `pnpm build` first.');
    process.exit(1);
  }

  // Lockstep guard: the immutable bootstrap bakes FLOOR_RUNNER_PROTOCOL and uses
  // it as the ceiling for any hot-update — a staged JS bundle whose signed
  // `runnerProtocol` EXCEEDS the floor would strand the desktop with a client
  // newer than any runner its bundled CLI can spawn. The floor is therefore a
  // guaranteed-serveable MINIMUM, so it must never be HIGHER than
  // RUNNER_PROTOCOL_VERSION (that would promise a protocol the CLI can't serve).
  // It MAY legitimately LAG when the runner adds an OPTIONAL, version-gated
  // method (e.g. v10's `session.loadHistory`, which the renderer feature-detects
  // and falls back from): such skew is additive and the desktop keeps working
  // against the floor runner. So assert `floor <= RUNNER_PROTOCOL_VERSION` rather
  // than strict equality — a forgotten bump that pushes the floor ABOVE the
  // runner still fails the build.
  const floorSrc = readFileSync(
    path.join(desktopDir, 'electron', 'main', 'floor-runner-protocol.ts'),
    'utf8',
  );
  const floorMatch = /FLOOR_RUNNER_PROTOCOL\s*=\s*(\d+)/.exec(floorSrc);
  const floorProtocol = floorMatch ? Number.parseInt(floorMatch[1], 10) : NaN;
  if (!Number.isFinite(floorProtocol) || floorProtocol > RUNNER_PROTOCOL_VERSION) {
    console.error(
      `build-app-bundle: FLOOR_RUNNER_PROTOCOL (${floorProtocol}) must be <= ` +
        `@moxxy/runner RUNNER_PROTOCOL_VERSION (${RUNNER_PROTOCOL_VERSION}) — ` +
        'update apps/desktop/electron/main/floor-runner-protocol.ts.',
    );
    process.exit(1);
  }

  const { manifest, manifestJson, bundleGz } = buildAppBundle({
    version,
    minElectron,
    nodeAbi,
    bundleUrl,
    privateKeyPem,
    files,
    runnerProtocol: RUNNER_PROTOCOL_VERSION,
    releaseUrl,
    notes: process.env.MOXXY_BUNDLE_NOTES,
  });

  const outDir = process.env.MOXXY_BUNDLE_OUT_DIR ?? path.join(desktopDir, 'release', 'update');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, bundleName), bundleGz);
  writeFileSync(path.join(outDir, 'moxxy-app-manifest.json'), manifestJson);

  console.log(
    `build-app-bundle: wrote ${Object.keys(files).length} files ` +
      `(${(bytes / 1024).toFixed(0)} KiB raw → ${(bundleGz.length / 1024).toFixed(0)} KiB gz)\n` +
      `  version=${version} minElectron=${minElectron} nodeAbi=${nodeAbi || '(any)'} runnerProtocol=${RUNNER_PROTOCOL_VERSION}\n` +
      `  sha256=${manifest.sha256}\n` +
      `  bundleUrl=${bundleUrl}\n` +
      `  out=${outDir}`,
  );
}

main();
