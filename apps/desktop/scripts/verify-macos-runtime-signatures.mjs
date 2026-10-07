#!/usr/bin/env node
/**
 * Check that Apple will notarize the runtimes of a prepared app: unpack each
 * macOS archive of `runtimes-seed` and look at the signature of every program
 * and library in it, as the notary service does. Notarization answers after
 * the installer is built and uploaded, most of an hour into a release; this
 * answers in a minute. Usage: verify-macos-runtime-signatures.mjs <resources dir>
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { notarizationProblems } from './macos-code-signature.mjs';

/** One line per file notarization would refuse, as `<target>/<archive>/<path in it>: <reasons>`. */
export function runtimeSignatureProblems(resourcesPath) {
  const seedRoot = path.join(resourcesPath, 'runtimes-seed');
  const problems = [];
  for (const target of readdirSync(seedRoot).filter((name) => name.startsWith('darwin-')).sort()) {
    const { runtimes } = JSON.parse(readFileSync(path.join(seedRoot, target, 'manifest.json'), 'utf8'));
    for (const { archive } of runtimes) {
      const unpacked = mkdtempSync(path.join(tmpdir(), 'moxxy signatures-'));
      try {
        execFileSync('tar', ['-xf', path.join(seedRoot, target, archive), '-C', unpacked]);
        problems.push(...notarizationProblems(unpacked).map((problem) => `${target}/${archive}/${problem}`));
      } finally {
        rmSync(unpacked, { recursive: true, force: true });
      }
    }
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const resources = process.argv[2];
  if (!resources || !existsSync(resources)) throw new Error('Usage: verify-macos-runtime-signatures.mjs <resources dir>');
  const problems = runtimeSignatureProblems(path.resolve(resources));
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    console.error(`\n${problems.length} files in the bundled runtimes would fail notarization. They are signed by bundle-runtimes-seed.mjs when MOXXY_MAC_SIGN_IDENTITY names a Developer ID.`);
    process.exit(1);
  }
  console.log('Bundled runtimes: every program and library is signed for notarization.');
}
