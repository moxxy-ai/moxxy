import assert from 'node:assert/strict';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { unbundledImports } from '../packages/desktop-host/dist/app-update/bundle-imports.js';
import { collectAppBundleFiles } from './app-bundle-files.mjs';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'desktop');

// The release refuses such a bundle only when it signs one, after the day's
// changes are merged and versioned. This runs the same check on every build.
test('the built desktop main imports no package a hot-update does not carry', () => {
  const files = collectAppBundleFiles(desktopDir);
  assert.ok(files['dist-electron/main/index.js'], 'apps/desktop is not built — run `pnpm build` first');

  assert.deepEqual(unbundledImports(files), []);
});
