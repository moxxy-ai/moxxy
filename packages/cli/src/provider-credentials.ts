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
import { storedProviderApiKeyName } from '@moxxy/plugin-provider-admin';
import { resolveProviderApiKey, type ResolveOptions } from './provider-keys.js';

/**
 * Provider-aware credential resolution. The existing API-key flow (vault →
 * env → prompt) is unchanged for all providers EXCEPT the subscription-OAuth
 * ones: `openai-codex` pulls a ChatGPT token bundle (under
 * `oauth/openai-codex/*`), and `claude-code` pulls a Claude bearer (vault
 * `oauth/claude-code/*` or a `CLAUDE_CODE_OAUTH_TOKEN` env var) — each
 * exposing the live token plus a refresh hook the provider uses on a 401.
 *
 * For runtime-registered providers (plugins.provider.items in the unified config) the stored
 * `envVar` override is honored: the lookup goes through the shared
 * key-name derivation in `@moxxy/plugin-provider-admin`, the same one the
 * admin tools and the desktop use.
 */
export async function resolveProviderCredentials(
  providerName: string,
  vault: VaultStore,
  opts: ResolveOptions = {},
): Promise<Record<string, unknown>> {
  if (providerName === 'openai-codex') return resolveOAuthCodex(vault, opts);
  if (providerName === CLAUDE_CODE_PROVIDER_ID) return resolveClaudeCode(vault);
  // The `local` provider (Ollama / LM Studio / llama.cpp / vLLM) authenticates
  // against nothing, so it must activate without a key — never prompting, never
  // throwing AUTH_NO_CREDENTIALS. Supply a harmless placeholder key (the OpenAI
  // SDK requires a non-empty one) and pass an optional base-URL override
  // through; the provider's createClient defaults the endpoint to Ollama when
  // neither config nor env sets it.
  if (providerName === 'local') {
    return {
      ...(opts.providerConfig ?? {}),
      apiKey: process.env.LOCAL_API_KEY ?? 'local',
      ...(process.env.LOCAL_MODEL_BASE_URL ? { baseURL: process.env.LOCAL_MODEL_BASE_URL } : {}),
    };
  }
  const storedKeyName = await storedProviderApiKeyName(providerName).catch(() => null);
  const { providerConfig } = await resolveProviderApiKey(providerName, vault, {
    ...opts,
    ...(storedKeyName ? { keyName: storedKeyName } : {}),
  });
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

async function resolveOAuthCodex(
  vault: VaultStore,
  opts: ResolveOptions = {},
): Promise<Record<string, unknown>> {
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
    // Pass user-supplied provider.config (moxxy.config.ts) through so
    // options like `reasoningEffort` reach CodexProvider — previously this
    // returned a fresh object and silently dropped every configured option.
    ...(opts.providerConfig ?? {}),
    tokens,
    onTokensRefreshed: async (next: CodexTokens) => {
      await persistCodexTokens(vault, next);
    },
    // Cross-process recovery: when a refresh hits invalid_grant because another
    // moxxy process already rotated the single-use refresh token, the provider
    // re-reads the vault through this hook and retries once with the fresher
    // token instead of forcing a re-login.
    reloadTokens: () => readStoredTokens(vault),
  };
}
