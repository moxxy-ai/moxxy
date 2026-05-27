// Bundles the browser frontend (React + DOM) into dist/public/app.js with
// esbuild, and copies index.html alongside it. This is the repo's only
// browser bundle; it is deliberately quarantined to this package. The channel
// serves dist/public/* at runtime.
import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const outdir = path.join(root, 'dist', 'public');

await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/frontend/main.tsx')],
  bundle: true,
  outfile: path.join(outdir, 'app.js'),
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  logLevel: 'warning',
});

await copyFile(path.join(root, 'src/frontend/index.html'), path.join(outdir, 'index.html'));
console.log('build-web: wrote dist/public/{app.js,index.html}');
