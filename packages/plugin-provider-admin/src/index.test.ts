import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProviderDef, ToolContext, ToolDef } from '@moxxy/sdk';
import { buildProviderAdminPlugin, type ProviderRegistryLike } from './index.js';
import { readProvidersConfig } from './store.js';

// Stub ONLY the network probe; buildProviderDef stays real. Lets the
// provider_test tests assert what key the validator received without ever
// hitting a vendor endpoint.
const validateMock = vi.hoisted(() =>
  vi.fn(async (_key: string, _opts: { baseURL?: string }) => ({ ok: true as const })),
);
vi.mock('./factory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./factory.js')>();
  return { ...actual, validateOpenAICompatKey: validateMock };
});

class FakeRegistry implements ProviderRegistryLike {
  defs = new Map<string, ProviderDef>();
  register(def: ProviderDef): void {
    if (this.defs.has(def.name)) throw new Error(`already registered: ${def.name}`);
    this.defs.set(def.name, def);
  }
  replace(def: ProviderDef): void {
    this.defs.set(def.name, def);
  }
  unregister(name: string): void {
    this.defs.delete(name);
  }
  list(): ReadonlyArray<ProviderDef> {
    return [...this.defs.values()];
  }
}

let tmpDir: string;
let cfgPath: string;
let registry: FakeRegistry;
let tools: Map<string, ToolDef>;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-provider-admin-tools-'));
  cfgPath = path.join(tmpDir, 'providers.json');
  registry = new FakeRegistry();
  const plugin = buildProviderAdminPlugin({ providerRegistry: registry, configPath: cfgPath });
  tools = new Map((plugin.tools ?? []).map((t) => [t.name, t]));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function call(name: string, input: Record<string, unknown>): Promise<unknown> {
  const tool = tools.get(name);
  if (!tool) throw new Error(`no tool: ${name}`);
  const parsed = tool.inputSchema.parse(input);
  return Promise.resolve(tool.handler(parsed, {} as never));
}

const zaiInput = {
  kind: 'openai-compat' as const,
  name: 'zai',
  baseURL: 'https://api.z.ai/api/coding/paas/v4',
  defaultModel: 'glm-4.6',
  models: [
    { id: 'glm-4.6', contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
  ],
};

describe('provider_add', () => {
  it('registers in the live registry AND persists to providers.json', async () => {
    const result = (await call('provider_add', zaiInput)) as { ok: boolean; replaced: boolean };
    expect(result.ok).toBe(true);
    expect(result.replaced).toBe(false);
    expect(registry.defs.has('zai')).toBe(true);
    const cfg = await readProvidersConfig(cfgPath);
    expect(cfg.providers.map((p) => p.name)).toEqual(['zai']);
  });

  it('replaces an existing provider with the same slug', async () => {
    await call('provider_add', zaiInput);
    const second = (await call('provider_add', {
      ...zaiInput,
      defaultModel: 'glm-4.5-air',
      models: [
        { id: 'glm-4.5-air', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
      ],
    })) as { ok: boolean; replaced: boolean };
    expect(second.replaced).toBe(true);
    const cfg = await readProvidersConfig(cfgPath);
    expect(cfg.providers).toHaveLength(1);
    expect(cfg.providers[0]!.defaultModel).toBe('glm-4.5-air');
  });

  it('rejects when defaultModel is not in the models list', async () => {
    await expect(
      call('provider_add', { ...zaiInput, defaultModel: 'not-in-list' }),
    ).rejects.toThrow(/not in the models list/);
    expect(registry.defs.size).toBe(0);
    const cfg = await readProvidersConfig(cfgPath);
    expect(cfg.providers).toEqual([]);
  });

  it('rejects invalid slug shapes via inputSchema', () => {
    const tool = tools.get('provider_add')!;
    const bad = tool.inputSchema.safeParse({ ...zaiInput, name: 'NotASlug' });
    expect(bad.success).toBe(false);
  });

  it('refuses to shadow a built-in provider but still adds a genuinely-new one', async () => {
    // Simulate the host having already registered the built-in OpenAI provider
    // (its def is in the registry before the plugin is built).
    const withBuiltin = new FakeRegistry();
    const builtinDef = { name: 'openai', models: [{ id: 'gpt-x', contextWindow: 1 }] } as unknown as ProviderDef;
    withBuiltin.register(builtinDef);
    const plugin = buildProviderAdminPlugin({ providerRegistry: withBuiltin, configPath: cfgPath });
    const guardedTools = new Map((plugin.tools ?? []).map((t) => [t.name, t]));
    const addBuiltin = (input: Record<string, unknown>): Promise<unknown> => {
      const tool = guardedTools.get('provider_add')!;
      return Promise.resolve(tool.handler(tool.inputSchema.parse(input), {} as never));
    };

    // Attempting to redirect 'openai' to an arbitrary baseURL must be rejected
    // AND must leave the built-in def untouched + nothing persisted.
    await expect(
      addBuiltin({ ...zaiInput, name: 'openai', baseURL: 'https://evil.example.com/v1' }),
    ).rejects.toThrow(/built-in/i);
    expect(withBuiltin.defs.get('openai')).toBe(builtinDef);
    expect(await readProvidersConfig(cfgPath)).toEqual({ providers: [] });

    // A genuinely-new slug still succeeds against the same registry.
    const ok = (await addBuiltin(zaiInput)) as { ok: boolean; replaced: boolean };
    expect(ok.ok).toBe(true);
    expect(ok.replaced).toBe(false);
    expect(withBuiltin.defs.has('zai')).toBe(true);
    // The built-in is still its original def.
    expect(withBuiltin.defs.get('openai')).toBe(builtinDef);
  });

  it('restores the prior def (not deletes it) when the disk write fails on a replace', async () => {
    // A registry already holding a custom 'zai' def at the moment the plugin's
    // tool runs (registered AFTER plugin build, so it is NOT a reserved builtin).
    const reg = new FakeRegistry();
    // Build with a config path whose parent is a FILE → the atomic write's
    // mkdir(dirname) rejects (ENOTDIR), driving the rollback branch.
    const blocker = path.join(tmpDir, 'blocker');
    await fs.writeFile(blocker, 'not a dir', 'utf8');
    const badPath = path.join(blocker, 'providers.json');
    const plugin = buildProviderAdminPlugin({ providerRegistry: reg, configPath: badPath });
    const guardedTools = new Map((plugin.tools ?? []).map((t) => [t.name, t]));
    const priorDef = { name: 'zai', models: [{ id: 'old-model', contextWindow: 1 }] } as unknown as ProviderDef;
    reg.register(priorDef);

    const addTool = guardedTools.get('provider_add')!;
    await expect(
      Promise.resolve(addTool.handler(addTool.inputSchema.parse(zaiInput), {} as never)),
    ).rejects.toBeTruthy();

    // The original def must STILL be present and UNCHANGED — not deleted.
    expect(reg.defs.get('zai')).toBe(priorDef);
  });

  it('unregisters a brand-new provider when the disk write fails (no phantom)', async () => {
    const reg = new FakeRegistry();
    const blocker = path.join(tmpDir, 'blocker');
    await fs.writeFile(blocker, 'not a dir', 'utf8');
    const badPath = path.join(blocker, 'providers.json');
    const plugin = buildProviderAdminPlugin({ providerRegistry: reg, configPath: badPath });
    const guardedTools = new Map((plugin.tools ?? []).map((t) => [t.name, t]));
    const addTool = guardedTools.get('provider_add')!;
    await expect(
      Promise.resolve(addTool.handler(addTool.inputSchema.parse(zaiInput), {} as never)),
    ).rejects.toBeTruthy();
    // Nothing left behind in the live registry.
    expect(reg.defs.has('zai')).toBe(false);
  });

  it('persists supportsDocuments through the schema → ModelDescriptor chain', async () => {
    // Previously the input schema had no supportsDocuments field, so zod
    // STRIPPED it — attachments degraded to extracted text for every
    // runtime-registered provider even when the vendor model takes PDFs.
    await call('provider_add', {
      ...zaiInput,
      models: [
        {
          id: 'glm-4.6',
          contextWindow: 200_000,
          supportsTools: true,
          supportsStreaming: true,
          supportsImages: true,
          supportsDocuments: true,
        },
      ],
    });
    const cfg = await readProvidersConfig(cfgPath);
    expect(cfg.providers[0]!.models[0]).toMatchObject({ supportsDocuments: true });
    const def = registry.defs.get('zai')!;
    expect(def.models[0]).toMatchObject({ supportsDocuments: true });
  });
});

describe('provider_list', () => {
  it('reflects the persisted config', async () => {
    await call('provider_add', zaiInput);
    const list = (await call('provider_list', {})) as {
      providers: Array<{ name: string; envVar: string }>;
    };
    expect(list.providers).toHaveLength(1);
    expect(list.providers[0]).toMatchObject({ name: 'zai', envVar: 'ZAI_API_KEY' });
  });
});

describe('provider_remove', () => {
  it('drops the entry from disk AND the live registry', async () => {
    await call('provider_add', zaiInput);
    const removed = (await call('provider_remove', { name: 'zai' })) as { ok: boolean };
    expect(removed.ok).toBe(true);
    expect(registry.defs.has('zai')).toBe(false);
    const cfg = await readProvidersConfig(cfgPath);
    expect(cfg.providers).toEqual([]);
  });

  it('is a no-op when the slug is unknown', async () => {
    const removed = (await call('provider_remove', { name: 'never-existed' })) as { ok: boolean };
    expect(removed.ok).toBe(false);
  });
});

describe('provider_test', () => {
  const ctxWithSecret = (secrets: Record<string, string>): ToolContext =>
    ({ getSecret: async (name: string) => secrets[name] ?? null }) as unknown as ToolContext;

  function callTest(input: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
    const tool = tools.get('provider_test')!;
    const parsed = tool.inputSchema.parse(input);
    return Promise.resolve(tool.handler(parsed, ctx));
  }

  beforeEach(() => validateMock.mockClear());

  it('resolves the key from the vault via ctx.getSecret and probes with it', async () => {
    const result = (await callTest(
      { baseURL: 'https://api.z.ai/api/coding/paas/v4', keyName: 'ZAI_API_KEY' },
      ctxWithSecret({ ZAI_API_KEY: 'sk-plaintext-secret' }),
    )) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(validateMock).toHaveBeenCalledWith('sk-plaintext-secret', {
      baseURL: 'https://api.z.ai/api/coding/paas/v4',
    });
    // The plaintext key must never leak into the model-visible tool result.
    expect(JSON.stringify(result)).not.toContain('sk-plaintext-secret');
  });

  it('returns an actionable message when the vault has no such secret', async () => {
    const result = (await callTest(
      { baseURL: 'https://api.deepseek.com', keyName: 'DEEPSEEK_API_KEY' },
      ctxWithSecret({}),
    )) as { ok: boolean; message: string };
    expect(result.ok).toBe(false);
    expect(result.message).toContain('DEEPSEEK_API_KEY');
    expect(result.message).toContain('/vault set DEEPSEEK_API_KEY');
    expect(validateMock).not.toHaveBeenCalled();
  });

  it('fails gracefully when the session has no vault wired in', async () => {
    const result = (await callTest(
      { baseURL: 'https://api.deepseek.com', keyName: 'DEEPSEEK_API_KEY' },
      {} as ToolContext,
    )) as { ok: boolean; message: string };
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/vault/i);
    expect(validateMock).not.toHaveBeenCalled();
  });

  it('does not accept a plaintext apiKey input (schema requires keyName)', () => {
    const tool = tools.get('provider_test')!;
    const bad = tool.inputSchema.safeParse({
      baseURL: 'https://api.deepseek.com',
      apiKey: 'sk-raw-key',
    });
    expect(bad.success).toBe(false);
    // lower-case / non-env-shaped names are rejected too
    const badName = tool.inputSchema.safeParse({
      baseURL: 'https://api.deepseek.com',
      keyName: 'not a name',
    });
    expect(badName.success).toBe(false);
  });

  it('description asserts the vault-name contract', () => {
    const tool = tools.get('provider_test')!;
    expect(tool.description).toContain('vault');
    expect(tool.description).toMatch(/never enters the conversation/i);
    expect(tool.description).not.toMatch(/supplied API key/i);
  });
});

describe('onInit logger guard', () => {
  // A registry whose register() always throws drives onInit down its per-entry
  // catch → log?.warn path. These tests pin the runtime guard that replaced the
  // old ad-hoc `(ctx as { logger?: … }).logger` structural cast.
  class ThrowingRegistry extends FakeRegistry {
    override register(): void {
      throw new Error('boom');
    }
  }

  beforeEach(async () => {
    await fs.writeFile(
      cfgPath,
      JSON.stringify({ providers: [{ ...zaiInput, kind: 'openai-compat' }] }),
      'utf8',
    );
  });

  it('warns through a conforming host logger', async () => {
    const warn = vi.fn();
    const plugin = buildProviderAdminPlugin({ providerRegistry: new ThrowingRegistry(), configPath: cfgPath });
    await plugin.hooks!.onInit!({ logger: { warn } } as never);
    expect(warn).toHaveBeenCalledWith(
      'provider-admin: failed to register "zai"',
      expect.any(Object),
    );
  });

  it('ignores a non-conforming logger instead of crashing', async () => {
    const plugin = buildProviderAdminPlugin({ providerRegistry: new ThrowingRegistry(), configPath: cfgPath });
    // `logger.warn` is a string, not a function — the guard must reject it
    // (a blanket cast would have called a non-function and thrown).
    await expect(
      plugin.hooks!.onInit!({ logger: { warn: 'nope' } } as never),
    ).resolves.toBeUndefined();
    // A ctx with no logger at all is likewise a clean no-op.
    await expect(plugin.hooks!.onInit!({} as never)).resolves.toBeUndefined();
  });
});

describe('onInit', () => {
  it('re-registers everything stored on disk', async () => {
    // Pre-seed providers.json the way it would look after a previous session.
    await fs.writeFile(
      cfgPath,
      JSON.stringify({ providers: [{ ...zaiInput, kind: 'openai-compat' }] }),
      'utf8',
    );
    // Fresh registry — simulate a brand-new session pointing at the same store.
    const fresh = new FakeRegistry();
    const plugin = buildProviderAdminPlugin({ providerRegistry: fresh, configPath: cfgPath });
    await plugin.hooks!.onInit!({} as never);
    expect(fresh.defs.has('zai')).toBe(true);
    const def = fresh.defs.get('zai')!;
    expect(def.models[0]!.id).toBe('glm-4.6');
  });

  it('does not clobber a built-in when providers.json contains a colliding entry', async () => {
    // A poisoned/legacy store smuggling an 'openai' entry must NOT overwrite the
    // built-in OpenAI def on boot — onInit skips reserved names.
    await fs.writeFile(
      cfgPath,
      JSON.stringify({
        providers: [
          { ...zaiInput, name: 'openai', baseURL: 'https://evil.example.com/v1', kind: 'openai-compat' },
          { ...zaiInput, kind: 'openai-compat' },
        ],
      }),
      'utf8',
    );
    const withBuiltin = new FakeRegistry();
    const builtinDef = { name: 'openai', models: [{ id: 'gpt-x', contextWindow: 1 }] } as unknown as ProviderDef;
    withBuiltin.register(builtinDef);
    const plugin = buildProviderAdminPlugin({ providerRegistry: withBuiltin, configPath: cfgPath });
    await plugin.hooks!.onInit!({} as never);
    // Built-in untouched...
    expect(withBuiltin.defs.get('openai')).toBe(builtinDef);
    // ...but the genuinely-new provider in the same file still got registered.
    expect(withBuiltin.defs.has('zai')).toBe(true);
  });
});
