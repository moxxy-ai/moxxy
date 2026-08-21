/**
 * Launch the browser-cost benchmark in a real Electron.
 *
 * The measurement needs a live Chromium with a <webview> and a CDP session, so
 * it cannot run under plain node — this wrapper only finds the binary and the
 * built host, then gets out of the way.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
// Electron belongs to apps/desktop, not the workspace root, so resolve from
// there rather than from this file.
const require = createRequire(join(root, 'apps/desktop/package.json'));

let electron;
try {
  electron = require('electron');
} catch {
  console.error('electron not installed — run pnpm install first');
  process.exit(1);
}
const host = join(root, 'packages/desktop-host/dist/browser/host.js');
if (!existsSync(host)) {
  console.error('build first: pnpm --filter @moxxy/desktop-host build');
  process.exit(1);
}

const child = spawn(electron, [join(here, 'main.cjs'), host], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
