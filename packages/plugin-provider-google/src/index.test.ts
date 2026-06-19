import { describe, expect, it } from 'vitest';
import { googlePlugin, googleProviderDef, geminiModels, GEMINI_DEFAULT_MODEL } from './index.js';

describe('@moxxy/plugin-provider-google', () => {
  it('registers the google provider', () => {
    expect(googlePlugin.providers?.map((p) => p.name)).toEqual(['google']);
  });

  it('advertises the Gemini catalog (1M-context, vision-capable)', () => {
    expect(googleProviderDef.models).toEqual(geminiModels);
    expect(geminiModels.find((m) => m.id === 'gemini-3-pro')).toMatchObject({
      contextWindow: 1_000_000,
      supportsImages: true,
    });
  });

  it('createClient stamps the google slug so usage/errors attribute to Gemini, not openai', () => {
    const client = googleProviderDef.createClient({ apiKey: 'test-key' });
    expect(client.name).toBe('google');
    expect(client.models).toEqual(geminiModels);
  });

  it('exposes an apiKey auth descriptor pinned to the canonical GOOGLE_API_KEY env var', () => {
    expect(googleProviderDef.auth).toMatchObject({ kind: 'apiKey', envVar: 'GOOGLE_API_KEY' });
  });

  it('every Gemini model advertises supportsImages (image_url data URLs are honored by the compat endpoint)', () => {
    for (const m of geminiModels) {
      expect(m.supportsImages, `${m.id} supportsImages`).toBe(true);
    }
  });

  it('no Gemini model over-claims supportsDocuments (the OpenAI-compat endpoint rejects the file part)', () => {
    // Worst case if this regresses: the desktop ships raw PDF bytes as an
    // OpenAI `file`/`file_data` part the Gemini compat endpoint does not honor,
    // so the document is dropped/400s with no fallback. Keeping the flag unset
    // preserves the safe extracted-text path.
    for (const m of geminiModels) {
      expect(m.supportsDocuments, `${m.id} supportsDocuments`).toBeFalsy();
    }
  });

  it('the reasoning-tier Gemini models advertise supportsReasoning', () => {
    // Reasoning gating (reasoning_effort + reasoning-stream surfacing) keys off
    // this flag; the pro/flash tiers are reasoning models.
    const reasoningIds = ['gemini-3-pro', 'gemini-3-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'];
    for (const id of reasoningIds) {
      expect(geminiModels.find((m) => m.id === id)?.supportsReasoning, id).toBe(true);
    }
  });

  it('the default model exists in the catalog (else every default request gets a wrong budget)', () => {
    // Worst case if this regresses: a request that pins no model falls through
    // to GEMINI_DEFAULT_MODEL, whose descriptor lookup then MISSES, so the
    // default call silently inherits the host's generic miss-path
    // context-window/capability budget instead of Gemini's 1M window — the exact
    // unlisted-id trap the catalog docstring warns about, now hitting the
    // package's OWN configured default.
    expect(geminiModels.find((m) => m.id === GEMINI_DEFAULT_MODEL), GEMINI_DEFAULT_MODEL).toBeDefined();
  });

  it('the catalog is non-empty and free of duplicate ids', () => {
    // An empty catalog would defeat all context/capability gating; a duplicate
    // id makes descriptor lookup order-dependent (a stale/wrong descriptor can
    // shadow the intended one). Both are silent-correctness hazards a careless
    // future edit could introduce.
    expect(geminiModels.length).toBeGreaterThan(0);
    const ids = geminiModels.map((m) => m.id);
    expect(new Set(ids).size, `duplicate model id in catalog: ${ids.join(', ')}`).toBe(ids.length);
  });

  it('every catalog entry carries a sane, positive context/output budget', () => {
    // A zero/negative/NaN window or output cap would corrupt compaction/elision
    // budgeting downstream (e.g. premature compaction or unbounded asks). Assert
    // the worst case never ships from this catalog.
    for (const m of geminiModels) {
      expect(Number.isFinite(m.contextWindow) && m.contextWindow > 0, `${m.id} contextWindow`).toBe(true);
      if (m.maxOutputTokens !== undefined) {
        expect(
          Number.isFinite(m.maxOutputTokens) && m.maxOutputTokens > 0,
          `${m.id} maxOutputTokens`,
        ).toBe(true);
        // The output cap can never exceed the total context window.
        expect(m.maxOutputTokens, `${m.id} maxOutputTokens <= contextWindow`).toBeLessThanOrEqual(
          m.contextWindow,
        );
      }
    }
  });

  it('wires validateKey so a bad Gemini key is caught at setup, not first inference', () => {
    // defineOpenAICompatProvider defaults validation ON (probes the base URL's
    // /models). Dropping it would let an invalid key sail through setup and only
    // fail — opaquely — on the first real turn. Pin that it stays wired.
    expect(typeof googleProviderDef.validateKey).toBe('function');
  });

  it('createClient narrows away hostile/wrong-typed config fields without crashing', () => {
    // The registry hands createClient an untyped Record<string, unknown>. A
    // wrong-typed baseURL/defaultModel (number/object/null) plus unknown junk
    // must be narrowed away and fall back to vendor defaults — they must NOT
    // smuggle a bad value into the client or crash construction. A valid apiKey
    // is always present in practice (the registry resolves it before calling),
    // so we supply one and stress only the other fields.
    const hostile: Record<string, unknown> = {
      apiKey: 'test-key',
      baseURL: { evil: true } as unknown as string,
      defaultModel: 12345 as unknown as string,
      extraJunk: 'ignored',
      __proto__pollution: 'ignored',
    };
    expect(() => googleProviderDef.createClient(hostile)).not.toThrow();
    const client = googleProviderDef.createClient(hostile);
    // Slug attribution and catalog must survive the hostile config.
    expect(client.name).toBe('google');
    expect(client.models).toEqual(geminiModels);
  });

  it('createClient surfaces a clear error (never a silently-broken client) when no key resolves', () => {
    // In practice the registry only calls createClient with a resolved key. If
    // it ever didn't, the underlying OpenAI SDK constructor must FAIL LOUDLY
    // (no key) rather than hand back a half-constructed client that 401s opaquely
    // on the first turn. Pin that the keyless path throws synchronously here.
    // The OpenAI SDK falls back to process.env.OPENAI_API_KEY, so clear it for
    // the assertion to keep this deterministic regardless of the runner's env.
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(() => googleProviderDef.createClient({})).toThrow();
    } finally {
      if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
    }
  });
});
