import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pnpmStore = join(repoRoot, 'node_modules', '.pnpm');
const patchedPackage = readdirSync(pnpmStore).find((name) =>
  name.startsWith('image-size@1.2.1_patch_hash='),
);
assert.ok(patchedPackage, 'the patched image-size package must be installed');
const imageSizeEntry = join(pnpmStore, patchedPackage, 'node_modules', 'image-size');

test('patched image-size rejects zero-length ICNS entries without hanging', () => {
  const firstEntry = Buffer.alloc(16);
  firstEntry.write('icns', 0, 'ascii');
  firstEntry.writeUInt32BE(16, 4);
  firstEntry.write('ic07', 8, 'ascii');
  firstEntry.writeUInt32BE(0, 12);
  assertRejectedPromptly(firstEntry, 'Invalid ICNS entry length');

  const laterEntry = Buffer.alloc(24);
  laterEntry.write('icns', 0, 'ascii');
  laterEntry.writeUInt32BE(24, 4);
  laterEntry.write('ic07', 8, 'ascii');
  laterEntry.writeUInt32BE(8, 12);
  laterEntry.write('ic08', 16, 'ascii');
  laterEntry.writeUInt32BE(0, 20);
  assertRejectedPromptly(laterEntry, 'Invalid ICNS entry length');
});

test('patched image-size rejects zero-length JXL partial streams without hanging', () => {
  const input = Buffer.alloc(32);
  input.writeUInt32BE(12, 0);
  input.write('JXL ', 4, 'ascii');
  input.writeUInt32BE(12, 12);
  input.write('ftyp', 16, 'ascii');
  input.write('jxl ', 20, 'ascii');
  input.writeUInt32BE(0, 24);
  input.write('jxlp', 28, 'ascii');
  assertRejectedPromptly(input, 'Invalid JXL partial codestream box');
});

function assertRejectedPromptly(input, expectedMessage) {
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=commonjs',
      '--eval',
      `const imageSize = require(process.argv[1]);
const input = Buffer.from(process.argv[2], 'base64');
try {
  imageSize(input);
  process.exitCode = 2;
} catch (error) {
  if (!(error instanceof TypeError) || error.message !== process.argv[3]) process.exitCode = 3;
}`,
      imageSizeEntry,
      input.toString('base64'),
      expectedMessage,
    ],
    { encoding: 'utf8', timeout: 1_000 },
  );

  assert.notEqual(child.error?.code, 'ETIMEDOUT', 'the parser must not block the event loop');
  assert.equal(child.status, 0, child.stderr || child.stdout);
}
