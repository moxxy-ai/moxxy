/**
 * Claude subscription login + token lifecycle.
 *
 * Claude's OAuth is an out-of-band (manual code-paste) authorization-code +
 * PKCE flow whose token endpoint speaks JSON (not the form-encoded dialect
 * the framework's `exchangeCodeForToken` / `refreshAccessToken` assume), so
 * the HTTP exchange + refresh are implemented here. Everything else is reused
 * from `@moxxy/plugin-oauth`: PKCE, the auth-URL builder, the browser opener,
 * vault storage layout, and `parseTokenResponse`.
 */

import {
  buildAuthUrl,
  clearStoredCreds,
  computeCodeChallenge,
  generateCodeVerifier,
  generateState,
  isExpired,
  openInBrowser,
  parseTokenResponse,
  readStoredCreds,
  storeTokenSet,
  type OAuthVault,
  type TokenSet,
} from '@moxxy/plugin-oauth';
import { MoxxyError } from '@moxxy/sdk';
import type {
  ProviderAuthContext,
  ProviderOAuthResult,
  ProviderOAuthStatus,
} from '@moxxy/sdk';
import {
  CLAUDE_AUTHORIZE_URL,
  CLAUDE_CLIENT_ID,
  CLAUDE_CODE_PROVIDER_ID,
  CLAUDE_CODE_SERVICE_NAME,
  CLAUDE_REDIRECT_URI,
  CLAUDE_SCOPES,
  CLAUDE_TOKEN_URL,
} from './constants.js';

const PASTE_PROMPT =
  'Paste a token from `claude setup-token` (or press Enter to sign in via browser): ';
const CODE_PROMPT = 'Paste the authorization code shown after you approve: ';

/**
 * Drive an interactive Claude sign-in. Two ways in, both through one command:
 *   1. paste an existing `claude setup-token` token (stored verbatim), or
 *   2. press Enter to run the browser out-of-band authorization-code flow.
 * Needs `ctx.prompt` (a TTY); headless callers use `CLAUDE_CODE_OAUTH_TOKEN`.
 */
export async function claudeLogin(ctx: ProviderAuthContext): Promise<ProviderOAuthResult> {
  if (!ctx.prompt) {
    throw new MoxxyError({
      code: 'OAUTH_FLOW_NOT_SUPPORTED',
      message: 'Claude sign-in needs an interactive terminal.',
      hint:
        'Run `claude setup-token` and set CLAUDE_CODE_OAUTH_TOKEN, or run ' +
        '`moxxy login claude-code` in a terminal.',
      context: { provider: CLAUDE_CODE_PROVIDER_ID },
    });
  }

  const pasted = (await ctx.prompt(PASTE_PROMPT, { mask: true })).trim();
  if (pasted) {
    // A `setup-token` is a long-lived bearer with no refresh token; store it
    // as-is. `isExpired` treats a missing expiry as non-expiring.
    await storeTokenSet(
      ctx.vault,
      CLAUDE_CODE_PROVIDER_ID,
      { accessToken: pasted, tokenType: 'Bearer' },
      { clientId: CLAUDE_CLIENT_ID, tokenUrl: CLAUDE_TOKEN_URL },
    );
    ctx.write('\nStored your Claude token.\n');
    return {};
  }

  const verifier = generateCodeVerifier();
  const challenge = computeCodeChallenge(verifier);
  const state = generateState();
  const authUrl = buildAuthUrl({
    authUrl: CLAUDE_AUTHORIZE_URL,
    clientId: CLAUDE_CLIENT_ID,
    redirectUri: CLAUDE_REDIRECT_URI,
    scopes: [...CLAUDE_SCOPES],
    codeChallenge: challenge,
    state,
    extraAuthParams: { code: 'true' },
  });

  ctx.write(
    `\nSign in to ${CLAUDE_CODE_SERVICE_NAME} to authorize moxxy.\n\n` +
      `If your browser doesn't open automatically, paste this URL:\n\n  ${authUrl}\n\n` +
      `After approving, copy the authorization code shown and paste it back here.\n\n`,
  );
  try {
    await openBrowserImpl(authUrl);
  } catch {
    // Non-fatal — the user can open the URL surfaced above by hand.
  }

  const entered = (await ctx.prompt(CODE_PROMPT)).trim();
  if (!entered) {
    throw new MoxxyError({
      code: 'AUTH_DENIED',
      message: 'No authorization code entered — sign-in cancelled.',
      context: { provider: CLAUDE_CODE_PROVIDER_ID },
    });
  }
  // Anthropic returns `code#state`; verify the state to defeat CSRF.
  const hash = entered.indexOf('#');
  const code = hash >= 0 ? entered.slice(0, hash) : entered;
  const returnedState = hash >= 0 ? entered.slice(hash + 1) : '';
  if (returnedState && returnedState !== state) {
    throw new MoxxyError({
      code: 'AUTH_INVALID',
      message: 'Authorization state mismatch — please run sign-in again.',
      context: { provider: CLAUDE_CODE_PROVIDER_ID },
    });
  }

  const { tokenSet, accountEmail } = await exchangeClaudeCode(code, returnedState || state, verifier);
  await persistClaudeTokens(ctx.vault, tokenSet, accountEmail);
  ctx.write(`\nSigned in to Claude${accountEmail ? ` as ${accountEmail}` : ''}.\n`);
  return {
    ...(accountEmail ? { accountId: accountEmail } : {}),
    expiresAt: tokenSet.expiresAt ?? 0,
  };
}

export async function claudeLogout(ctx: ProviderAuthContext): Promise<boolean> {
  try {
    return (await clearStoredCreds(ctx.vault, CLAUDE_CODE_PROVIDER_ID)) > 0;
  } catch {
    return false;
  }
}

export async function claudeStatus(ctx: ProviderAuthContext): Promise<ProviderOAuthStatus | null> {
  const stored = await readStoredCreds(ctx.vault, CLAUDE_CODE_PROVIDER_ID);
  if (!stored) return null;
  return {
    accountId: stored.extras.account_email ?? null,
    expiresAt: stored.tokenSet.expiresAt ?? 0,
    vaultKey: `oauth/${CLAUDE_CODE_PROVIDER_ID}/*`,
  };
}

export interface FreshClaudeTokens {
  readonly accessToken: string;
  readonly expiresAt?: number;
  /** True when a refresh_token is stored, so a 401 can be recovered. */
  readonly canRefresh: boolean;
}

/**
 * Read the stored Claude creds, refreshing first if the access token is near
 * expiry and a refresh_token is available. Returns null when nothing is
 * stored. Persists rotated tokens BEFORE returning so a crash can't strand a
 * single-use refresh_token.
 */
export async function ensureFreshClaudeTokens(vault: OAuthVault): Promise<FreshClaudeTokens | null> {
  const stored = await readStoredCreds(vault, CLAUDE_CODE_PROVIDER_ID);
  if (!stored) return null;
  const { tokenSet, extras } = stored;
  if (tokenSet.refreshToken && isExpired(tokenSet)) {
    const refreshed = await refreshAndPersist(vault, tokenSet.refreshToken, extras.account_email);
    return { accessToken: refreshed.accessToken, ...(refreshed.expiresAt !== undefined ? { expiresAt: refreshed.expiresAt } : {}), canRefresh: true };
  }
  return {
    accessToken: tokenSet.accessToken,
    ...(tokenSet.expiresAt !== undefined ? { expiresAt: tokenSet.expiresAt } : {}),
    canRefresh: tokenSet.refreshToken !== undefined,
  };
}

/**
 * Force a refresh of the stored Claude tokens and persist the rotated bundle.
 * Used as the provider's reactive 401 recovery. Throws if no refresh_token is
 * stored (e.g. a pasted `setup-token`).
 */
export async function refreshClaudeAccessToken(
  vault: OAuthVault,
): Promise<{ token: string; expiresAt?: number }> {
  const stored = await readStoredCreds(vault, CLAUDE_CODE_PROVIDER_ID);
  if (!stored?.tokenSet.refreshToken) {
    throw new MoxxyError({
      code: 'AUTH_EXPIRED',
      message: 'Claude token expired and no refresh_token is stored.',
      hint: 'Run `moxxy login claude-code` again, or refresh `CLAUDE_CODE_OAUTH_TOKEN` via `claude setup-token`.',
      context: { provider: CLAUDE_CODE_PROVIDER_ID },
    });
  }
  const refreshed = await refreshAndPersist(
    vault,
    stored.tokenSet.refreshToken,
    stored.extras.account_email,
  );
  return { token: refreshed.accessToken, ...(refreshed.expiresAt !== undefined ? { expiresAt: refreshed.expiresAt } : {}) };
}

// --- internal HTTP (JSON dialect) -----------------------------------------

interface ClaudeExchangeResult {
  readonly tokenSet: TokenSet;
  readonly accountEmail?: string;
}

/** Test seam so the exchange/refresh can run against a fake fetch. */
let fetchImpl: typeof fetch = fetch;
export function __setClaudeFetch(f: typeof fetch): void {
  fetchImpl = f;
}

/** Test seam so the OOB login can run without launching a real browser. */
let openBrowserImpl: (url: string) => Promise<void> = openInBrowser;
export function __setClaudeOpenBrowser(f: (url: string) => Promise<void>): void {
  openBrowserImpl = f;
}

async function exchangeClaudeCode(
  code: string,
  state: string,
  verifier: string,
): Promise<ClaudeExchangeResult> {
  return postClaudeToken({
    grant_type: 'authorization_code',
    code,
    state,
    client_id: CLAUDE_CLIENT_ID,
    redirect_uri: CLAUDE_REDIRECT_URI,
    code_verifier: verifier,
  });
}

async function refreshAndPersist(
  vault: OAuthVault,
  refreshToken: string,
  priorEmail: string | undefined,
): Promise<TokenSet> {
  const { tokenSet, accountEmail } = await postClaudeToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLAUDE_CLIENT_ID,
  });
  // Claude rotates the refresh_token on every refresh; if a response ever
  // omits one, keep the prior so we don't lock ourselves out.
  const merged: TokenSet = tokenSet.refreshToken
    ? tokenSet
    : { ...tokenSet, refreshToken };
  await persistClaudeTokens(vault, merged, accountEmail ?? priorEmail);
  return merged;
}

async function persistClaudeTokens(
  vault: OAuthVault,
  tokenSet: TokenSet,
  accountEmail: string | undefined,
): Promise<void> {
  await storeTokenSet(vault, CLAUDE_CODE_PROVIDER_ID, tokenSet, {
    clientId: CLAUDE_CLIENT_ID,
    tokenUrl: CLAUDE_TOKEN_URL,
    ...(accountEmail ? { extras: { account_email: accountEmail } } : {}),
  });
}

async function postClaudeToken(body: Record<string, string>): Promise<ClaudeExchangeResult> {
  const res = await fetchImpl(CLAUDE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new MoxxyError({
      code: res.status === 401 || res.status === 403 ? 'AUTH_DENIED' : 'AUTH_INVALID',
      message: `Claude token endpoint returned HTTP ${res.status}: ${text.slice(0, 300)}`,
      context: { provider: CLAUDE_CODE_PROVIDER_ID, status: res.status },
    });
  }
  const json = (await res.json()) as Record<string, unknown>;
  return { tokenSet: parseTokenResponse(json), ...extractAccountEmail(json) };
}

function extractAccountEmail(json: Record<string, unknown>): { accountEmail?: string } {
  const account = json.account;
  if (account && typeof account === 'object') {
    const email = (account as { email_address?: unknown }).email_address;
    if (typeof email === 'string' && email) return { accountEmail: email };
  }
  return {};
}
