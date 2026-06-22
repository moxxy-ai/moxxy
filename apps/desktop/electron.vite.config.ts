import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, existsSync, createReadStream } from 'node:fs';
import type { Plugin } from 'vite';

/**
 * The onnxruntime-web WASM artifacts the anonymizer's NER worker needs at
 * runtime. transformers.js (which bundles onnxruntime-web) dynamically
 * `import()`s `ort-wasm-simd-threaded.jsep.mjs` (the JS glue), which in turn
 * fetch-compiles `ort-wasm-simd-threaded.jsep.wasm` (the ~21 MB binary).
 *
 * By DEFAULT transformers.js resolves these from the jsdelivr CDN — which (a)
 * breaks the offline guarantee and (b) is blocked by the renderer CSP (and just
 * fails outright when the user is offline). So we ship them as part of the app
 * shell, served from the renderer's OWN origin at `/ort/<file>`, and point ORT
 * at that local base via `env.backends.onnx.wasm.wasmPaths` in the worker. They
 * are part of the bundle (unlike the ~109 MB model, which is install-downloaded)
 * because they are tiny relative to the app and always required.
 *
 * The exact set is read from the installed `@huggingface/transformers` so a
 * version bump can't silently desync the shipped glue from the runtime that
 * loads it.
 */
const ORT_WASM_FILES = [
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
] as const;

/** Base URL path (relative to the renderer origin) the worker's `wasmPaths`
 *  points at; MUST match {@link ../desktop/src/apps/anonymizer/ner/ner.worker.ts}. */
const ORT_SERVE_BASE = '/ort/';

function transformersDistDir(): string {
  const require = createRequire(import.meta.url);
  // The package's `exports` map doesn't expose `./package.json`, so resolve the
  // package entry itself. Historically every conditional export landed in
  // `dist/`, so its dirname IS the dist dir (where the ORT artifacts live). But
  // that's an internal-layout invariant — pin the REAL dir by verifying the ORT
  // files actually live where we inferred, and probe a couple of fallbacks if a
  // future version flattens the entry out of `dist/`. Failing loudly here beats
  // the silent CDN fallback the whole module exists to prevent.
  const entry = require.resolve('@huggingface/transformers');
  const entryDir = path.dirname(entry);
  const candidates = [entryDir, path.join(entryDir, 'dist'), path.join(entryDir, '..', 'dist')];
  for (const dir of candidates) {
    if (ORT_WASM_FILES.every((f) => existsSync(path.join(dir, f)))) return dir;
  }
  // None matched — return the historical guess so the downstream existsSync
  // check throws a precise, file-named error rather than silently serving the
  // wrong directory.
  return entryDir;
}

/**
 * Vite plugin: ship the onnxruntime-web WASM artifacts at `/ort/<file>` from the
 * renderer origin, in BOTH dev (a static middleware) and prod (copied into
 * `dist/ort/` so electron-builder packs them and the loopback / file:// server
 * serves them). Nothing is fetched from a CDN.
 */
function ortWasmAssets(): Plugin {
  const distDir = transformersDistDir();
  return {
    name: 'moxxy-ort-wasm-assets',
    apply: 'build',
    writeBundle(options): void {
      const outDir = options.dir ?? path.resolve(__dirname, 'dist');
      const ortOut = path.join(outDir, 'ort');
      mkdirSync(ortOut, { recursive: true });
      for (const file of ORT_WASM_FILES) {
        const src = path.join(distDir, file);
        if (!existsSync(src)) {
          throw new Error(
            `[ort-wasm] expected ${file} in @huggingface/transformers/dist (${distDir}); ` +
              `the NER worker would fall back to the jsdelivr CDN and break offline use. ` +
              `Re-run pnpm install or update ORT_WASM_FILES for this transformers version.`,
          );
        }
        copyFileSync(src, path.join(ortOut, file));
      }
    },
  };
}

/** Dev-only twin of {@link ortWasmAssets}: serve `/ort/<file>` from the
 *  installed transformers dist so the worker resolves the same local paths the
 *  packaged build serves (the Vite dev server is the renderer origin in dev). */
function ortWasmDevServer(): Plugin {
  const distDir = transformersDistDir();
  return {
    name: 'moxxy-ort-wasm-dev-server',
    apply: 'serve',
    configureServer(server): void {
      // Match on the FULL request path (not connect's mounted/stripped url) so
      // the behaviour matches the packaged `/ort/<file>` serving exactly.
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0] ?? '';
        if (!pathname.startsWith(ORT_SERVE_BASE)) {
          next();
          return;
        }
        const file = pathname.slice(ORT_SERVE_BASE.length);
        if (!(ORT_WASM_FILES as readonly string[]).includes(file)) {
          next();
          return;
        }
        const abs = path.join(distDir, file);
        if (!existsSync(abs)) {
          next();
          return;
        }
        res.setHeader(
          'Content-Type',
          file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
        );
        createReadStream(abs).pipe(res);
      });
    },
  };
}

/**
 * Workspace packages the main process imports at runtime. They MUST be
 * bundled INTO the main/preload output rather than left as bare
 * `require('@moxxy/…')` calls: electron-builder packs only `dist` /
 * `dist-electron` (not the pnpm symlink farm under node_modules), so an
 * externalized workspace import would `MODULE_NOT_FOUND` in the packaged
 * app. Excluding them from `externalizeDepsPlugin` inlines them.
 */
const BUNDLED_WORKSPACE_DEPS = [
  '@moxxy/runner',
  '@moxxy/sdk',
  '@moxxy/plugin-vault',
  '@moxxy/plugin-stt-whisper-codex',
  '@moxxy/desktop-ipc-contract',
  '@moxxy/desktop-host',
  '@moxxy/ipc-server-ws',
  // The main imports the mobile-channel's pure pairing-URL helpers
  // (`@moxxy/plugin-channel-mobile/pairing`, only `node:os`) to build the QR /
  // connectUrl for the mobile gateway. Bundling the subpath inlines just those
  // helpers — the heavy tunnel-provider package is never pulled in.
  '@moxxy/plugin-channel-mobile',
];

/**
 * Native / optional modules that must stay external even though they ride
 * in on a bundled workspace dep. `@napi-rs/keyring` is loaded via a guarded
 * dynamic `import('@napi-rs/keyring')` (plugin-vault falls back to a
 * disk/passphrase key when it is absent), so it is never statically
 * required — keep it out of the bundle (its NAPI-RS loader reassigns
 * `commonjsRequire`, which Rollup can't inline) and let it resolve (or
 * gracefully fail) at runtime.
 *
 * `bufferutil` / `utf-8-validate` are `ws`'s optional native accelerators
 * (`ws` rides in via the bundled `@moxxy/ipc-server-ws`). `ws` requires them
 * inside try/catch and falls back to its JS implementations, so leaving them
 * external-and-absent in the packaged app is safe and intended.
 */
const EXTERNAL_NATIVE = ['@napi-rs/keyring', 'bufferutil', 'utf-8-validate'];

/**
 * electron-vite manages three build targets (main / preload / renderer)
 * with one config. Each has its own output dir under `dist-electron/`,
 * and the renderer also writes to `dist/` so it can be served by Vite
 * during dev and packaged by electron-builder for production.
 */
export default defineConfig(({ mode }) => {
  // The renderer reads VITE_CLERK_PUBLISHABLE_KEY via import.meta.env, but the
  // MAIN process needs it too — to fold a `pk_live_` instance's own Frontend
  // API host into the CSP + OAuth popup allow-list (a prod key serves clerk-js
  // from that host, which the static dev/test hosts don't cover; without it
  // `clerk.openSignIn()` is CSP-blocked and renders no modal). electron-vite
  // only exposes VITE_ vars to the renderer, so bake the key into the main
  // bundle explicitly as a `define` global (read in electron/main/index.ts).
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const clerkDefine = {
    __CLERK_PUBLISHABLE_KEY__: JSON.stringify(env.VITE_CLERK_PUBLISHABLE_KEY ?? ''),
  };
  return {
  main: {
    plugins: [externalizeDepsPlugin({ exclude: BUNDLED_WORKSPACE_DEPS })],
    define: clerkDefine,
    build: {
      outDir: 'dist-electron/main',
      rollupOptions: {
        // `bootstrap` is the packaged entry (package.json#main) — a tiny,
        // dependency-free loader that picks which app bundle's `index.js` (the
        // real main) to run. It imports no workspace deps, so Rollup keeps it
        // out of `index.js`'s chunk graph and it stays the immutable "floor"
        // that hot-updates can never replace.
        input: {
          index: path.resolve('electron/main/index.ts'),
          bootstrap: path.resolve('electron/main/bootstrap.ts'),
        },
        external: EXTERNAL_NATIVE,
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: BUNDLED_WORKSPACE_DEPS })],
    build: {
      outDir: 'dist-electron/preload',
      rollupOptions: {
        input: { index: path.resolve('electron/preload/index.ts') },
        external: EXTERNAL_NATIVE,
        // A `sandbox: true` window loads its preload as a classic
        // CommonJS script — an ESM (.mjs) preload throws "Cannot use
        // import statement outside a module" and never runs. Emit CJS.
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  renderer: {
    root: '.',
    plugins: [react(), ortWasmAssets(), ortWasmDevServer()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
      // Dedupe React + clerk-react so the wizard's ClerkProvider and
      // any hook that reads Clerk context share a single React tree
      // (pnpm's symlink layout can produce two copies otherwise).
      // We DON'T dedupe @clerk/shared — its sub-path exports
      // (e.g. /loadClerkJsScript) can't be resolved when dedupe
      // collapses it.
      dedupe: ['@clerk/clerk-react', 'react', 'react-dom'],
    },
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'index.html'),
          // Dedicated entry for the floating focus widget. Separate
          // HTML + entry script means the focus window doesn't share
          // any module side-effects with the main app — no #hash
          // routing, no splash fallback bleed, no ClerkProvider, no
          // StrictMode double-mount.
          focus: path.resolve(__dirname, 'focus.html'),
        },
      },
    },
  },
  };
});
