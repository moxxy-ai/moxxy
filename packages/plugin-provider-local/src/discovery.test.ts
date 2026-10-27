import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverLocalModelDescriptors, discoverLocalModels, localProviderDef } from './index.js';

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

describe('discoverLocalModelDescriptors (Ollama only)', () => {
  it('uses Ollama runtime allocation instead of the larger model maximum', async () => {
    const model = 'SpeakLeash/bielik-11b-v3.0-instruct:Q8_0';
    const server = await startServer((request, response) => {
      if (request.url === '/v1/models') {
        json(response, { data: [{ id: model }] });
        return;
      }
      if (request.url === '/api/ps') {
        json(response, { models: [{ name: model, model, context_length: 4_096 }] });
        return;
      }
      if (request.url === '/api/show') {
        json(response, {
          model_info: {
            'general.architecture': 'llama',
            'llama.context_length': 32_768,
          },
          parameters: '',
          capabilities: ['completion', 'tools'],
        });
        return;
      }
      json(response, { error: 'not found' }, 404);
    });
    try {
      await expect(
        discoverLocalModelDescriptors({ baseURL: `${server.baseURL}/v1` }),
      ).resolves.toEqual([
        {
          id: model,
          contextWindow: 4_096,
          supportsStreaming: true,
          supportsTools: true,
        },
      ]);
      expect(server.requests).toEqual(['/v1/models', '/api/ps', '/api/show']);
    } finally {
      await server.close();
    }
  });

  it('keeps the existing generic-local fallback when the server is not Ollama', async () => {
    const server = await startServer((request, response) => {
      if (request.url === '/v1/models') {
        json(response, { data: [{ id: 'lm-studio-model' }] });
        return;
      }
      json(response, { error: 'not an Ollama endpoint' }, 404);
    });
    try {
      await expect(
        discoverLocalModelDescriptors({ baseURL: `${server.baseURL}/v1` }),
      ).resolves.toEqual([
        {
          id: 'lm-studio-model',
          contextWindow: 8_192,
          supportsStreaming: true,
          supportsTools: true,
        },
      ]);
      expect(server.requests).toEqual(['/v1/models', '/api/ps', '/api/v1/models']);
    } finally {
      await server.close();
    }
  });

  it('uses an explicit Ollama num_ctx for an unloaded model and never exceeds its maximum', async () => {
    const server = await startServer((request, response) => {
      if (request.url === '/v1/models') {
        json(response, { data: [{ id: 'configured-model' }] });
        return;
      }
      if (request.url === '/api/ps') {
        json(response, { models: [] });
        return;
      }
      if (request.url === '/api/show') {
        json(response, {
          model_info: {
            'general.architecture': 'llama',
            'llama.context_length': 8_192,
          },
          parameters: 'temperature 0.1\nnum_ctx 12288',
          capabilities: ['completion'],
        });
        return;
      }
      json(response, { error: 'not found' }, 404);
    });
    try {
      const [descriptor] = await discoverLocalModelDescriptors({
        baseURL: `${server.baseURL}/v1`,
      });
      expect(descriptor).toMatchObject({
        id: 'configured-model',
        contextWindow: 8_192,
        supportsTools: false,
      });
    } finally {
      await server.close();
    }
  });
});

// LM Studio 0.4+: `/api/v1/models` reports each loaded instance's real context length.
describe('discoverLocalModelDescriptors (LM Studio)', () => {
  const lmStudio = (models: unknown[]) => startServer((request, response) => {
    if (request.url === '/v1/models') {
      json(response, { data: [{ id: 'openai/gpt-oss-20b' }, { id: 'qwen/qwen3-vl-30b' }] });
      return;
    }
    if (request.url === '/api/v1/models') {
      json(response, { models });
      return;
    }
    json(response, { error: 'Unexpected endpoint or method.' }, 404);
  });

  it('uses the context a model is loaded with, and what it can do, instead of guessing 8192', async () => {
    const server = await lmStudio([
      {
        type: 'llm',
        key: 'openai/gpt-oss-20b',
        loaded_instances: [{ id: 'openai/gpt-oss-20b', config: { context_length: 65_536 } }],
        max_context_length: 131_072,
        capabilities: { vision: false, trained_for_tool_use: true },
      },
      {
        type: 'llm',
        key: 'qwen/qwen3-vl-30b',
        loaded_instances: [],
        max_context_length: 262_144,
        capabilities: { vision: true, trained_for_tool_use: false },
      },
    ]);
    try {
      await expect(discoverLocalModelDescriptors({ baseURL: `${server.baseURL}/v1` })).resolves.toEqual([
        { id: 'openai/gpt-oss-20b', contextWindow: 65_536, supportsTools: true, supportsStreaming: true },
        // Not loaded yet: LM Studio picks the context when it loads it, so stay conservative until then.
        { id: 'qwen/qwen3-vl-30b', contextWindow: 4_096, supportsTools: false, supportsStreaming: true, supportsImages: true },
      ]);
      expect(server.requests).toEqual(['/v1/models', '/api/ps', '/api/v1/models']);
    } finally {
      await server.close();
    }
  });

  it('reads the loaded context again before a turn, once the model got loaded', async () => {
    let loaded = false;
    const server = await startServer((request, response) => {
      if (request.url === '/api/v1/models') {
        json(response, {
          models: [{
            type: 'llm',
            key: 'openai/gpt-oss-20b',
            loaded_instances: loaded ? [{ id: 'openai/gpt-oss-20b', config: { context_length: 32_768 } }] : [],
            max_context_length: 131_072,
            capabilities: { trained_for_tool_use: true },
          }],
        });
        return;
      }
      json(response, { error: 'Unexpected endpoint or method.' }, 404);
    });
    try {
      const provider = localProviderDef.createClient({ baseURL: `${server.baseURL}/v1` });
      await provider.prepareModel?.('openai/gpt-oss-20b');
      expect(provider.models.find((model) => model.id === 'openai/gpt-oss-20b')?.contextWindow).toBe(4_096);
      loaded = true;
      await provider.prepareModel?.('openai/gpt-oss-20b');
      expect(provider.models.find((model) => model.id === 'openai/gpt-oss-20b')?.contextWindow).toBe(32_768);
    } finally {
      await server.close();
    }
  });
});
