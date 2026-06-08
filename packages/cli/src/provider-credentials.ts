import type { VaultStore } from '@moxxy/plugin-vault';
import { MoxxyError } from '@moxxy/sdk';
import {
  persistCodexTokens,
  readStoredTokens,
  type CodexTokens,
} from '@moxxy/plugin-provider-openai-codex';
import {
  CLAUDE_CODE_PROVIDER_ID,
  CLAUDE_TOKEN_ENV_VARS,
  ensureFreshClaudeTokens,
  refreshClaudeAccessToken,
} from '@moxxy/plugin-provider-claude-code';
import { resolveProviderApiKey, type ResolveOptions } from './provider-keys.js';

/**
 * Provider-aware credential resolution. The existing API-key flow (vault →
 * env → prompt) is unchanged for all providers EXCEPT the subscription-OAuth
 * ones: `openai-codex` pulls a ChatGPT token bundle (under
 * `oauth/openai-codex/*`), and `claude-code` pulls a Claude bearer (vault
 * `oauth/claude-code/*` or a `CLAUDE_CODE_OAUTH_TOKEN` env var) — each
 * exposing the live token plus a refresh hook the provider uses on a 401.
 */
export async function resolveProviderCredentials(
  providerName: string,
  vault: VaultStore,
  opts: ResolveOptions = {},
): Promise<Record<string, unknown>> {
  if (providerName === 'openai-codex') return resolveOAuthCodex(vault);
  if (providerName === CLAUDE_CODE_PROVIDER_ID) return resolveClaudeCode(vault);
  const { providerConfig } = await resolveProviderApiKey(providerName, vault, opts);
  return providerConfig;
}

/**
 * Claude subscription credentials. Prefer the vault bundle written by
 * `moxxy login claude-code` (refreshed proactively when near expiry); fall
 * back to a `claude setup-token` env var for CI / non-interactive use. The
 * `oauthRefresh` hook is wired only when a refresh_token is actually stored.
 */
async function resolveClaudeCode(vault: VaultStore): Promise<Record<string, unknown>> {
  const fresh = await ensureFreshClaudeTokens(vault);
  if (fresh) {
    return {
      oauthToken: fresh.accessToken,
      ...(fresh.expiresAt !== undefined ? { oauthExpiresAt: fresh.expiresAt } : {}),
      ...(fresh.canRefresh ? { oauthRefresh: () => refreshClaudeAccessToken(vault) } : {}),
    };
  }
  for (const envVar of CLAUDE_TOKEN_ENV_VARS) {
    const token = process.env[envVar];
    if (token) return { oauthToken: token };
  }
  throw new MoxxyError({
    code: 'AUTH_NO_CREDENTIALS',
    message: 'No Claude subscription credentials found.',
    hint:
      'Run `moxxy login claude-code` to sign in with your Claude Pro/Max account, ' +
      'or set CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`.',
    context: { provider: CLAUDE_CODE_PROVIDER_ID },
  });
}

async function resolveOAuthCodex(vault: VaultStore): Promise<Record<string, unknown>> {
  let tokens: CodexTokens | null = null;
  try {
    tokens = await readStoredTokens(vault);
  } catch {
    tokens = null;
  }
  if (!tokens) {
    throw new MoxxyError({
      code: 'AUTH_NO_CREDENTIALS',
      message: 'No ChatGPT OAuth credentials found in the vault.',
      hint: 'Run `moxxy login openai-codex` to sign in with your ChatGPT Pro/Plus account.',
      context: { provider: 'openai-codex' },
    });
  }
  return {
    tokens,
    onTokensRefreshed: async (next: CodexTokens) => {
      await persistCodexTokens(vault, next);
    },
  };
}
