import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverLocalModels } from './index.js';

interface TestServer {
  readonly baseURL: string;
  readonly requests: Array<string>;
  readonly close: () => Promise<void>;
}

async function startServer(
  respond: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<TestServer> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    respond(request, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}

function json(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

const savedBaseURL = process.env.LOCAL_MODEL_BASE_URL;

afterEach(() => {
  if (savedBaseURL === undefined) delete process.env.LOCAL_MODEL_BASE_URL;
  else process.env.LOCAL_MODEL_BASE_URL = savedBaseURL;
});

describe('discoverLocalModels', () => {
  it('uses /v1/models once and preserves exact Ollama ids, tags and cloud entries', async () => {
    const server = await startServer((_request, response) => json(response, {
      object: 'list',
      data: [
        { id: 'gpt-oss:20b' },
        { id: 'SpeakLeash/bielik-11b-v3.0-instruct:Q8_0' },
        { id: 'glm-5:cloud' },
        { id: 'gpt-oss:20b' },
        { id: '' },
        { id: 7 },
        {},
      ],
    }));
    try {
      await expect(discoverLocalModels({ baseURL: `${server.baseURL}/v1` })).resolves.toEqual([
        'SpeakLeash/bielik-11b-v3.0-instruct:Q8_0',
        'glm-5:cloud',
        'gpt-oss:20b',
      ]);
      expect(server.requests).toEqual(['/v1/models']);
    } finally {
      await server.close();
    }
  });

  it('adds /v1/models when the configured base URL has no API suffix', async () => {
    const server = await startServer((_request, response) => json(response, { data: [] }));
    try {
      await expect(discoverLocalModels({ baseURL: server.baseURL })).resolves.toEqual([]);
      expect(server.requests).toEqual(['/v1/models']);
    } finally {
      await server.close();
    }
  });

  it('prefers provider config over LOCAL_MODEL_BASE_URL', async () => {
    process.env.LOCAL_MODEL_BASE_URL = 'http://127.0.0.1:1/v1';
    const server = await startServer((_request, response) => json(response, {
      data: [{ id: 'Configured/Model:Q8_0' }],
    }));
    try {
      await expect(discoverLocalModels({ baseURL: `${server.baseURL}/v1` })).resolves.toEqual([
        'Configured/Model:Q8_0',
      ]);
    } finally {
      await server.close();
    }
  });

  it('uses LOCAL_MODEL_BASE_URL when provider config does not override it', async () => {
    const server = await startServer((_request, response) => json(response, {
      data: [{ id: 'env-model:latest' }],
    }));
    process.env.LOCAL_MODEL_BASE_URL = `${server.baseURL}/v1`;
    try {
      await expect(discoverLocalModels({})).resolves.toEqual(['env-model:latest']);
    } finally {
      await server.close();
    }
  });

  it('accepts Ollama data:null as an empty model list', async () => {
    const server = await startServer((_request, response) => json(response, { data: null }));
    try {
      await expect(discoverLocalModels({ baseURL: `${server.baseURL}/v1` })).resolves.toEqual([]);
    } finally {
      await server.close();
    }
  });

  it('reports HTTP, invalid JSON and timeout failures without hanging', async () => {
    const failing = await startServer((_request, response) => json(response, { error: 'nope' }, 503));
    try {
      await expect(discoverLocalModels({ baseURL: `${failing.baseURL}/v1` })).rejects.toThrow(/503/);
    } finally {
      await failing.close();
    }

    const invalid = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{not-json');
    });
    try {
      await expect(discoverLocalModels({ baseURL: `${invalid.baseURL}/v1` })).rejects.toThrow(/invalid/i);
    } finally {
      await invalid.close();
    }

    const hanging = await startServer(() => undefined);
    try {
      await expect(discoverLocalModels(
        { baseURL: `${hanging.baseURL}/v1` },
        { signal: AbortSignal.timeout(25) },
      )).rejects.toThrow(/timed out/i);
    } finally {
      await hanging.close();
    }
  });

  it('rejects non-http schemes before making a request', async () => {
    await expect(discoverLocalModels({ baseURL: 'file:///tmp/models' })).rejects.toThrow(/http/i);
  });
});
