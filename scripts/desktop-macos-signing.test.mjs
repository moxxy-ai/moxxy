import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  machOFiles,
  notarizationProblems,
  parseSignature,
  signForNotarization,
} from '../apps/desktop/scripts/macos-code-signature.mjs';
import { runtimeSignatureProblems } from '../apps/desktop/scripts/verify-macos-runtime-signatures.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pythonEntitlements = path.join(repo, 'apps/desktop/build/entitlements.python.mac.plist');
// codesign and a C compiler exist on a Mac only; the signatures are a macOS matter.
const macOnly = { skip: process.platform !== 'darwin' && 'macOS only' };

/** What `codesign -dv --verbose=4` printed for real files of the runtimes seed. */
const DEVELOPER_ID_SIGNED = `Executable=/tmp/git/libexec/git-core/git-credential-manager
Identifier=git-credential-manager
Format=Mach-O thin (arm64)
CodeDirectory v=20500 size=1346 flags=0x10000(runtime) hashes=31+7 location=embedded
Executable Segment flags=0x1
Authority=Developer ID Application: Microsoft Corporation (UBF8T346G9)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
Timestamp=19 Jun 2026 at 17:29:36
TeamIdentifier=UBF8T346G9
`;
const AD_HOC_SIGNED = `Executable=/tmp/python/bin/python3.12
Identifier=python3.12
Format=Mach-O thin (arm64)
CodeDirectory v=20400 size=140296 flags=0x20002(adhoc,linker-signed) hashes=4381+0 location=embedded
Signature=adhoc
TeamIdentifier=not set
`;
const NOT_SIGNED = '/tmp/python/lib/libpython3.12.dylib: code object is not signed at all\n';

/** A folder with a program, a library, a script and a link to the program, as a runtime has them. */
function runtimeTree(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'moxxy signing-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'bin'));
  mkdirSync(path.join(root, 'lib'));
  const compile = (source, args) => execFileSync('cc', ['-x', 'c', '-', ...args], { input: source, stdio: ['pipe', 'inherit', 'inherit'] });
  compile('int main(void) { return 0; }\n', ['-o', path.join(root, 'bin', 'tool')]);
  compile('int answer(void) { return 42; }\n', ['-dynamiclib', '-o', path.join(root, 'lib', 'libanswer.dylib')]);
  writeFileSync(path.join(root, 'bin', 'script'), '#!/bin/sh\necho hello\n', { mode: 0o755 });
  symlinkSync('tool', path.join(root, 'bin', 'tool3'));
  return root;
}

// codesign describes a file on stderr and fails for one that is not signed.
const describe = (file) => execFileSync('/bin/sh', ['-c', 'codesign -dv --verbose=4 "$1" 2>&1 || true', 'sh', file], { encoding: 'utf8' });
const entitlementsOf = (file) => execFileSync('/bin/sh', ['-c', 'codesign -d --entitlements - "$1" 2>/dev/null || true', 'sh', file], { encoding: 'utf8' });

test('a signature Apple notarizes names a Developer ID, a timestamp and the hardened runtime', () => {
  assert.deepEqual(parseSignature(DEVELOPER_ID_SIGNED), { developerId: true, timestamp: true, hardenedRuntime: true });
  assert.deepEqual(parseSignature(AD_HOC_SIGNED), { developerId: false, timestamp: false, hardenedRuntime: false });
  assert.deepEqual(parseSignature(NOT_SIGNED), { developerId: false, timestamp: false, hardenedRuntime: false });
});

test('the programs and libraries of a runtime are found by what they are, not by their name', macOnly, (t) => {
  const root = runtimeTree(t);

  assert.deepEqual(machOFiles(root), [
    { file: 'bin/tool', kind: 'executable' },
    { file: 'lib/libanswer.dylib', kind: 'library' },
  ]);
});

test('a runtime as it is downloaded would be refused by notarization, file by file', macOnly, (t) => {
  const root = runtimeTree(t);

  assert.deepEqual(notarizationProblems(root), [
    'bin/tool: not signed with a Developer ID, no secure timestamp, hardened runtime not enabled',
    'lib/libanswer.dylib: not signed with a Developer ID, no secure timestamp',
  ]);
});

test('signing gives every program and library the hardened runtime, and the entitlements to programs only', macOnly, (t) => {
  const root = runtimeTree(t);
  const script = readFileSync(path.join(root, 'bin', 'script'));

  const signed = signForNotarization(root, { identity: '-', entitlements: pythonEntitlements });

  assert.deepEqual(signed, ['bin/tool', 'lib/libanswer.dylib']);
  assert.equal(parseSignature(describe(path.join(root, 'bin', 'tool'))).hardenedRuntime, true);
  assert.equal(parseSignature(describe(path.join(root, 'lib', 'libanswer.dylib'))).hardenedRuntime, true);
  assert.match(entitlementsOf(path.join(root, 'bin', 'tool')), /com\.apple\.security\.cs\.disable-library-validation/);
  assert.doesNotMatch(entitlementsOf(path.join(root, 'lib', 'libanswer.dylib')), /com\.apple\.security/);
  assert.deepEqual(readFileSync(path.join(root, 'bin', 'script')), script);
  assert.ok(lstatSync(path.join(root, 'bin', 'tool3')).isSymbolicLink());
  execFileSync(path.join(root, 'bin', 'tool3'));
});

test('a program its maker already signed with a Developer ID keeps that signature', macOnly, (t) => {
  // The Node that runs the tests: the official build is signed by the Node.js Foundation.
  if (!/^Authority=Developer ID Application: /m.test(describe(process.execPath))) {
    t.skip('this Node is not an official, Developer ID signed build');
    return;
  }
  const root = mkdtempSync(path.join(tmpdir(), 'moxxy signing-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  copyFileSync(process.execPath, path.join(root, 'node'));
  const before = describe(path.join(root, 'node'));

  assert.deepEqual(notarizationProblems(root), []);
  assert.deepEqual(signForNotarization(root, { identity: '-' }), []);
  assert.equal(describe(path.join(root, 'node')), before);
});

test('the runtimes of a prepared app are checked inside their archives, as Apple reads them', macOnly, (t) => {
  const tree = runtimeTree(t);
  const resources = mkdtempSync(path.join(tmpdir(), 'moxxy resources-'));
  t.after(() => rmSync(resources, { recursive: true, force: true }));
  const seed = path.join(resources, 'runtimes-seed', 'darwin-arm64');
  mkdirSync(seed, { recursive: true });
  execFileSync('tar', ['-czf', path.join(seed, 'python.tar.gz'), '-C', path.dirname(tree), path.basename(tree)]);
  writeFileSync(path.join(seed, 'manifest.json'), JSON.stringify({ runtimes: [{ name: 'python', id: '3.12.15-abc', archive: 'python.tar.gz' }] }));
  // An archive for another system holds no macOS program; it is not opened.
  mkdirSync(path.join(resources, 'runtimes-seed', 'linux-x64'));
  writeFileSync(path.join(resources, 'runtimes-seed', 'linux-x64', 'manifest.json'), JSON.stringify({ runtimes: [{ name: 'node', id: 'v22-abc', archive: 'missing.tar.xz' }] }));

  const folder = path.basename(tree);
  assert.deepEqual(runtimeSignatureProblems(resources), [
    `darwin-arm64/python.tar.gz/${folder}/bin/tool: not signed with a Developer ID, no secure timestamp, hardened runtime not enabled`,
    `darwin-arm64/python.tar.gz/${folder}/lib/libanswer.dylib: not signed with a Developer ID, no secure timestamp`,
  ]);
});
