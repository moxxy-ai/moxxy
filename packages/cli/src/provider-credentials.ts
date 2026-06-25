import type { VaultStore } from '@moxxy/plugin-vault';
import { MoxxyError } from '@moxxy/sdk';
import {
  persistCodexTokens,
  readStoredTokens,
  readInstalledCodexTokens,
  writeInstalledCodexTokens,
  type CodexTokens,
} from '@moxxy/plugin-provider-openai-codex';
import {
  CLAUDE_CODE_PROVIDER_ID,
  CLAUDE_TOKEN_ENV_VARS,
  ensureFreshClaudeTokens,
  refreshClaudeAccessToken,
  refreshClaudeTokenDirect,
  readInstalledClaudeCreds,
  writeInstalledClaudeCreds,
} from '@moxxy/plugin-provider-claude-code';
import { storedProviderApiKeyName } from '@moxxy/plugin-provider-admin';
import { resolveProviderApiKey, type ResolveOptions } from './provider-keys.js';

/**
 * Where a provider's resolved credentials came from. Surfaced through the
 * runner's provider info so the desktop/CLI can show e.g. "Connected via
 * installed Claude CLI" instead of leaving an auto-activated provider looking
 * unconfigured. `'installed-cli'` is the borrow-from-the-installed-CLI path.
 */
export type CredentialSource = 'config' | 'vault' | 'env' | 'prompt' | 'installed-cli';

export interface ResolvedCredentials {
  readonly config: Record<string, unknown>;
  readonly source: CredentialSource;
}

/**
 * Provider-aware credential resolution. The existing API-key flow (vault →
 * env → prompt) is unchanged for all providers EXCEPT the subscription-OAuth
 * ones: `openai-codex` and `claude-code` resolve in the order
 *
 *   moxxy vault (`moxxy login`) → env var → the INSTALLED CLI's own store
 *
 * The last step is "borrow live": if the user already signed into the `codex`
 * or `claude` CLI, moxxy reads that CLI's token directly (codex
 * `~/.codex/auth.json`; claude macOS Keychain / `~/.claude/.credentials.json`)
 * and lets the CLI stay the owner — only refreshing + writing back when the
 * CLI's own token has gone stale. This makes the provider work out of the box,
 * with no separate `moxxy login`.
 *
 * For runtime-registered providers (~/.moxxy/providers.json) the stored
 * `envVar` override is honored via the shared key-name derivation in
 * `@moxxy/plugin-provider-admin`.
 */
export async function resolveProviderCredentials(
  providerName: string,
  vault: VaultStore,
  opts: ResolveOptions = {},
): Promise<Record<string, unknown>> {
  return (await resolveProviderCredentialsDetailed(providerName, vault, opts)).config;
}

/**
 * Like {@link resolveProviderCredentials} but also reports where the
 * credentials came from (for the "connected via …" badge). Activation uses
 * this; the plain variant above stays the hot path for callers that only need
 * the config (the runtime credential resolver, the readiness probe).
 */
export async function resolveProviderCredentialsDetailed(
  providerName: string,
  vault: VaultStore,
  opts: ResolveOptions = {},
): Promise<ResolvedCredentials> {
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
      config: {
        ...(opts.providerConfig ?? {}),
        apiKey: process.env.LOCAL_API_KEY ?? 'local',
        ...(process.env.LOCAL_MODEL_BASE_URL ? { baseURL: process.env.LOCAL_MODEL_BASE_URL } : {}),
      },
      source: 'config',
    };
  }
  const storedKeyName = await storedProviderApiKeyName(providerName).catch(() => null);
  const { providerConfig, source } = await resolveProviderApiKey(providerName, vault, {
    ...opts,
    ...(storedKeyName ? { keyName: storedKeyName } : {}),
  });
  return { config: providerConfig, source };
}

/**
 * Claude subscription credentials. Prefer the vault bundle written by
 * `moxxy login claude-code` (refreshed proactively when near expiry); then a
 * `claude setup-token` env var; then borrow the token from an installed
 * `claude` CLI. The `oauthRefresh` hook is wired only when a refresh path
 * actually exists.
 */
async function resolveClaudeCode(vault: VaultStore): Promise<ResolvedCredentials> {
  const fresh = await ensureFreshClaudeTokens(vault);
  if (fresh) {
    return {
      config: {
        oauthToken: fresh.accessToken,
        ...(fresh.expiresAt !== undefined ? { oauthExpiresAt: fresh.expiresAt } : {}),
        ...(fresh.canRefresh ? { oauthRefresh: () => refreshClaudeAccessToken(vault) } : {}),
      },
      source: 'vault',
    };
  }
  for (const envVar of CLAUDE_TOKEN_ENV_VARS) {
    const token = process.env[envVar];
    if (token) return { config: { oauthToken: token }, source: 'env' };
  }
  const installed = await readInstalledClaudeCreds();
  if (installed) {
    return {
      config: {
        oauthToken: installed.accessToken,
        ...(installed.expiresAt !== undefined ? { oauthExpiresAt: installed.expiresAt } : {}),
        // Borrow-live refresh: re-read the CLI's store first (it may have
        // rotated the token itself); only refresh + write back when the
        // store's token is itself stale. Wired only when a refresh token
        // exists to recover with.
        ...(installed.refreshToken ? { oauthRefresh: borrowLiveClaudeRefresh } : {}),
      },
      source: 'installed-cli',
    };
  }
  throw new MoxxyError({
    code: 'AUTH_NO_CREDENTIALS',
    message: 'No Claude subscription credentials found.',
    hint:
      'Sign in with the `claude` CLI (its token is picked up automatically), run ' +
      '`moxxy login claude-code`, or set CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`.',
    context: { provider: CLAUDE_CODE_PROVIDER_ID },
  });
}

/**
 * Refresh hook for a token borrowed from the installed `claude` CLI. Defers to
 * the CLI: first re-reads its store (picking up a token it refreshed itself for
 * free), and only when that's still stale does it refresh against the IdP and
 * write the rotated bundle back to the CLI's store so the two stay in sync.
 */
async function borrowLiveClaudeRefresh(): Promise<{ token: string; expiresAt?: number }> {
  const current = await readInstalledClaudeCreds();
  if (current && current.expiresAt !== undefined && current.expiresAt > Date.now() + 60_000) {
    return { token: current.accessToken, ...(current.expiresAt !== undefined ? { expiresAt: current.expiresAt } : {}) };
  }
  const refreshToken = current?.refreshToken;
  if (!refreshToken) {
    throw new MoxxyError({
      code: 'AUTH_EXPIRED',
      message: 'The installed Claude CLI token expired and has no refresh token to recover with.',
      hint: 'Run any `claude` command to refresh it, or run `moxxy login claude-code`.',
      context: { provider: CLAUDE_CODE_PROVIDER_ID },
    });
  }
  const refreshed = await refreshClaudeTokenDirect(refreshToken);
  // Write the rotated bundle back to the CLI's store (best-effort): we already
  // hold the fresh token, so a write failure must not fail the turn — it only
  // means the CLI re-auths later.
  await writeInstalledClaudeCreds({
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? refreshToken,
    ...(refreshed.expiresAt !== undefined ? { expiresAt: refreshed.expiresAt } : {}),
    ...(current?.subscriptionType ? { subscriptionType: current.subscriptionType } : {}),
  }).catch(() => {});
  return {
    token: refreshed.accessToken,
    ...(refreshed.expiresAt !== undefined ? { expiresAt: refreshed.expiresAt } : {}),
  };
}

async function resolveOAuthCodex(
  vault: VaultStore,
  opts: ResolveOptions = {},
): Promise<ResolvedCredentials> {
  let tokens: CodexTokens | null = null;
  try {
    tokens = await readStoredTokens(vault);
  } catch {
    tokens = null;
  }
  if (tokens) {
    return {
      config: {
        // Pass user-supplied provider.config (moxxy.config.ts) through so
        // options like `reasoningEffort` reach CodexProvider — previously this
        // returned a fresh object and silently dropped every configured option.
        ...(opts.providerConfig ?? {}),
        tokens,
        onTokensRefreshed: async (next: CodexTokens) => {
          await persistCodexTokens(vault, next);
        },
        // Cross-process recovery: when a refresh hits invalid_grant because
        // another moxxy process already rotated the single-use refresh token,
        // the provider re-reads the vault through this hook and retries once
        // with the fresher token instead of forcing a re-login.
        reloadTokens: () => readStoredTokens(vault),
      },
      source: 'vault',
    };
  }
  // Borrow live from an installed `codex` CLI. Same provider hooks, but pointed
  // at the CLI's `auth.json`: `reloadTokens` picks up a token the codex CLI
  // rotated itself; `onTokensRefreshed` writes our rotations back so the CLI
  // doesn't hit invalid_grant on its next run.
  const installed = await readInstalledCodexTokens();
  if (installed) {
    return {
      config: {
        ...(opts.providerConfig ?? {}),
        tokens: installed,
        onTokensRefreshed: async (next: CodexTokens) => {
          await writeInstalledCodexTokens(next).catch(() => {});
        },
        reloadTokens: () => readInstalledCodexTokens(),
      },
      source: 'installed-cli',
    };
  }
  throw new MoxxyError({
    code: 'AUTH_NO_CREDENTIALS',
    message: 'No ChatGPT OAuth credentials found.',
    hint:
      'Sign in with the `codex` CLI (its token is picked up automatically) or run ' +
      '`moxxy login openai-codex` to sign in with your ChatGPT Pro/Plus account.',
    context: { provider: 'openai-codex' },
  });
}
