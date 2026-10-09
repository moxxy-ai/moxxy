import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  exceedsCliRunnerProtocol,
  needsNewerRunner,
  parseManifest,
  verifyManifestSignature,
} from '../packages/desktop-host/dist/app-update/index.js';
import { RUNNER_PROTOCOL_VERSION } from '../packages/runner/dist/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = existsSync(path.join(repoRoot, 'apps', 'desktop', 'dist-electron', 'main', 'index.js'));

/** The release's two assets, made by the release script with a throwaway key. */
function release() {
  const keys = generateKeyPairSync('ed25519');
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'app-bundle-'));
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'build-app-bundle.mjs')], {
    env: {
      ...process.env,
      MOXXY_UPDATE_SIGNING_KEY: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      MOXXY_BUNDLE_OUT_DIR: outDir,
    },
    stdio: 'pipe',
  });
  const manifest = parseManifest(readFileSync(path.join(outDir, 'moxxy-app-manifest.json'), 'utf8'));
  rmSync(outDir, { recursive: true, force: true });
  assert.ok(manifest, 'the release manifest parses');
  return { manifest, publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

// An app installed before 0.43 refuses a bundle whose SIGNED runner protocol is
// newer than its own and sends the person to its own installer step — which
// crashes on macOS now that the installer is over a gigabyte. So a release
// must not sign it: those apps then load the bundle, and the bundle installs
// the full app itself.
test('a release is one an app installed earlier can load, and says unsigned which runner it needs', { skip: !built && 'apps/desktop is not built' }, () => {
  const { manifest, publicKeyPem } = release();

  assert.equal(manifest.runnerProtocol, undefined);
  assert.equal(manifest.needsRunnerProtocol, RUNNER_PROTOCOL_VERSION);
  assert.equal(verifyManifestSignature(manifest, publicKeyPem), true);
  // The gate as desktop-v0.40.x has it (runner protocol 15) lets it through …
  assert.equal(exceedsCliRunnerProtocol(manifest, 15), false);
  // … and an app that reads the unsigned word takes the installer straight away.
  assert.equal(needsNewerRunner(manifest, RUNNER_PROTOCOL_VERSION - 1), true);
  assert.equal(needsNewerRunner(manifest, RUNNER_PROTOCOL_VERSION), false);
});
