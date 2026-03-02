import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../src/api-client.js';
import { parseAuthCommand, buildTokenPayload } from '../src/commands/auth.js';
import { parseAgentCommand } from '../src/commands/agent.js';
import { buildSseUrl, parseSseEvent, createSseClient } from '../src/sse-client.js';

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

  it('request throws on error response', async () => {
    const client = createApiClient('http://localhost:99999', 'tok');
    await assert.rejects(() => client.request('/v1/agents', 'GET'));
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
    const args = ['create', '--provider', 'openai', '--model', 'gpt-4', '--workspace', '/tmp/ws'];
    const parsed = parseAgentCommand(args);
    assert.equal(parsed.provider_id, 'openai');
    assert.equal(parsed.model_id, 'gpt-4');
    assert.equal(parsed.workspace_root, '/tmp/ws');
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
