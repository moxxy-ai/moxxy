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
export type FetchLike = (
  url: string,
  init?: { readonly signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const NPM_SEARCH_URL = 'https://registry.npmjs.org/-/v1/search';

/** Fail fast if the registry stalls (slow DNS / black-holed network / hung TLS). */
const NPM_SEARCH_TIMEOUT_MS = 10_000;

// Validate the registry body rather than trusting `as` casts: a hostile or
// buggy mirror returning numbers/objects for description/version (or a huge
// objects array) must not flow unchecked back to the model. The top-level shape
// is parsed loosely; each `package` is then validated INDEPENDENTLY so one
// malformed entry is skipped (not the whole response — mirrors plugin-mcp).
const npmSearchBodySchema = z.object({
  objects: z.array(z.object({ package: z.unknown() })).optional(),
});

const npmSearchPackageSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().optional(),
});

/**
 * Search for installable moxxy plugins. Queries the npm registry scoped to the
 * `moxxy-plugin` keyword (the convention a publishable moxxy plugin tags itself
 * with) and merges in any curated-catalog entries whose id/label/description
 * matches the query. Network-only read; no install side effects — the caller
 * picks a `name` and hands it to `install_plugin` / `moxxy plugins install`.
 */
export async function searchInstallablePlugins(
  query: string,
  opts: { readonly size?: number; readonly fetchImpl?: FetchLike; readonly signal?: AbortSignal } = {},
): Promise<ReadonlyArray<PluginSearchResult>> {
  const q = query.trim();
  const results: PluginSearchResult[] = catalogMatches(q);
  const seen = new Set(results.map((r) => r.name));

  const size = opts.size ?? 20;
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  if (fetchImpl) {
    // Combine the turn's abort signal with a hard deadline so a hung registry
    // fails fast AND aborting the turn cancels the in-flight request, instead
    // of blocking on the OS socket timeout with no way to cancel.
    const deadline = AbortSignal.timeout(NPM_SEARCH_TIMEOUT_MS);
    const signal = opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline;
    try {
      const text = q ? `${q} keywords:moxxy-plugin` : 'keywords:moxxy-plugin';
      const url = `${NPM_SEARCH_URL}?text=${encodeURIComponent(text)}&size=${size}`;
      const res = await fetchImpl(url, { signal });
      if (res.ok) {
        const parsed = npmSearchBodySchema.safeParse(await res.json());
        const objects = parsed.success ? (parsed.data.objects ?? []) : [];
        for (const obj of objects.slice(0, size)) {
          const pkg = npmSearchPackageSchema.safeParse(obj.package);
          if (!pkg.success || seen.has(pkg.data.name)) continue;
          seen.add(pkg.data.name);
          results.push({
            name: pkg.data.name,
            description: pkg.data.description ?? '',
            version: pkg.data.version ?? 'latest',
            source: 'npm',
            installSpec: pkg.data.name,
          });
        }
      }
    } catch {
      // Network failure / abort / timeout is non-fatal: still return the
      // curated catalog matches.
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
    handler: async ({ query }, ctx) => {
      const results = await searchInstallablePlugins(query, { ...opts, signal: ctx.signal });
      return { query, count: results.length, results };
    },
  });
}
