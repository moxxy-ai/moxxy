import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../src/api-client.js';
import { parseAuthCommand, buildTokenPayload } from '../src/commands/auth.js';
import { parseAgentCommand } from '../src/commands/agent.js';
import {
  BUILTIN_PROVIDERS,
  buildCodexDeviceCodeBody,
  buildCodexAuthorizationCodeExchangeBody,
  buildCodexApiKeyExchangeBody,
  buildCodexBrowserAuthorizeUrl,
  codexClientHeaders,
  codexUserAgent,
  buildOllamaDiscoveryUrls,
  buildScopedRetryFlags,
  buildOpenAiCodexSessionModels,
  buildOpenAiCodexSessionSecret,
  buildPkceCodeChallenge,
  extractCodexAccountIdFromTokens,
  formatOpenAiOAuthError,
  getMoxxyCodexCloudOauthUrl,
  parseOllamaModels,
  parseOpenAiModels,
} from '../src/commands/provider.js';
import { buildSseUrl, parseSseEvent, createSseClient } from '../src/sse-client.js';
import { isInteractive, handleCancel } from '../src/ui.js';
import { matchCommands, isSlashCommand, SLASH_COMMANDS } from '../src/tui/slash-commands.js';
import { EventsHandler } from '../src/tui/events-handler.js';
import { COMMAND_HELP } from '../src/help.js';
import { saveSttSetting } from '../src/commands/init.js';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// API Client tests
describe('api-client', () => {
  it('request adds bearer header', () => {
    const client = createApiClient('http://localhost:3000', 'mox_test_token');
    const req = client.buildRequest('/v1/auth/tokens', 'GET');
    assert.equal(req.headers.get('authorization'), 'Bearer mox_test_token');
  });

  it('build url with base and path', () => {
    const client = createApiClient('http://localhost:3000', 'tok');
    const url = client.buildUrl('/v1/agents');
    assert.equal(url, 'http://localhost:3000/v1/agents');
  });

  it('build url avoids duplicated /v1 when base already ends with /v1', () => {
    const client = createApiClient('http://localhost:3000/v1', 'tok');
    const url = client.buildUrl('/v1/agents');
    assert.equal(url, 'http://localhost:3000/v1/agents');
  });

  it('build url avoids duplicated /v1 when base ends with /v1/', () => {
    const client = createApiClient('http://localhost:3000/v1/', 'tok');
    const url = client.buildUrl('/v1/providers');
    assert.equal(url, 'http://localhost:3000/v1/providers');
  });

  it('request throws on error response', async () => {
    const client = createApiClient('http://127.0.0.1:19876', 'tok');
    await assert.rejects(() => client.request('/v1/agents', 'GET'));
  });

  it('getHistory builds correct url', () => {
    const client = createApiClient('http://localhost:3000', 'tok');
    const req = client.buildRequest('/v1/agents/my-agent/history?limit=50', 'GET');
    assert.equal(req.url, 'http://localhost:3000/v1/agents/my-agent/history?limit=50');
    assert.equal(req.method, 'GET');
  });

  it('getHistory uses default limit', () => {
    const client = createApiClient('http://localhost:3000', 'tok');
    // Verify the method exists and builds the right request by checking buildUrl
    const url = client.buildUrl('/v1/agents/test-agent/history?limit=50');
    assert.equal(url, 'http://localhost:3000/v1/agents/test-agent/history?limit=50');
  });

  it('request throws gateway-down error when connection refused', async () => {
    // Use a valid port that's almost certainly not listening
    const client = createApiClient('http://127.0.0.1:19876', 'tok');
    try {
      await client.request('/v1/agents', 'GET');
      assert.fail('should have thrown');
    } catch (err) {
      assert.equal(err.isGatewayDown, true);
      assert.ok(err.message.includes('Gateway is not running'));
      assert.ok(err.message.includes('moxxy gateway start'));
    }
  });

  it('request appends endpoint hint on 404', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response(
        JSON.stringify({ message: 'Not Found' }),
        {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }
      );

      const client = createApiClient('http://localhost:3000', 'tok');
      await assert.rejects(
        () => client.request('/v1/agents', 'GET'),
        (err) => {
          assert.equal(err.status, 404);
          assert.ok(err.message.includes('Endpoint not found (/v1/agents)'));
          assert.ok(err.message.includes('MOXXY_API_URL'));
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// Command parsing tests
describe('auth commands', () => {
  it('parse token create with all flags', () => {
    const args = ['token', 'create', '--scopes', 'agents:read,agents:write', '--ttl', '3600', '--json'];
    const parsed = parseAuthCommand(args);
    assert.deepEqual(parsed.scopes, ['agents:read', 'agents:write']);
    assert.equal(parsed.ttl, 3600);
    assert.equal(parsed.json, true);
  });

  it('parse token create minimal', () => {
    const args = ['token', 'create', '--scopes', 'tokens:admin'];
    const parsed = parseAuthCommand(args);
    assert.deepEqual(parsed.scopes, ['tokens:admin']);
    assert.equal(parsed.ttl, undefined);
  });

  it('build token create payload with ttl', () => {
    const payload = buildTokenPayload(['agents:read'], 3600);
    assert.deepEqual(payload, { scopes: ['agents:read'], ttl_seconds: 3600 });
  });

  it('build token create payload without ttl', () => {
    const payload = buildTokenPayload(['agents:read'], undefined);
    assert.deepEqual(payload, { scopes: ['agents:read'] });
    assert.equal(payload.ttl_seconds, undefined);
  });
});

describe('agent commands', () => {
  it('parse agent create with required flags', () => {
    const args = ['create', '--provider', 'openai', '--model', 'gpt-4', '--name', 'my-agent'];
    const parsed = parseAgentCommand(args);
    assert.equal(parsed.provider_id, 'openai');
    assert.equal(parsed.model_id, 'gpt-4');
    assert.equal(parsed.name, 'my-agent');
  });

  it('parse agent run with task', () => {
    const args = ['run', '--id', 'agent-123', '--task', 'do something'];
    const parsed = parseAgentCommand(args);
    assert.equal(parsed.action, 'run');
    assert.equal(parsed.id, 'agent-123');
    assert.equal(parsed.task, 'do something');
  });

  it('parse agent stop with id', () => {
    const args = ['stop', '--id', 'agent-123'];
    const parsed = parseAgentCommand(args);
    assert.equal(parsed.action, 'stop');
    assert.equal(parsed.id, 'agent-123');
  });

  it('parse agent update with all flags', () => {
    const args = ['update', '--id', 'agent-123', '--provider', 'openai', '--model', 'gpt-4o', '--temperature', '0.9'];
    const parsed = parseAgentCommand(args);
    assert.equal(parsed.action, 'update');
    assert.equal(parsed.id, 'agent-123');
    assert.equal(parsed.provider_id, 'openai');
    assert.equal(parsed.model_id, 'gpt-4o');
    assert.equal(parsed.temperature, 0.9);
  });

  it('parse agent update with partial flags', () => {
    const args = ['update', '--id', 'agent-123', '--temperature', '1.0'];
    const parsed = parseAgentCommand(args);
    assert.equal(parsed.action, 'update');
    assert.equal(parsed.id, 'agent-123');
    assert.equal(parsed.provider_id, undefined);
    assert.equal(parsed.model_id, undefined);
    assert.equal(parsed.temperature, 1.0);
  });
});

describe('provider oauth helpers', () => {
  it('includes Ollama as a built-in provider without api-key requirement', () => {
    const ollama = BUILTIN_PROVIDERS.find(provider => provider.id === 'ollama');
    assert.ok(ollama);
    assert.equal(ollama.display_name, 'Ollama');
    assert.equal(ollama.api_key_env, undefined);
    assert.equal(ollama.api_base, 'http://127.0.0.1:11434/v1');
  });

  it('parseOllamaModels reads OpenAI-compatible /v1/models payload', () => {
    const models = parseOllamaModels({
      models: [
        { id: 'gpt-oss:20b', name: 'GPT OSS 20B' },
        { name: 'gemma3' },
      ],
    });

    assert.deepEqual(models, [
      {
        model_id: 'gemma3',
        display_name: 'gemma3',
        metadata: { api_base: 'http://127.0.0.1:11434/v1' },
      },
      {
        model_id: 'gpt-oss:20b',
        display_name: 'GPT OSS 20B',
        metadata: { api_base: 'http://127.0.0.1:11434/v1' },
      },
    ]);
  });

  it('buildOllamaDiscoveryUrls tries both loopback host variants', () => {
    const urls = buildOllamaDiscoveryUrls('http://localhost:11434/v1');
    assert.deepEqual(urls, [
      'http://localhost:11434/v1/models',
      'http://localhost:11434/api/tags',
      'http://127.0.0.1:11434/v1/models',
      'http://127.0.0.1:11434/api/tags',
    ]);
  });

  it('codexClientHeaders include originator and a codex_cli_rs user-agent', () => {
    // Without these headers OpenAI's abuse detection returns 429 on the
    // device-code and token endpoints. Keep them aligned with the Rust side
    // and with the official CLI.
    const headers = codexClientHeaders();
    assert.equal(headers.originator, 'codex_cli_rs');
    assert.match(headers['user-agent'], /^codex_cli_rs\/\S+ \(.+;\s*.+\)$/);
    assert.equal(codexUserAgent(), headers['user-agent']);
  });

  it('codexClientHeaders merges and overrides extras after identity headers', () => {
    const headers = codexClientHeaders({ 'content-type': 'application/json' });
    assert.equal(headers['content-type'], 'application/json');
    assert.equal(headers.originator, 'codex_cli_rs');
  });

  it('buildCodexDeviceCodeBody returns oauth device-code payload', () => {
    const payload = buildCodexDeviceCodeBody('app_test_123');
    assert.deepEqual(payload, {
      client_id: 'app_test_123',
    });
  });

  it('buildCodexDeviceCodeBody includes optional org/workspace/project selectors', () => {
    const payload = buildCodexDeviceCodeBody('app_test_123', {
      allowedWorkspaceId: 'org_123',
      organizationId: 'org_123',
      projectId: 'proj_456',
    });
    assert.deepEqual(payload, {
      client_id: 'app_test_123',
      allowed_workspace_id: 'org_123',
      organization_id: 'org_123',
      project_id: 'proj_456',
    });
  });

  it('buildScopedRetryFlags preserves selected method and scopes organization', () => {
    assert.deepEqual(
      buildScopedRetryFlags({ method: 'headless', no_browser: true }, 'org_123', 'headless'),
      {
        method: 'headless',
        no_browser: true,
        allowed_workspace_id: 'org_123',
        organization_id: 'org_123',
      }
    );

    assert.deepEqual(
      buildScopedRetryFlags({ method: 'browser' }, 'org_123', 'browser'),
      {
        method: 'browser',
        allowed_workspace_id: 'org_123',
        organization_id: 'org_123',
      }
    );
  });

  it('buildCodexAuthorizationCodeExchangeBody returns form payload', () => {
    const body = buildCodexAuthorizationCodeExchangeBody({
      code: 'code_123',
      redirectUri: 'https://auth.openai.com/deviceauth/callback',
      clientId: 'app_test_123',
      codeVerifier: 'verifier_123',
    });

    assert.equal(
      body,
      'grant_type=authorization_code&code=code_123&redirect_uri=https%3A%2F%2Fauth.openai.com%2Fdeviceauth%2Fcallback&client_id=app_test_123&code_verifier=verifier_123'
    );
  });

  it('buildCodexApiKeyExchangeBody returns token-exchange form payload', () => {
    const body = buildCodexApiKeyExchangeBody({
      clientId: 'app_test_123',
      idToken: 'id_token_abc',
    });

    assert.equal(
      body,
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Atoken-exchange&client_id=app_test_123&requested_token=openai-api-key&subject_token=id_token_abc&subject_token_type=urn%3Aietf%3Aparams%3Aoauth%3Atoken-type%3Aid_token'
    );
  });

  it('buildPkceCodeChallenge follows S256 base64url encoding', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = buildPkceCodeChallenge(verifier);
    assert.equal(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('buildCodexBrowserAuthorizeUrl includes organization token claim flag', () => {
    const url = buildCodexBrowserAuthorizeUrl({
      clientId: 'app_test_123',
      redirectUri: 'http://localhost:1455/auth/callback',
      codeChallenge: 'challenge_123',
      state: 'state_123',
      originator: 'Codex Desktop',
    });
    const parsed = new URL(url);

    assert.equal(parsed.origin + parsed.pathname, 'https://auth.openai.com/oauth/authorize');
    assert.equal(parsed.searchParams.get('response_type'), 'code');
    assert.equal(parsed.searchParams.get('client_id'), 'app_test_123');
    assert.equal(parsed.searchParams.get('redirect_uri'), 'http://localhost:1455/auth/callback');
    assert.equal(parsed.searchParams.get('scope'), 'openid profile email offline_access');
    assert.equal(parsed.searchParams.get('code_challenge'), 'challenge_123');
    assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(parsed.searchParams.get('id_token_add_organizations'), 'true');
    assert.equal(parsed.searchParams.get('codex_cli_simplified_flow'), 'true');
    assert.equal(parsed.searchParams.get('state'), 'state_123');
    assert.equal(parsed.searchParams.get('originator'), 'Codex Desktop');
  });

  it('buildCodexBrowserAuthorizeUrl uses Codex Desktop as default originator', () => {
    const url = buildCodexBrowserAuthorizeUrl({
      clientId: 'app_test_123',
      redirectUri: 'http://localhost:1455/auth/callback',
      codeChallenge: 'challenge_123',
      state: 'state_123',
    });
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('originator'), 'Codex Desktop');
  });

  it('buildCodexBrowserAuthorizeUrl includes optional workspace/org/project selectors', () => {
    const url = buildCodexBrowserAuthorizeUrl({
      clientId: 'app_test_123',
      redirectUri: 'http://localhost:1455/auth/callback',
      codeChallenge: 'challenge_123',
      state: 'state_123',
      allowedWorkspaceId: 'org_123',
      organizationId: 'org_123',
      projectId: 'proj_456',
    });
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('allowed_workspace_id'), 'org_123');
    assert.equal(parsed.searchParams.get('organization_id'), 'org_123');
    assert.equal(parsed.searchParams.get('project_id'), 'proj_456');
  });

  it('formatOpenAiOAuthError includes backend details', () => {
    const msg = formatOpenAiOAuthError('OpenAI API key token-exchange failed', 401, {
      error: 'invalid_grant',
      error_description: 'Account is not eligible',
    });

    assert.equal(
      msg,
      'OpenAI API key token-exchange failed (401): invalid_grant - Account is not eligible'
    );
  });

  it('formatOpenAiOAuthError adds eligibility hint for API key exchange 401', () => {
    const msg = formatOpenAiOAuthError('OpenAI API key token-exchange failed', 401, {
      error: 'invalid_grant',
    });

    assert.equal(
      msg,
      'OpenAI API key token-exchange failed (401): invalid_grant. The OpenAI account may not be eligible for OAuth API-key issuance yet (API org/project or billing setup may be missing).'
    );
  });

  it('formatOpenAiOAuthError parses nested OpenAI error object and suggests browser mode', () => {
    const msg = formatOpenAiOAuthError('OpenAI API key token-exchange failed', 401, {
      error: {
        message: 'Invalid ID token: missing organization_id',
        code: 'invalid_subject_token',
      },
    });

    assert.equal(
      msg,
      'OpenAI API key token-exchange failed (401): invalid_subject_token - Invalid ID token: missing organization_id. Retry OAuth with organization-scoped login (interactive flow will prompt to select organization). If OpenCode works but this step fails, it usually means OpenCode is using ChatGPT backend tokens while Moxxy requires API-key issuance linked to an API organization.'
    );
  });

  it('parseOpenAiModels returns sorted unique model list', () => {
    const parsed = parseOpenAiModels({
      data: [
        { id: 'gpt-4o' },
        { id: 'o4-mini' },
        { id: 'gpt-4o' },
        { id: '' },
        {},
      ],
    });

    assert.deepEqual(parsed, [
      { model_id: 'gpt-4o', display_name: 'gpt-4o', metadata: { api_base: 'https://api.openai.com/v1' } },
      { model_id: 'o4-mini', display_name: 'o4-mini', metadata: { api_base: 'https://api.openai.com/v1' } },
    ]);
  });

  it('extractCodexAccountIdFromTokens reads chatgpt account from id token claims', () => {
    const payload = Buffer.from(JSON.stringify({
      chatgpt_account_id: 'acct_123',
      'https://api.openai.com/auth': {
        organizations: [{ id: 'org_abc' }],
      },
    })).toString('base64url');
    const fakeJwt = `aaa.${payload}.bbb`;

    assert.equal(
      extractCodexAccountIdFromTokens({ id_token: fakeJwt }),
      'acct_123'
    );
  });

  it('buildOpenAiCodexSessionSecret stores oauth session fields', () => {
    const secret = buildOpenAiCodexSessionSecret({
      accessToken: 'access_123',
      refreshToken: 'refresh_456',
      expiresAtMs: 1_700_000_000_000,
      accountId: 'acct_123',
    });
    const parsed = JSON.parse(secret);

    assert.deepEqual(parsed, {
      mode: 'chatgpt_oauth_session',
      issuer: 'https://auth.openai.com',
      client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
      access_token: 'access_123',
      refresh_token: 'refresh_456',
      expires_at: 1_700_000_000_000,
      account_id: 'acct_123',
    });
  });

  it('buildOpenAiCodexSessionModels includes codex endpoint and account id metadata', () => {
    const models = buildOpenAiCodexSessionModels('acct_123');
    const codex = models.find(m => m.model_id === 'gpt-5.3-codex');
    assert.ok(codex);
    assert.equal(codex.metadata.api_base, 'https://chatgpt.com/backend-api/codex');
    assert.equal(codex.metadata.chatgpt_account_id, 'acct_123');
  });

  it('getMoxxyCodexCloudOauthUrl defaults to oauth.cloud.moxxy.ai and respects env override', () => {
    const prev = process.env.MOXXY_CODEX_OAUTH_URL;
    try {
      delete process.env.MOXXY_CODEX_OAUTH_URL;
      assert.equal(getMoxxyCodexCloudOauthUrl(), 'https://oauth.cloud.moxxy.ai');

      process.env.MOXXY_CODEX_OAUTH_URL = 'http://localhost:4010/';
      assert.equal(getMoxxyCodexCloudOauthUrl(), 'http://localhost:4010');
    } finally {
      if (prev === undefined) delete process.env.MOXXY_CODEX_OAUTH_URL;
      else process.env.MOXXY_CODEX_OAUTH_URL = prev;
    }
  });
});

describe('sse-client', () => {
  it('build sse url with no filters', () => {
    const url = buildSseUrl('http://localhost:3000', {});
    assert.equal(url, 'http://localhost:3000/v1/events/stream');
  });

  it('build sse url with agent filter', () => {
    const url = buildSseUrl('http://localhost:3000', { agent_id: 'agent-1' });
    assert.equal(url, 'http://localhost:3000/v1/events/stream?agent_id=agent-1');
  });

  it('parse sse event line', () => {
    const event = parseSseEvent('data: {"event_id":"123","event_type":"run.started"}');
    assert.equal(event.event_id, '123');
    assert.equal(event.event_type, 'run.started');
  });

  it('reconnects on connection drop', () => {
    const client = createSseClient('http://localhost:3000', 'tok', {});
    assert.equal(typeof client.reconnect, 'function');
  });
});

// UI helpers tests
describe('ui helpers', () => {
  it('isInteractive returns false when not TTY', () => {
    assert.equal(isInteractive(), false);
  });

  it('handleCancel passes through non-cancel values', () => {
    assert.equal(handleCancel('hello'), 'hello');
    assert.equal(handleCancel(42), 42);
    assert.deepEqual(handleCancel(['a', 'b']), ['a', 'b']);
  });
});

// New API client method tests
describe('api-client new methods', () => {
  it('builds list agents URL', () => {
    const client = createApiClient('http://localhost:3000', 'tok');
    const url = client.buildUrl('/v1/agents');
    assert.equal(url, 'http://localhost:3000/v1/agents');
  });

  it('builds list providers URL', () => {
    const client = createApiClient('http://localhost:3000', 'tok');
    const url = client.buildUrl('/v1/providers');
    assert.equal(url, 'http://localhost:3000/v1/providers');
  });

  it('builds list models URL', () => {
    const client = createApiClient('http://localhost:3000', 'tok');
    const url = client.buildUrl('/v1/providers/openai/models');
    assert.equal(url, 'http://localhost:3000/v1/providers/openai/models');
  });

  it('builds list secrets URL', () => {
    const client = createApiClient('http://localhost:3000', 'tok');
    const url = client.buildUrl('/v1/vault/secrets');
    assert.equal(url, 'http://localhost:3000/v1/vault/secrets');
  });

  it('has listAgents method', () => {
    const client = createApiClient('http://localhost:3000', 'tok');
    assert.equal(typeof client.listAgents, 'function');
  });

  it('has listProviders method', () => {
    const client = createApiClient('http://localhost:3000', 'tok');
    assert.equal(typeof client.listProviders, 'function');
  });

  it('has listModels method', () => {
    const client = createApiClient('http://localhost:3000', 'tok');
    assert.equal(typeof client.listModels, 'function');
  });

  it('has listSecrets method', () => {
    const client = createApiClient('http://localhost:3000', 'tok');
    assert.equal(typeof client.listSecrets, 'function');
  });

  it('has updateAgent method', () => {
    const client = createApiClient('http://localhost:3000', 'tok');
    assert.equal(typeof client.updateAgent, 'function');
  });

  it('builds update agent URL', () => {
    const client = createApiClient('http://localhost:3000', 'tok');
    const url = client.buildUrl('/v1/agents/agent-123');
    assert.equal(url, 'http://localhost:3000/v1/agents/agent-123');
  });

  it('normalizes listMcpServers object response into an array', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response(
        JSON.stringify({
          servers: [
            { id: 'filesystem', transport: 'stdio', enabled: true },
            { id: 'github', transport: 'sse', enabled: false },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      );

      const client = createApiClient('http://localhost:3000', 'tok');
      const servers = await client.listMcpServers('agent-1');
      assert.deepEqual(servers, [
        { id: 'filesystem', transport: 'stdio', enabled: true },
        { id: 'github', transport: 'sse', enabled: false },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('passes through listMcpServers arrays unchanged', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response(
        JSON.stringify([
          { id: 'filesystem', transport: 'stdio', enabled: true },
        ]),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      );

      const client = createApiClient('http://localhost:3000', 'tok');
      const servers = await client.listMcpServers('agent-1');
      assert.deepEqual(servers, [
        { id: 'filesystem', transport: 'stdio', enabled: true },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// Slash command tests
describe('slash commands', () => {
  it('matchCommands returns all on /', () => {
    const matches = matchCommands('/');
    assert.equal(matches.length, SLASH_COMMANDS.length);
  });

  it('matchCommands filters by prefix', () => {
    const matches = matchCommands('/st');
    const names = matches.map(m => m.name);
    assert.ok(names.includes('/stop'));
    assert.ok(names.includes('/status'));
    assert.equal(matches.length, 2);
  });

  it('matchCommands returns empty for non-slash', () => {
    assert.equal(matchCommands('hello').length, 0);
  });

  it('matchCommands matches aliases', () => {
    const matches = matchCommands('/ex');
    const names = matches.map(m => m.name);
    assert.ok(names.includes('/exit'));
  });

  it('slash command registry exposes /exit and no longer exposes /quit', () => {
    const names = SLASH_COMMANDS.map(command => command.name);
    assert.ok(names.includes('/exit'));
    assert.equal(names.includes('/quit'), false);
  });

  it('isSlashCommand detects slash prefix', () => {
    assert.equal(isSlashCommand('/exit'), true);
    assert.equal(isSlashCommand('/'), true);
    assert.equal(isSlashCommand('hello'), false);
    assert.equal(isSlashCommand(''), false);
  });
});

describe('help text', () => {
  it('tui help references /exit and does not mention /quit', () => {
    assert.ok(COMMAND_HELP.tui.includes('/exit'));
    assert.equal(COMMAND_HELP.tui.includes('/quit'), false);
  });
});

// Gateway down detection
describe('gateway down detection', () => {
  it('EventsHandler detects ECONNREFUSED', () => {
    const handler = new EventsHandler({}, 'agent-1');
    const err = new Error('fetch failed');
    err.cause = { code: 'ECONNREFUSED' };
    assert.equal(handler._isConnectionError(err), true);
  });

  it('EventsHandler detects ECONNRESET', () => {
    const handler = new EventsHandler({}, 'agent-1');
    const err = new Error('connection reset');
    err.cause = { code: 'ECONNRESET' };
    assert.equal(handler._isConnectionError(err), true);
  });

  it('EventsHandler detects fetch failed message', () => {
    const handler = new EventsHandler({}, 'agent-1');
    const err = new Error('fetch failed');
    assert.equal(handler._isConnectionError(err), true);
  });

  it('EventsHandler ignores unrelated errors', () => {
    const handler = new EventsHandler({}, 'agent-1');
    const err = new Error('timeout');
    assert.equal(handler._isConnectionError(err), false);
  });
});

// ---------- STT (voice) init helpers ----------

describe('saveSttSetting', () => {
  function makeHome() {
    return mkdtempSync(join(tmpdir(), 'moxxy-stt-test-'));
  }

  it('writes a fresh stt block when settings.yaml does not exist', () => {
    const home = makeHome();
    try {
      saveSttSetting(home, {
        provider: 'whisper',
        model: 'whisper-1',
        secret_ref: 'moxxy_stt_whisper',
      });
      const out = readFileSync(join(home, 'settings.yaml'), 'utf-8');
      assert.match(out, /^stt:$/m);
      assert.match(out, /^  provider: whisper$/m);
      assert.match(out, /^  model: whisper-1$/m);
      assert.match(out, /^  secret_ref: moxxy_stt_whisper$/m);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('appends stt block while preserving unrelated top-level keys', () => {
    const home = makeHome();
    try {
      writeFileSync(
        join(home, 'settings.yaml'),
        'browser_rendering: true\nnetwork_mode: safe\n',
      );
      saveSttSetting(home, {
        provider: 'whisper',
        model: 'whisper-1',
        secret_ref: 'moxxy_stt_whisper',
      });
      const out = readFileSync(join(home, 'settings.yaml'), 'utf-8');
      assert.match(out, /^browser_rendering: true$/m);
      assert.match(out, /^network_mode: safe$/m);
      assert.match(out, /^stt:$/m);
      assert.match(out, /^  provider: whisper$/m);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('replaces an existing stt block without leaving duplicates', () => {
    const home = makeHome();
    try {
      writeFileSync(
        join(home, 'settings.yaml'),
        [
          'browser_rendering: true',
          'stt:',
          '  provider: whisper',
          '  model: whisper-1',
          '  secret_ref: old_key',
          '  max_bytes: 1234',
          'network_mode: safe',
          '',
        ].join('\n'),
      );
      saveSttSetting(home, {
        provider: 'whisper',
        model: 'whisper-1',
        secret_ref: 'new_key',
      });
      const out = readFileSync(join(home, 'settings.yaml'), 'utf-8');
      // Only one stt: header should remain.
      const sttMatches = out.match(/^stt:$/gm) || [];
      assert.equal(sttMatches.length, 1, `expected one stt: block, got:\n${out}`);
      // Old indented values should be gone.
      assert.doesNotMatch(out, /old_key/);
      assert.doesNotMatch(out, /max_bytes: 1234/);
      // New values present.
      assert.match(out, /^  secret_ref: new_key$/m);
      // Other keys preserved.
      assert.match(out, /^browser_rendering: true$/m);
      assert.match(out, /^network_mode: safe$/m);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('clears the stt block when passed null', () => {
    const home = makeHome();
    try {
      writeFileSync(
        join(home, 'settings.yaml'),
        [
          'browser_rendering: true',
          'stt:',
          '  provider: whisper',
          '  secret_ref: moxxy_stt_whisper',
          '',
        ].join('\n'),
      );
      saveSttSetting(home, null);
      const out = readFileSync(join(home, 'settings.yaml'), 'utf-8');
      assert.doesNotMatch(out, /^stt:/m);
      assert.doesNotMatch(out, /provider: whisper/);
      // Unrelated keys preserved.
      assert.match(out, /^browser_rendering: true$/m);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('includes api_base when provided in config', () => {
    const home = makeHome();
    try {
      saveSttSetting(home, {
        provider: 'whisper',
        model: 'whisper-1',
        secret_ref: 'moxxy_stt_whisper',
        api_base: 'https://api.groq.com/openai/v1',
      });
      const out = readFileSync(join(home, 'settings.yaml'), 'utf-8');
      assert.match(out, /^  api_base: https:\/\/api\.groq\.com\/openai\/v1$/m);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('is idempotent across repeated writes of the same config', () => {
    const home = makeHome();
    try {
      const cfg = {
        provider: 'whisper',
        model: 'whisper-1',
        secret_ref: 'moxxy_stt_whisper',
      };
      saveSttSetting(home, cfg);
      const first = readFileSync(join(home, 'settings.yaml'), 'utf-8');
      saveSttSetting(home, cfg);
      saveSttSetting(home, cfg);
      const third = readFileSync(join(home, 'settings.yaml'), 'utf-8');
      assert.equal(first, third);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('ApiClient STT settings', () => {
  it('getSttSettings GETs /v1/settings/stt', async () => {
    const calls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (req) => {
      calls.push({ url: req.url, method: req.method });
      return new Response(
        JSON.stringify({ enabled: false }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    try {
      const client = createApiClient('http://localhost:3000', 'tok');
      const out = await client.getSttSettings();
      assert.deepEqual(out, { enabled: false });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'http://localhost:3000/v1/settings/stt');
      assert.equal(calls[0].method, 'GET');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('updateSttSettings PUTs the body as JSON', async () => {
    const seen = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (req) => {
      const body = await req.text();
      seen.push({ url: req.url, method: req.method, body });
      return new Response(
        JSON.stringify({
          enabled: true,
          provider: 'whisper',
          model: 'whisper-1',
          secret_ref: 'moxxy_stt_whisper',
          max_bytes: 26214400,
          max_seconds: 600,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    try {
      const client = createApiClient('http://localhost:3000', 'tok');
      const out = await client.updateSttSettings({
        provider: 'whisper',
        model: 'whisper-1',
        api_key: 'sk-live-abc',
      });
      assert.equal(out.enabled, true);
      assert.equal(out.provider, 'whisper');
      assert.equal(seen.length, 1);
      assert.equal(seen[0].method, 'PUT');
      assert.equal(seen[0].url, 'http://localhost:3000/v1/settings/stt');
      const parsed = JSON.parse(seen[0].body);
      assert.equal(parsed.provider, 'whisper');
      assert.equal(parsed.model, 'whisper-1');
      assert.equal(parsed.api_key, 'sk-live-abc');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('deleteSttSettings DELETEs the settings endpoint', async () => {
    const seen = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (req) => {
      seen.push({ url: req.url, method: req.method });
      return new Response(
        JSON.stringify({ enabled: false }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    try {
      const client = createApiClient('http://localhost:3000', 'tok');
      const out = await client.deleteSttSettings();
      assert.deepEqual(out, { enabled: false });
      assert.equal(seen[0].method, 'DELETE');
      assert.equal(seen[0].url, 'http://localhost:3000/v1/settings/stt');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('getSttSettings surfaces 403 as an Error with status', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ error: 'insufficient_scope', message: 'settings:read required' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    try {
      const client = createApiClient('http://localhost:3000', 'tok');
      await assert.rejects(
        () => client.getSttSettings(),
        (err) => {
          assert.equal(err.status, 403);
          assert.match(err.message, /settings:read/);
          return true;
        },
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe('ApiClient.startRunWithAudio', () => {
  it('posts multipart/form-data with audio field to the audio route', async () => {
    const calls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          agent_name: 'demo',
          run_id: 'run-1',
          task: 'hello',
          transcript: 'hello',
          status: 'running',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    try {
      const client = createApiClient('http://localhost:3000', 'mox_token');
      const out = await client.startRunWithAudio('demo', {
        data: new Uint8Array([0, 1, 2, 3, 4]),
        mime: 'audio/wav',
        filename: 'clip.wav',
      });
      assert.equal(out.transcript, 'hello');
      assert.equal(out.run_id, 'run-1');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'http://localhost:3000/v1/agents/demo/runs/audio');
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.headers.authorization, 'Bearer mox_token');
      assert.ok(calls[0].init.body instanceof FormData);
      const audioField = calls[0].init.body.get('audio');
      assert.ok(audioField, 'audio field must be present');
      assert.equal(audioField.type, 'audio/wav');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('surfaces server error bodies as Error with status and code', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ error: 'voice_not_configured', message: 'STT is off' }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    try {
      const client = createApiClient('http://localhost:3000', 'tok');
      await assert.rejects(
        () =>
          client.startRunWithAudio('demo', {
            data: new Uint8Array([1, 2, 3]),
            mime: 'audio/wav',
            filename: 'x.wav',
          }),
        (err) => {
          assert.equal(err.status, 400);
          assert.equal(err.code, 'voice_not_configured');
          assert.match(err.message, /STT is off/);
          return true;
        },
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
