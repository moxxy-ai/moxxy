import { createRequire } from 'node:module';
import { ORIGINATOR } from '../oauth.js';
import type { CodexTokens } from '../types.js';

/**
 * Resolve this plugin's real version from its package.json once at module load
 * rather than freezing a stale literal in two places (the UA and the plugin
 * def). The User-Agent is sent on every request to the ChatGPT backend; a
 * permanently-`0.0.0` UA defeats server-side version gating and diverges from
 * the real release. Resolves correctly when the package runs from its own dist
 * (dev, tests, third-party `~/.moxxy/plugins` installs); falls back to `0.0.0`
 * defensively — never throws on a header build. (NOTE: when inlined into the
 * single-file CLI bundle the relative resolve fails and we keep the `0.0.0`
 * fallback; a build-time constant would close that gap — see TECH_DEBT.)
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

export const CODEX_USER_AGENT = `moxxy/${PLUGIN_VERSION} (codex)`;

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
