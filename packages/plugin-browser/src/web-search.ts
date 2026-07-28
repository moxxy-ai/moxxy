import { MoxxyError, defineTool, z, type ToolContext } from '@moxxy/sdk';
import { htmlToPlainText } from './html-extract.js';
import { webFetchTool } from './web-fetch.js';

export interface WebSearchQuery {
  readonly query: string;
  readonly maxResults: number;
}
export interface WebSearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet?: string;
}

/** Adapter seam for replacing the local fallback without changing the tool. */
export interface WebSearchAdapter {
  readonly name: string;
  search(query: WebSearchQuery, ctx: ToolContext): Promise<ReadonlyArray<WebSearchResult>>;
}

export interface BuildWebSearchToolOptions {
  readonly adapter?: WebSearchAdapter;
}

const outputSchema = z.object({
  provider: z.string(),
  query: z.string(),
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string().url(),
      snippet: z.string().optional(),
    }),
  ),
});

export function buildWebSearchTool(opts: BuildWebSearchToolOptions = {}) {
  const adapter = opts.adapter ?? duckDuckGoHtmlAdapter;
  return defineTool({
    name: 'web_search',
    icon: 'search',
  description:
      'Search the public web for current information and return source URLs with snippets. On models with provider-hosted web search this fallback is replaced automatically by the provider; otherwise it uses the configured local search adapter.',
    inputSchema: z.object({
      query: z.string().trim().min(1).max(1_000).describe('Search query.'),
      maxResults: z.number().int().min(1).max(10).optional().default(5),
    }).strict(),
    outputSchema,
    hosted: { type: 'web_search' },
    permission: { action: 'prompt' },
    isolation: {
      capabilities: {
        net: { mode: 'any' },
        timeMs: 120_000,
      },
    },
    compact: {
      verb: 'Searching the web for',
      noun: { one: 'query', other: 'queries' },
      previewKey: 'query',
    },
    async handler({ query, maxResults }, ctx) {
      const results = await adapter.search({ query, maxResults }, ctx);
      return { provider: adapter.name, query, results: results.slice(0, maxResults) };
    },
  });
}

/**
 * Zero-config fallback. It deliberately goes through web_fetch's SSRF guard,
 * redirect validation, DNS pinning, byte cap, timeout, and parent abort signal.
 */
export const duckDuckGoHtmlAdapter: WebSearchAdapter = {
  name: 'duckduckgo-html',
  async search({ query, maxResults }, ctx) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await webFetchTool.handler(
      {
        url,
        format: 'raw',
        method: 'GET',
        headers: { accept: 'text/html,application/xhtml+xml' },
        maxBytes: 1_000_000,
        timeoutMs: 20_000,
      },
      ctx,
    );
    if (typeof response !== 'string') {
      throw new MoxxyError({
        code: 'TOOL_ERROR',
        message: 'web_search fallback returned a non-text response',
      });
    }
    const separator = response.indexOf('\n\n');
    const html = separator >= 0 ? response.slice(separator + 2) : response;
    const results = parseDuckDuckGoHtml(html, maxResults);
    if (results.length === 0) {
      throw new MoxxyError({
        code: 'TOOL_ERROR',
        message: 'web_search fallback returned no parseable results (the search endpoint may be blocking automated traffic)',
        hint: 'Use web_fetch/browser_session directly, or switch to a model with hosted web search.',
      });
    }
    return results;
  },
};

export function parseDuckDuckGoHtml(html: string, maxResults = 10): ReadonlyArray<WebSearchResult> {
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  const anchor = /<a\b(?=[^>]*\bclass=(?:"[^"]*\bresult__a\b[^"]*"|'[^']*\bresult__a\b[^']*'))[^>]*\bhref=(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while (results.length < maxResults && (match = anchor.exec(html)) !== null) {
    const rawHref = match[1] ?? match[2];
    const rawTitle = match[3];
    if (!rawHref || !rawTitle) continue;
    const url = normalizeResultUrl(rawHref);
    if (!url || seen.has(url)) continue;
    const title = htmlToPlainText(rawTitle);
    if (!title) continue;

    const nextAnchor = html.slice(anchor.lastIndex).search(anchor);
    const resultEnd = nextAnchor >= 0 ? anchor.lastIndex + nextAnchor : html.length;
    const resultTail = html.slice(anchor.lastIndex, Math.min(resultEnd, anchor.lastIndex + 8_000));
    const snippetMatch = /<(?:a|div)\b(?=[^>]*\bclass=(?:"[^"]*\bresult__snippet\b[^"]*"|'[^']*\bresult__snippet\b[^']*'))[^>]*>([\s\S]*?)<\/(?:a|div)>/i.exec(resultTail);
    const snippet = snippetMatch?.[1] ? htmlToPlainText(snippetMatch[1]).slice(0, 1_000) : undefined;
    seen.add(url);
    results.push({ title, url, ...(snippet ? { snippet } : {}) });
  }
  return results;
}

function normalizeResultUrl(rawHref: string): string | null {
  const decodedHref = rawHref.replaceAll('&amp;', '&');
  let parsed: URL;
  try {
    parsed = new URL(decodedHref, 'https://html.duckduckgo.com');
  } catch {
    return null;
  }
  const redirected = parsed.hostname.endsWith('duckduckgo.com') && parsed.pathname === '/l/'
    ? parsed.searchParams.get('uddg')
    : null;
  if (redirected) {
    try {
      parsed = new URL(redirected);
    } catch {
      return null;
    }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.toString();
}
