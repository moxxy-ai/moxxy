/**
 * The Claude subscription provider is the standard Anthropic Messages API
 * with a bearer (OAuth) credential instead of an API key, so it reuses
 * `AnthropicProvider` in OAuth mode rather than duplicating the streaming /
 * tool-call event handling. This module just stamps in the Claude-specific
 * constants (beta headers + the required identity preamble) and forwards the
 * resolved token + refresh callback.
 */

import { AnthropicProvider } from '@moxxy/plugin-provider-anthropic';
import { CLAUDE_CODE_PROVIDER_ID, CLAUDE_CODE_SYSTEM, CLAUDE_OAUTH_BETA } from './constants.js';

export interface ClaudeCodeProviderConfig {
  /** Claude Code OAuth access token (bearer). Resolved by the host. */
  readonly oauthToken?: string;
  /** Epoch-ms expiry of `oauthToken`, when known (drives proactive refresh). */
  readonly oauthExpiresAt?: number;
  /** Refresh callback wired by the host; omitted for non-refreshable tokens. */
  readonly oauthRefresh?: () => Promise<{ readonly token: string; readonly expiresAt?: number }>;
  /** Optional default model override. */
  readonly defaultModel?: string;
}

export function createClaudeCodeClient(config: ClaudeCodeProviderConfig = {}): AnthropicProvider {
  return new AnthropicProvider({
    name: CLAUDE_CODE_PROVIDER_ID,
    oauthBeta: [...CLAUDE_OAUTH_BETA],
    systemPreamble: CLAUDE_CODE_SYSTEM,
    ...(config.oauthToken ? { oauthToken: config.oauthToken } : {}),
    ...(config.oauthExpiresAt !== undefined ? { oauthExpiresAt: config.oauthExpiresAt } : {}),
    ...(config.oauthRefresh ? { oauthRefresh: config.oauthRefresh } : {}),
    ...(config.defaultModel ? { defaultModel: config.defaultModel } : {}),
  });
}
