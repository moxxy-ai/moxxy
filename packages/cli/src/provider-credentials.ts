import type { VaultStore } from '@moxxy/plugin-vault';
import { MoxxyError } from '@moxxy/sdk';
import {
  persistCodexTokens,
  readStoredTokens,
  type CodexTokens,
} from '@moxxy/plugin-provider-openai-codex';
import { resolveProviderApiKey, type ResolveOptions } from './provider-keys.js';

/**
 * Provider-aware credential resolution. The existing API-key flow (vault →
 * env → prompt) is unchanged for all providers EXCEPT `openai-codex`, which
 * pulls the OAuth token bundle from the vault (under `oauth/openai-codex/*`)
 * and exposes both the tokens AND a writeback callback that persists
 * refreshed tokens before the next API call goes out.
 */
export async function resolveProviderCredentials(
  providerName: string,
  vault: VaultStore,
  opts: ResolveOptions = {},
): Promise<Record<string, unknown>> {
  if (providerName === 'openai-codex') return resolveOAuthCodex(vault);
  const { providerConfig } = await resolveProviderApiKey(providerName, vault, opts);
  return providerConfig;
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
