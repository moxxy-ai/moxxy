import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

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
    plugins: [react()],
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
