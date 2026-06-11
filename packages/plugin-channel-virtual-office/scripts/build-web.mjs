// Bundles the pixel-art office game (Phaser + React DOM overlay) into
// dist/public/app.js with esbuild, and copies index.html alongside it. The
// channel serves dist/public/* at runtime. Pass --serve for a dev loop that
// rebuilds on change and serves the bundle on http://127.0.0.1:8000 (static
// only — game logic that needs a live backend should boot with ?demo=1).
import { build, context } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const outdir = path.join(root, 'dist', 'public');
const serve = process.argv.includes('--serve');

await mkdir(outdir, { recursive: true });
await copyFile(path.join(root, 'src/frontend/index.html'), path.join(outdir, 'index.html'));

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [path.join(root, 'src/frontend/main.tsx')],
  bundle: true,
  outfile: path.join(outdir, 'app.js'),
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  minify: !serve,
  sourcemap: serve,
  logLevel: 'warning',
};

if (serve) {
  const ctx = await context(options);
  await ctx.watch();
  const { hosts, port } = await ctx.serve({ servedir: outdir, port: 8000 });
  console.log(`build-web: dev server on http://${hosts[0] ?? '127.0.0.1'}:${port}/?demo=1`);
} else {
  await build(options);
  console.log('build-web: wrote dist/public/{app.js,index.html}');
}
