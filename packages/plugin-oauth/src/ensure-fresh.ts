/**
 * Pre-request token freshness helper. Reads stored creds, refreshes when
 * within `skewMs` of expiry (or forced), persists the rotated tokens BEFORE
 * returning so a crash mid-flight can't strand a single-use refresh_token.
 *
 * The refresh + persist critical section runs under the per-credential lock
 * (`withCredentialLock`): concurrent consumers — in this process or another
 * moxxy process — coalesce into a single IdP refresh, with the followers
 * re-reading the winner's rotated tokens from the vault instead of burning
 * the (single-use, rotating) refresh_token a second time.
 *
 * Returns the live TokenSet + extras the provider can use to build headers
 * (e.g. ChatGPT-Account-Id). Throws when no credential is stored or the
 * refresh fails permanently.
 */

import { MoxxyError, classifyNetworkError } from '@moxxy/sdk';
import { isExpired, readStoredCreds, storeTokenSet, type OAuthVault, type StoredCreds } from './storage.js';
import { refreshAccessToken } from './oauth/token-exchange.js';
import { isAuthRejection, withCredentialLock } from './credential-lock.js';
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
  return withCredentialLock(`oauth-${profile.id}`, async () => {
    // Re-read under the lock: another consumer/process may have refreshed
    // while we waited. If the vault now holds a different, still-fresh access
    // token, reuse it — even under `force`, which exists for 401 recovery and
    // is satisfied by ANY rotation, not specifically ours.
    const current = (await readStoredCreds(vault, profile.id)) ?? stored;
    const rotatedMeanwhile = current.tokenSet.accessToken !== stored.tokenSet.accessToken;
    if (!isExpired(current.tokenSet, opts.skewMs) && (!opts.force || rotatedMeanwhile)) {
      return { tokens: current.tokenSet, extras: current.extras };
    }
    return refreshAndStore(profile, vault, current);
  });
}

async function refreshAndStore(
  profile: OAuthProviderProfile,
  vault: OAuthVault,
  stored: StoredCreds,
  retried = false,
): Promise<EnsureFreshResult> {
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
    // Rotation-race recovery: an invalid_grant-style rejection with a
    // DIFFERENT refresh_token now on disk means another process rotated ours
    // away after we read it. Retry once with the fresher token before
    // declaring re-auth necessary. Transient (network/5xx) failures are not
    // recovered here — they aren't evidence of rotation.
    if (!retried && isAuthRejection(err)) {
      const latest = await readStoredCreds(vault, profile.id);
      if (
        latest?.tokenSet.refreshToken &&
        latest.tokenSet.refreshToken !== stored.tokenSet.refreshToken
      ) {
        return refreshAndStore(profile, vault, latest, true);
      }
    }
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
