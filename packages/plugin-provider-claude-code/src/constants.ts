/**
 * Constants for the Claude subscription (Pro/Max) provider.
 *
 * These are the public Claude Code OAuth client parameters — the same values
 * the `claude` CLI uses — so a token minted here interoperates with one from
 * `claude setup-token`, and vice-versa. We never embed a client secret; the
 * flow is PKCE + an out-of-band (manual paste) authorization code.
 */

/** Provider name in the registry / `/model` picker / `provider.name` config. */
export const CLAUDE_CODE_PROVIDER_ID = 'claude-code';

/** Human-readable upstream service, shown in `moxxy login` and the init wizard. */
export const CLAUDE_CODE_SERVICE_NAME = 'Claude (Pro/Max subscription)';

export const CLAUDE_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
export const CLAUDE_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
export const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
/**
 * Out-of-band redirect: after consent, Anthropic shows the user a
 * `code#state` string to paste back into the terminal (no loopback server).
 */
export const CLAUDE_REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
export const CLAUDE_SCOPES = ['org:create_api_key', 'user:profile', 'user:inference'] as const;

/**
 * `anthropic-beta` values sent with every request. `oauth-2025-04-20` is the
 * flag that makes the Messages API accept a subscription bearer token at all;
 * `claude-code-20250219` matches what the real CLI sends. Sent comma-joined.
 */
export const CLAUDE_OAUTH_BETA = ['oauth-2025-04-20', 'claude-code-20250219'] as const;

/**
 * Required first system block. Claude rejects a subscription token unless the
 * system prompt leads with this exact identity line; moxxy's real system
 * prompt is appended as the following block. (Verified against the working
 * opencode / claude-code-router behaviour.)
 */
export const CLAUDE_CODE_SYSTEM = "You are Claude Code, Anthropic's official CLI for Claude.";

/**
 * Env vars a pasted/CI token can arrive through. `CLAUDE_CODE_OAUTH_TOKEN` is
 * what `claude setup-token` documents; `ANTHROPIC_AUTH_TOKEN` is the
 * SDK-native bearer var. Checked in this order.
 */
export const CLAUDE_TOKEN_ENV_VARS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN'] as const;
