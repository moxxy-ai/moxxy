import { describe, expect, it } from 'vitest';
import type { ModelDescriptor } from '@moxxy/sdk';
import {
  defineOpenAICompatProvider,
  pickOpenAICompatConfig,
} from './compat.js';

const TEST_MODELS: ReadonlyArray<ModelDescriptor> = [
  { id: 'vendor-flagship', contextWindow: 1_000_000, supportsTools: true, supportsStreaming: true },
  { id: 'vendor-mini', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
];

describe('pickOpenAICompatConfig', () => {
  it('keeps only string apiKey/baseURL/defaultModel and drops everything else', () => {
    const picked = pickOpenAICompatConfig({
      apiKey: 'k',
      baseURL: 'https://vendor/v1',
      defaultModel: 'vendor-mini',
      extraneous: 'ignored',
    });
    expect(picked).toEqual({ apiKey: 'k', baseURL: 'https://vendor/v1', defaultModel: 'vendor-mini' });
  });

  it('drops wrong-typed fields (falls back to undefined) instead of smuggling them through', () => {
    const picked = pickOpenAICompatConfig({
      apiKey: 'k',
      baseURL: { not: 'a string' },
      defaultModel: ['nope'],
    });
    expect(picked).toEqual({ apiKey: 'k', baseURL: undefined, defaultModel: undefined });
  });
});

describe('defineOpenAICompatProvider', () => {
  const def = defineOpenAICompatProvider({
    name: 'vendor',
    baseURL: 'https://vendor.example/v1',
    defaultModel: 'vendor-flagship',
    models: TEST_MODELS,
    auth: { kind: 'apiKey', hint: 'vendor key' },
  });

  it('stamps the vendor slug onto the def and the built client (not openai)', () => {
    expect(def.name).toBe('vendor');
    const client = def.createClient({ apiKey: 'test-key' });
    expect(client.name).toBe('vendor');
  });

  it('forces the vendor catalog onto the def and the built client', () => {
    expect(def.models).toEqual(TEST_MODELS);
    const client = def.createClient({ apiKey: 'test-key' });
    expect(client.models).toEqual(TEST_MODELS);
  });

  it('returns a fresh copy of the catalog (not the caller-owned array)', () => {
    expect(def.models).not.toBe(TEST_MODELS);
  });

  it('narrows the untyped registry config — wrong-typed fields do not crash createClient', () => {
    const messy: Record<string, unknown> = {
      apiKey: 'test-key',
      baseURL: { not: 'a string' },
      defaultModel: ['nope'],
      extraneous: 'ignored',
    };
    const client = def.createClient(messy);
    expect(client.name).toBe('vendor');
    expect(client.models).toEqual(TEST_MODELS);
    expect(typeof client.stream).toBe('function');
  });

  it('passes the auth descriptor straight through', () => {
    expect(def.auth).toEqual({ kind: 'apiKey', hint: 'vendor key' });
  });

  it('omits auth when none is supplied', () => {
    const noAuth = defineOpenAICompatProvider({
      name: 'vendor',
      baseURL: 'https://vendor.example/v1',
      defaultModel: 'vendor-flagship',
      models: TEST_MODELS,
    });
    expect(noAuth.auth).toBeUndefined();
  });

  it('wires validateKey by default and short-circuits a too-short key without a network call', async () => {
    expect(def.validateKey).toBeDefined();
    // The real validateOpenAICompatKey rejects keys < 8 chars before any probe,
    // proving the def is wired to the shared validator (no network needed).
    await expect(def.validateKey?.('')).resolves.toEqual({ ok: false, message: 'key looks too short' });
  });

  it('omits validateKey entirely when validate: false (local servers do not authenticate)', () => {
    const local = defineOpenAICompatProvider({
      name: 'local',
      baseURL: 'http://localhost:11434/v1',
      defaultModel: 'llama3.3',
      models: TEST_MODELS,
      validate: false,
    });
    expect(local.validateKey).toBeUndefined();
  });

  it('refuses an empty/missing/whitespace key for an authenticating vendor (no silent OPENAI_API_KEY fallback)', () => {
    // The OpenAI SDK ctor falls back to process.env.OPENAI_API_KEY when apiKey
    // is empty; since a compat vendor pins baseURL to its OWN host, that would
    // exfiltrate the user's real OpenAI credential to the vendor's endpoint on a
    // merely misconfigured provider. defineOpenAICompatProvider must refuse it
    // centrally, regardless of the runner's OPENAI_API_KEY env, so each vendor
    // (xai/google/provider-admin) doesn't have to re-add a guard.
    const saved = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-real-user-openai-key';
    try {
      for (const bad of [{}, { apiKey: undefined }, { apiKey: '' }, { apiKey: '   ' }, { apiKey: 123 }] as Record<
        string,
        unknown
      >[]) {
        expect(() => def.createClient(bad)).toThrow(/api key/i);
      }
      // A real key still constructs fine.
      expect(() => def.createClient({ apiKey: 'vendor-key' })).not.toThrow();
    } finally {
      if (saved === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = saved;
    }
  });

  it('does NOT require a key when validate:false (local servers use a placeholder)', () => {
    const local = defineOpenAICompatProvider({
      name: 'local',
      baseURL: 'http://localhost:11434/v1',
      defaultModel: 'llama3.3',
      models: TEST_MODELS,
      validate: false,
      // Mirrors the real local provider: no config key → placeholder.
      resolveApiKey: (cfg) => cfg.apiKey ?? 'placeholder',
    });
    expect(() => local.createClient({})).not.toThrow();
    expect(local.createClient({}).name).toBe('local');
  });

  it('uses resolveApiKey / resolveBaseURL hooks for per-call credential fallback', () => {
    const seen: Array<{ apiKey?: string; baseURL?: string }> = [];
    const def2 = defineOpenAICompatProvider({
      name: 'local',
      baseURL: 'http://localhost:11434/v1',
      defaultModel: 'llama3.3',
      models: TEST_MODELS,
      validate: false,
      resolveApiKey: (cfg) => {
        seen.push({ apiKey: cfg.apiKey });
        return cfg.apiKey ?? 'placeholder';
      },
      resolveBaseURL: (cfg) => {
        seen.push({ baseURL: cfg.baseURL });
        return cfg.baseURL ?? 'http://fallback/v1';
      },
    });
    const client = def2.createClient({});
    expect(client.name).toBe('local');
    // Both hooks ran (per-call) against the narrowed config.
    expect(seen).toContainEqual({ apiKey: undefined });
    expect(seen).toContainEqual({ baseURL: undefined });
  });
});
