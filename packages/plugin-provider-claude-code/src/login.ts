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
  isAuthRejection,
  isExpired,
  openInBrowser,
  parseTokenResponse,
  readStoredCreds,
  storeTokenSet,
  withCredentialLock,
  type OAuthVault,
  type StoredCreds,
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
      `After approving, copy the authorization code shown and paste it back here.\n` +
      `(Anthropic's sign-in page sometimes shows "Internal server error" on the\n` +
      ` first attempt — just click "Try again" and it goes through.)\n\n`,
  );
  try {
    await openBrowserImpl(authUrl);
  } catch {
    // Non-fatal — the user can open the URL surfaced above by hand.
  }

  // The authorization code is a single-use, exchangeable credential — mask it
  // so it doesn't echo into scrollback / screen-share, matching the token paste.
  const entered = (await ctx.prompt(CODE_PROMPT, { mask: true })).trim();
  if (!entered) {
    throw new MoxxyError({
      code: 'AUTH_DENIED',
      message: 'No authorization code entered — sign-in cancelled.',
      context: { provider: CLAUDE_CODE_PROVIDER_ID },
    });
  }
  // Anthropic returns `code#state`, but often shows just the bare code, so the
  // state check below is best-effort: it only fires when a state was pasted.
  // The real CSRF/code-injection defense is PKCE — the `code_verifier` binds
  // the code to this client session, so a foreign code fails the exchange.
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
  // Omit `expiresAt` when the credential never expires (setup-token paste, or a
  // token response without `expires_in`). Surfacing `0` would read as "epoch =
  // already expired" to the CLI status renderer, which only checks `!== undefined`.
  return {
    ...(accountEmail ? { accountId: accountEmail } : {}),
    ...(tokenSet.expiresAt !== undefined ? { expiresAt: tokenSet.expiresAt } : {}),
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
    // Omit when absent — a stored setup-token has no expiry, and `0` would be
    // mis-rendered as "expired" (the CLI only treats `!== undefined` as set).
    ...(stored.tokenSet.expiresAt !== undefined ? { expiresAt: stored.tokenSet.expiresAt } : {}),
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
 * single-use refresh_token. The refresh itself is serialized per credential
 * (in-process + cross-process) and coalesces with concurrent refreshers.
 */
export async function ensureFreshClaudeTokens(vault: OAuthVault): Promise<FreshClaudeTokens | null> {
  const stored = await readStoredCreds(vault, CLAUDE_CODE_PROVIDER_ID);
  if (!stored) return null;
  const { tokenSet } = stored;
  if (tokenSet.refreshToken && isExpired(tokenSet)) {
    const refreshed = await refreshClaudeUnderLock(vault, stored);
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
  const refreshed = await refreshClaudeUnderLock(vault, stored);
  return { token: refreshed.accessToken, ...(refreshed.expiresAt !== undefined ? { expiresAt: refreshed.expiresAt } : {}) };
}

/**
 * Refresh + persist under the per-credential lock. Anthropic ROTATES the
 * refresh_token on every refresh and invalidates the previous one, so two
 * concurrent refreshes (a second consumer in this process, or another moxxy
 * process — TUI alongside a desktop runner) must not both burn the same
 * stored token. Under the lock we:
 *   1. re-read the vault — if someone else already rotated and the new access
 *      token is still fresh, reuse it (coalesce; no IdP call at all);
 *   2. otherwise refresh with the freshest stored refresh_token;
 *   3. on an invalid_grant-style rejection, re-read once more — if the
 *      on-disk refresh_token changed under us (another process won a race we
 *      couldn't see), retry ONCE with the fresher token before declaring
 *      re-auth necessary.
 */
async function refreshClaudeUnderLock(vault: OAuthVault, baseline: StoredCreds): Promise<TokenSet> {
  return withCredentialLock(`oauth-${CLAUDE_CODE_PROVIDER_ID}`, async () => {
    const current = (await readStoredCreds(vault, CLAUDE_CODE_PROVIDER_ID)) ?? baseline;
    if (current.tokenSet.accessToken !== baseline.tokenSet.accessToken && !isExpired(current.tokenSet)) {
      return current.tokenSet;
    }
    const refreshToken = current.tokenSet.refreshToken ?? baseline.tokenSet.refreshToken;
    if (!refreshToken) {
      throw new MoxxyError({
        code: 'AUTH_EXPIRED',
        message: 'Claude token expired and no refresh_token is stored.',
        hint: 'Run `moxxy login claude-code` again, or refresh `CLAUDE_CODE_OAUTH_TOKEN` via `claude setup-token`.',
        context: { provider: CLAUDE_CODE_PROVIDER_ID },
      });
    }
    const email = current.extras.account_email ?? baseline.extras.account_email;
    try {
      return await refreshAndPersist(vault, refreshToken, email);
    } catch (err) {
      if (isAuthRejection(err)) {
        const latest = await readStoredCreds(vault, CLAUDE_CODE_PROVIDER_ID);
        const latestRefresh = latest?.tokenSet.refreshToken;
        if (latestRefresh && latestRefresh !== refreshToken) {
          return refreshAndPersist(vault, latestRefresh, latest.extras.account_email ?? email);
        }
      }
      throw err;
    }
  });
}

// --- internal HTTP (JSON dialect) -----------------------------------------

interface ClaudeExchangeResult {
  readonly tokenSet: TokenSet;
  readonly accountEmail?: string;
}

/**
 * Anthropic's OAuth endpoints (both `claude.ai/oauth/authorize` and the token
 * endpoint) intermittently return a transient HTTP 500 — the *same* request
 * then succeeds on retry. So retry 5xx/429/network failures with a short
 * backoff before giving up. 4xx (bad/expired/already-used code, invalid_grant)
 * is deterministic and surfaced immediately, never retried.
 */
const TOKEN_POST_MAX_ATTEMPTS = 3;
const TOKEN_POST_BACKOFF_MS = [600, 1800] as const;
/**
 * Per-attempt deadline on the token POST. Node's `fetch` has NO default
 * timeout, so a half-open TCP socket (server accepts but never responds — a
 * stalled edge node, a black-holing proxy, a captive portal that keeps the
 * connection alive) would hang the whole login/refresh indefinitely. Bound
 * each attempt; a timeout aborts the request and is classed as a transient
 * network error, so the retry loop tries again and ultimately surfaces the
 * "endpoint kept failing" hint instead of wedging forever.
 */
const TOKEN_POST_TIMEOUT_MS = 30_000;

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

/** Test seam so the retry backoff doesn't actually sleep under test. */
let sleepImpl = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
export function __setClaudeSleep(f: (ms: number) => Promise<void>): void {
  sleepImpl = f;
}

/** Test seam to shrink the per-attempt network deadline (default {@link TOKEN_POST_TIMEOUT_MS}). */
let timeoutMs = TOKEN_POST_TIMEOUT_MS;
export function __setClaudeTimeoutMs(ms: number): void {
  timeoutMs = ms;
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
  let transient = '';
  for (let attempt = 1; attempt <= TOKEN_POST_MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleepImpl(TOKEN_POST_BACKOFF_MS[attempt - 2] ?? 1800);

    let res: Response;
    try {
      res = await fetchImpl(CLAUDE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        // Bound a hung connection so it surfaces as a retryable network error
        // (TimeoutError) rather than blocking the login/refresh forever.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      transient = `network error (${err instanceof Error ? err.message : String(err)})`;
      continue;
    }

    if (res.ok) {
      // A captive portal / proxy / misbehaving edge can return 200 with an HTML
      // or empty body, or a JSON primitive/array. Treat any of these as a
      // transient and retry rather than letting a raw SyntaxError escape the
      // retry/classify path.
      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch {
        transient = 'HTTP 200 with non-JSON body';
        continue;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        transient = 'HTTP 200 with malformed token response';
        continue;
      }
      const json = parsed as Record<string, unknown>;
      return { tokenSet: parseTokenResponse(json), ...extractAccountEmail(json) };
    }

    const text = await res.text().catch(() => '');
    // Deterministic client errors: surface immediately, don't burn retries.
    if (res.status < 500 && res.status !== 429) {
      throw new MoxxyError({
        code: res.status === 401 || res.status === 403 ? 'AUTH_DENIED' : 'AUTH_INVALID',
        message: `Claude token endpoint returned HTTP ${res.status}: ${text.slice(0, 300)}`,
        context: { provider: CLAUDE_CODE_PROVIDER_ID, status: res.status },
      });
    }
    // 5xx / 429 — Anthropic-side flake; loop and try the same request again.
    transient = `HTTP ${res.status}: ${text.slice(0, 200)}`;
  }

  throw new MoxxyError({
    code: 'AUTH_INVALID',
    message: `Claude token endpoint kept failing after ${TOKEN_POST_MAX_ATTEMPTS} attempts (last: ${transient}).`,
    hint:
      "Anthropic's OAuth endpoint is returning transient errors right now — " +
      'wait a few seconds and run `moxxy login claude-code` again.',
    context: { provider: CLAUDE_CODE_PROVIDER_ID },
  });
}

function extractAccountEmail(json: Record<string, unknown>): { accountEmail?: string } {
  const account = json.account;
  if (account && typeof account === 'object') {
    const email = (account as { email_address?: unknown }).email_address;
    if (typeof email === 'string' && email) return { accountEmail: email };
  }
  return {};
}
