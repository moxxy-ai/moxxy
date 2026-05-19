/**
 * Pre-request token freshness helper. Reads stored creds, refreshes when
 * within `skewMs` of expiry (or forced), persists the rotated tokens BEFORE
 * returning so a crash mid-flight can't strand a single-use refresh_token.
 *
 * Returns the live TokenSet + extras the provider can use to build headers
 * (e.g. ChatGPT-Account-Id). Throws when no credential is stored or the
 * refresh fails permanently.
 */

import { MoxxyError, classifyNetworkError } from '@moxxy/sdk';
import { isExpired, readStoredCreds, storeTokenSet, type OAuthVault } from './storage.js';
import { refreshAccessToken } from './oauth/token-exchange.js';
import type { TokenSet } from './oauth/types.js';
import type { OAuthProviderProfile } from './profile.js';

export interface EnsureFreshOptions {
  /** Force a refresh even if the access token hasn't expired. */
  readonly force?: boolean;
  /** Refresh when within this many ms of expiry. Default 60_000. */
  readonly skewMs?: number;
}

export interface EnsureFreshResult {
  readonly tokens: TokenSet;
  readonly extras: Readonly<Record<string, string>>;
}

export async function ensureFreshTokens(
  profile: OAuthProviderProfile,
  vault: OAuthVault,
  opts: EnsureFreshOptions = {},
): Promise<EnsureFreshResult> {
  const stored = await readStoredCreds(vault, profile.id);
  if (!stored) {
    throw new MoxxyError({
      code: 'AUTH_NO_CREDENTIALS',
      message: `No stored OAuth credentials for "${profile.id}".`,
      hint: `Run \`moxxy login ${profile.id}\` to sign in.`,
      context: { provider: profile.id },
    });
  }
  if (!opts.force && !isExpired(stored.tokenSet, opts.skewMs)) {
    return { tokens: stored.tokenSet, extras: stored.extras };
  }
  if (!stored.tokenSet.refreshToken) {
    throw new MoxxyError({
      code: 'AUTH_EXPIRED',
      message: `OAuth token for "${profile.id}" expired and no refresh_token is stored.`,
      hint: `Re-run \`moxxy login ${profile.id}\` to sign in again.`,
      context: { provider: profile.id },
    });
  }
  let refreshed: TokenSet;
  try {
    refreshed = await refreshAccessToken({
      tokenUrl: stored.tokenUrl,
      clientId: stored.clientId,
      ...(stored.clientSecret ? { clientSecret: stored.clientSecret } : {}),
      refreshToken: stored.tokenSet.refreshToken,
    });
  } catch (err) {
    const net = classifyNetworkError(err, { url: stored.tokenUrl, provider: profile.id });
    if (net) throw net;
    throw new MoxxyError({
      code: 'AUTH_EXPIRED',
      message: `Couldn't refresh the OAuth token for "${profile.id}".`,
      hint: `Re-run \`moxxy login ${profile.id}\` to sign in again.`,
      context: { provider: profile.id },
      cause: err,
    });
  }
  // Providers MAY rotate refresh_token — preserve the prior one if not.
  const merged: TokenSet = {
    ...refreshed,
    refreshToken: refreshed.refreshToken ?? stored.tokenSet.refreshToken,
  };

  // Re-derive extras from the fresh tokens. id_token re-issuance varies by
  // provider; when the refresh response omits id_token, fall back to the
  // previously stored extras so things like account_id survive refreshes.
  const freshAccountId = profile.extractAccountId?.(merged);
  const freshExtras = profile.extractExtras?.(merged) ?? {};
  const mergedExtras: Record<string, string> = { ...stored.extras, ...freshExtras };
  if (freshAccountId) mergedExtras.account_id = freshAccountId;

  await storeTokenSet(vault, profile.id, merged, {
    clientId: stored.clientId,
    ...(stored.clientSecret ? { clientSecret: stored.clientSecret } : {}),
    tokenUrl: stored.tokenUrl,
    extras: mergedExtras,
  });

  return { tokens: merged, extras: mergedExtras };
}
