import { defineTool, z } from '@moxxy/sdk';
import { INSTALLABLE_PLUGIN_CATALOG, type PluginCatalogEntry } from './catalog.js';

/** A discovered installable plugin (npm registry hit or curated catalog entry). */
export interface PluginSearchResult {
  /** npm package name (the `install_plugin` / `moxxy plugins install` spec). */
  readonly name: string;
  readonly description: string;
  readonly version: string;
  /** Where this hit came from. Catalog hits are curated/first-party. */
  readonly source: 'catalog' | 'npm';
  /** Install spec (catalog entries may install from GitHub/path, not just npm). */
  readonly installSpec: string;
}

/** Minimal `fetch` surface, injectable for tests. Defaults to global fetch. */
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const NPM_SEARCH_URL = 'https://registry.npmjs.org/-/v1/search';

interface NpmSearchPackage {
  readonly name?: string;
  readonly description?: string;
  readonly version?: string;
}

/**
 * Search for installable moxxy plugins. Queries the npm registry scoped to the
 * `moxxy-plugin` keyword (the convention a publishable moxxy plugin tags itself
 * with) and merges in any curated-catalog entries whose id/label/description
 * matches the query. Network-only read; no install side effects — the caller
 * picks a `name` and hands it to `install_plugin` / `moxxy plugins install`.
 */
export async function searchInstallablePlugins(
  query: string,
  opts: { readonly size?: number; readonly fetchImpl?: FetchLike } = {},
): Promise<ReadonlyArray<PluginSearchResult>> {
  const q = query.trim();
  const results: PluginSearchResult[] = catalogMatches(q);
  const seen = new Set(results.map((r) => r.name));

  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  if (fetchImpl) {
    try {
      const text = q ? `${q} keywords:moxxy-plugin` : 'keywords:moxxy-plugin';
      const url = `${NPM_SEARCH_URL}?text=${encodeURIComponent(text)}&size=${opts.size ?? 20}`;
      const res = await fetchImpl(url);
      if (res.ok) {
        const body = (await res.json()) as { objects?: ReadonlyArray<{ package?: NpmSearchPackage }> };
        for (const obj of body.objects ?? []) {
          const pkg = obj.package;
          if (!pkg?.name || seen.has(pkg.name)) continue;
          seen.add(pkg.name);
          results.push({
            name: pkg.name,
            description: pkg.description ?? '',
            version: pkg.version ?? 'latest',
            source: 'npm',
            installSpec: pkg.name,
          });
        }
      }
    } catch {
      // Network failure is non-fatal: still return the curated catalog matches.
    }
  }
  return results;
}

function catalogMatches(query: string): PluginSearchResult[] {
  const q = query.toLowerCase();
  const matches = (e: PluginCatalogEntry): boolean =>
    q.length === 0 ||
    e.id.toLowerCase().includes(q) ||
    e.label.toLowerCase().includes(q) ||
    e.packageName.toLowerCase().includes(q) ||
    e.description.toLowerCase().includes(q);
  return INSTALLABLE_PLUGIN_CATALOG.filter(matches).map((e) => ({
    name: e.packageName,
    description: e.description,
    version: 'latest',
    source: 'catalog' as const,
    installSpec: e.installSpec,
  }));
}

export function buildSearchPluginsTool(opts: { readonly fetchImpl?: FetchLike } = {}) {
  return defineTool({
    name: 'search_plugins',
    description:
      'Search for installable moxxy plugins by topic/keyword. Queries the npm ' +
      'registry (plugins tagged with the `moxxy-plugin` keyword) and the curated ' +
      'catalog, returning candidate packages with name + description + version. ' +
      'Use this for requests like "find me a plugin for X" — pick the best match ' +
      'and pass its `name` to install_plugin. Read-only; does not install anything.',
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe('What the plugin should do, e.g. "notion", "calendar", "code review".'),
    }),
    permission: { action: 'allow' },
    // Honest capability declaration: hits the public npm registry over HTTPS.
    isolation: {
      capabilities: { net: { mode: 'allowlist', hosts: ['registry.npmjs.org'] } },
    },
    handler: async ({ query }) => {
      const results = await searchInstallablePlugins(query, opts);
      return { query, count: results.length, results };
    },
  });
}
