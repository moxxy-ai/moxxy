/**
 * Ask the npm registry what version a package's `latest` dist-tag points at.
 * Pure transport over global `fetch` — no `npm` dependency, no child process —
 * so `moxxy update`, the TUI's "new version" banner and the agent CLI checks
 * share one cheap call.
 *
 * Fail-soft by contract: every error (offline, timeout, 404, malformed body)
 * resolves to `null`, never throws. A version check must never break a caller.
 */

const REGISTRY = 'https://registry.npmjs.org';
const DEFAULT_TIMEOUT_MS = 4000;
const STABLE_SEMVER_RE = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;

function normalizeStableSemver(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = STABLE_SEMVER_RE.exec(value);
  if (!match) return null;
  const [, major, minor, patch] = match;
  if (major === undefined || minor === undefined || patch === undefined) return null;
  return `${Number(major)}.${Number(minor)}.${Number(patch)}`;
}

export interface FetchNpmLatestOptions {
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
export async function fetchNpmLatest(pkg: string, opts: FetchNpmLatestOptions = {}): Promise<string | null> {
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
    return normalizeStableSemver(json.version);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
