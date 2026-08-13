import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Bundle @moxxy/cli into a single self-contained binary.
 *
 * Everything first-party (@moxxy/core, every plugin, modes, isolators, …)
 * is inlined: those packages live in cli's devDependencies so pnpm links
 * them at build time, and tsup only auto-externalizes runtime
 * `dependencies` — so devDeps get bundled.
 *
 * EXTERNAL (resolved from node_modules at runtime, never inlined):
 *   - @moxxy/sdk      the published public contract; ONE shared instance so
 *                     discovered third-party plugins share it with the builtins
 *   - zod             sdk's peer dep; must be the SAME instance the builtins and
 *                     third-party plugins use, or cross-boundary schemas diverge
 *   - @napi-rs/keyring  native module, cannot be bundled (vault degrades to disk key);
 *                       shipped as an optionalDependency
 *   - playwright      huge; install-on-demand (browser plugin throws a clear hint if absent)
 *   - @huggingface/transformers  huge; install-on-demand (embedder falls back to TF-IDF)
 *   - node-pty        native; optional (terminal surface falls back to a piped shell)
 * All three are loaded via dynamic import() with graceful fallback already, so
 * playwright/transformers stay external (bundled plugins import them lazily)
 * even though they are no longer installed by default; @moxxy/sdk + zod ship as
 * real runtime dependencies.
 */
export default defineConfig({
  entry: {
    bin: 'src/bin.ts',
    // Emitted as a standalone sibling so the Read tool's
    // `handlerModule: { url: new URL('./read-handler.js', import.meta.url) }`
    // (tools-builtin/src/read.ts) still resolves next to the bundled bin.
    // Out-of-process isolators (worker/subprocess/wasm) re-import this URL.
    'read-handler': '../tools-builtin/src/read-handler.ts',
    // (plugin-browser is no longer bundled; a standalone install resolves its
    // own dist/sidecar.js next to its module, so no sidecar entry here.)
  },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  bundle: true,
  splitting: false,
  treeshake: true,
  sourcemap: true,
  metafile: true,
  clean: true,
  dts: false, // a binary ships no types; `tsc --noEmit` still typechecks
  shims: false, // code uses import.meta.url directly; no __dirname shims
  external: ['@moxxy/sdk', 'zod', '@napi-rs/keyring', 'playwright', '@huggingface/transformers', 'node-pty'],
  // Several bundled CJS deps (ulid, jiti, …) call require() for node builtins.
  // ESM output has no `require`, so esbuild's __require stub throws. Inject a
  // real createRequire-backed `require` so those calls resolve. esbuild keeps
  // the entry shebang as line 1 and places this banner after it.
  banner: {
    js: "import { createRequire as __moxxyCreateRequire } from 'node:module';\nvar require = __moxxyCreateRequire(import.meta.url);",
  },
  esbuildOptions(options) {
    // Ink/React TUI — matches cli tsconfig "jsx": "react-jsx".
    options.jsx = 'automatic';
    options.jsxImportSource = 'react';
    // ink dynamically imports react-devtools-core only under DEV=true; it's a
    // dev-only dep that isn't installed. Alias it to an empty stub so the
    // bundle resolves; the devtools path never runs in a normal session.
    options.alias = {
      ...options.alias,
      'react-devtools-core': path.resolve(here, 'scripts/devtools-stub.mjs'),
      // Bundled deps (whatwg-url/tr46 via node-fetch, uri-js via ajv) call bare
      // require("punycode"), which resolves to Node's DEPRECATED builtin (DEP0040).
      // Redirect to the API-compatible userland package so esbuild inlines it and
      // the deprecation warning never fires. (`punycode/` forces node_modules.)
      punycode: 'punycode/',
    };
  },
  async onSuccess() {
    await assertNoHeavyVendorSdks();
    // bin.ts already carries the shebang; tsup preserves it. Just make it executable.
    await fs.chmod(path.resolve(here, 'dist/bin.js'), 0o755);
    // Copy builtin skill markdown next to the bin so the cli-local
    // BUILTIN_SKILLS_DIR (see setup/builtins.ts) resolves post-bundle.
    const skillsSrc = path.resolve(here, '../skills-builtin/skills');
    const skillsDest = path.resolve(here, 'dist/skills');
    await fs.rm(skillsDest, { recursive: true, force: true });
    await fs.cp(skillsSrc, skillsDest, { recursive: true });
    // (plugin-channel-web is no longer bundled; a standalone install serves
    // its own dist/public next to its module, so no dist/public copy here.)
  },
});

/**
 * Vendor SDKs that must never reach the published binary, and the leaf subpath
 * that keeps them out.
 *
 * Each of these arrived TRANSITIVELY, through a package barrel, never on
 * purpose. Importing the string helper `providerApiKeyName` from
 * `@moxxy/plugin-provider-admin` also loaded its factory and with it the ~1 MB
 * `openai` SDK; reading `~/.moxxy/mcp.json` through `@moxxy/plugin-mcp`'s
 * barrel loaded `@modelcontextprotocol/sdk` and its `ajv` dependency. Together
 * that was 1.9 MB, a third of the binary, for two config helpers.
 */
const FORBIDDEN_VENDOR_SDKS: ReadonlyArray<{ readonly pkg: string; readonly useInstead: string }> = [
  { pkg: 'openai', useInstead: '@moxxy/plugin-provider-admin/key-name' },
  { pkg: '@modelcontextprotocol/sdk', useInstead: '@moxxy/plugin-mcp/config-io' },
  { pkg: 'ajv', useInstead: '@moxxy/plugin-mcp/config-io' },
];

/**
 * Fail the build when a heavy vendor SDK is back in the bundle.
 *
 * Asserted HERE rather than as a dependency-cruiser rule because cross-package
 * imports in this workspace resolve to `dist/`, which that config excludes, so
 * the edge is invisible to it and such a rule would pass forever without ever
 * checking anything. The bundle is where this property actually exists, so this
 * is where it gets checked.
 */
async function assertNoHeavyVendorSdks(): Promise<void> {
  const metafilePath = path.resolve(here, 'dist/metafile-esm.json');
  let raw: string;
  try {
    raw = await fs.readFile(metafilePath, 'utf8');
  } catch {
    throw new Error(
      `bundle guard: ${metafilePath} is missing. It is produced by \`metafile: true\`; ` +
        'do not remove that option without replacing this check.',
    );
  }
  const meta = JSON.parse(raw) as { outputs: Record<string, { inputs: Record<string, unknown> }> };
  const inputs = Object.keys(meta.outputs['dist/bin.js']?.inputs ?? {});

  const offenders = FORBIDDEN_VENDOR_SDKS.filter(({ pkg }) =>
    inputs.some((file) => file.includes(`/node_modules/${pkg}/`)),
  );
  if (offenders.length === 0) return;

  const detail = offenders
    .map(({ pkg, useInstead }) => {
      const example = inputs.find((f) => f.includes(`/node_modules/${pkg}/`));
      return `  ${pkg}\n    e.g. ${example}\n    import the leaf subpath instead: ${useInstead}`;
    })
    .join('\n');
  throw new Error(
    `bundle guard: a heavy vendor SDK is back in the moxxy binary.\n${detail}\n` +
      'These are pulled in through a package barrel, not on purpose. Find the import with:\n' +
      '  node -e "…" over dist/metafile-esm.json (walk the reverse import edges).',
  );
}
