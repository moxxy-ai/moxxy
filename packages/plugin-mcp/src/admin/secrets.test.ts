import { describe, expect, it, vi } from 'vitest';
import type { McpServerConfig } from '../types.js';
import { resolveServerSecrets } from './secrets.js';

const resolver = vi.fn(async (value: string) =>
  value.replace(/\$\{vault:([A-Za-z0-9_.-]+)\}/g, (_m, name: string) => `sekret-${name}`),
);

describe('resolveServerSecrets', () => {
  it('resolves placeholders in stdio env values', async () => {
    const server: McpServerConfig = {
      kind: 'stdio',
      name: 'demo',
      command: 'npx',
      env: { API_KEY: '${vault:k}', HOME: '/home/u' },
    };
    const out = (await resolveServerSecrets(server, resolver)) as Extract<McpServerConfig, { command: string }>;
    expect(out.env).toEqual({ API_KEY: 'sekret-k', HOME: '/home/u' });
    // Original untouched — that object is what gets persisted.
    expect(server.env).toEqual({ API_KEY: '${vault:k}', HOME: '/home/u' });
  });

  it('resolves placeholders in http/sse header values', async () => {
    const server: McpServerConfig = {
      kind: 'sse',
      name: 'demo',
      url: 'https://mcp.example.com/sse',
      headers: { authorization: 'Bearer ${vault:tok}' },
    };
    const out = (await resolveServerSecrets(server, resolver)) as Extract<McpServerConfig, { url: string }>;
    expect(out.headers).toEqual({ authorization: 'Bearer sekret-tok' });
  });

  it('returns the same object when nothing resolves (literal passthrough)', async () => {
    const server: McpServerConfig = {
      kind: 'stdio',
      name: 'demo',
      command: 'npx',
      env: { PLAIN: 'literal-value' },
    };
    expect(await resolveServerSecrets(server, resolver)).toBe(server);
  });

  it('is the identity without a resolver (back-compat for plaintext configs)', async () => {
    const server: McpServerConfig = {
      kind: 'http',
      name: 'demo',
      url: 'https://mcp.example.com',
      headers: { authorization: 'Bearer plaintext' },
    };
    expect(await resolveServerSecrets(server, null)).toBe(server);
    expect(await resolveServerSecrets(server, undefined)).toBe(server);
  });

  it('treats a missing kind as stdio', async () => {
    const server = { name: 'demo', command: 'npx', env: { K: '${vault:x}' } } as McpServerConfig;
    const out = (await resolveServerSecrets(server, resolver)) as Extract<McpServerConfig, { command: string }>;
    expect(out.env).toEqual({ K: 'sekret-x' });
  });
});
