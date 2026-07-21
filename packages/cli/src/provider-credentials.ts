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
  if (providerName === CLAUDE_CODE_PROVIDER_ID) return resolveClaudeCode(vault, opts);
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
 * The installed CLI is the primary authentication source, so activation must
 * also work with no moxxy credential at all. When moxxy has a token (from its
 * login flow or an env var), pass it to the provider; the provider supplies it
 * to the child through CLAUDE_CODE_OAUTH_TOKEN rather than command-line args.
 */
async function resolveClaudeCode(
  vault: VaultStore,
  opts: ResolveOptions,
): Promise<Record<string, unknown>> {
  const config = { ...(opts.providerConfig ?? {}) };
  const fresh = await ensureFreshClaudeTokens(vault);
  if (fresh) {
    return {
      ...config,
      oauthToken: fresh.accessToken,
      ...(fresh.expiresAt !== undefined ? { oauthExpiresAt: fresh.expiresAt } : {}),
      ...(fresh.canRefresh ? { oauthRefresh: () => refreshClaudeAccessToken(vault) } : {}),
    };
  }

  for (const envVar of CLAUDE_TOKEN_ENV_VARS) {
    const token = process.env[envVar];
    if (token) return { ...config, oauthToken: token };
  }
  return config;
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
