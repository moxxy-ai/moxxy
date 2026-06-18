import { defineTool, MoxxyError, z } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import {
  buildAuthUrl,
  refreshAccessToken,
  runAuthorizationCodeFlow,
  runDeviceCodeFlow,
  type DevicePrompt,
  type TokenSet,
} from './flow.js';
import { generateCodeVerifier, generateState } from './pkce.js';
import {
  clearStoredCreds,
  isExpired,
  readStoredCreds,
  storeTokenSet,
  validateProvider,
  type OAuthVault,
  type StoredCreds,
} from './storage.js';
import { isAuthRejection, withCredentialLock } from './credential-lock.js';
import { classifyNetworkError } from '@moxxy/sdk';

export interface OAuthToolDeps {
  readonly vault: VaultStore;
}

const providerNameField = z
  .string()
  .min(1)
  .max(60)
  .describe(
    'Stable provider key used as the vault namespace (e.g. "google", "github", ' +
      '"notion"). Lowercase letters, digits, dot/dash/underscore only.',
  );

export function buildOauthAuthorizeTool(deps: OAuthToolDeps) {
  return defineTool({
    name: 'oauth_authorize',
    description:
      'Run an OAuth 2.0 authorization-code flow (PKCE) against any provider, ' +
      'or RFC 8628 device-code flow for headless hosts. Opens the user\'s ' +
      'browser (loopback mode), or prints a code to type on another device ' +
      '(device mode). Stores the resulting tokens in the vault under ' +
      '`oauth/<provider>/*`. Subsequent `oauth_get_token` calls auto-refresh ' +
      'when the access token expires. Returns when the user finishes the dance.',
    inputSchema: z.object({
      provider: providerNameField,
      authUrl: z
        .string()
        .url()
        .optional()
        .describe(
          'Provider authorization endpoint. Required for `mode: "loopback"`. ' +
            'E.g. https://accounts.google.com/o/oauth2/v2/auth',
        ),
      tokenUrl: z
        .string()
        .url()
        .describe('Provider token endpoint. E.g. https://oauth2.googleapis.com/token'),
      deviceUrl: z
        .string()
        .url()
        .optional()
        .describe(
          'Provider device-authorization endpoint. Required for `mode: "device"`. ' +
            'E.g. https://oauth2.googleapis.com/device/code',
        ),
      clientId: z.string().min(1),
      clientSecret: z
        .string()
        .optional()
        .describe('Required for confidential clients (most server-side apps). Omit for native/installed apps using PKCE alone.'),
      scopes: z.array(z.string().min(1)).min(1),
      mode: z
        .enum(['loopback', 'device'])
        .optional()
        .describe(
          'Flow mode. "loopback" (default) opens a browser + local callback ' +
            'server. "device" prints a code for the user to type into another ' +
            'device — use when running headless (SSH session, CI, no display).',
        ),
      redirectPort: z
        .number()
        .int()
        .positive()
        .max(65535)
        .optional()
        .describe('Loopback-mode redirect port. Default 8765. MUST match what you registered with the provider.'),
      redirectPath: z
        .string()
        .optional()
        .describe('Loopback-mode redirect path. Default "/callback".'),
      extraAuthParams: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          'Provider-specific auth-URL params. Google wants `access_type=offline` + `prompt=consent` ' +
            'to issue a refresh_token; Auth0 may want `audience=...`.',
        ),
      noOpen: z
        .boolean()
        .optional()
        .describe(
          'Loopback-mode only: skip auto-opening the browser. The auth URL is ' +
            'logged via the tool logger so the user can open it manually on the ' +
            'host where the loopback server is reachable.',
        ),
    }),
    permission: { action: 'prompt' },
    async handler(input, ctx) {
      validateProvider(input.provider);
      const mode = input.mode ?? 'loopback';

      let tokens: TokenSet;
      if (mode === 'device') {
        if (!input.deviceUrl) {
          throw new MoxxyError({
            code: 'TOOL_ERROR',
            message: 'mode="device" requires `deviceUrl` (the provider\'s device-authorization endpoint)',
          });
        }
        tokens = await runDeviceCodeFlow({
          deviceUrl: input.deviceUrl,
          tokenUrl: input.tokenUrl,
          clientId: input.clientId,
          ...(input.clientSecret ? { clientSecret: input.clientSecret } : {}),
          scopes: input.scopes,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
          onPrompt: (info: DevicePrompt) => {
            // Surface the prompt prominently via the tool logger so the
            // channel renders it as a system notice. The model can also
            // see this in the event log and echo it to the user.
            ctx.logger.info('oauth_authorize: device flow — visit URL', {
              verificationUri: info.verificationUri,
              ...(info.verificationUriComplete ? { verificationUriComplete: info.verificationUriComplete } : {}),
              userCode: info.userCode,
              expiresInSec: info.expiresIn,
            });
            // Belt-and-suspenders: stderr in case the logger isn't
            // wired to a visible surface in the current channel.
            process.stderr.write(
              `\n  Open ${info.verificationUri} and enter code: ${info.userCode}\n` +
                (info.verificationUriComplete
                  ? `  (or visit directly: ${info.verificationUriComplete})\n`
                  : '') +
                `  Code expires in ${Math.floor(info.expiresIn / 60)}m.\n\n`,
            );
          },
        });
      } else {
        if (!input.authUrl) {
          throw new MoxxyError({
            code: 'TOOL_ERROR',
            message: 'mode="loopback" requires `authUrl` (the provider\'s authorization endpoint)',
          });
        }
        if (input.noOpen) {
          // Compute + log the URL without spawning a browser.
          const verifier = generateCodeVerifier();
          const state = generateState();
          const { computeCodeChallenge } = await import('./pkce.js');
          const challenge = computeCodeChallenge(verifier);
          const port = input.redirectPort ?? 8765;
          const path = input.redirectPath ?? '/callback';
          const url = buildAuthUrl({
            authUrl: input.authUrl,
            clientId: input.clientId,
            redirectUri: `http://localhost:${port}${path}`,
            scopes: input.scopes,
            codeChallenge: challenge,
            state,
            ...(input.extraAuthParams ? { extraAuthParams: input.extraAuthParams } : {}),
          });
          ctx.logger.info('oauth_authorize: open this URL manually', { url });
          process.stderr.write(`\n  Open this URL in a browser on this host:\n  ${url}\n\n`);
        }
        tokens = await runAuthorizationCodeFlow({
          authUrl: input.authUrl,
          tokenUrl: input.tokenUrl,
          clientId: input.clientId,
          ...(input.clientSecret ? { clientSecret: input.clientSecret } : {}),
          scopes: input.scopes,
          ...(input.redirectPort !== undefined ? { redirectPort: input.redirectPort } : {}),
          ...(input.redirectPath !== undefined ? { redirectPath: input.redirectPath } : {}),
          ...(input.extraAuthParams ? { extraAuthParams: input.extraAuthParams } : {}),
          ...(input.noOpen ? { noOpen: true } : {}),
          ...(ctx.signal ? { signal: ctx.signal } : {}),
          onAuthUrl: (url) => {
            ctx.logger.info('oauth_authorize: opening browser', { url });
          },
        });
      }

      await storeTokenSet(deps.vault, input.provider, tokens, {
        clientId: input.clientId,
        ...(input.clientSecret ? { clientSecret: input.clientSecret } : {}),
        tokenUrl: input.tokenUrl,
      });

      return summarizeTokens(input.provider, tokens);
    },
  });
}

export function buildOauthGetTokenTool(deps: OAuthToolDeps) {
  return defineTool({
    name: 'oauth_get_token',
    description:
      'Read the stored access token for an OAuth provider, transparently ' +
      'refreshing it via refresh_token if it has expired. Returns the bearer ' +
      'token ready to drop into an Authorization header. Throws if no token ' +
      'has been stored — call `oauth_authorize` first.',
    inputSchema: z.object({
      provider: providerNameField,
      forceRefresh: z
        .boolean()
        .optional()
        .describe('Refresh even if the cached token has not expired yet.'),
      includeRefresh: z
        .boolean()
        .optional()
        .describe(
          'Also return the refresh_token. Default false — the refresh_token ' +
            'is more sensitive than the access_token and most callers never ' +
            'need it. Set true when wiring an MCP server (or other long-lived ' +
            'subprocess) that needs to mint its own access tokens.',
        ),
    }),
    permission: { action: 'prompt' },
    async handler({ provider, forceRefresh, includeRefresh }, _ctx) {
      const stored = await readStoredCreds(deps.vault, provider);
      if (!stored) {
        throw new MoxxyError({
          code: 'AUTH_NO_CREDENTIALS',
          message: `no stored OAuth credentials for "${provider}". Run oauth_authorize first.`,
          context: { provider },
        });
      }
      // Fast path: a still-fresh token needs no lock and no network. Refreshing
      // a rotating single-use refresh_token, on the other hand, MUST serialize
      // per credential (a second concurrent refresher — another oauth_get_token
      // call OR a provider's ensureFreshTokens sharing this vault credential —
      // would otherwise burn the now-rotated token and log the user out). Route
      // the refresh+persist critical section through the same per-credential
      // lock ensure-fresh.ts uses, re-reading inside the lock so a queued
      // waiter reuses the winner's rotated token instead of re-racing.
      if (!forceRefresh && !isExpired(stored.tokenSet)) {
        return summarizeTokens(provider, stored.tokenSet, {
          includeAccess: true,
          ...(includeRefresh ? { includeRefresh: true } : {}),
        });
      }
      const tokens = await withCredentialLock(`oauth-${provider}`, async () => {
        // Re-read under the lock: another consumer/process may have refreshed
        // while we queued. Reuse a now-fresh token even under forceRefresh,
        // which exists for 401 recovery and is satisfied by ANY rotation.
        const current = (await readStoredCreds(deps.vault, provider)) ?? stored;
        const rotatedMeanwhile = current.tokenSet.accessToken !== stored.tokenSet.accessToken;
        if (!isExpired(current.tokenSet) && (!forceRefresh || rotatedMeanwhile)) {
          return current.tokenSet;
        }
        return refreshAndStoreCreds(deps.vault, provider, current);
      });
      return summarizeTokens(provider, tokens, {
        includeAccess: true,
        ...(includeRefresh ? { includeRefresh: true } : {}),
      });
    },
  });
}

export function buildOauthClearTool(deps: OAuthToolDeps) {
  return defineTool({
    name: 'oauth_clear_token',
    description:
      'Delete every stored credential for an OAuth provider — access token, ' +
      'refresh token, client config, etc. Use when the user wants to revoke ' +
      'the grant or re-do the flow with different scopes.',
    inputSchema: z.object({ provider: providerNameField }),
    permission: { action: 'prompt' },
    async handler({ provider }) {
      const removed = await clearStoredCreds(deps.vault, provider);
      return { ok: true, provider, removedKeys: removed };
    },
  });
}

/**
 * Refresh + persist for `oauth_get_token`, mirroring ensure-fresh.ts's
 * `refreshAndStore` but keyed off raw StoredCreds (the tool has no provider
 * profile). MUST run inside `withCredentialLock` — it is a second writer to the
 * same `oauth/<provider>/*` keys that ensure-fresh.ts guards. Preserves a
 * rotated-or-prior refresh_token (RFC 6749 §6) and recovers once from an
 * invalid_grant when another process rotated our refresh_token away after we
 * read it. Re-persists the stored extras so a store-layer change can't silently
 * wipe account_id on a tool-driven refresh.
 */
async function refreshAndStoreCreds(
  vault: OAuthVault,
  provider: string,
  stored: StoredCreds,
  retried = false,
): Promise<TokenSet> {
  if (!stored.tokenSet.refreshToken) {
    throw new MoxxyError({
      code: 'AUTH_EXPIRED',
      message: `OAuth token for "${provider}" expired and no refresh_token is stored. Re-run oauth_authorize.`,
      context: { provider },
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
    // Rotation-race recovery: an invalid_grant-style rejection with a DIFFERENT
    // refresh_token now on disk means another process rotated ours away after
    // we read it. Retry once with the fresher token before surfacing the error.
    // Transient (network/5xx) failures aren't evidence of rotation — don't loop.
    if (!retried && isAuthRejection(err)) {
      const latest = await readStoredCreds(vault, provider);
      if (
        latest?.tokenSet.refreshToken &&
        latest.tokenSet.refreshToken !== stored.tokenSet.refreshToken
      ) {
        return refreshAndStoreCreds(vault, provider, latest, true);
      }
    }
    const net = classifyNetworkError(err, { url: stored.tokenUrl, provider });
    if (net) throw net;
    throw err;
  }
  // Providers MAY rotate refresh_token; preserve the prior one if not.
  const merged: TokenSet = {
    ...refreshed,
    refreshToken: refreshed.refreshToken ?? stored.tokenSet.refreshToken,
  };
  await storeTokenSet(vault, provider, merged, {
    clientId: stored.clientId,
    ...(stored.clientSecret ? { clientSecret: stored.clientSecret } : {}),
    tokenUrl: stored.tokenUrl,
    ...(Object.keys(stored.extras).length > 0 ? { extras: stored.extras } : {}),
  });
  return merged;
}

function summarizeTokens(
  provider: string,
  tokens: TokenSet,
  opts: { includeAccess?: boolean; includeRefresh?: boolean } = {},
): Record<string, unknown> {
  return {
    provider,
    tokenType: tokens.tokenType,
    expiresAt: tokens.expiresAt ?? null,
    scope: tokens.scope ?? null,
    hasRefreshToken: tokens.refreshToken !== undefined,
    // The actual access_token only flows through `oauth_get_token`
    // (the model needs it to make API calls). For `oauth_authorize`
    // the response is a confirmation; the token stays in the vault.
    ...(opts.includeAccess
      ? { accessToken: tokens.accessToken, ...(tokens.idToken ? { idToken: tokens.idToken } : {}) }
      : {}),
    ...(opts.includeRefresh && tokens.refreshToken !== undefined
      ? { refreshToken: tokens.refreshToken }
      : {}),
  };
}
