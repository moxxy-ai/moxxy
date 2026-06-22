import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin, ResolvedPluginManifest } from '@moxxy/sdk';
import type { PluginLoader } from './host.js';

export interface JitiLoaderOptions {
  readonly cwd: string;
  /**
   * When provided, its return value is appended as a `?v=` query to the ESM
   * import URL so `import()` re-evaluates the module. Supplying this LEAKS a
   * module instance per call — ESM modules can't be unloaded, so every distinct
   * URL is retained for the process lifetime. Provide it ONLY for an explicit
   * hot-reload of a changed `.js`/`.mjs` plugin; omit it for normal loads so a
   * long-lived runner that reloads repeatedly doesn't grow memory without
   * bound. (`.ts` plugins go through jiti, which has its own cache control.)
   */
  readonly cacheBust?: () => string;
}

// Key the jiti cache by cwd: createPluginLoader is called per-session with the
// session's cwd, so a single process-global instance rooted at the FIRST cwd
// would resolve every later session's .ts plugins (and jiti's transform cache)
// against the wrong base directory — non-deterministically by session order.
// One jiti per distinct plugin root is bounded and correct.
const jitiByCwd = new Map<string, ((id: string) => unknown) | null>();

async function getJiti(cwd: string): Promise<((id: string) => unknown) | null> {
  const cached = jitiByCwd.get(cwd);
  if (cached !== undefined) return cached;
  try {
    const mod = await import('jiti');
    const factory = (mod as { createJiti?: (cwd: string, opts?: unknown) => (id: string) => unknown; default?: (cwd: string, opts?: unknown) => (id: string) => unknown }).createJiti ?? (mod as { default?: (cwd: string, opts?: unknown) => (id: string) => unknown }).default;
    if (!factory) {
      jitiByCwd.set(cwd, null);
      return null;
    }
    const instance = factory(cwd, { interopDefault: true });
    jitiByCwd.set(cwd, instance);
    return instance;
  } catch {
    // Don't cache a transient import failure as a permanent null — a missing
    // optional `jiti` dep is the only realistic cause and is stable, but not
    // caching here keeps a one-off failure from poisoning all later loads.
    return null;
  }
}

export function createPluginLoader(opts: JitiLoaderOptions): PluginLoader {
  return {
    async load(manifest: ResolvedPluginManifest): Promise<Plugin> {
      const entry = path.resolve(manifest.packagePath, manifest.entry);
      // `manifest.entry` comes from the plugin's own package.json (validated only
      // as a non-empty string). Reject an entry that escapes the package dir
      // (e.g. `../../sibling/internals.js` or an absolute path) so a package can
      // only execute code from inside its own tree — cheap defense-in-depth for
      // provenance/auditing and any future sandbox-by-path assumptions.
      const rel = path.relative(manifest.packagePath, entry);
      if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(
          `Plugin entry escapes its package directory: ${manifest.entry} (package: ${manifest.packagePath})`,
        );
      }
      const isTs = entry.endsWith('.ts') || entry.endsWith('.tsx');

      let mod: unknown;
      if (isTs) {
        const jiti = await getJiti(opts.cwd);
        if (!jiti) {
          throw new Error(
            `Cannot load .ts plugin entry without jiti: ${entry}. Install 'jiti' as a dependency.`,
          );
        }
        mod = jiti(entry);
      } else {
        // Only cache-bust on an explicit request (caller supplied cacheBust).
        // Busting unconditionally appended a unique `?v=` on EVERY load, and
        // since ESM never unloads a module, each load permanently retained a
        // fresh copy of the plugin + its transitive graph — an unbounded leak
        // across repeated reloads. The plain URL lets ESM reuse its cache.
        const bust = opts.cacheBust?.();
        const url = bust ? `${pathToFileURL(entry).href}?v=${bust}` : pathToFileURL(entry).href;
        mod = await import(url);
      }

      const plugin = extractPlugin(mod);
      if (!plugin) {
        throw new Error(
          `Plugin entry did not export a valid Plugin (default export with __moxxy === 'plugin'): ${entry}`,
        );
      }
      // The runtime-reported version is the package.json version — the single
      // source of truth. Plugin authors hardcode a placeholder `version` in
      // definePlugin (commonly '0.0.0'), so stamp the manifest's packageVersion
      // here; otherwise `moxxy plugins list` and PluginRegisteredEvent lie.
      if (manifest.packageVersion && plugin.version !== manifest.packageVersion) {
        return Object.freeze({ ...plugin, version: manifest.packageVersion });
      }
      return plugin;
    },
  };
}

function extractPlugin(mod: unknown): Plugin | null {
  if (!mod || typeof mod !== 'object') return null;
  const candidates: unknown[] = [
    (mod as { default?: unknown }).default,
    (mod as { default?: { default?: unknown } }).default?.default,
    mod,
    (mod as { plugin?: unknown }).plugin,
  ];
  for (const c of candidates) {
    if (c && typeof c === 'object' && (c as { __moxxy?: string }).__moxxy === 'plugin') {
      return c as Plugin;
    }
  }
  return null;
}
