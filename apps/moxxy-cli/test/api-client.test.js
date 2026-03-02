import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ApiClient } from '../src/api-client.js';

/**
 * Spin up a tiny HTTP server for testing the API client.
 */
function mockServer(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

describe('ApiClient', () => {
  let server, client;

  afterEach(async () => {
    if (server) await closeServer(server);
  });

  it('sends GET request and parses JSON response', async () => {
    const mock = await mockServer((req, res) => {
      assert.equal(req.method, 'GET');
      assert.equal(req.url, '/v1/auth/tokens');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{ id: 'tok_1', scopes: ['agents:read'] }]));
    });
    server = mock.server;
    client = new ApiClient(mock.baseUrl);

    const result = await client.listTokens();
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'tok_1');
  });

  it('sends POST request with JSON body', async () => {
    let receivedBody = '';
    const mock = await mockServer((req, res) => {
      assert.equal(req.method, 'POST');
      let data = '';
      req.on('data', (chunk) => data += chunk);
      req.on('end', () => {
        receivedBody = JSON.parse(data);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'tok_new', token: 'mox_secret' }));
      });
    });
    server = mock.server;
    client = new ApiClient(mock.baseUrl);

    const result = await client.createToken(['agents:read'], 3600, 'test');
    assert.equal(result.id, 'tok_new');
    assert.equal(result.token, 'mox_secret');
    assert.deepEqual(receivedBody.scopes, ['agents:read']);
    assert.equal(receivedBody.ttl_seconds, 3600);
  });

  it('injects Authorization header when token is set', async () => {
    let authHeader = null;
    const mock = await mockServer((req, res) => {
      authHeader = req.headers['authorization'];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    });
    server = mock.server;
    client = new ApiClient(mock.baseUrl, 'mox_test_token');

    await client.listTokens();
    assert.equal(authHeader, 'Bearer mox_test_token');
  });

  it('throws on non-OK response with error message', async () => {
    const mock = await mockServer((req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized', message: 'Invalid token' }));
    });
    server = mock.server;
    client = new ApiClient(mock.baseUrl);

    await assert.rejects(
      () => client.listTokens(),
      (err) => {
        assert.equal(err.status, 401);
        assert.equal(err.message, 'Invalid token');
        return true;
      }
    );
  });

  it('sends DELETE request for token revocation', async () => {
    let reqUrl = '';
    const mock = await mockServer((req, res) => {
      reqUrl = req.url;
      assert.equal(req.method, 'DELETE');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    server = mock.server;
    client = new ApiClient(mock.baseUrl);

    await client.revokeToken('tok_123');
    assert.equal(reqUrl, '/v1/auth/tokens/tok_123');
  });

  it('builds event stream URL with filters', () => {
    client = new ApiClient('http://localhost:3000');
    const url = client.eventStreamUrl({ agent_id: 'a1', run_id: 'r1' });
    assert.ok(url.includes('agent_id=a1'));
    assert.ok(url.includes('run_id=r1'));
  });

  it('creates agent with correct payload', async () => {
    let receivedBody = '';
    const mock = await mockServer((req, res) => {
      let data = '';
      req.on('data', (chunk) => data += chunk);
      req.on('end', () => {
        receivedBody = JSON.parse(data);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'agent_1' }));
      });
    });
    server = mock.server;
    client = new ApiClient(mock.baseUrl);

    const result = await client.createAgent('openai', 'gpt-4', '/tmp/ws', { temperature: 0.5 });
    assert.equal(result.id, 'agent_1');
    assert.equal(receivedBody.provider_id, 'openai');
    assert.equal(receivedBody.model_id, 'gpt-4');
    assert.equal(receivedBody.temperature, 0.5);
  });
});
