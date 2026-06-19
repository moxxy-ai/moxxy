import { classifyHttpStatus, MoxxyError } from '@moxxy/sdk';
import type { TokenSet } from './types.js';

interface ExchangeCodeInput {
  readonly tokenUrl: string;
  readonly code: string;
  readonly redirectUri: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly codeVerifier: string;
  /** Abort the exchange fetch when the caller's flow is cancelled. */
  readonly signal?: AbortSignal;
}

export async function exchangeCodeForToken(
  input: ExchangeCodeInput,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenSet> {
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', input.code);
  body.set('redirect_uri', input.redirectUri);
  body.set('client_id', input.clientId);
  body.set('code_verifier', input.codeVerifier);
  if (input.clientSecret) body.set('client_secret', input.clientSecret);
  const res = await fetchImpl(input.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw (
      classifyHttpStatus(res.status, { url: input.tokenUrl, body: text }) ??
      new MoxxyError({
        code: 'AUTH_INVALID',
        message: `Token exchange failed (HTTP ${res.status})${errorSummary(text)}`,
        context: { status: res.status, url: input.tokenUrl, ...bodyContext(text) },
      })
    );
  }
  const json = await parseJsonBody(res, input.tokenUrl);
  return parseTokenResponse(json);
}

/**
 * Build a human-message suffix from a token-endpoint error body. Token
 * endpoints return `{error, error_description}` (RFC 6749 §5.2); prefer those
 * structured fields verbatim. For an opaque/HTML body (proxy/captive-portal
 * error page) — provider/attacker-influenced text that flows to logs and can
 * reach the model — emit nothing in the human message; the bounded raw body
 * still lands in `context` via {@link bodyContext}.
 */
function errorSummary(body: string): string {
  const fields = parseOauthError(body);
  if (!fields) return '';
  const { error, error_description } = fields;
  const detail = error_description ?? error;
  return detail ? `: ${detail.slice(0, 300)}` : '';
}

/** Truncated raw body for the error context only (never the human message). */
function bodyContext(body: string): Record<string, string> {
  return body ? { body: body.slice(0, 200) } : {};
}

function parseOauthError(body: string): { error?: string; error_description?: string } | null {
  if (!body) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    const error = typeof obj.error === 'string' ? obj.error : undefined;
    const error_description =
      typeof obj.error_description === 'string' ? obj.error_description : undefined;
    if (!error && !error_description) return null;
    return {
      ...(error !== undefined ? { error } : {}),
      ...(error_description !== undefined ? { error_description } : {}),
    };
  } catch {
    return null; // opaque / HTML body — don't reflect it into the message
  }
}

/**
 * Parse a 2xx token-endpoint body as JSON. A provider (or an intercepting
 * proxy / captive portal / load-balancer error page) can return HTTP 200 with
 * a non-JSON or truncated body; an unguarded `res.json()` would reject with a
 * native SyntaxError that escapes the MoxxyError boundary (no code/hint, and
 * `isAuthRejection` can't classify it). Convert it to a typed error instead.
 */
async function parseJsonBody(res: { json(): Promise<unknown> }, url: string): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => {
    throw new MoxxyError({
      code: 'PROVIDER_UNKNOWN_RESPONSE',
      message: 'token endpoint returned a non-JSON success body',
      context: { url },
    });
  })) as Record<string, unknown>;
}

/**
 * Refresh an access token using a stored refresh_token. Same token
 * endpoint, different grant_type. Returns a new TokenSet — note that
 * providers MAY or MAY NOT rotate the refresh_token (Google does
 * not; Auth0 with rotation does). Caller should preserve the prior
 * refresh_token if the response omits one.
 */
export async function refreshAccessToken(
  input: {
    readonly tokenUrl: string;
    readonly clientId: string;
    readonly clientSecret?: string;
    readonly refreshToken: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<TokenSet> {
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', input.refreshToken);
  body.set('client_id', input.clientId);
  if (input.clientSecret) body.set('client_secret', input.clientSecret);
  const res = await fetchImpl(input.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // 401/403 here typically means the refresh_token was revoked/expired —
    // classifyHttpStatus maps those to AUTH_INVALID/AUTH_DENIED. Surface a
    // refresh-specific fallback for the unmapped statuses.
    throw (
      classifyHttpStatus(res.status, { url: input.tokenUrl, body: text }) ??
      new MoxxyError({
        code: 'AUTH_EXPIRED',
        message: `Token refresh failed (HTTP ${res.status})${errorSummary(text)}`,
        context: { status: res.status, url: input.tokenUrl, ...bodyContext(text) },
      })
    );
  }
  const json = await parseJsonBody(res, input.tokenUrl);
  return parseTokenResponse(json);
}

export function parseTokenResponse(json: Record<string, unknown>): TokenSet {
  const access = typeof json.access_token === 'string' ? json.access_token : null;
  if (!access) {
    throw new MoxxyError({
      code: 'PROVIDER_UNKNOWN_RESPONSE',
      message: `token response missing access_token: ${JSON.stringify(json).slice(0, 200)}`,
    });
  }
  const refresh = typeof json.refresh_token === 'string' ? json.refresh_token : undefined;
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : null;
  const scope = typeof json.scope === 'string' ? json.scope : undefined;
  const tokenType = typeof json.token_type === 'string' ? json.token_type : 'Bearer';
  const idToken = typeof json.id_token === 'string' ? json.id_token : undefined;
  return {
    accessToken: access,
    ...(refresh !== undefined ? { refreshToken: refresh } : {}),
    ...(expiresIn != null ? { expiresAt: Date.now() + expiresIn * 1000 } : {}),
    ...(scope !== undefined ? { scope } : {}),
    tokenType,
    ...(idToken !== undefined ? { idToken } : {}),
  };
}
