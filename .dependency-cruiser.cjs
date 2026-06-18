/**
 * Architectural invariants for moxxy (see AGENTS.md):
 *   1. @moxxy/sdk has zero internal deps — it must not import from any other @moxxy/* package.
 *   2. @moxxy/core must not import from any plugin package
 *      (@moxxy/plugin-*, @moxxy/mode-*, @moxxy/compactor-*, @moxxy/cache-strategy-*,
 *      @moxxy/skills-builtin). Core can only import @moxxy/sdk + @moxxy/tools-builtin.
 *   3. The desktop renderer (apps/desktop/src) and the React-Native PoC
 *      (apps/mobile-poc/src) must never statically reach a `node:*` builtin —
 *      those bundles run under a browser engine / Metro and cannot polyfill
 *      node:child_process etc. (this is why @moxxy/sdk splits Node helpers into
 *      the './server' subpath; value-importing them from the main barrel here
 *      would drag a builtin into the bundle).
 *
 * Run with: `pnpm check:deps`
 *
 * Note: plugins CAN import @moxxy/core (e.g., channel plugins like @moxxy/plugin-cli
 * and @moxxy/plugin-telegram need runTurn). The hard rule is the reverse direction:
 * core never depends on a plugin.
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-internal-deps-from-sdk',
      severity: 'error',
      comment:
        '@moxxy/sdk must have zero internal dependencies. It is the typed public surface; ' +
        'pulling in any sibling package would create a cycle with everything that imports it.',
      from: { path: '^packages/sdk/src' },
      to: { path: '^packages/(?!sdk/)' },
    },
    {
      name: 'no-plugin-deps-from-core',
      severity: 'error',
      comment:
        '@moxxy/core must not import from any plugin. Plugins are dynamically loaded; ' +
        'a static import from core inverts the dependency arrow.',
      from: { path: '^packages/core/src' },
      to: {
        // Loop strategies were renamed loop-* → mode-*; cache-strategy-* was
        // added. Match all current block packages so the invariant stays
        // enforced. tools-builtin is intentionally NOT listed (core may import it).
        path: '^packages/(plugin-|mode-|compactor-|cache-strategy-|skills-builtin)',
      },
    },
    {
      name: 'no-node-builtins-in-renderer',
      severity: 'error',
      comment:
        'The desktop renderer and the React-Native PoC must not statically reach a node:* builtin — ' +
        'these bundles run under a browser engine / Metro, which cannot polyfill node:child_process etc. ' +
        "Import Node helpers from '@moxxy/sdk/server' only in Node-side code; use the browser/RN-safe " +
        'main barrel + ./tool-display subpath here.',
      from: { path: '^apps/(desktop/src|mobile-poc/src)' },
      // dep-cruiser strips the `node:` prefix and tags builtins with the `core`
      // dependency type, so match on that (matching `^node:` would never fire).
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular dependencies between packages indicate a layering bug. Re-route through @moxxy/sdk.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment:
        'Source files reachable from no entry point are usually dead code. ' +
        'Package entry points (src/index.ts, src/bin.ts, matchers, etc.) are not orphans — they are consumed across the workspace.',
      from: {
        orphan: true,
        pathNot: [
          '\\.test\\.ts$',
          '\\.test-d\\.ts$',
          // Ambient declaration files are loaded by the compiler, never imported.
          '\\.d\\.ts$',
          '__fixtures__/',
          'vitest\\.config\\.',
          'tsconfig\\.',
          'src/index\\.ts$',
          'src/bin\\.ts$',
          'src/matchers\\.ts$',
          // Vitest setup file — loaded via vitest.config `setupFiles`, not imported.
          'src/test-setup\\.ts$',
          // Standalone executables shipped via a package's `bin` field
          // (consumed by spawning a child process, not by being imported).
          'src/sidecar\\.ts$',
          // Electron process entry points — invoked by the Electron
          // runtime / loaded as a window preload, never imported.
          'apps/desktop/electron/main/index\\.ts$',
          'apps/desktop/electron/preload/index\\.ts$',
          // The renderer (Vite) and the RN PoC (Metro) are cruised ONLY for the
          // no-node-builtins-in-renderer rule. Their extensionless, bundler-
          // resolved imports aren't reliably linked by dep-cruiser's resolver, so
          // orphan detection there is false-positive-prone (e.g. lib/asset.ts is
          // imported by 10 components yet reported as an orphan). Skip orphan
          // checking for them; dead-renderer-code is the bundler's/linter's job.
          '^apps/desktop/src/',
          '^apps/mobile-poc/src/',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Node builtins are kept in the graph (despite the path scoping) so the
    // `no-node-builtins-in-renderer` rule can actually see a renderer/RN module
    // reaching one — `includeOnly` filters BOTH ends of a dependency, and a core
    // module (dep-cruiser strips the `node:` prefix, so it resolves to a bare
    // name like `fs`/`child_process`) outside this set would be invisible.
    includeOnly:
      '^(packages/.*/src|apps/desktop/electron|apps/desktop/src|apps/mobile-poc/src|' +
      '(node:)?(assert|async_hooks|buffer|child_process|cluster|console|constants|crypto|dgram|diagnostics_channel|dns|domain|events|fs|http|http2|https|inspector|module|net|os|path|perf_hooks|process|punycode|querystring|readline|repl|stream|string_decoder|sys|timers|tls|trace_events|tty|url|util|v8|vm|wasi|worker_threads|zlib)(/|$))',
    exclude: {
      path: '(dist/|node_modules/|\\.turbo/|\\.test\\.ts$|\\.test-d\\.ts$|__fixtures__/)',
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
