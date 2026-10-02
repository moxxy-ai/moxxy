import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pnpmStore = join(repoRoot, 'node_modules', '.pnpm');
const patchedMetro = readdirSync(pnpmStore).find((name) => name.startsWith('metro@0.83.3_patch_hash='));
assert.ok(patchedMetro, 'metro@0.83.3 must be installed with its image-size 2 patch');
const metroAssets = join(pnpmStore, patchedMetro, 'node_modules', 'metro', 'src', 'Assets.js');
const imageSizeEntry = createRequire(metroAssets).resolve('image-size');

const PNG_3X2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR4nGP8z8DwnwEKGAAMMgH+R7s3ZQAAAABJRU5ErkJggg==',
  'base64',
);

test('patched metro sizes image assets read from disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'moxxy-metro-asset-'));
  try {
    const file = join(dir, 'logo.png');
    writeFileSync(file, PNG_3X2);
    const { getAssetData } = createRequire(import.meta.url)(metroAssets);
    const data = await getAssetData(file, 'logo.png', [], null, '/assets');
    assert.equal(data.width, 3);
    assert.equal(data.height, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('image-size rejects zero-length ICNS entries without hanging', () => {
  const firstEntry = Buffer.alloc(16);
  firstEntry.write('icns', 0, 'ascii');
  firstEntry.writeUInt32BE(16, 4);
  firstEntry.write('ic07', 8, 'ascii');
  firstEntry.writeUInt32BE(0, 12);
  assertRejectedPromptly(firstEntry);

  const laterEntry = Buffer.alloc(24);
  laterEntry.write('icns', 0, 'ascii');
  laterEntry.writeUInt32BE(24, 4);
  laterEntry.write('ic07', 8, 'ascii');
  laterEntry.writeUInt32BE(8, 12);
  laterEntry.write('ic08', 16, 'ascii');
  laterEntry.writeUInt32BE(0, 20);
  assertRejectedPromptly(laterEntry);
});

test('image-size rejects zero-length JXL partial streams without hanging', () => {
  const input = Buffer.alloc(32);
  input.writeUInt32BE(12, 0);
  input.write('JXL ', 4, 'ascii');
  input.writeUInt32BE(12, 12);
  input.write('ftyp', 16, 'ascii');
  input.write('jxl ', 20, 'ascii');
  input.writeUInt32BE(0, 24);
  input.write('jxlp', 28, 'ascii');
  assertRejectedPromptly(input);
});

function assertRejectedPromptly(input) {
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=commonjs',
      '--eval',
      `const { imageSize } = require(process.argv[1]);
const input = Buffer.from(process.argv[2], 'base64');
try {
  imageSize(input);
  process.exitCode = 2;
} catch (error) {
  if (!(error instanceof TypeError)) process.exitCode = 3;
}`,
      imageSizeEntry,
      input.toString('base64'),
    ],
    { encoding: 'utf8', timeout: 1_000 },
  );

  assert.notEqual(child.error?.code, 'ETIMEDOUT', 'the parser must not block the event loop');
  assert.equal(child.status, 0, child.stderr || child.stdout);
}
