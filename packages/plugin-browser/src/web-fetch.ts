import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';
import { Agent } from 'undici';
import { MoxxyError, assertDefined, defineTool, z } from '@moxxy/sdk';
import { htmlToMarkdown, htmlToPlainText } from './html-extract.js';
import {
  assertPublicUrl,
  setSsrfDnsResolver,
  SsrfBlockedError,
  type DnsResolver,
} from './ssrf-guard.js';

/**
 * Light-tier web fetch: a single HTTP GET (or HEAD) with HTML→text/markdown
 * post-processing for the common case of "read this page". Zero new
 * dependencies — uses Node's built-in `fetch`.
 *
 * For JS-heavy / interactive pages, use `browser_session` (Playwright
 * sidecar) instead. The web-research skill picks the tier.
 */

export { htmlToMarkdown, htmlToPlainText } from './html-extract.js';

const MAX_BYTES_DEFAULT = 2 * 1024 * 1024; // 2 MB
const MAX_REDIRECTS_DEFAULT = 5;
const FETCH_TIMEOUT_MS_DEFAULT = 20_000;

// --- SSRF guard -------------------------------------------------------------
// web_fetch can be driven by the model, so it must not be a confused-deputy
// that reaches loopback, RFC-1918, link-local (incl. the 169.254.169.254 cloud
// metadata endpoint), or non-HTTP schemes. The guard itself lives in
// `./ssrf-guard.js` (shared with browser_session and the Playwright sidecar);
// here we validate the initial URL AND every redirect hop (a public URL can
// 302 to an internal one).

export type { DnsResolver } from './ssrf-guard.js';

/** Test seam: override DNS resolution so SSRF tests stay hermetic. Pass null to reset. */
export function setWebFetchDnsResolver(fn: DnsResolver | null): void {
  setSsrfDnsResolver(fn);
}

/**
 * Shared guard, with rejections re-thrown as MoxxyError for the tool surface.
 * Returns the vetted resolved addresses (null when the host is an IP literal
 * or resolution failed open) so the fetch can be pinned to exactly what was
 * checked.
 */
async function assertPublicUrlForWebFetch(raw: string): Promise<ReadonlyArray<string> | null> {
  try {
    return await assertPublicUrl(raw, 'web_fetch');
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      throw new MoxxyError({ code: 'INTERNAL', message: err.message });
    }
    throw err;
  }
}

/**
 * DNS-rebinding (TOCTOU) defense: a lookup function that always answers with
 * the addresses the SSRF guard just vetted, so the connection provably goes
 * to the IP that was checked — a second, attacker-controlled DNS answer
 * between check and connect can never be consulted. Exported for tests.
 */
export function createPinnedLookup(addresses: ReadonlyArray<string>): LookupFunction {
  // Implemented against the runtime contract (net.connect may ask for one
  // address or, with autoSelectFamily/happy-eyeballs, `all: true`), which is
  // wider than the single-answer `LookupFunction` type — hence the cast.
  const lookup = (
    hostname: string,
    options: { all?: boolean } | undefined,
    callback: (
      err: NodeJS.ErrnoException | null,
      address?: string | Array<{ address: string; family: number }>,
      family?: number,
    ) => void,
  ): void => {
    if (addresses.length === 0) {
      const err: NodeJS.ErrnoException = new Error(`web_fetch: no pinned address for "${hostname}"`);
      err.code = 'ENOTFOUND';
      callback(err);
      return;
    }
    const all = addresses.map((address) => ({ address, family: isIP(address) }));
    if (options?.all) callback(null, all);
    else {
      const first = all[0];
      assertDefined(first, 'addresses is non-empty (length === 0 returned above)');
      callback(null, first.address, first.family);
    }
  };
  return lookup as unknown as LookupFunction;
}

/** Per-hop undici dispatcher whose connections resolve via the pinned lookup. */
function createPinnedDispatcher(addresses: ReadonlyArray<string>): Agent {
  return new Agent({ connect: { lookup: createPinnedLookup(addresses) } });
}

export const webFetchTool = defineTool({
  name: 'web_fetch',
  description:
    'Fetch a URL over HTTP(S) and return the page content. HTML is post-processed to readable text (or markdown). Use for simple GETs; if the page needs JS execution, clicks, or form fills, use browser_session instead.',
  inputSchema: z.object({
    url: z.string().url().describe('Absolute http:// or https:// URL.'),
    format: z
      .enum(['text', 'markdown', 'raw'])
      .optional()
      .default('text')
      .describe(
        'How to render the response. `text` strips HTML to readable plain text. `markdown` keeps headings + lists + links. `raw` returns the body as-is (HTML, JSON, etc).',
      ),
    method: z.enum(['GET', 'HEAD']).optional().default('GET'),
    headers: z.record(z.string(), z.string()).optional(),
    maxBytes: z.number().int().positive().max(20_000_000).optional(),
    timeoutMs: z.number().int().positive().max(120_000).optional(),
    selector: z
      .string()
      .optional()
      .describe(
        'Optional CSS-like selector for the readability extractor (e.g. "main", "article"). Falls back to whole-body extraction.',
      ),
  }),
  permission: { action: 'prompt' },
  isolation: {
    capabilities: {
      net: { mode: 'any' },
      timeMs: 120_000,
    },
  },
  async handler({ url, format, method, headers, maxBytes, timeoutMs, selector }, ctx) {
    const cap = maxBytes ?? MAX_BYTES_DEFAULT;
    const timeout = timeoutMs ?? FETCH_TIMEOUT_MS_DEFAULT;

    const aborter = new AbortController();
    const onParentAbort = (): void => aborter.abort('parent signal');
    ctx.signal.addEventListener('abort', onParentAbort, { once: true });
    const timer = setTimeout(() => aborter.abort('fetch timeout'), timeout);

    let fetched: FetchResult | null = null;
    try {
      const res = await fetchFollowRedirects(url, {
        method,
        headers: { 'user-agent': 'moxxy/0.0', ...(headers ?? {}) },
        signal: aborter.signal,
        maxRedirects: MAX_REDIRECTS_DEFAULT,
      });
      fetched = res;

      if (method === 'HEAD') {
        return formatHeadResult(res);
      }

      const body = await readCapped(res, cap);
      const contentType = res.headers.get('content-type') ?? '';
      const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml');

      if (format === 'raw' || !isHtml) {
        return formatBodyResult({
          status: res.status,
          url: res.url,
          contentType,
          body,
          truncated: body.truncated,
        });
      }

      const extracted =
        format === 'markdown'
          ? htmlToMarkdown(body.text, { selector })
          : htmlToPlainText(body.text, { selector });
      return formatBodyResult({
        status: res.status,
        url: res.url,
        contentType,
        body: { text: extracted, truncated: body.truncated },
        truncated: body.truncated,
      });
    } finally {
      clearTimeout(timer);
      ctx.signal.removeEventListener('abort', onParentAbort);
      // Close the final hop's pinned dispatcher (body is consumed by now).
      if (fetched) await fetched.dispose();
    }
  },
});

interface FetchResult {
  readonly status: number;
  readonly url: string;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
  /** Close the pinned dispatcher (if any) once the body has been consumed. */
  dispose(): Promise<void>;
}

async function fetchFollowRedirects(
  initialUrl: string,
  opts: {
    method: 'GET' | 'HEAD';
    headers: Record<string, string>;
    signal: AbortSignal;
    maxRedirects: number;
  },
): Promise<FetchResult> {
  let current = initialUrl;
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    // Re-validate on every hop — the initial URL AND each redirect target —
    // so a public URL can't 302 us into the internal network.
    const vettedAddrs = await assertPublicUrlForWebFetch(current);
    // DNS-rebinding TOCTOU defense: pin THIS hop's connection to the
    // addresses the guard just vetted. The hostname (and so TLS SNI/cert
    // validation) is untouched — only name resolution is overridden. When
    // there is nothing to pin (IP-literal host already vetted, or fail-open
    // resolution error where the real fetch fails identically), plain fetch.
    const dispatcher = vettedAddrs && vettedAddrs.length > 0 ? createPinnedDispatcher(vettedAddrs) : null;
    const closeDispatcher = async (): Promise<void> => {
      if (dispatcher) {
        try { await dispatcher.close(); } catch { /* ignore */ }
      }
    };
    let res: Response;
    try {
      res = await fetch(current, {
        method: opts.method,
        headers: opts.headers,
        signal: opts.signal,
        redirect: 'manual',
        ...(dispatcher ? { dispatcher } : {}),
      } as RequestInit);
    } catch (err) {
      await closeDispatcher();
      throw err;
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const location = res.headers.get('location');
      assertDefined(location, 'redirect (3xx) with a truthy Location header (checked above)');
      const next = new URL(location, current).toString();
      current = next;
      // drain to avoid the connection leaking
      try { await res.body?.cancel(); } catch { /* ignore */ }
      await closeDispatcher();
      continue;
    }
    return {
      status: res.status,
      url: current,
      headers: res.headers,
      body: res.body,
      dispose: closeDispatcher,
    };
  }
  throw new MoxxyError({
    code: 'INTERNAL',
    message: `Too many redirects (>${opts.maxRedirects}) starting at ${initialUrl}`,
  });
}

interface CappedBody {
  readonly text: string;
  readonly truncated: boolean;
}

async function readCapped(res: FetchResult, cap: number): Promise<CappedBody> {
  if (!res.body) return { text: '', truncated: false };
  const reader = res.body.getReader();
  // Streaming UTF-8 decode: a multi-byte sequence straddling a chunk boundary —
  // or the hard byte cut at `cap` — is buffered across `decode({stream:true})`
  // calls instead of being sliced mid-codepoint into a replacement char. Avoids
  // the Buffer.concat re-copy too.
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > cap) {
        text += decoder.decode(value.subarray(0, cap - total), { stream: true });
        total = cap;
        truncated = true;
        break;
      }
      text += decoder.decode(value, { stream: true });
      total += value.byteLength;
    }
    text += decoder.decode(); // flush any buffered partial sequence
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
    try { await res.body.cancel(); } catch { /* ignore */ }
  }
  return { text, truncated };
}

function formatHeadResult(res: FetchResult): string {
  const lines = [`HTTP ${res.status} ${res.url}`];
  for (const [k, v] of res.headers.entries()) lines.push(`${k}: ${v}`);
  return lines.join('\n');
}

interface BodyResult {
  status: number;
  url: string;
  contentType: string;
  body: CappedBody;
  truncated: boolean;
}

function formatBodyResult(r: BodyResult): string {
  const header = `HTTP ${r.status} ${r.url}\ncontent-type: ${r.contentType}${
    r.truncated ? '\n[response truncated]' : ''
  }`;
  return `${header}\n\n${r.body.text}`;
}

