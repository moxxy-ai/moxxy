/**
 * Ask the npm registry what the latest published `@moxxy/cli` is. Pure transport
 * over global `fetch` — no `npm` dependency, no child process — so both the
 * `moxxy update` command and the TUI's "new version" banner can call it cheaply.
 *
 * Fail-soft by contract: every error (offline, timeout, 404, malformed body)
 * resolves to `null`, never throws. A version check must never break the CLI.
 */

const REGISTRY = 'https://registry.npmjs.org';
const DEFAULT_PKG = '@moxxy/cli';
const DEFAULT_TIMEOUT_MS = 4000;

export interface FetchLatestOpts {
  /** Override the fetch implementation (tests inject a stub). */
  fetchImpl?: typeof fetch;
  /** Abort the request after this many ms (default 4000). */
  timeoutMs?: number;
}

/**
 * The version under the `latest` dist-tag for `pkg`, or `null` if it can't be
 * resolved. Uses the per-tag manifest endpoint
 * (`/<pkg>/latest`) so we transfer a tiny document, not the full packument.
 */
export async function fetchLatest(
  pkg: string = DEFAULT_PKG,
  opts: FetchLatestOpts = {},
): Promise<string | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  // Encode the whole package name (incl. the scope slash) so an arbitrary or
  // attacker-influenced `pkg` can't inject path traversal / a query string /
  // another host segment into the registry URL. npm accepts `@scope%2Fname`.
  const url = `${REGISTRY}/${encodeURIComponent(pkg)}/latest`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { version?: unknown };
    return typeof json.version === 'string' ? json.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
