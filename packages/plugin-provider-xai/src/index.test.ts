import { describe, expect, it } from 'vitest';
import { assertDefined } from '@moxxy/sdk';
import { xaiPlugin, xaiProviderDef, grokModels } from './index.js';

describe('@moxxy/plugin-provider-xai', () => {
  it('registers the xai provider', () => {
    expect(xaiPlugin.providers?.map((p) => p.name)).toEqual(['xai']);
  });

  it('advertises the Grok catalog (including the 1M-context grok-4.3 flagship)', () => {
    expect(xaiProviderDef.models).toEqual(grokModels);
    expect(grokModels.find((m) => m.id === 'grok-4.3')).toMatchObject({ contextWindow: 1_000_000 });
  });

  it('createClient stamps the xai slug so usage/errors attribute to xAI, not openai', () => {
    const client = xaiProviderDef.createClient({ apiKey: 'xai-test-key' });
    expect(client.name).toBe('xai');
    expect(client.models).toEqual(grokModels);
  });

  it('exposes an apiKey auth descriptor', () => {
    expect(xaiProviderDef.auth).toMatchObject({ kind: 'apiKey' });
  });

  it('the reasoning-tier Grok models advertise supportsReasoning', () => {
    // Reasoning gating (reasoning_effort + reasoning-stream surfacing) keys off
    // this flag; absent it, the loop silently drops reasoning config even when
    // the user enables it. The grok-4 family + grok-3-mini are reasoning models.
    const reasoningIds = ['grok-4.3', 'grok-4', 'grok-4-fast', 'grok-code-fast-1', 'grok-3-mini'];
    for (const id of reasoningIds) {
      expect(grokModels.find((m) => m.id === id)?.supportsReasoning, id).toBe(true);
    }
    // The non-mini grok-3 is NOT a reasoning model — keep the flag off so the
    // loop doesn't request reasoning the model won't honor.
    expect(grokModels.find((m) => m.id === 'grok-3')?.supportsReasoning).toBeUndefined();
  });

  it('every Grok descriptor carries a positive, in-window maxOutputTokens budget', () => {
    // Without maxOutputTokens the context budgeter can't reserve completion
    // space, so a near-full window + large generation gets server-truncated
    // instead of pre-emptively elided.
    for (const m of grokModels) {
      expect(typeof m.maxOutputTokens, `${m.id} maxOutputTokens`).toBe('number');
      const maxOutputTokens = m.maxOutputTokens;
      assertDefined(maxOutputTokens, `${m.id} maxOutputTokens is a number (asserted above)`);
      expect(maxOutputTokens, `${m.id} maxOutputTokens > 0`).toBeGreaterThan(0);
      expect(maxOutputTokens, `${m.id} maxOutputTokens <= contextWindow`).toBeLessThanOrEqual(m.contextWindow);
    }
  });

  it('every Grok descriptor is structurally well-formed (positive window, required flags, unique id)', () => {
    // Lock the catalog invariants so a careless future edit can't silently ship
    // a descriptor the SDK budgeter/capability-gating would mis-read.
    const seen = new Set<string>();
    for (const m of grokModels) {
      expect(typeof m.id, 'id is a string').toBe('string');
      expect(m.id.length, `${m.id} id non-empty`).toBeGreaterThan(0);
      expect(seen.has(m.id), `${m.id} is not duplicated`).toBe(false);
      seen.add(m.id);
      expect(typeof m.contextWindow, `${m.id} contextWindow`).toBe('number');
      expect(m.contextWindow, `${m.id} contextWindow > 0`).toBeGreaterThan(0);
      expect(m.supportsTools, `${m.id} supportsTools`).toBe(true);
      expect(m.supportsStreaming, `${m.id} supportsStreaming`).toBe(true);
    }
  });

  it('no Grok descriptor asserts supportsDocuments (OpenAI-compat endpoint rejects native file parts)', () => {
    // Intentional: the xAI compat surface does not honor the OpenAI `file`/
    // `file_data` content part the shared translate layer emits for `document`
    // blocks. Asserting supportsDocuments would make the desktop ship raw PDF
    // bytes the endpoint drops — losing the doc with no fallback. The safe path
    // is the extracted-text route (supportsDocuments unset → text). Guard the
    // decision so it can't be re-introduced without an explicit, tested choice.
    for (const m of grokModels) {
      expect(m.supportsDocuments, `${m.id} must not assert supportsDocuments`).toBeUndefined();
    }
  });

  it('createClient degrades to xAI defaults on hostile/wrong-typed config (no smuggled non-string fields)', () => {
    // The registry hands createClient an untyped Record<string, unknown>. A
    // wrong-typed baseURL/defaultModel (object/number) must NOT reach the OpenAI
    // SDK (where a non-string baseURL would throw or silently mis-route); the
    // narrowing drops them so the vendor defaults stand. A string apiKey is
    // present (the SDK constructor requires a non-empty key) — everything else
    // is hostile. The worst case here is degradation to defaults, never a crash.
    const hostile = {
      apiKey: 'xai-test-key',
      baseURL: { evil: true },
      defaultModel: 12345,
      extraJunk: ['should', 'be', 'ignored'],
    } as unknown as Record<string, unknown>;
    const client = xaiProviderDef.createClient(hostile);
    expect(client.name).toBe('xai');
    expect(client.models).toEqual(grokModels);
  });

  it('refuses an empty config rather than smuggling OPENAI_API_KEY to xai', () => {
    // Worst case: the registry hands us {} (no key) while OPENAI_API_KEY is set in
    // env. The OpenAI SDK ctor would silently fall back to it and ship the user's
    // real OpenAI credential to api.x.ai — createClient MUST refuse, not smuggle.
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-env-fallback-for-test';
    try {
      expect(() => xaiProviderDef.createClient({})).toThrow(/requires an API key/);
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
    }
  });

  it('builds a working client when a real apiKey is supplied (no junk smuggled)', () => {
    const client = xaiProviderDef.createClient({ apiKey: 'xai-test-key' });
    expect(client.name).toBe('xai');
    expect(client.models).toEqual(grokModels);
  });

  it('exposes a validateKey probe (so a bad xAI key is caught before first stream)', () => {
    // defineOpenAICompatProvider wires validateOpenAICompatKey against the xAI
    // base URL unless validate:false. xai relies on the default, so the setup
    // wizard / `moxxy login` can verify the key against api.x.ai/v1/models.
    expect(typeof xaiProviderDef.validateKey).toBe('function');
  });
});
