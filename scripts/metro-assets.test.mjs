import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pnpmStore = join(repoRoot, 'node_modules', '.pnpm');
// Every Metro the mobile app can bundle with, so a second copy cannot slip past.
const metroDirs = readdirSync(pnpmStore)
  .filter((name) => name.startsWith('metro@'))
  .map((name) => join(pnpmStore, name, 'node_modules', 'metro'))
  .filter((dir) => existsSync(join(dir, 'src', 'Assets.js')));

const PNG_3X2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR4nGP8z8DwnwEKGAAMMgH+R7s3ZQAAAABJRU5ErkJggg==',
  'base64',
);

test('Metro is installed', () => {
  assert.ok(metroDirs.length > 0, 'no metro found under node_modules/.pnpm');
});

for (const metroDir of metroDirs) {
  test(`${metroDir.split('/node_modules/.pnpm/')[1]} sizes image assets read from disk`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'moxxy-metro-asset-'));
    try {
      const file = join(dir, 'logo.png');
      writeFileSync(file, PNG_3X2);
      const { getAssetData } = createRequire(import.meta.url)(join(metroDir, 'src', 'Assets.js'));
      const data = await getAssetData(file, 'logo.png', [], null, '/assets');
      assert.equal(data.width, 3);
      assert.equal(data.height, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
