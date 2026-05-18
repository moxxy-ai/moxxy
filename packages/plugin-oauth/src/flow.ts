import { createServer, type Server } from 'node:http';
import { computeCodeChallenge, generateCodeVerifier, generateState } from './pkce.js';
import { openInBrowser } from './open-browser.js';

export interface OAuthFlowOptions {
  /** Provider's authorization endpoint, e.g. https://accounts.google.com/o/oauth2/v2/auth */
  readonly authUrl: string;
  /** Provider's token endpoint, e.g. https://oauth2.googleapis.com/token */
  readonly tokenUrl: string;
  readonly clientId: string;
  /** Confidential clients only; loopback flows usually omit. */
  readonly clientSecret?: string;
  readonly scopes: ReadonlyArray<string>;
  /**
   * Loopback redirect port. The redirect URI MUST be registered with
   * the provider exactly (most providers require an exact match) — pick
   * a value and tell the user to register it. Default 8765 to keep the
   * Google Cloud Console setup deterministic across sessions.
   */
  readonly redirectPort?: number;
  /**
   * Loopback redirect path. Default `/callback`. Some providers reject
   * paths other than `/`; tweak per provider. The full registered
   * redirect URI must be `http://localhost:<port><path>` exactly.
   */
  readonly redirectPath?: string;
  /**
   * Provider-specific extra query parameters on the auth URL. Common
   * cases: `access_type=offline` + `prompt=consent` for Google (forces
   * the issuance of a refresh_token); `audience=...` for Auth0.
   */
  readonly extraAuthParams?: Readonly<Record<string, string>>;
  /** How long to wait for the callback before giving up. Default 5min. */
  readonly timeoutMs?: number;
  /**
   * Abort signal — when fired, shuts the local server and rejects the
   * flow. Wire from `ctx.signal` so a turn cancel kills a pending auth.
   */
  readonly signal?: AbortSignal;
  /**
   * When true, do NOT auto-open the browser. The auth URL still
   * gets handed to `onAuthUrl`; the caller is expected to print it
   * for the user to visit on a host where the loopback callback is
   * reachable (same machine, SSH tunnel, port-forward).
   */
  readonly noOpen?: boolean;
  /**
   * Fires with the built auth URL just before the browser-open step.
   * Use to log / display the URL so the user sees it even when
   * auto-open fails or `noOpen` is set.
   */
  readonly onAuthUrl?: (url: string) => void;
}

export interface DeviceFlowOptions {
  /** Provider's device-authorization endpoint (RFC 8628 §3.1). */
  readonly deviceUrl: string;
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly scopes: ReadonlyArray<string>;
  /** Hard cap; the device-code's own expires_in usually drives the timer. */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /**
   * Fired ONCE with the user-facing prompt info as soon as the
   * device endpoint returns. Channels should surface this prominently
   * — the whole flow stalls until the user finishes on the URL.
   */
  readonly onPrompt: (info: DevicePrompt) => void;
}

export interface DevicePrompt {
  /** Short code the user types into the verification page. */
  readonly userCode: string;
  /** URL the user opens on any device. */
  readonly verificationUri: string;
  /** Some providers return a URL that already includes the user_code. */
  readonly verificationUriComplete?: string;
  /** Seconds until the device_code expires (from the provider). */
  readonly expiresIn: number;
  /** Poll interval the provider wants us to use, in seconds. */
  readonly interval: number;
}

export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken?: string;
  /** Epoch ms when the access_token expires. */
  readonly expiresAt?: number;
  /** Granted scopes — provider may grant less than requested. */
  readonly scope?: string;
  readonly tokenType: string;
  /** OIDC id_token if the provider returned one (Google does for `openid` scope). */
  readonly idToken?: string;
}

/**
 * Run the full authorization-code-with-PKCE dance:
 *   1. Bind a loopback HTTP server on `redirectPort`.
 *   2. Build the auth URL (PKCE challenge, CSRF state, scopes, etc.).
 *   3. Open the URL in the user's default browser.
 *   4. Wait for the provider to redirect back with `code` + `state`.
 *   5. Verify state, POST the code to the token endpoint with the
 *      verifier, return the parsed token set.
 */
export async function runAuthorizationCodeFlow(opts: OAuthFlowOptions): Promise<TokenSet> {
  const port = opts.redirectPort ?? 8765;
  const path = opts.redirectPath ?? '/callback';
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);
  const state = generateState();
  const redirectUri = `http://localhost:${port}${path}`;

  const authUrl = buildAuthUrl({
    authUrl: opts.authUrl,
    clientId: opts.clientId,
    redirectUri,
    scopes: opts.scopes,
    codeChallenge,
    state,
    extraAuthParams: opts.extraAuthParams,
  });

  // Start the server BEFORE opening the browser — otherwise the user
  // could complete the consent screen before we're listening and the
  // redirect would 404.
  const codePromise = waitForCallback({
    port,
    path,
    expectedState: state,
    timeoutMs: opts.timeoutMs ?? 300_000,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  if (opts.onAuthUrl) opts.onAuthUrl(authUrl);
  if (!opts.noOpen) {
    try {
      await openInBrowser(authUrl);
    } catch {
      // Failed to open the browser — not fatal; the user can visit
      // the URL surfaced via onAuthUrl. The loopback server is still
      // listening.
    }
  }

  const code = await codePromise;
  const tokens = await exchangeCodeForToken({
    tokenUrl: opts.tokenUrl,
    code,
    redirectUri,
    clientId: opts.clientId,
    ...(opts.clientSecret ? { clientSecret: opts.clientSecret } : {}),
    codeVerifier,
  });
  return tokens;
}

export interface BuildAuthUrlInput {
  readonly authUrl: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: ReadonlyArray<string>;
  readonly codeChallenge: string;
  readonly state: string;
  readonly extraAuthParams?: Readonly<Record<string, string>>;
}

/** Pure URL builder, exported separately so tests can assert on it. */
export function buildAuthUrl(input: BuildAuthUrlInput): string {
  const url = new URL(input.authUrl);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', input.scopes.join(' '));
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  for (const [k, v] of Object.entries(input.extraAuthParams ?? {})) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

interface WaitForCallbackOpts {
  readonly port: number;
  readonly path: string;
  readonly expectedState: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

function waitForCallback(opts: WaitForCallbackOpts): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let server: Server | null = null;
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (server) server.close();
      fn();
    };

    const timer = setTimeout(() => {
      settle(() => reject(new Error(`OAuth callback timed out after ${opts.timeoutMs}ms`)));
    }, opts.timeoutMs);
    timer.unref?.();

    const onAbort = (): void => {
      settle(() => reject(new Error('OAuth flow aborted')));
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${opts.port}`);
      if (url.pathname !== opts.path) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      const err = url.searchParams.get('error');
      const errDesc = url.searchParams.get('error_description');
      if (err) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(htmlPage('OAuth error', `${err}${errDesc ? `: ${errDesc}` : ''}`));
        clearTimeout(timer);
        settle(() => reject(new Error(`OAuth error: ${err}${errDesc ? ` — ${errDesc}` : ''}`)));
        return;
      }
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      if (!code || !returnedState) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(htmlPage('OAuth error', 'callback was missing code or state'));
        clearTimeout(timer);
        settle(() => reject(new Error('OAuth callback missing code or state')));
        return;
      }
      if (returnedState !== opts.expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(htmlPage('OAuth error', 'state mismatch — possible CSRF, refusing'));
        clearTimeout(timer);
        settle(() => reject(new Error('OAuth state mismatch')));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlPage('Authorized', 'You can close this window — moxxy received the token.'));
      clearTimeout(timer);
      settle(() => resolve(code));
    });
    server.on('error', (e) => {
      clearTimeout(timer);
      settle(() => reject(e));
    });
    server.listen(opts.port, '127.0.0.1');
  });
}

interface ExchangeCodeInput {
  readonly tokenUrl: string;
  readonly code: string;
  readonly redirectUri: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly codeVerifier: string;
}

async function exchangeCodeForToken(input: ExchangeCodeInput): Promise<TokenSet> {
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', input.code);
  body.set('redirect_uri', input.redirectUri);
  body.set('client_id', input.clientId);
  body.set('code_verifier', input.codeVerifier);
  if (input.clientSecret) body.set('client_secret', input.clientSecret);
  const res = await fetch(input.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`token exchange failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  return parseTokenResponse(json);
}

/**
 * Run the RFC 8628 device-authorization flow. Suitable for headless
 * environments (SSH session, CI, kiosk, no display): the user opens
 * the verification URL on any device, types the short user_code,
 * approves the scopes, and the local process discovers the grant by
 * polling the token endpoint.
 *
 * Phases:
 *   1. POST `client_id` + `scope` to deviceUrl → returns user_code,
 *      verification_uri, device_code, expires_in, interval.
 *   2. `onPrompt` fires once with the user-facing pieces — the caller
 *      surfaces them in whatever UI it has.
 *   3. Poll tokenUrl every `interval` seconds with
 *      grant_type=urn:ietf:params:oauth:grant-type:device_code +
 *      device_code. The provider replies:
 *        - authorization_pending → keep polling.
 *        - slow_down            → bump interval by 5s and keep polling.
 *        - access_denied        → user clicked deny; throw.
 *        - expired_token        → device_code expired; throw.
 *        - access_token, ...    → success; return TokenSet.
 */
export async function runDeviceCodeFlow(opts: DeviceFlowOptions): Promise<TokenSet> {
  const deviceBody = new URLSearchParams();
  deviceBody.set('client_id', opts.clientId);
  deviceBody.set('scope', opts.scopes.join(' '));
  const deviceRes = await fetch(opts.deviceUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: deviceBody.toString(),
  });
  if (!deviceRes.ok) {
    const text = await deviceRes.text().catch(() => '');
    throw new Error(`device-code request failed (HTTP ${deviceRes.status}): ${text.slice(0, 300)}`);
  }
  const deviceJson = (await deviceRes.json()) as Record<string, unknown>;
  const deviceCode = typeof deviceJson.device_code === 'string' ? deviceJson.device_code : null;
  const userCode = typeof deviceJson.user_code === 'string' ? deviceJson.user_code : null;
  const verificationUri =
    typeof deviceJson.verification_uri === 'string'
      ? deviceJson.verification_uri
      : typeof deviceJson.verification_url === 'string'
        ? deviceJson.verification_url
        : null;
  const verificationUriComplete =
    typeof deviceJson.verification_uri_complete === 'string'
      ? deviceJson.verification_uri_complete
      : undefined;
  const expiresIn = typeof deviceJson.expires_in === 'number' ? deviceJson.expires_in : 600;
  let interval = typeof deviceJson.interval === 'number' ? deviceJson.interval : 5;
  if (!deviceCode || !userCode || !verificationUri) {
    throw new Error(`device-code response missing required fields: ${JSON.stringify(deviceJson).slice(0, 200)}`);
  }

  opts.onPrompt({
    userCode,
    verificationUri,
    ...(verificationUriComplete ? { verificationUriComplete } : {}),
    expiresIn,
    interval,
  });

  const deadline = Date.now() + Math.min((opts.timeoutMs ?? expiresIn * 1000), expiresIn * 1000);

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new Error('OAuth device flow aborted');
    await sleep(interval * 1000, opts.signal);
    const body = new URLSearchParams();
    body.set('grant_type', 'urn:ietf:params:oauth:grant-type:device_code');
    body.set('device_code', deviceCode);
    body.set('client_id', opts.clientId);
    if (opts.clientSecret) body.set('client_secret', opts.clientSecret);
    const pollRes = await fetch(opts.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    });
    const pollJson = (await pollRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (pollRes.ok && typeof pollJson.access_token === 'string') {
      return parseTokenResponse(pollJson);
    }
    const err = typeof pollJson.error === 'string' ? pollJson.error : `HTTP ${pollRes.status}`;
    if (err === 'authorization_pending') continue;
    if (err === 'slow_down') {
      interval += 5;
      continue;
    }
    if (err === 'access_denied') throw new Error('OAuth device flow: user denied authorization');
    if (err === 'expired_token') throw new Error('OAuth device flow: device_code expired before approval');
    const desc = typeof pollJson.error_description === 'string' ? pollJson.error_description : '';
    throw new Error(`OAuth device flow failed: ${err}${desc ? ` — ${desc}` : ''}`);
  }
  throw new Error('OAuth device flow timed out waiting for user approval');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const t = setTimeout(resolve, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Refresh an access token using a stored refresh_token. Same token
 * endpoint, different grant_type. Returns a new TokenSet — note that
 * providers MAY or MAY NOT rotate the refresh_token (Google does
 * not; Auth0 with rotation does). Caller should preserve the prior
 * refresh_token if the response omits one.
 */
export async function refreshAccessToken(input: {
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly refreshToken: string;
}): Promise<TokenSet> {
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', input.refreshToken);
  body.set('client_id', input.clientId);
  if (input.clientSecret) body.set('client_secret', input.clientSecret);
  const res = await fetch(input.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`token refresh failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  return parseTokenResponse(json);
}

function parseTokenResponse(json: Record<string, unknown>): TokenSet {
  const access = typeof json.access_token === 'string' ? json.access_token : null;
  if (!access) throw new Error(`token response missing access_token: ${JSON.stringify(json).slice(0, 200)}`);
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

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#111;color:#eee;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0}h1{font-weight:300}</style>
</head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
