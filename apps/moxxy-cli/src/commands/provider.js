/**
 * Provider commands: install/list/verify.
 * Includes built-in provider catalog with frontier models.
 */
import { parseFlags } from './auth.js';
import { isInteractive, handleCancel, withSpinner, showResult, p } from '../ui.js';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { BUILTIN_PROVIDERS } from './providers/index.js';

const OPENAI_API_BASE = 'https://api.openai.com/v1';
export const OPENAI_CODEX_PROVIDER_ID = 'openai-codex';
const OPENAI_CODEX_DISPLAY_NAME = 'OpenAI (Codex OAuth)';
const OPENAI_CODEX_ISSUER = 'https://auth.openai.com';
const OPENAI_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_CODEX_DEVICE_CODE_ENDPOINT = `${OPENAI_CODEX_ISSUER}/api/accounts/deviceauth/usercode`;
const OPENAI_CODEX_DEVICE_TOKEN_ENDPOINT = `${OPENAI_CODEX_ISSUER}/api/accounts/deviceauth/token`;
const OPENAI_CODEX_TOKEN_ENDPOINT = `${OPENAI_CODEX_ISSUER}/oauth/token`;
const OPENAI_CODEX_AUTHORIZE_ENDPOINT = `${OPENAI_CODEX_ISSUER}/oauth/authorize`;
const OPENAI_CODEX_DEVICE_VERIFY_URL = `${OPENAI_CODEX_ISSUER}/codex/device`;
const OPENAI_CODEX_DEVICE_CALLBACK_REDIRECT_URI = `${OPENAI_CODEX_ISSUER}/deviceauth/callback`;
const OPENAI_CODEX_BROWSER_CALLBACK_PATH = '/auth/callback';
const OPENAI_CODEX_BROWSER_CALLBACK_PORT = 1455;
const OPENAI_CODEX_SCOPE = 'openid profile email offline_access';
const OPENAI_CODEX_ORIGINATOR = 'Codex Desktop';
const OPENAI_CODEX_SECRET_KEY_NAME = 'OPENAI_CODEX_API_KEY';
const OPENAI_CODEX_BACKEND_KEY = `moxxy_provider_${OPENAI_CODEX_PROVIDER_ID}`;
const OPENAI_CODEX_CHATGPT_API_BASE = 'https://chatgpt.com/backend-api/codex';
const OPENAI_CODEX_OAUTH_SESSION_MODE = 'chatgpt_oauth_session';
const OPENAI_CODEX_CLIENT_USER_AGENT_ID = 'codex_cli_rs';
const OPENAI_CODEX_CLIENT_VERSION = '0.50.0';
const MOXXY_CODEX_CLOUD_OAUTH_URL = 'https://oauth.cloud.moxxy.ai';
const MOXXY_CODEX_CLOUD_POLL_MAX_MS = 15 * 60 * 1000;

export function codexUserAgent() {
  const platform = process.platform || 'unknown';
  const arch = process.arch || 'unknown';
  return `${OPENAI_CODEX_CLIENT_USER_AGENT_ID}/${OPENAI_CODEX_CLIENT_VERSION} (${platform}; ${arch})`;
}

export function codexClientHeaders(extra = {}) {
  return {
    'user-agent': codexUserAgent(),
    originator: OPENAI_CODEX_CLIENT_USER_AGENT_ID,
    ...extra,
  };
}

export const ANTHROPIC_PROVIDER_ID = 'anthropic';
const ANTHROPIC_SECRET_KEY_NAME = 'ANTHROPIC_API_KEY';
const ANTHROPIC_BACKEND_KEY = `moxxy_provider_${ANTHROPIC_PROVIDER_ID}`;
const ANTHROPIC_API_BASE = 'https://api.anthropic.com';
const ANTHROPIC_OAUTH_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const ANTHROPIC_OAUTH_TOKEN_ENDPOINT = 'https://console.anthropic.com/v1/oauth/token';
const ANTHROPIC_OAUTH_REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
const ANTHROPIC_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const ANTHROPIC_OAUTH_SCOPE = 'org:create_api_key user:profile user:inference';
const ANTHROPIC_OAUTH_SESSION_MODE = 'anthropic_oauth_session';
const OLLAMA_PROVIDER_ID = 'ollama';
const OLLAMA_API_BASE = 'http://127.0.0.1:11434/v1';
const OPENAI_CODEX_MODEL_IDS = [
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5.3-codex',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'o3',
  'o4-mini',
  'gpt-4o',
  'gpt-4o-mini',
];

export function buildCodexDeviceCodeBody(clientId, opts = {}) {
  const allowedWorkspaceId = String(opts.allowedWorkspaceId || '').trim();
  const organizationId = String(opts.organizationId || '').trim();
  const projectId = String(opts.projectId || '').trim();

  const body = {
    client_id: clientId,
  };
  if (allowedWorkspaceId) body.allowed_workspace_id = allowedWorkspaceId;
  if (organizationId) body.organization_id = organizationId;
  if (projectId) body.project_id = projectId;
  return body;
}

export function buildCodexAuthorizationCodeExchangeBody({
  code,
  redirectUri,
  clientId,
  codeVerifier,
}) {
  return new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  }).toString();
}

export function buildCodexApiKeyExchangeBody({ clientId, idToken }) {
  return new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    client_id: clientId,
    requested_token: 'openai-api-key',
    subject_token: idToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
  }).toString();
}

export function buildPkceCodeChallenge(codeVerifier) {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

export function buildCodexBrowserAuthorizeUrl({
  clientId,
  redirectUri,
  codeChallenge,
  state,
  originator = OPENAI_CODEX_ORIGINATOR,
  allowedWorkspaceId,
  organizationId,
  projectId,
}) {
  const url = new URL(OPENAI_CODEX_AUTHORIZE_ENDPOINT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', OPENAI_CODEX_SCOPE);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('state', state);
  url.searchParams.set('originator', originator);
  if (allowedWorkspaceId) {
    url.searchParams.set('allowed_workspace_id', allowedWorkspaceId);
  }
  if (organizationId) {
    url.searchParams.set('organization_id', organizationId);
  }
  if (projectId) {
    url.searchParams.set('project_id', projectId);
  }
  return url.toString();
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toInlineText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

export function formatOpenAiOAuthError(prefix, status, payload, rawText = '') {
  const nestedError = payload?.error && typeof payload.error === 'object' ? payload.error : null;
  const code = toInlineText(
    nestedError?.code ||
    payload?.code ||
    (typeof payload?.error === 'string' ? payload.error : '')
  );
  const description = toInlineText(
    nestedError?.message ||
    nestedError?.error_description ||
    payload?.error_description ||
    payload?.message ||
    payload?.detail ||
    payload?.error_summary ||
    ''
  );
  const fallbackText = toInlineText(rawText);

  const parts = [];
  if (code) parts.push(code);
  if (description) parts.push(description);
  if (!code && !description && fallbackText) {
    parts.push(fallbackText.slice(0, 220));
  }

  let message = `${prefix} (${status})`;
  if (parts.length > 0) {
    message += `: ${parts.join(' - ')}`;
  }

  if (prefix === 'OpenAI API key token-exchange failed' && status === 401) {
    const missingOrg = code === 'invalid_subject_token' || description.includes('organization_id');
    if (missingOrg) {
      message += '. Retry OAuth with organization-scoped login (interactive flow will prompt to select organization). If OpenCode works but this step fails, it usually means OpenCode is using ChatGPT backend tokens while Moxxy requires API-key issuance linked to an API organization.';
    } else if (!description) {
      message += '. The OpenAI account may not be eligible for OAuth API-key issuance yet (API org/project or billing setup may be missing).';
    }
  }

  return message;
}

function toBool(v) {
  return v === true || v === 'true';
}

function parseJwtPayload(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;

  const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);

  try {
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function extractOpenAiAuthClaims(idToken) {
  const payload = parseJwtPayload(idToken);
  const claims = payload?.['https://api.openai.com/auth'];
  if (claims && typeof claims === 'object') {
    return claims;
  }
  return null;
}

function extractCodexAccountIdFromClaims(claims) {
  if (!claims || typeof claims !== 'object') return '';
  const rootAccount = typeof claims.chatgpt_account_id === 'string' ? claims.chatgpt_account_id.trim() : '';
  if (rootAccount) return rootAccount;

  const apiAuth = claims['https://api.openai.com/auth'];
  const apiAuthAccount = typeof apiAuth?.chatgpt_account_id === 'string' ? apiAuth.chatgpt_account_id.trim() : '';
  if (apiAuthAccount) return apiAuthAccount;

  const firstOrgId = typeof apiAuth?.organizations?.[0]?.id === 'string' ? apiAuth.organizations[0].id.trim() : '';
  if (firstOrgId) return firstOrgId;

  return '';
}

export function extractCodexAccountIdFromTokens(tokens) {
  const fromIdToken = extractCodexAccountIdFromClaims(parseJwtPayload(tokens?.id_token));
  if (fromIdToken) return fromIdToken;
  return extractCodexAccountIdFromClaims(parseJwtPayload(tokens?.access_token));
}

function toPositiveInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

export function buildOpenAiCodexSessionSecret({
  accessToken,
  refreshToken,
  expiresAtMs,
  accountId,
}) {
  const out = {
    mode: OPENAI_CODEX_OAUTH_SESSION_MODE,
    issuer: OPENAI_CODEX_ISSUER,
    client_id: OPENAI_CODEX_CLIENT_ID,
    access_token: String(accessToken || '').trim(),
    refresh_token: String(refreshToken || '').trim(),
    expires_at: toPositiveInt(expiresAtMs, 0),
  };
  const account = String(accountId || '').trim();
  if (account) {
    out.account_id = account;
  }
  return JSON.stringify(out);
}

export function buildOpenAiCodexSessionModels(accountId = '') {
  const account = String(accountId || '').trim();
  return OPENAI_CODEX_MODEL_IDS.map(modelId => ({
    model_id: modelId,
    display_name: modelId,
    metadata: {
      api_base: OPENAI_CODEX_CHATGPT_API_BASE,
      ...(account ? { chatgpt_account_id: account } : {}),
    },
  }));
}

function listOrganizationCandidates(apiAuthClaims) {
  const orgs = Array.isArray(apiAuthClaims?.organizations) ? apiAuthClaims.organizations : [];
  const out = [];
  for (const org of orgs) {
    const id = typeof org?.id === 'string' ? org.id.trim() : '';
    if (!id) continue;
    out.push({
      id,
      title: typeof org?.title === 'string' ? org.title.trim() : '',
      is_default: org?.is_default === true,
    });
  }
  return out;
}

function isMissingOrganizationIdError(err) {
  const msg = String(err?.message || '');
  return msg.includes('invalid_subject_token') && msg.includes('organization_id');
}

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function resolveOpenAiAuthMethod(flags) {
  const raw = String(flags.method || flags.auth_method || '').trim().toLowerCase();
  if (raw === 'browser' || raw === 'headless' || raw === 'cloud') {
    return raw;
  }
  if (toBool(flags.cloud)) {
    return 'cloud';
  }
  if (toBool(flags.browser)) {
    return 'browser';
  }
  if (toBool(flags.headless)) {
    return 'headless';
  }
  if (toBool(flags.no_browser) || toBool(flags.noBrowser)) {
    return 'headless';
  }
  return null;
}

export function getMoxxyCodexCloudOauthUrl() {
  const raw = String(process.env.MOXXY_CODEX_OAUTH_URL || MOXXY_CODEX_CLOUD_OAUTH_URL).trim();
  return raw.replace(/\/+$/, '');
}

function buildOrgScopeFromFlags(flags) {
  return {
    allowedWorkspaceId: String(flags.allowed_workspace_id || flags.allowedWorkspaceId || '').trim() || '',
    organizationId: String(flags.organization_id || flags.organizationId || '').trim() || '',
    projectId: String(flags.project_id || flags.projectId || '').trim() || '',
  };
}

export function buildScopedRetryFlags(flags, selectedOrg, method) {
  return {
    ...flags,
    method,
    allowed_workspace_id: selectedOrg,
    organization_id: selectedOrg,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function tryOpenUrl(url) {
  const candidates = [];

  if (process.platform === 'darwin') {
    candidates.push({ cmd: 'open', args: [url] });
  } else if (process.platform === 'win32') {
    candidates.push({ cmd: 'cmd', args: ['/c', 'start', '', url] });
  } else {
    candidates.push(
      { cmd: 'xdg-open', args: [url] },
      { cmd: 'sensible-browser', args: [url] },
      { cmd: 'x-www-browser', args: [url] },
    );
  }

  for (const { cmd, args } of candidates) {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      child.unref();
      return true;
    } catch {
      // try next candidate
    }
  }
  return false;
}

function createCodeVerifier() {
  return randomBytes(48).toString('base64url');
}

function createStateToken() {
  return randomBytes(24).toString('base64url');
}

function respondHtml(res, statusCode, bodyHtml) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(bodyHtml);
}

function createAuthCallbackHtml(success, message) {
  const title = success ? 'Authorization Complete' : 'Authorization Failed';
  const escaped = String(message || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const accentColor = success ? '#10b981' : '#ef4444';
  const icon = success
    ? `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
    : `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — Moxxy</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1rem;
    }
    .card {
      background: #171717;
      border: 1px solid #262626;
      border-radius: 16px;
      padding: 3rem 2.5rem;
      max-width: 420px;
      width: 100%;
      text-align: center;
      animation: fadeIn 0.4s ease-out;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: ${accentColor}1a;
      margin-bottom: 1.5rem;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 600;
      color: #fafafa;
      margin-bottom: 0.5rem;
    }
    .message {
      font-size: 0.9rem;
      color: #a3a3a3;
      line-height: 1.5;
      margin-bottom: 1.75rem;
    }
    .hint {
      font-size: 0.8rem;
      color: #525252;
    }
    .brand {
      margin-top: 2rem;
      font-size: 0.75rem;
      color: #404040;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p class="message">${escaped}</p>
    <p class="hint">${success ? 'This window will close automatically.' : 'Please try again from the terminal.'}</p>
    <p class="brand">moxxy</p>
  </div>
  ${success ? '<script>setTimeout(()=>window.close(),2000)</script>' : ''}
</body>
</html>`;
}

async function bindServer(server, port, host) {
  return await new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function startBrowserOAuthCallbackServer({ expectedState, timeoutMs, preferredPort }) {
  const host = '127.0.0.1';
  let finish;
  let fail;
  let isDone = false;
  let timeoutId;

  const done = (fn, value) => {
    if (isDone) return;
    isDone = true;
    if (timeoutId) clearTimeout(timeoutId);
    fn(value);
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== OPENAI_CODEX_BROWSER_CALLBACK_PATH) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }

    const returnedState = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code') || '';
    const error = url.searchParams.get('error') || '';
    const errorDescription = url.searchParams.get('error_description') || '';

    if (returnedState !== expectedState) {
      respondHtml(res, 400, createAuthCallbackHtml(false, 'Invalid OAuth state'));
      done(fail, new Error('OpenAI browser OAuth callback rejected: state mismatch'));
      return;
    }

    if (error) {
      const msg = [error, errorDescription].filter(Boolean).join(' - ');
      respondHtml(res, 400, createAuthCallbackHtml(false, msg || 'Authorization failed'));
      done(fail, new Error(`OpenAI browser OAuth callback failed: ${msg || error}`));
      return;
    }

    if (!code) {
      respondHtml(res, 400, createAuthCallbackHtml(false, 'Missing authorization code'));
      done(fail, new Error('OpenAI browser OAuth callback missing authorization code'));
      return;
    }

    respondHtml(res, 200, createAuthCallbackHtml(true, 'You can return to Moxxy.'));
    done(finish, { authorization_code: code });
  });

  try {
    await bindServer(server, preferredPort, host);
  } catch (err) {
    if (err?.code !== 'EADDRINUSE') {
      throw err;
    }
    await bindServer(server, 0, host);
  }

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    server.close();
    throw new Error('Could not determine local OAuth callback port');
  }

  const resultPromise = new Promise((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });

  timeoutId = setTimeout(() => {
    done(fail, new Error('Timed out waiting for browser authorization callback'));
  }, Math.max(15_000, timeoutMs));

  const close = async () => {
    await new Promise((resolve) => server.close(() => resolve()));
  };

  return {
    redirectUri: `http://localhost:${addr.port}${OPENAI_CODEX_BROWSER_CALLBACK_PATH}`,
    waitForAuthorizationCode: () => resultPromise,
    close,
  };
}

async function requestCodexDeviceCode(opts = {}) {
  const resp = await fetch(OPENAI_CODEX_DEVICE_CODE_ENDPOINT, {
    method: 'POST',
    headers: codexClientHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(buildCodexDeviceCodeBody(OPENAI_CODEX_CLIENT_ID, opts)),
  });

  const text = await resp.text();
  const json = parseJsonSafe(text);
  if (!resp.ok || !json?.device_auth_id || !json?.user_code) {
    throw new Error(formatOpenAiOAuthError('OpenAI OAuth device-code request failed', resp.status, json, text));
  }
  return json;
}

async function pollCodexAuthorizationCode(deviceAuthId, userCode, intervalSeconds, expiresInSeconds) {
  const deadline = Date.now() + (Math.max(30, expiresInSeconds) * 1000);
  let pollIntervalMs = Math.max(1, intervalSeconds) * 1000;

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);

    const resp = await fetch(OPENAI_CODEX_DEVICE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: codexClientHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        device_auth_id: deviceAuthId,
        user_code: userCode,
      }),
    });

    const text = await resp.text();
    const json = parseJsonSafe(text) || {};
    if (resp.ok && json.authorization_code && json.code_verifier) {
      return json;
    }

    const code = json.error;
    if (code === 'authorization_pending' || resp.status === 403 || resp.status === 404) {
      continue;
    }
    if (code === 'slow_down') {
      pollIntervalMs += 5000;
      continue;
    }
    if (code === 'expired_token') {
      throw new Error('OpenAI OAuth session expired before authorization was completed');
    }
    if (code === 'access_denied') {
      throw new Error('OpenAI OAuth authorization was denied');
    }

    throw new Error(formatOpenAiOAuthError('OpenAI OAuth device token poll failed', resp.status, json, text));
  }

  throw new Error('Timed out waiting for OpenAI OAuth authorization');
}

async function exchangeCodexIdToken({
  authorizationCode,
  codeVerifier,
  redirectUri = OPENAI_CODEX_DEVICE_CALLBACK_REDIRECT_URI,
}) {
  const resp = await fetch(OPENAI_CODEX_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: codexClientHeaders({
      'content-type': 'application/x-www-form-urlencoded',
    }),
    body: buildCodexAuthorizationCodeExchangeBody({
      code: authorizationCode,
      redirectUri,
      clientId: OPENAI_CODEX_CLIENT_ID,
      codeVerifier,
    }),
  });

  const text = await resp.text();
  const json = parseJsonSafe(text);
  if (!resp.ok || !json?.id_token) {
    throw new Error(formatOpenAiOAuthError('OpenAI OAuth code exchange failed', resp.status, json, text));
  }

  return json;
}

async function exchangeCodexApiKey(idToken) {
  const resp = await fetch(OPENAI_CODEX_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: codexClientHeaders({
      'content-type': 'application/x-www-form-urlencoded',
    }),
    body: buildCodexApiKeyExchangeBody({
      clientId: OPENAI_CODEX_CLIENT_ID,
      idToken,
    }),
  });
  const text = await resp.text();
  const json = parseJsonSafe(text);
  if (!resp.ok || !json?.access_token) {
    throw new Error(formatOpenAiOAuthError('OpenAI API key token-exchange failed', resp.status, json, text));
  }
  return json.access_token;
}

export function parseOpenAiModels(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const unique = new Set();
  for (const row of rows) {
    const id = typeof row?.id === 'string' ? row.id.trim() : '';
    if (id) unique.add(id);
  }

  return Array.from(unique)
    .sort((a, b) => a.localeCompare(b))
    .map(id => ({
      model_id: id,
      display_name: id,
      metadata: { api_base: OPENAI_API_BASE },
    }));
}

async function fetchOpenAiModels(apiKey) {
  const resp = await fetch(`${OPENAI_API_BASE}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  const text = await resp.text();
  const json = parseJsonSafe(text);
  if (!resp.ok || !json) {
    throw new Error(`Fetching OpenAI models failed (${resp.status})`);
  }
  const models = parseOpenAiModels(json);
  if (models.length === 0) {
    throw new Error('OpenAI model list is empty');
  }
  return models;
}

function normalizeOllamaApiBase(apiBase = OLLAMA_API_BASE) {
  const trimmed = String(apiBase || OLLAMA_API_BASE).trim().replace(/\/+$/, '');
  if (!trimmed) return OLLAMA_API_BASE;
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed.slice(0, -'/chat/completions'.length);
  }
  if (trimmed.endsWith('/models')) {
    return trimmed.slice(0, -'/models'.length);
  }
  return trimmed;
}

function alternateOllamaApiBase(apiBase = OLLAMA_API_BASE) {
  try {
    const url = new URL(normalizeOllamaApiBase(apiBase));
    if (url.hostname === 'localhost') {
      url.hostname = '127.0.0.1';
      return url.toString().replace(/\/+$/, '');
    }
    if (url.hostname === '127.0.0.1') {
      url.hostname = 'localhost';
      return url.toString().replace(/\/+$/, '');
    }
  } catch {
    return null;
  }
  return null;
}

export function buildOllamaDiscoveryUrls(apiBase = OLLAMA_API_BASE) {
  const bases = [normalizeOllamaApiBase(apiBase)];
  const alternateBase = alternateOllamaApiBase(apiBase);
  if (alternateBase && !bases.includes(alternateBase)) {
    bases.push(alternateBase);
  }

  const urls = [];
  for (const base of bases) {
    const openAiUrl = `${base}/models`;
    if (!urls.includes(openAiUrl)) {
      urls.push(openAiUrl);
    }

    const legacyBase = base.endsWith('/v1')
      ? base.slice(0, -'/v1'.length)
      : base;
    const legacyUrl = `${legacyBase}/api/tags`;
    if (!urls.includes(legacyUrl)) {
      urls.push(legacyUrl);
    }
  }

  return urls;
}

export function parseOllamaModels(payload, apiBase = OLLAMA_API_BASE) {
  const normalizedBase = normalizeOllamaApiBase(apiBase);
  const rows = Array.isArray(payload?.models)
    ? payload.models
    : Array.isArray(payload?.data)
      ? payload.data
      : [];
  const unique = new Map();

  for (const row of rows) {
    const id = typeof row?.id === 'string'
      ? row.id.trim()
      : typeof row?.name === 'string'
        ? row.name.trim()
        : '';
    if (!id || unique.has(id)) continue;

    const displayName = typeof row?.name === 'string' && row.name.trim()
      ? row.name.trim()
      : id;

    unique.set(id, {
      model_id: id,
      display_name: displayName,
      metadata: { api_base: normalizedBase },
    });
  }

  return Array.from(unique.values()).sort((left, right) =>
    left.display_name.toLowerCase().localeCompare(right.display_name.toLowerCase())
  );
}

async function fetchOllamaModels(apiBase = OLLAMA_API_BASE) {
  for (const url of buildOllamaDiscoveryUrls(apiBase)) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (!resp.ok) continue;
      const payload = await resp.json();
      const models = parseOllamaModels(payload, apiBase);
      if (models.length > 0) return models;
    } catch {
      // fall through to the next Ollama discovery endpoint
    }
  }
  return [];
}

export function getProviderCatalog() {
  return BUILTIN_PROVIDERS.map(bp => ({
    id: bp.id,
    display_name: bp.display_name,
    api_base: bp.api_base ?? null,
    api_key_env: bp.api_key_env ?? null,
    cli_binary: bp.cli_binary ?? null,
    api_key_login: Boolean(bp.api_key_login),
    oauth_login: Boolean(bp.oauth_login),
    models: (bp.models ?? []).map(m => ({
      model_id: m.model_id,
      display_name: m.display_name ?? m.model_id,
    })),
  }));
}

export async function resolveBuiltinProviderModels(builtin) {
  const fallbackModels = builtin.models.map(model => ({
    ...model,
    metadata: builtin.api_base ? { api_base: builtin.api_base } : {},
  }));

  if (builtin.id !== OLLAMA_PROVIDER_ID) {
    return fallbackModels;
  }

  const discovered = await fetchOllamaModels(builtin.api_base);
  return discovered.length > 0 ? discovered : fallbackModels;
}

async function upsertProviderSecret(client, keyName, backendKey, value) {
  const existing = await client.listSecrets();
  for (const secret of existing || []) {
    if (secret.key_name === keyName || secret.backend_key === backendKey) {
      await client.deleteSecret(secret.id);
    }
  }

  return client.createSecret({
    key_name: keyName,
    backend_key: backendKey,
    policy_label: 'provider-api-key',
    value,
  });
}

async function finalizeOpenAiCodexProviderInstall(client, flags, secretValue, opts = {}) {
  await withSpinner(
    'Storing provider key in vault...',
    () => upsertProviderSecret(client, OPENAI_CODEX_SECRET_KEY_NAME, OPENAI_CODEX_BACKEND_KEY, secretValue),
    'Provider key stored in vault.'
  );

  const predefinedModels = Array.isArray(opts.models) ? opts.models : null;
  const models = predefinedModels
    ? predefinedModels
    : await withSpinner(
      'Syncing models from OpenAI...',
      () => fetchOpenAiModels(secretValue),
      'Model sync completed.'
    );

  if (!Array.isArray(models) || models.length === 0) {
    throw new Error('OpenAI model list is empty');
  }

  const provider = await withSpinner(
    'Installing OpenAI Codex provider...',
    () => client.installProvider(OPENAI_CODEX_PROVIDER_ID, OPENAI_CODEX_DISPLAY_NAME, models),
    'OpenAI Codex provider installed.'
  );

  const result = {
    provider_id: OPENAI_CODEX_PROVIDER_ID,
    provider: provider,
    models_count: models.length,
  };

  if (toBool(flags.json)) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    showResult('Provider Connected', {
      Provider: OPENAI_CODEX_DISPLAY_NAME,
      ID: OPENAI_CODEX_PROVIDER_ID,
      Models: models.length,
      Secret: OPENAI_CODEX_SECRET_KEY_NAME,
    });
  }

  return result;
}

async function finalizeOpenAiCodexLogin(client, flags, oauthTokens) {
  const idToken = String(oauthTokens?.id_token || '').trim();
  if (!idToken) {
    throw new Error('OpenAI OAuth code exchange did not return id_token');
  }

  const apiKey = await withSpinner(
    'Exchanging OAuth token for API key...',
    () => exchangeCodexApiKey(idToken),
    'Provider key ready.'
  );

  return finalizeOpenAiCodexProviderInstall(client, flags, apiKey);
}

async function maybeFinalizeWithCodexSession(client, flags, oauthTokens) {
  const accessToken = String(oauthTokens?.access_token || '').trim();
  const refreshToken = String(oauthTokens?.refresh_token || '').trim();
  if (!accessToken || !refreshToken) {
    return null;
  }

  const expiresInSec = toPositiveInt(oauthTokens?.expires_in, 3600);
  const expiresAtMs = Date.now() + (Math.max(60, expiresInSec) * 1000);
  const accountId = extractCodexAccountIdFromTokens(oauthTokens);
  const secretValue = buildOpenAiCodexSessionSecret({
    accessToken,
    refreshToken,
    expiresAtMs,
    accountId,
  });
  const models = buildOpenAiCodexSessionModels(accountId);

  p.log.warn('Falling back to ChatGPT OAuth session mode (OpenCode-compatible).');
  return finalizeOpenAiCodexProviderInstall(client, flags, secretValue, { models });
}

async function loginOpenAiCodexHeadless(flags) {
  const noBrowser = toBool(flags.no_browser) || toBool(flags.noBrowser);
  const scope = buildOrgScopeFromFlags(flags);

  const device = await withSpinner(
    'Starting OpenAI OAuth flow...',
    () => requestCodexDeviceCode(scope),
    'OpenAI authorization started.'
  );

  const verifyUrl = OPENAI_CODEX_DEVICE_VERIFY_URL;
  if (!noBrowser && verifyUrl) {
    tryOpenUrl(verifyUrl);
  }

  p.note(
    [
      'Log in to OpenAI and approve access.',
      verifyUrl ? `Open this URL: ${verifyUrl}` : '',
      device.user_code ? `Verification code: ${device.user_code}` : '',
    ].filter(Boolean).join('\n'),
    'OpenAI OAuth'
  );

  const authorization = await withSpinner(
    'Waiting for OpenAI authorization...',
    () => pollCodexAuthorizationCode(
      device.device_auth_id,
      device.user_code,
      toInt(device.interval, 5),
      toInt(device.expires_in, 900)
    ),
    'OpenAI authorization completed.'
  );

  return await withSpinner(
    'Finalizing OpenAI authorization...',
    () => exchangeCodexIdToken({
      authorizationCode: authorization.authorization_code,
      codeVerifier: authorization.code_verifier,
      redirectUri: OPENAI_CODEX_DEVICE_CALLBACK_REDIRECT_URI,
    }),
    'Authorization finalized.'
  );
}

async function loginOpenAiCodexByMethod(method, flags) {
  if (method === 'headless') return loginOpenAiCodexHeadless(flags);
  if (method === 'cloud') return loginOpenAiCodexCloud(flags);
  return loginOpenAiCodexBrowser(flags);
}

async function postCloudJson(baseUrl, path, body) {
  let resp;
  try {
    resp = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  } catch (err) {
    throw new Error(`Could not reach ${baseUrl} (${err.message}). Fallback: moxxy provider login --id openai-codex --method headless`);
  }
  const text = await resp.text();
  const json = parseJsonSafe(text);
  if (!resp.ok) {
    const msg = json?.error || text || `HTTP ${resp.status}`;
    throw new Error(`oauth.cloud.moxxy.ai ${path} failed (${resp.status}): ${msg}`);
  }
  return json || {};
}

async function loginOpenAiCodexCloud(flags) {
  const noBrowser = toBool(flags.no_browser) || toBool(flags.noBrowser);
  const baseUrl = getMoxxyCodexCloudOauthUrl();
  const scope = buildOrgScopeFromFlags(flags);

  const startBody = {};
  if (scope.organizationId) startBody.organizationId = scope.organizationId;
  if (scope.projectId) startBody.projectId = scope.projectId;

  let session = await withSpinner(
    'Starting hosted OpenAI OAuth flow...',
    () => postCloudJson(baseUrl, '/cli/openai-codex/start', startBody),
    'OpenAI authorization started.'
  );

  if (session.verificationUrl && !noBrowser) {
    tryOpenUrl(session.verificationUrl);
  }

  p.note(
    [
      'Log in to OpenAI and approve access.',
      session.verificationUrl ? `Open this URL: ${session.verificationUrl}` : '',
      session.userCode ? `Verification code: ${session.userCode}` : '',
    ].filter(Boolean).join('\n'),
    'OpenAI OAuth (oauth.cloud.moxxy.ai)'
  );

  let deviceSessionToken = session.deviceSessionToken;
  let pollIntervalSeconds = Math.max(1, toInt(session.pollIntervalSeconds, 5));
  const deadline = Date.now() + MOXXY_CODEX_CLOUD_POLL_MAX_MS;

  const connected = await withSpinner(
    'Waiting for OpenAI authorization...',
    async () => {
      while (Date.now() < deadline) {
        await sleep(pollIntervalSeconds * 1000);
        const result = await postCloudJson(baseUrl, '/cli/openai-codex/poll', {
          deviceSessionToken,
        });

        if (result.status === 'pending') {
          deviceSessionToken = result.deviceSessionToken || deviceSessionToken;
          pollIntervalSeconds = Math.max(1, toInt(result.pollIntervalSeconds, pollIntervalSeconds));
          continue;
        }

        if (result.status === 'needs_organization') {
          const organizations = Array.isArray(result.organizations) ? result.organizations : [];
          if (organizations.length === 0) {
            throw new Error(result.error || 'OpenAI needs an organization to continue.');
          }
          let selectedOrg = organizations.find(o => o.isDefault)?.id || organizations[0].id;
          if (isInteractive() && organizations.length > 1) {
            const chosen = await p.select({
              message: 'Select OpenAI organization for API key issuance',
              options: organizations.map(org => ({
                value: org.id,
                label: org.title ? `${org.title} (${org.id})` : org.id,
                hint: org.isDefault ? 'default' : undefined,
              })),
            });
            selectedOrg = handleCancel(chosen);
          }
          const retry = await postCloudJson(baseUrl, '/cli/openai-codex/start', {
            ...startBody,
            organizationId: selectedOrg,
          });
          deviceSessionToken = retry.deviceSessionToken;
          pollIntervalSeconds = Math.max(1, toInt(retry.pollIntervalSeconds, 5));
          if (retry.verificationUrl && !noBrowser) tryOpenUrl(retry.verificationUrl);
          p.note(
            [
              `Retry required for organization ${selectedOrg}.`,
              retry.verificationUrl ? `Open this URL: ${retry.verificationUrl}` : '',
              retry.userCode ? `Verification code: ${retry.userCode}` : '',
            ].filter(Boolean).join('\n'),
            'OpenAI OAuth — organization retry'
          );
          continue;
        }

        if (result.status === 'connected') {
          return result;
        }

        throw new Error(result.error || 'OpenAI login failed');
      }
      throw new Error('Timed out waiting for OpenAI authorization');
    },
    'OpenAI authorization completed.'
  );

  const secretValue = String(connected.secretValue || '').trim();
  if (!secretValue) {
    throw new Error('oauth.cloud.moxxy.ai returned no secretValue');
  }
  const models = Array.isArray(connected.models) && connected.models.length > 0
    ? connected.models
    : null;
  if (!models) {
    throw new Error('oauth.cloud.moxxy.ai returned no models');
  }

  if (connected.authMode === 'chatgpt_oauth_session') {
    p.log.warn('Using ChatGPT OAuth session mode (OpenCode-compatible).');
  }

  return { __cloudResult: { secretValue, models } };
}

async function loginOpenAiCodexBrowser(flags) {
  const timeoutMs = Math.max(30_000, toInt(flags.timeout_ms, toInt(flags.timeout_seconds, 180) * 1000));
  const preferredPort = Math.max(1, toInt(flags.port, OPENAI_CODEX_BROWSER_CALLBACK_PORT));
  const noBrowser = toBool(flags.no_browser) || toBool(flags.noBrowser);
  const originator = String(flags.originator || OPENAI_CODEX_ORIGINATOR).trim() || OPENAI_CODEX_ORIGINATOR;
  const allowedWorkspaceId = String(flags.allowed_workspace_id || flags.allowedWorkspaceId || '').trim() || '';
  const organizationId = String(flags.organization_id || flags.organizationId || '').trim() || '';
  const projectId = String(flags.project_id || flags.projectId || '').trim() || '';
  const state = createStateToken();
  const codeVerifier = createCodeVerifier();
  const codeChallenge = buildPkceCodeChallenge(codeVerifier);
  const callbackServer = await withSpinner(
    'Preparing browser OAuth callback...',
    () => startBrowserOAuthCallbackServer({ expectedState: state, timeoutMs, preferredPort }),
    'Browser callback ready.'
  );

  let authorizationCode;
  try {
    const authorizeUrl = buildCodexBrowserAuthorizeUrl({
      clientId: OPENAI_CODEX_CLIENT_ID,
      redirectUri: callbackServer.redirectUri,
      codeChallenge,
      state,
      originator,
      allowedWorkspaceId: allowedWorkspaceId || undefined,
      organizationId: organizationId || undefined,
      projectId: projectId || undefined,
    });

    if (!noBrowser) {
      tryOpenUrl(authorizeUrl);
    }

    p.note(
      [
        'Log in to OpenAI and approve access.',
        `Open this URL: ${authorizeUrl}`,
        `Callback URL: ${callbackServer.redirectUri}`,
      ].join('\n'),
      'OpenAI OAuth (Browser)'
    );

    const result = await withSpinner(
      'Waiting for browser authorization...',
      () => callbackServer.waitForAuthorizationCode(),
      'OpenAI authorization completed.'
    );
    authorizationCode = result.authorization_code;
  } finally {
    await callbackServer.close();
  }

  return await withSpinner(
    'Finalizing OpenAI authorization...',
    () => exchangeCodexIdToken({
      authorizationCode,
      codeVerifier,
      redirectUri: callbackServer.redirectUri,
    }),
    'Authorization finalized.'
  );
}

async function maybeFinalizeWithManualApiKey(client, flags) {
  const argApiKey = String(flags.api_key || flags['api-key'] || '').trim();
  if (argApiKey) {
    p.log.warn('Using manual OpenAI API key from CLI flag fallback.');
    return await finalizeOpenAiCodexProviderInstall(client, flags, argApiKey);
  }

  if (!isInteractive()) {
    return null;
  }

  const useManual = handleCancel(await p.confirm({
    message: 'OAuth API key issuance failed. Provide OpenAI API key manually to finish provider setup?',
    initialValue: false,
  }));
  if (!useManual) {
    return null;
  }

  const manualApiKey = handleCancel(await p.password({
    message: 'OpenAI API key',
    validate: (v) => { if (!v.trim()) return 'Required'; },
  }));

  p.log.warn('Using manual OpenAI API key fallback.');
  return await finalizeOpenAiCodexProviderInstall(client, flags, manualApiKey.trim());
}

export async function loginOpenAiCodex(client, flags) {
  let method = resolveOpenAiAuthMethod(flags);
  if (!method && isInteractive()) {
    method = handleCancel(await p.select({
      message: 'Select OpenAI auth method',
      options: [
        { value: 'cloud', label: 'ChatGPT Pro/Plus (oauth.cloud.moxxy.ai)', hint: 'recommended: hosted, no local server' },
        { value: 'browser', label: 'ChatGPT Pro/Plus (browser)', hint: 'local OAuth callback on port 1455' },
        { value: 'headless', label: 'ChatGPT Pro/Plus (headless)', hint: 'device-code flow with verification code' },
      ],
    }));
  }
  if (!method) {
    method = 'cloud';
  }

  const oauthTokens = await loginOpenAiCodexByMethod(method, flags);

  // Cloud flow already exchanged the API key and listed models on oauth.cloud.moxxy.ai;
  // only vault storage + provider install remain.
  if (oauthTokens && oauthTokens.__cloudResult) {
    const { secretValue, models } = oauthTokens.__cloudResult;
    return finalizeOpenAiCodexProviderInstall(client, flags, secretValue, { models });
  }

  try {
    return await finalizeOpenAiCodexLogin(client, flags, oauthTokens);
  } catch (err) {
    if (!isMissingOrganizationIdError(err)) {
      throw err;
    }

    let sessionTokens = oauthTokens;
    const apiAuthClaims = extractOpenAiAuthClaims(oauthTokens?.id_token);
    const organizations = listOrganizationCandidates(apiAuthClaims);
    const alreadyScoped = Boolean(flags.allowed_workspace_id || flags.allowedWorkspaceId || flags.organization_id || flags.organizationId);

    if (!alreadyScoped && organizations.length > 0) {
      let selectedOrg = organizations.find(o => o.is_default)?.id || organizations[0].id;

      if (isInteractive() && organizations.length > 1) {
        const chosen = await p.select({
          message: 'Select OpenAI organization for API key issuance',
          options: organizations.map(org => ({
            value: org.id,
            label: org.title ? `${org.title} (${org.id})` : org.id,
            hint: org.is_default ? 'default' : undefined,
          })),
        });
        selectedOrg = handleCancel(chosen);
      }

      p.log.warn(`Retrying OAuth with selected organization: ${selectedOrg}`);
      const retryFlags = buildScopedRetryFlags(flags, selectedOrg, method);
      const retryOauthTokens = await loginOpenAiCodexByMethod(method, retryFlags);
      sessionTokens = retryOauthTokens;
      try {
        return await finalizeOpenAiCodexLogin(client, flags, retryOauthTokens);
      } catch (retryErr) {
        if (!isMissingOrganizationIdError(retryErr)) {
          throw retryErr;
        }
      }
    }

    const sessionFallback = await maybeFinalizeWithCodexSession(client, flags, sessionTokens);
    if (sessionFallback) {
      return sessionFallback;
    }

    const platformUrl = 'https://platform.openai.com/';
    p.note(
      `OpenAI returned an ID token without organization_id. Complete API organization/project setup at ${platformUrl} and retry provider login.`,
      'OpenAI Setup'
    );

    const manualFallback = await maybeFinalizeWithManualApiKey(client, flags);
    if (manualFallback) {
      return manualFallback;
    }

    throw err;
  }
}

// ── Anthropic Login ───────────────────────────────────────────────────────────

export function buildAnthropicSessionSecret({ accessToken, refreshToken, expiresAtMs }) {
  return JSON.stringify({
    mode: ANTHROPIC_OAUTH_SESSION_MODE,
    client_id: ANTHROPIC_OAUTH_CLIENT_ID,
    access_token: String(accessToken || '').trim(),
    refresh_token: String(refreshToken || '').trim(),
    expires_at: toPositiveInt(expiresAtMs, 0),
  });
}

async function exchangeAnthropicAuthCode({ authorizationCode, codeVerifier, redirectUri }) {
  // Auth code comes as {code}#{state} - split on #
  const hashIdx = authorizationCode.indexOf('#');
  const code = hashIdx >= 0 ? authorizationCode.slice(0, hashIdx) : authorizationCode;
  const state = hashIdx >= 0 ? authorizationCode.slice(hashIdx + 1) : '';

  const resp = await fetch(ANTHROPIC_OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      state,
      client_id: ANTHROPIC_OAUTH_CLIENT_ID,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  const text = await resp.text();
  const json = parseJsonSafe(text);
  if (!resp.ok || !json?.access_token) {
    const msg = json?.error_description || json?.error || text;
    throw new Error(`Anthropic OAuth code exchange failed (${resp.status}): ${msg}`);
  }
  return json;
}

function extractAnthropicAuthCodeFromInput(rawInput, expectedState) {
  const input = rawInput.trim();

  // Try parsing as a full callback URL first
  try {
    const url = new URL(input);
    const code = url.searchParams.get('code') || '';
    const returnedState = url.searchParams.get('state') || '';
    if (code) {
      if (expectedState && returnedState && returnedState !== expectedState) {
        throw new Error('Anthropic OAuth state mismatch - possible CSRF. Please retry.');
      }
      return `${code}#${returnedState}`;
    }
  } catch {
    // Not a URL - try as raw code
  }

  // Accept raw {code}#{state} or just {code}
  if (input) return input;
  throw new Error('Could not extract authorization code from input');
}

async function loginAnthropicOAuth(client, flags) {
  const noBrowser = toBool(flags.no_browser) || toBool(flags.noBrowser);
  const state = createStateToken();
  const codeVerifier = createCodeVerifier();
  const codeChallenge = buildPkceCodeChallenge(codeVerifier);
  const redirectUri = ANTHROPIC_OAUTH_REDIRECT_URI;

  const authorizeUrl = new URL(ANTHROPIC_OAUTH_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', ANTHROPIC_OAUTH_CLIENT_ID);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', ANTHROPIC_OAUTH_SCOPE);
  authorizeUrl.searchParams.set('state', state);

  if (!noBrowser) {
    tryOpenUrl(authorizeUrl.toString());
  }

  p.note(
    [
      'Log in to Anthropic and approve access.',
      `Open this URL: ${authorizeUrl.toString()}`,
      '',
      'After approving, copy the authorization code shown on the page',
      '(or the full callback URL from your browser address bar) and paste it below.',
    ].join('\n'),
    'Anthropic OAuth (Claude Plan)'
  );

  if (!isInteractive()) {
    throw new Error('Anthropic OAuth login requires interactive mode. Use --method api-key for non-interactive.');
  }

  const callbackInput = handleCancel(await p.text({
    message: 'Paste authorization code or callback URL',
    validate: (v) => { if (!v.trim()) return 'Required'; },
  }));

  const authorizationCode = extractAnthropicAuthCodeFromInput(callbackInput, state);

  const tokens = await withSpinner(
    'Exchanging authorization code...',
    () => exchangeAnthropicAuthCode({
      authorizationCode,
      codeVerifier,
      redirectUri,
    }),
    'Token exchange completed.'
  );

  const expiresInSec = toPositiveInt(tokens.expires_in, 28800);
  const expiresAtMs = Date.now() + (Math.max(60, expiresInSec) * 1000);
  const secretValue = buildAnthropicSessionSecret({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAtMs,
  });

  await withSpinner(
    'Storing provider key in vault...',
    () => upsertProviderSecret(client, ANTHROPIC_SECRET_KEY_NAME, ANTHROPIC_BACKEND_KEY, secretValue),
    'Provider key stored in vault.'
  );

  const builtin = BUILTIN_PROVIDERS.find(bp => bp.id === ANTHROPIC_PROVIDER_ID);
  const models = builtin.models.map(m => ({
    ...m,
    metadata: { api_base: ANTHROPIC_API_BASE },
  }));

  const provider = await withSpinner(
    'Installing Anthropic provider...',
    () => client.installProvider(ANTHROPIC_PROVIDER_ID, builtin.display_name, models),
    'Anthropic provider installed.'
  );

  const result = {
    provider_id: ANTHROPIC_PROVIDER_ID,
    provider,
    models_count: models.length,
  };

  if (toBool(flags.json)) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    showResult('Provider Connected', {
      Provider: builtin.display_name,
      ID: ANTHROPIC_PROVIDER_ID,
      Models: models.length,
      Secret: ANTHROPIC_SECRET_KEY_NAME,
      Auth: 'Claude Plan (OAuth)',
    });
  }

  return result;
}

async function loginAnthropicApiKey(client, flags) {
  const argApiKey = String(flags.api_key || flags['api-key'] || '').trim();
  let apiKey = argApiKey;

  if (!apiKey) {
    if (!isInteractive()) {
      throw new Error('Anthropic login requires --api-key in non-interactive mode');
    }

    p.note(
      'Get your API key at: https://console.anthropic.com/settings/keys',
      'Anthropic API Key'
    );

    apiKey = handleCancel(await p.password({
      message: 'Anthropic API key',
      validate: (v) => { if (!v.trim()) return 'Required'; },
    }));
    apiKey = apiKey.trim();
  }

  // Validate by calling the models endpoint
  await withSpinner('Validating API key...', async () => {
    const resp = await fetch(`${ANTHROPIC_API_BASE}/v1/models`, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (!resp.ok) {
      const text = await resp.text();
      const json = parseJsonSafe(text);
      const msg = json?.error?.message || text;
      throw new Error(`Anthropic API key validation failed (${resp.status}): ${msg}`);
    }
  }, 'API key is valid.');

  await withSpinner(
    'Storing provider key in vault...',
    () => upsertProviderSecret(client, ANTHROPIC_SECRET_KEY_NAME, ANTHROPIC_BACKEND_KEY, apiKey),
    'Provider key stored in vault.'
  );

  const builtin = BUILTIN_PROVIDERS.find(bp => bp.id === ANTHROPIC_PROVIDER_ID);
  const models = builtin.models.map(m => ({
    ...m,
    metadata: { api_base: ANTHROPIC_API_BASE },
  }));

  const provider = await withSpinner(
    'Installing Anthropic provider...',
    () => client.installProvider(ANTHROPIC_PROVIDER_ID, builtin.display_name, models),
    'Anthropic provider installed.'
  );

  const result = {
    provider_id: ANTHROPIC_PROVIDER_ID,
    provider,
    models_count: models.length,
  };

  if (toBool(flags.json)) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    showResult('Provider Connected', {
      Provider: builtin.display_name,
      ID: ANTHROPIC_PROVIDER_ID,
      Models: models.length,
      Secret: ANTHROPIC_SECRET_KEY_NAME,
    });
  }

  return result;
}

export async function loginAnthropic(client, flags) {
  let method = String(flags.method || '').trim().toLowerCase();

  // --api-key flag → direct API key flow
  if (flags.api_key || flags['api-key']) method = 'api-key';

  if (!method && isInteractive()) {
    method = handleCancel(await p.select({
      message: 'Select Anthropic auth method',
      options: [
        { value: 'oauth', label: 'Claude Plan (OAuth)', hint: 'recommended: Pro/Max subscription' },
        { value: 'api-key', label: 'API Key', hint: 'from console.anthropic.com' },
      ],
    }));
  }
  if (!method) method = 'oauth';

  if (method === 'api-key') return loginAnthropicApiKey(client, flags);
  return loginAnthropicOAuth(client, flags);
}

// ── Provider Credential Check ──────────────────────────────────────────────

/**
 * Verify credentials for a provider.  For CLI-based providers this checks the
 * binary + auth status; for API providers it checks the env-var key and
 * optionally stores it in the vault.
 *
 * Returns `false` if the provider cannot be used (missing binary), `true`
 * otherwise (warnings are logged but do not block installation).
 */
export async function checkProviderCredentials(builtin, client) {
  if (builtin.cli_binary) {
    const { execFileSync } = await import('node:child_process');
    try {
      const binPath = execFileSync('which', [builtin.cli_binary], { encoding: 'utf8' }).trim();
      p.log.success(`${builtin.cli_binary} found at: ${binPath}`);

      try {
        const authOut = execFileSync(binPath, ['auth', 'status', '--json'], { encoding: 'utf8', timeout: 10_000 });
        const auth = JSON.parse(authOut);
        if (auth.authenticated || auth.loggedIn) {
          p.log.success(`Authenticated as: ${auth.email || auth.account || 'unknown'}`);
        } else {
          p.log.warn(`${builtin.cli_binary} is not authenticated. Run: ${builtin.cli_binary} auth login`);
        }
      } catch {
        p.log.warn(`Could not check auth status. Make sure you are logged in: ${builtin.cli_binary} auth login`);
      }
    } catch {
      p.log.error(`${builtin.cli_binary} binary not found. Install it first: https://docs.anthropic.com/en/docs/claude-code`);
      return false;
    }
  } else if (builtin.id === OLLAMA_PROVIDER_ID) {
    try {
      const discovered = await fetchOllamaModels(builtin.api_base);
      if (discovered.length > 0) {
        p.log.success(`Local Ollama detected (${discovered.length} models discovered).`);
      } else {
        p.log.warn('Could not discover local Ollama models. Static catalog will be used as fallback.');
      }
    } catch {
      p.log.warn('Could not reach local Ollama. Static catalog will be used as fallback.');
    }
  } else if (builtin.api_key_env) {
    const currentKey = process.env[builtin.api_key_env];
    if (currentKey) {
      const masked = currentKey.slice(0, 8) + '...' + currentKey.slice(-4);
      p.log.success(`API key found: ${builtin.api_key_env} = ${masked}`);
    } else {
      p.log.warn(`API key not set: ${builtin.api_key_env}`);

      const setKey = handleCancel(await p.confirm({
        message: `Store API key via vault? (You can also set ${builtin.api_key_env} in your shell)`,
        initialValue: false,
      }));

      if (setKey) {
        const apiKey = handleCancel(await p.password({
          message: `Enter your ${builtin.display_name} API key`,
          validate: (v) => { if (!v.trim()) return 'Required'; },
        }));

        try {
          await withSpinner('Storing API key in vault...', async () => {
            await client.request('/v1/vault/secrets', 'POST', {
              key_name: builtin.api_key_env,
              backend_key: `moxxy_provider_${builtin.id}`,
              policy_label: 'provider-api-key',
              value: apiKey,
            });
          }, 'API key reference stored.');

          p.note(
            `export ${builtin.api_key_env}="${apiKey}"`,
            'Also add to your shell profile for direct access'
          );
        } catch (err) {
          p.log.warn(`Could not store in vault: ${err.message}`);
          p.note(
            `export ${builtin.api_key_env}="<your-key>"`,
            'Set this in your shell profile'
          );
        }
      } else {
        p.note(
          `export ${builtin.api_key_env}="<your-key>"`,
          'Set this in your shell profile'
        );
      }
    }
  }
  return true;
}

// ── Built-in Provider Catalog ────────────────────────────────────────────────
// Each provider lives in its own file under ./providers/ — see providers/index.js.
// Re-exported here for back-compat with existing importers.

export { BUILTIN_PROVIDERS };

// ── CLI Command ──────────────────────────────────────────────────────────────

export async function runProvider(client, args) {
  let [action, ...rest] = args;
  const flags = parseFlags(rest);

  // Interactive sub-menu when no action
  if (!action && isInteractive()) {
    action = await p.select({
      message: 'Provider action',
      options: [
        { value: 'install', label: 'Install provider', hint: 'add a built-in or custom provider' },
        { value: 'login', label: 'Login provider', hint: 'OAuth/subscription login for supported providers' },
        { value: 'list',    label: 'List providers',    hint: 'show installed providers' },
        { value: 'catalog', label: 'Catalog',           hint: 'list all built-in providers and their known models' },
      ],
    });
    handleCancel(action);
  }

  switch (action) {
    case 'list': {
      let result;
      if (isInteractive()) {
        result = await withSpinner('Fetching providers...', () =>
          client.listProviders(), 'Providers loaded.');
        if (Array.isArray(result) && result.length > 0) {
          for (const pr of result) {
            const status = pr.enabled ? 'enabled' : 'disabled';
            p.log.info(`${pr.display_name || pr.id}  (${pr.id})  [${status}]`);
          }
        } else {
          p.log.warn('No providers installed. Run: moxxy provider install');
        }
      } else {
        result = await client.listProviders();
        console.log(JSON.stringify(result, null, 2));
      }
      return result;
    }

    case 'catalog': {
      const catalog = getProviderCatalog();
      if (isInteractive() && !flags.json) {
        p.intro('Built-in provider catalog');
        for (const pr of catalog) {
          p.log.info(`${pr.display_name}  (${pr.id})`);
          for (const m of pr.models) {
            console.log(`    - ${m.model_id}${m.display_name ? `  (${m.display_name})` : ''}`);
          }
        }
        p.outro(`${catalog.length} provider(s)`);
      } else {
        console.log(JSON.stringify(catalog, null, 2));
      }
      return catalog;
    }

    case 'install': {
      if (isInteractive()) {
        return await installInteractive(client);
      }
      return await installNonInteractive(client, flags);
    }

    case 'login': {
      return await loginProvider(client, flags);
    }

    default:
      if (!action) {
        console.error('Usage: moxxy provider <install|login|list|catalog>');
      } else {
        console.error(`Unknown provider action: ${action}`);
      }
      process.exitCode = 1;
  }
}

async function loginProvider(client, flags) {
  let providerId = flags.id || flags.provider;

  if (!providerId && isInteractive()) {
    providerId = handleCancel(await p.select({
      message: 'Select provider to log in',
      options: [
        { value: OPENAI_CODEX_PROVIDER_ID, label: 'OpenAI (Codex OAuth)', hint: 'ChatGPT Pro/Plus OAuth' },
        { value: ANTHROPIC_PROVIDER_ID, label: 'Anthropic', hint: 'Claude plan (OAuth) or API key' },
      ],
    }));
  }

  if (!providerId) {
    providerId = OPENAI_CODEX_PROVIDER_ID;
  }

  if (providerId === ANTHROPIC_PROVIDER_ID) return loginAnthropic(client, flags);
  if (providerId === OPENAI_CODEX_PROVIDER_ID) return loginOpenAiCodex(client, flags);

  throw new Error(`Provider login supported for: ${ANTHROPIC_PROVIDER_ID}, ${OPENAI_CODEX_PROVIDER_ID}`);
}

// ── Interactive Install Wizard ───────────────────────────────────────────────

async function installInteractive(client) {
  p.intro('Install Provider');

  // Step 1: Choose built-in or custom
  const providerChoice = await p.select({
    message: 'Select a provider to install',
    options: [
      ...BUILTIN_PROVIDERS.map(bp => ({
        value: bp.id,
        label: bp.display_name,
        hint: `${bp.models.length} models`,
      })),
      { value: '__custom__', label: 'Custom provider', hint: 'OpenAI-compatible endpoint' },
    ],
  });
  handleCancel(providerChoice);

  let providerId, displayName, models, apiKeyEnv, apiBase;

  if (providerChoice === '__custom__') {
    // Custom provider flow
    providerId = handleCancel(await p.text({
      message: 'Provider ID',
      placeholder: 'my-provider',
      validate: (v) => { if (!v.trim()) return 'Required'; },
    }));

    displayName = handleCancel(await p.text({
      message: 'Display name',
      placeholder: 'My Provider',
      validate: (v) => { if (!v.trim()) return 'Required'; },
    }));

    apiBase = handleCancel(await p.text({
      message: 'API base URL',
      placeholder: 'https://api.example.com/v1',
      validate: (v) => {
        try { new URL(v); } catch { return 'Must be a valid URL'; }
      },
    }));

    apiKeyEnv = handleCancel(await p.text({
      message: 'API key environment variable name',
      placeholder: 'MY_PROVIDER_API_KEY',
      validate: (v) => { if (!v.trim()) return 'Required'; },
    }));

    // Custom models
    models = [];
    let addMore = true;
    while (addMore) {
      const modelId = handleCancel(await p.text({
        message: 'Model ID',
        placeholder: 'model-name',
        validate: (v) => { if (!v.trim()) return 'Required'; },
      }));

      const modelName = handleCancel(await p.text({
        message: 'Model display name',
        initialValue: modelId,
      }));

      models.push({
        model_id: modelId,
        display_name: modelName || modelId,
        metadata: { api_base: apiBase },
      });

      addMore = handleCancel(await p.confirm({
        message: 'Add another model?',
        initialValue: false,
      }));
    }
  } else {
    // Built-in provider
    const builtin = BUILTIN_PROVIDERS.find(bp => bp.id === providerChoice);
    providerId = builtin.id;
    displayName = builtin.display_name;
    apiKeyEnv = builtin.api_key_env;
    apiBase = builtin.api_base;
    const availableModels = await resolveBuiltinProviderModels(builtin);

    // Step 2: Select which models to install
    const CUSTOM_MODEL_VALUE = '__custom_model__';

    const selectedModels = handleCancel(await p.multiselect({
      message: 'Select models to install',
      options: [
        ...availableModels.map(m => ({
          value: m.model_id,
          label: m.display_name,
          hint: m.model_id,
        })),
        { value: CUSTOM_MODEL_VALUE, label: 'Custom model ID', hint: 'enter a model ID manually' },
      ],
      required: true,
    }));

    models = availableModels
      .filter(m => selectedModels.includes(m.model_id))
      .map(m => ({
        ...m,
        metadata: m.metadata || (apiBase ? { api_base: apiBase } : {}),
      }));

    // Prompt for custom model details if selected
    if (selectedModels.includes(CUSTOM_MODEL_VALUE)) {
      const customModelId = handleCancel(await p.text({
        message: 'Custom model ID',
        placeholder: 'e.g. ft:gpt-4o:my-org:custom-suffix',
        validate: (v) => { if (!v.trim()) return 'Required'; },
      }));

      const customModelName = handleCancel(await p.text({
        message: 'Display name for this model',
        initialValue: customModelId,
      }));

      models.push({
        model_id: customModelId,
        display_name: customModelName || customModelId,
        metadata: apiBase ? { api_base: apiBase, custom: true } : { custom: true },
      });
    }
  }

  const builtin = BUILTIN_PROVIDERS.find(bp => bp.id === providerId);

  if (builtin?.oauth_login || builtin?.api_key_login) {
    // Providers with dedicated login: delegate to the login flow which handles
    // OAuth/API-key auth, vault storage, and provider installation in one step.
    const flags = {};
    if (providerId === ANTHROPIC_PROVIDER_ID) return loginAnthropic(client, flags);
    if (providerId === OPENAI_CODEX_PROVIDER_ID) return loginOpenAiCodex(client, flags);

    // Fallback for future login-enabled providers
    p.log.info(`Run: moxxy provider login --id ${providerId}`);
    return;
  }

  // Verify credentials (binary check for CLI providers, API key for others)
  const credOk = await checkProviderCredentials(
    builtin || { id: providerId, display_name: displayName, api_key_env: apiKeyEnv },
    client,
  );
  if (!credOk) return;

  // Step 3: Install provider via API
  const result = await withSpinner(`Installing ${displayName}...`, () =>
    client.installProvider(providerId, displayName, models),
    `${displayName} installed.`
  );

  const resultInfo = {
    ID: providerId,
    Name: displayName,
    Models: models.map(m => m.model_id).join(', '),
  };
  if (apiKeyEnv) resultInfo['API Key Env'] = apiKeyEnv;
  if (builtin?.cli_binary) resultInfo['CLI Binary'] = builtin.cli_binary;
  showResult('Provider Installed', resultInfo);

  p.outro('Provider ready. Create an agent with: moxxy agent create');
  return result;
}

// ── Non-Interactive Install ──────────────────────────────────────────────────

async function installNonInteractive(client, flags) {
  const providerId = flags.id || flags.provider;

  // Check if it's a built-in provider
  const builtin = BUILTIN_PROVIDERS.find(bp => bp.id === providerId);

  // Normalize --model to an array (parseFlags collects repeated --model flags)
  const extraModels = Array.isArray(flags.model) ? flags.model : (flags.model ? [flags.model] : []);

  if (builtin) {
    const builtinIds = new Set(builtin.models.map(m => m.model_id));
    const models = await resolveBuiltinProviderModels(builtin);
    const knownModelIds = new Set(models.map(m => m.model_id));

    // Add custom models that aren't already in the builtin catalog
    for (const modelId of extraModels) {
      if (!builtinIds.has(modelId) && !knownModelIds.has(modelId)) {
        models.push({
          model_id: modelId,
          display_name: modelId,
          metadata: builtin.api_base ? { api_base: builtin.api_base, custom: true } : { custom: true },
        });
      }
    }

    const result = await client.installProvider(builtin.id, builtin.display_name, models);
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  // Custom provider
  if (!providerId) {
    throw new Error('Required: --id (provider id). Built-in: openai, openai-codex, anthropic, ollama, xai, google, deepseek, zai, zai-coding-plan, claude-cli');
  }

  const displayName = flags.name || flags.display_name || providerId;
  const apiBase = flags.api_base || flags.url;
  const models = [];

  for (const modelId of extraModels) {
    models.push({
      model_id: modelId,
      display_name: flags.model_name || modelId,
      metadata: apiBase ? { api_base: apiBase } : undefined,
    });
  }

  const result = await client.installProvider(providerId, displayName, models);
  console.log(JSON.stringify(result, null, 2));
  return result;
}
