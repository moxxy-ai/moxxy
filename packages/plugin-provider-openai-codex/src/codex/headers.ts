import { createRequire } from 'node:module';
import { ORIGINATOR } from '../oauth.js';
import type { CodexTokens } from '../types.js';

/**
 * Resolve this plugin's real version from its package.json once at module load
 * rather than freezing a stale literal in the plugin def. Resolves correctly
 * when the package runs from its own dist (dev, tests, third-party
 * `~/.moxxy/plugins` installs); falls back to `0.0.0` defensively — never
 * throws. (NOTE: when inlined into the single-file CLI bundle the relative
 * resolve fails and we keep the `0.0.0` fallback; a build-time constant would
 * close that gap — see TECH_DEBT.)
 */
function resolvePluginVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../../package.json') as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const PLUGIN_VERSION = resolvePluginVersion();

/**
 * The Codex backend gates on `User-Agent` together with `originator` — see
 * ORIGINATOR in `../oauth.js` for the measurement behind both. Only the
 * `codex_cli_rs/` product token is load-bearing, not the version, so this
 * carries a pinned literal instead of moxxy's version (which would read as a
 * nonsense CLI release).
 */
const CODEX_CLI_VERSION = '0.51.0';

export const CODEX_USER_AGENT = `codex_cli_rs/${CODEX_CLI_VERSION}`;

export function buildCodexHeaders(tokens: CodexTokens, sessionId: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    Authorization: `Bearer ${tokens.access}`,
    originator: ORIGINATOR,
    'User-Agent': CODEX_USER_AGENT,
    session_id: sessionId,
  };
  if (tokens.accountId) headers['ChatGPT-Account-Id'] = tokens.accountId;
  return headers;
}
