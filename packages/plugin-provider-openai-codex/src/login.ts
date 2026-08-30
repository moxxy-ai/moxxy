/**
 * Codex OAuth login — thin wrapper over `@moxxy/plugin-oauth`'s provider
 * framework. Everything generic (loopback callback server, browser opener,
 * device-flow polling, vault persistence, refresh) lives in plugin-oauth;
 * this file only carries the codex-shaped mapping into `CodexTokens` that
 * the provider class consumes.
 */

import {
  clearStoredCreds,
  ensureFreshTokens,
  readStoredCreds,
  runOauthLogin,
  storeTokenSet,
  type OAuthVault,
  type StoredCreds,
} from '@moxxy/plugin-oauth';
import type {
  ProviderAuthContext,
  ProviderOAuthResult,
  ProviderOAuthStatus,
} from '@moxxy/sdk';
import { CODEX_PROVIDER_ID, codexOauthProfile } from './profile.js';
import type { CodexTokens } from './types.js';

export async function codexLogin(ctx: ProviderAuthContext): Promise<ProviderOAuthResult> {
  const result = await runOauthLogin(codexOauthProfile, {
    vault: ctx.vault,
    headless: ctx.headless,
    write: ctx.write,
    ...(ctx.noOpen ? { noOpen: true } : {}),
    ...(ctx.onAuthUrl ? { onAuthUrl: ctx.onAuthUrl } : {}),
  });
  return result.accountId
    ? { accountId: result.accountId, expiresAt: result.tokens.expiresAt ?? 0 }
    : { expiresAt: result.tokens.expiresAt ?? 0 };
}

export async function codexLogout(ctx: ProviderAuthContext): Promise<boolean> {
  try {
    const removed = await clearStoredCreds(ctx.vault, CODEX_PROVIDER_ID);
    return removed > 0;
  } catch {
    return false;
  }
}

export async function codexStatus(ctx: ProviderAuthContext): Promise<ProviderOAuthStatus | null> {
  const stored = await readStoredCreds(ctx.vault, CODEX_PROVIDER_ID);
  if (!stored) return null;
  return {
    accountId: stored.extras.account_id ?? null,
    expiresAt: stored.tokenSet.expiresAt ?? 0,
    vaultKey: `oauth/${CODEX_PROVIDER_ID}/*`,
  };
}

/**
 * Read the stored token set in the legacy `CodexTokens` shape the provider
 * class expects. Returns `null` if nothing is stored — the provider then
 * reports the "run `moxxy login openai-codex`" error to the caller.
 */
export async function readStoredTokens(vault: OAuthVault): Promise<CodexTokens | null> {
  const stored = await readStoredCreds(vault, CODEX_PROVIDER_ID);
  return stored ? toCodexTokens(stored) : null;
}

/**
 * Pre-request freshness gate consumed by `CodexProvider.ensureFresh`.
 * Reads the stored creds, refreshes if near expiry, persists the rotated
 * tokens BEFORE returning so a crash here can't strand a single-use
 * refresh_token in memory.
 */
export async function ensureFreshCodexTokens(vault: OAuthVault): Promise<CodexTokens> {
  const { tokens, extras } = await ensureFreshTokens(codexOauthProfile, vault);
  if (!tokens.refreshToken) {
    throw new Error('refreshed token set missing refresh_token');
  }
  return {
    access: tokens.accessToken,
    refresh: tokens.refreshToken,
    expires: tokens.expiresAt ?? 0,
    ...(extras.account_id ? { accountId: extras.account_id } : {}),
  };
}

/**
 * Persist the provider's in-memory `CodexTokens` back into the vault after
 * an in-flight refresh. Wires the `CodexProvider.onTokensRefreshed`
 * callback to the same storage layout `runOauthLogin` writes.
 */
export async function persistCodexTokens(
  vault: OAuthVault,
  tokens: CodexTokens,
): Promise<void> {
  await storeTokenSet(
    vault,
    CODEX_PROVIDER_ID,
    {
      accessToken: tokens.access,
      refreshToken: tokens.refresh,
      expiresAt: tokens.expires,
      tokenType: 'Bearer',
    },
    {
      clientId: codexOauthProfile.clientId,
      tokenUrl: codexOauthProfile.tokenUrl,
      extras: tokens.accountId ? { account_id: tokens.accountId } : {},
    },
  );
}

function toCodexTokens(stored: StoredCreds): CodexTokens {
  if (!stored.tokenSet.refreshToken) {
    throw new Error(`Stored codex creds missing refresh_token under oauth/${CODEX_PROVIDER_ID}/`);
  }
  return {
    access: stored.tokenSet.accessToken,
    refresh: stored.tokenSet.refreshToken,
    expires: stored.tokenSet.expiresAt ?? 0,
    ...(stored.extras.account_id ? { accountId: stored.extras.account_id } : {}),
  };
}
