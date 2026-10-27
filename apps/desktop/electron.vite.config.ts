import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, createReadStream, readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/**
 * The onnxruntime-web WASM artifacts the anonymizer's NER worker needs at
 * runtime. transformers.js imports `onnxruntime-web/webgpu`, whose glue
 * (`ort-wasm-simd-threaded.asyncify.mjs`) fetch-compiles
 * `ort-wasm-simd-threaded.asyncify.wasm` (the ~25 MB binary).
 *
 * By DEFAULT transformers.js resolves these from the jsdelivr CDN — which (a)
 * breaks the offline guarantee and (b) is blocked by the renderer CSP (and just
 * fails outright when the user is offline). So we ship them as part of the app
 * shell, served from the renderer's OWN origin at `/ort/<file>`, and point ORT
 * at that local base via `env.backends.onnx.wasm.wasmPaths` in the worker. They
 * are part of the bundle (unlike the ~109 MB model, which is install-downloaded)
 * because they are tiny relative to the app and always required.
 *
 * They are resolved from the onnxruntime-web that the installed
 * `@huggingface/transformers` itself depends on, so a version bump can't
 * silently desync the shipped glue from the runtime that loads it.
 */
const ORT_WASM_FILES = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
] as const;

/** Base URL path (relative to the renderer origin) the worker's `wasmPaths`
 *  points at; MUST match {@link ../desktop/src/apps/anonymizer/ner/ner.worker.ts}. */
const ORT_SERVE_BASE = '/ort/';

/** Absolute path of every ORT artifact, keyed by the file name served under `/ort/`. */
function ortWasmSources(): ReadonlyMap<string, string> {
  // onnxruntime-web is transformers' dependency, not ours, so resolve it from
  // there; its `exports` map names each WASM artifact. Failing loudly here beats
  // the silent CDN fallback the whole module exists to prevent.
  const fromTransformers = createRequire(
    createRequire(import.meta.url).resolve('@huggingface/transformers'),
  );
  const sources = new Map<string, string>();
  for (const file of ORT_WASM_FILES) {
    try {
      sources.set(file, fromTransformers.resolve(`onnxruntime-web/${file}`));
    } catch {
      throw new Error(
        `[ort-wasm] onnxruntime-web (from @huggingface/transformers) has no ${file}; ` +
          `the NER worker would fall back to the jsdelivr CDN and break offline use. ` +
          `Re-run pnpm install or update ORT_WASM_FILES for this transformers version.`,
      );
    }
  }
  return sources;
}

/**
 * Vite plugin: ship the onnxruntime-web WASM artifacts at `/ort/<file>` from the
 * renderer origin, in BOTH dev (a static middleware) and prod (copied into
 * `dist/ort/` so electron-builder packs them and the loopback / file:// server
 * serves them). Nothing is fetched from a CDN.
 */
function ortWasmAssets(): Plugin {
  const sources = ortWasmSources();
  return {
    name: 'moxxy-ort-wasm-assets',
    apply: 'build',
    writeBundle(options): void {
      const outDir = options.dir ?? path.resolve(__dirname, 'dist');
      const ortOut = path.join(outDir, 'ort');
      mkdirSync(ortOut, { recursive: true });
      for (const [file, src] of sources) {
        copyFileSync(src, path.join(ortOut, file));
      }
    },
  };
}

/** Dev-only twin of {@link ortWasmAssets}: serve `/ort/<file>` from the
 *  installed onnxruntime-web so the worker resolves the same local paths the
 *  packaged build serves (the Vite dev server is the renderer origin in dev). */
function ortWasmDevServer(): Plugin {
  const sources = ortWasmSources();
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
        const abs = sources.get(file);
        if (abs === undefined) {
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
 * Vite plugin: drop the ORPHAN onnxruntime-web WASM that Vite's import-meta-url
 * asset handling emits into `dist/assets/`.
 *
 * transformers.js imports onnxruntime-web's glue
 * (`ort-wasm-simd-threaded.asyncify.mjs`), which contains a
 * `new URL('ort-wasm-simd-threaded.asyncify.wasm', import.meta.url)` — emscripten's
 * DEFAULT wasm path. Vite statically resolves that and emits a hashed ~25 MB copy
 * into `dist/assets/` on EVERY bundle (and every hot-update). But that default is
 * DEAD: the NER worker sets `env.backends.onnx.wasm.wasmPaths` (→ emscripten
 * `locateFile`) to our locally-served `/ort/` base BEFORE the ORT session is
 * created, so ORT loads the real binary from `dist/ort/` and never touches the
 * `assets/` copy (the emscripten glue reads `Xa ??= locateFile ? locateFile(…) :
 * new URL(…).href`, so with `wasmPaths` set the `new URL` branch is never taken).
 * The emitted `assets/` file is therefore a pure orphan — delete it.
 *
 * This ONLY removes the orphan under `dist/assets/`. The REAL runtime binary lives
 * at `dist/ort/ort-wasm-simd-threaded.asyncify.wasm`, written by {@link ortWasmAssets}
 * via a separate `writeBundle` file copy (NOT part of the Rollup bundle graph), so
 * it is untouched. The anonymizer's on-device NER keeps loading ORT from `/ort/`
 * exactly as before, and the moxxy-app-served model bundle is unaffected.
 */
function ortWasmDropOrphan(): Plugin {
  // The orphan's hashed name: `ort-wasm-simd-threaded.asyncify-<hash>.wasm` (the
  // `-` after `asyncify` is the asset hash separator — it never appears in the
  // real, exact-named `dist/ort/…asyncify.wasm`, which isn't in the bundle graph).
  const ORPHAN_RE = /(^|\/)ort-wasm-simd-threaded\.asyncify-[^/]*\.wasm$/;
  return {
    name: 'moxxy-ort-wasm-drop-orphan',
    apply: 'build',
    generateBundle(_options, bundle): void {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'asset' && ORPHAN_RE.test(fileName)) {
          delete bundle[fileName];
        }
      }
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
  '@moxxy/plugin-provider-openai',
  '@moxxy/plugin-stt-whisper',
  '@moxxy/desktop-ipc-contract',
  '@moxxy/desktop-host',
];

/**
 * Third-party packages the main imports at runtime. A hot-update bundle is
 * only `dist/` + `dist-electron/` staged under `<userData>/app/<version>/`,
 * with no `node_modules` — left external, each dies at boot ("Cannot find
 * package 'zod'") and every update reverts to the installed app. The bundle
 * builder refuses a main that imports a package it doesn't carry
 * (`unbundledImports` in @moxxy/desktop-host/app-update), so a new one shows
 * up there first.
 */
const BUNDLED_THIRD_PARTY_DEPS = ['zod', 'openai', 'electron-updater'];

/**
 * Native / optional modules that must stay external even though they ride
 * in on a bundled workspace dep. `@napi-rs/keyring` is loaded via a guarded
 * dynamic `import('@napi-rs/keyring')` (plugin-vault falls back to a
 * disk/passphrase key when it is absent), so it is never statically
 * required — keep it out of the bundle (its NAPI-RS loader reassigns
 * `commonjsRequire`, which Rollup can't inline) and let it resolve (or
 * gracefully fail) at runtime.
 *
 * `bufferutil` / `utf-8-validate` are `ws`'s optional native accelerators,
 * should `ws` ride in through a bundled dependency. `ws` requires them
 * inside try/catch and falls back to its JS implementations, so leaving them
 * external-and-absent in the packaged app is safe and intended.
 *
 * `puppeteer` is officeparser's optional PDF-generation backend. Moxxy only
 * parses Office documents, so that guarded dynamic import is never reached;
 * keeping it external avoids shipping a browser runtime we do not use.
 */
const EXTERNAL_OPTIONAL = ['@napi-rs/keyring', 'bufferutil', 'utf-8-validate', 'puppeteer'];

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
  // The runner version this app is built with. The launch after an update
  // brings the runner and extensions to exactly it (never npm's `latest`,
  // which moves ahead of the app between its releases). A build-time constant
  // rather than a signed-manifest field: installed bootstraps verify the
  // manifest's exact bytes, so a new field there would fail their check.
  const cliManifest = JSON.parse(
    readFileSync(path.resolve(__dirname, '../../packages/cli/package.json'), 'utf8'),
  ) as { version: string };
  const mainDefine = {
    ...clerkDefine,
    __MOXXY_COMPONENTS_VERSION__: JSON.stringify(cliManifest.version),
  };
  return {
  main: {
    plugins: [externalizeDepsPlugin({ exclude: [...BUNDLED_WORKSPACE_DEPS, ...BUNDLED_THIRD_PARTY_DEPS] })],
    define: mainDefine,
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
        external: EXTERNAL_OPTIONAL,
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: [...BUNDLED_WORKSPACE_DEPS, ...BUNDLED_THIRD_PARTY_DEPS] })],
    build: {
      outDir: 'dist-electron/preload',
      rollupOptions: {
        input: { index: path.resolve('electron/preload/index.ts') },
        external: EXTERNAL_OPTIONAL,
        // A `sandbox: true` window loads its preload as a classic
        // CommonJS script — an ESM (.mjs) preload throws "Cannot use
        // import statement outside a module" and never runs. Emit CJS.
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  renderer: {
    root: '.',
    plugins: [react(), ortWasmAssets(), ortWasmDevServer(), ortWasmDropOrphan()],
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
