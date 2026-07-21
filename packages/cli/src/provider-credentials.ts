import type { VaultStore } from '@moxxy/plugin-vault';
import { MoxxyError } from '@moxxy/sdk';
import {
  persistCodexTokens,
  readStoredTokens,
  type CodexTokens,
} from '@moxxy/plugin-provider-openai-codex';
import {
  CLAUDE_CODE_PROVIDER_ID,
  checkClaudeCliAuth,
  resolveClaudeExecutable,
} from '@moxxy/plugin-provider-claude-code';
import { storedProviderApiKeyName } from '@moxxy/plugin-provider-admin';
import { resolveProviderApiKey, type ResolveOptions } from './provider-keys.js';

/**
 * Provider-aware credential resolution. The existing API-key flow (vault →
 * env → prompt) is unchanged for all providers EXCEPT the subscription-OAuth
 * ones: `openai-codex` pulls a ChatGPT token bundle, while `claude-code`
 * verifies the installed CLI and reuses its existing subscription sign-in.
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
 * The installed CLI is the only authentication source. Activation probes its
 * supported auth-status command and passes only executable/config options to
 * the provider; legacy moxxy credentials are intentionally ignored.
 */
async function resolveClaudeCode(
  _vault: VaultStore,
  opts: ResolveOptions,
): Promise<Record<string, unknown>> {
  const config = { ...(opts.providerConfig ?? {}) };
  const executable = resolveClaudeExecutable(config);
  const status = await checkClaudeCliAuth(executable);
  if (status.state !== 'signed-in') {
    throw new MoxxyError({
      code: status.state === 'signed-out' ? 'AUTH_NO_CREDENTIALS' : 'AUTH_INVALID',
      message: status.message,
      hint: status.state === 'signed-out'
        ? 'Run `moxxy login claude-code` to sign in with your Claude subscription.'
        : undefined,
      context: { provider: CLAUDE_CODE_PROVIDER_ID, executable, state: status.state },
    });
  }
  // Never read or forward legacy oauth/claude-code/* vault values. The child
  // inherits the Claude CLI's own config/auth state.
  return { ...config, executable };
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
