/**
 * Provider commands: install/list/verify.
 * Includes built-in provider catalog with frontier models.
 */
import { parseFlags } from './auth.js';
import { isInteractive, handleCancel, withSpinner, showResult, p } from '../ui.js';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

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
const OPENAI_CODEX_MODEL_IDS = [
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.1-codex',
  'gpt-5.1-codex-mini',
  'gpt-5.1-codex-max',
  'gpt-5.2',
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
  if (raw === 'browser' || raw === 'headless') {
    return raw;
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
  let cmd;
  let args;

  if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }

  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
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
  const title = success ? 'OpenAI authorization complete' : 'OpenAI authorization failed';
  const escaped = String(message || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${escaped}</p><script>window.close()</script></body></html>`;
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
    headers: { 'content-type': 'application/json' },
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
      headers: { 'content-type': 'application/json' },
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
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
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
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
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
  return method === 'headless'
    ? loginOpenAiCodexHeadless(flags)
    : loginOpenAiCodexBrowser(flags);
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
        { value: 'browser', label: 'ChatGPT Pro/Plus (browser)', hint: 'recommended: full OAuth link with callback' },
        { value: 'headless', label: 'ChatGPT Pro/Plus (headless)', hint: 'device-code flow with verification code' },
      ],
    }));
  }
  if (!method) {
    method = 'browser';
  }

  const oauthTokens = await loginOpenAiCodexByMethod(method, flags);

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

export const BUILTIN_PROVIDERS = [
  {
    id: 'anthropic',
    display_name: 'Anthropic',
    api_key_env: 'ANTHROPIC_API_KEY',
    api_base: 'https://api.anthropic.com',
    api_key_login: true,
    oauth_login: true,
    models: [
      { model_id: 'claude-sonnet-5-20260203', display_name: 'Claude Sonnet 5 "Fennec"' },
      { model_id: 'claude-opus-4-20250514', display_name: 'Claude Opus 4' },
      { model_id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' },
      { model_id: 'claude-haiku-4-20250506', display_name: 'Claude Haiku 4' },
      { model_id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet' },
      { model_id: 'claude-3-5-haiku-20241022', display_name: 'Claude 3.5 Haiku' },
    ],
  },
  {
    id: 'openai',
    display_name: 'OpenAI',
    api_key_env: 'OPENAI_API_KEY',
    api_base: OPENAI_API_BASE,
    models: [
      { model_id: 'gpt-5.2', display_name: 'GPT-5.2' },
      { model_id: 'gpt-4.1', display_name: 'GPT-4.1' },
      { model_id: 'gpt-4.1-mini', display_name: 'GPT-4.1 Mini' },
      { model_id: 'gpt-4.1-nano', display_name: 'GPT-4.1 Nano' },
      { model_id: 'o3', display_name: 'o3' },
      { model_id: 'o4-mini', display_name: 'o4-mini' },
      { model_id: 'gpt-4o', display_name: 'GPT-4o' },
      { model_id: 'gpt-4o-mini', display_name: 'GPT-4o Mini' },
    ],
  },
  {
    id: OPENAI_CODEX_PROVIDER_ID,
    display_name: OPENAI_CODEX_DISPLAY_NAME,
    api_key_env: OPENAI_CODEX_SECRET_KEY_NAME,
    api_base: OPENAI_API_BASE,
    oauth_login: true,
    models: [
      { model_id: 'gpt-5.2', display_name: 'GPT-5.2' },
      { model_id: 'gpt-4.1', display_name: 'GPT-4.1' },
      { model_id: 'gpt-4.1-mini', display_name: 'GPT-4.1 Mini' },
      { model_id: 'gpt-4.1-nano', display_name: 'GPT-4.1 Nano' },
      { model_id: 'o3', display_name: 'o3' },
      { model_id: 'o4-mini', display_name: 'o4-mini' },
      { model_id: 'gpt-4o', display_name: 'GPT-4o' },
      { model_id: 'gpt-4o-mini', display_name: 'GPT-4o Mini' },
    ],
  },
  {
    id: 'xai',
    display_name: 'xAI',
    api_key_env: 'XAI_API_KEY',
    api_base: 'https://api.x.ai/v1',
    models: [
      { model_id: 'grok-4', display_name: 'Grok 4' },
      { model_id: 'grok-3', display_name: 'Grok 3' },
      { model_id: 'grok-3-mini', display_name: 'Grok 3 Mini' },
      { model_id: 'grok-3-fast', display_name: 'Grok 3 Fast' },
      { model_id: 'grok-2', display_name: 'Grok 2' },
    ],
  },
  {
    id: 'google',
    display_name: 'Google Gemini',
    api_key_env: 'GOOGLE_API_KEY',
    api_base: 'https://generativelanguage.googleapis.com/v1beta',
    models: [
      { model_id: 'gemini-3.1-pro', display_name: 'Gemini 3.1 Pro' },
      { model_id: 'gemini-2.5-pro', display_name: 'Gemini 2.5 Pro' },
      { model_id: 'gemini-2.5-flash', display_name: 'Gemini 2.5 Flash' },
      { model_id: 'gemini-2.0-flash', display_name: 'Gemini 2.0 Flash' },
    ],
  },
  {
    id: 'deepseek',
    display_name: 'DeepSeek',
    api_key_env: 'DEEPSEEK_API_KEY',
    api_base: 'https://api.deepseek.com',
    models: [
      { model_id: 'deepseek-v4', display_name: 'DeepSeek V4' },
      { model_id: 'deepseek-r1', display_name: 'DeepSeek R1' },
      { model_id: 'deepseek-v3', display_name: 'DeepSeek V3' },
    ],
  },
  {
    id: 'zai',
    display_name: 'ZAI',
    api_key_env: 'ZAI_API_KEY',
    api_base: 'https://api.zai.com/v1',
    models: [
      { model_id: 'zai-pro', display_name: 'ZAI Pro' },
      { model_id: 'zai-standard', display_name: 'ZAI Standard' },
      { model_id: 'zai-fast', display_name: 'ZAI Fast' },
    ],
  },
  {
    id: 'zai-plan',
    display_name: 'ZAI Plan',
    api_key_env: 'ZAI_API_KEY',
    api_base: 'https://api.zai.com/v1',
    models: [
      { model_id: 'zai-plan-pro', display_name: 'ZAI Plan Pro' },
      { model_id: 'zai-plan-standard', display_name: 'ZAI Plan Standard' },
    ],
  },
  {
    id: 'claude-cli',
    display_name: 'Claude Code CLI',
    cli_binary: 'claude',
    models: [
      { model_id: 'opus', display_name: 'Claude Opus' },
      { model_id: 'sonnet', display_name: 'Claude Sonnet' },
      { model_id: 'haiku', display_name: 'Claude Haiku' },
    ],
  },
];

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
        console.error('Usage: moxxy provider <install|login|list>');
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

    // Step 2: Select which models to install
    const CUSTOM_MODEL_VALUE = '__custom_model__';

    const selectedModels = handleCancel(await p.multiselect({
      message: 'Select models to install',
      options: [
        ...builtin.models.map(m => ({
          value: m.model_id,
          label: m.display_name,
          hint: m.model_id,
        })),
        { value: CUSTOM_MODEL_VALUE, label: 'Custom model ID', hint: 'enter a model ID manually' },
      ],
      required: true,
    }));

    models = builtin.models
      .filter(m => selectedModels.includes(m.model_id))
      .map(m => ({
        ...m,
        metadata: apiBase ? { api_base: apiBase } : {},
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
    const models = builtin.models.map(m => ({
      ...m,
      metadata: builtin.api_base ? { api_base: builtin.api_base } : {},
    }));

    // Add custom models that aren't already in the builtin catalog
    for (const modelId of extraModels) {
      if (!builtinIds.has(modelId)) {
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
    throw new Error('Required: --id (provider id). Built-in: openai, openai-codex, anthropic, xai, zai, zai-plan, claude-cli');
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
