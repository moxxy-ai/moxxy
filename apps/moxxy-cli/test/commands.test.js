import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ApiClient } from '../src/api-client.js';
import { tokenCreate, tokenList, tokenRevoke, parseFlags, VALID_SCOPES } from '../src/commands/auth.js';
import { agentCreate, agentStatus } from '../src/commands/agent.js';

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

// Capture console.log output
function captureOutput(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  return async () => {
    try {
      await fn();
    } finally {
      console.log = orig;
    }
    return lines;
  };
}

describe('parseFlags', () => {
  it('parses --key=value flags', () => {
    const flags = parseFlags(['--scopes=agents:read,agents:write', '--ttl=3600']);
    assert.equal(flags.scopes, 'agents:read,agents:write');
    assert.equal(flags.ttl, '3600');
  });

  it('parses --key value flags', () => {
    const flags = parseFlags(['--scopes', 'agents:read', '--ttl', '3600']);
    assert.equal(flags.scopes, 'agents:read');
    assert.equal(flags.ttl, '3600');
  });

  it('parses boolean flags', () => {
    const flags = parseFlags(['--json']);
    assert.equal(flags.json, 'true');
  });
});

describe('tokenCreate (non-interactive)', () => {
  let server;

  afterEach(async () => {
    if (server) await closeServer(server);
  });

  it('creates token with flag-based scopes', async () => {
    const mock = await mockServer((req, res) => {
      let data = '';
      req.on('data', (chunk) => data += chunk);
      req.on('end', () => {
        const body = JSON.parse(data);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'tok_1', token: 'mox_secret', scopes: body.scopes }));
      });
    });
    server = mock.server;
    const client = new ApiClient(mock.baseUrl);

    const run = captureOutput(async () => {
      return tokenCreate(client, ['--scopes=agents:read,runs:write', '--ttl=7200']);
    });
    const output = await run();
    assert.ok(output.some(l => l.includes('tok_1')));
  });

  it('rejects invalid scopes', async () => {
    const client = new ApiClient('http://localhost:1');
    await assert.rejects(
      () => tokenCreate(client, ['--scopes=invalid:scope']),
      (err) => {
        assert.ok(err.message.includes('Invalid scopes'));
        return true;
      }
    );
  });

  it('rejects empty scopes', async () => {
    const client = new ApiClient('http://localhost:1');
    await assert.rejects(
      () => tokenCreate(client, ['--scopes=']),
      (err) => {
        assert.ok(err.message.includes('At least one scope'));
        return true;
      }
    );
  });
});

describe('agentCreate (non-interactive)', () => {
  let server;

  afterEach(async () => {
    if (server) await closeServer(server);
  });

  it('creates agent with required flags', async () => {
    const mock = await mockServer((req, res) => {
      let data = '';
      req.on('data', (chunk) => data += chunk);
      req.on('end', () => {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'agent_abc' }));
      });
    });
    server = mock.server;
    const client = new ApiClient(mock.baseUrl);

    const run = captureOutput(async () => {
      return agentCreate(client, ['--provider=openai', '--model=gpt-4', '--workspace=/tmp/test']);
    });
    const output = await run();
    assert.ok(output.some(l => l.includes('agent_abc')));
  });

  it('rejects missing required flags', async () => {
    const client = new ApiClient('http://localhost:1');
    await assert.rejects(
      () => agentCreate(client, ['--provider=openai']),
      (err) => {
        assert.ok(err.message.includes('Required'));
        return true;
      }
    );
  });
});

describe('VALID_SCOPES', () => {
  it('contains all 7 expected scopes', () => {
    assert.equal(VALID_SCOPES.length, 7);
    assert.ok(VALID_SCOPES.includes('agents:read'));
    assert.ok(VALID_SCOPES.includes('tokens:admin'));
    assert.ok(VALID_SCOPES.includes('events:read'));
  });
});
