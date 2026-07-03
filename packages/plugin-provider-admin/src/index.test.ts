import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProviderDef, ToolContext, ToolDef } from '@moxxy/sdk';
import { buildProviderAdminPlugin, buildProviderAdminPluginWithApi, type ProviderRegistryLike } from './index.js';
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
  instances = new Map<string, Record<string, unknown>>();
  active: string | null = null;
  register(def: ProviderDef): void {
    if (this.defs.has(def.name)) throw new Error(`already registered: ${def.name}`);
    this.defs.set(def.name, def);
  }
  replace(def: ProviderDef): void {
    this.defs.set(def.name, def);
    // Mirror core's ProviderRegistry: replace() drops the cached instance.
    this.instances.delete(def.name);
  }
  unregister(name: string): void {
    this.defs.delete(name);
    this.instances.delete(name);
    if (this.active === name) this.active = null;
  }
  list(): ReadonlyArray<ProviderDef> {
    return [...this.defs.values()];
  }
  getActiveName(): string | null {
    return this.active;
  }
  setActive(name: string, config?: Record<string, unknown>): unknown {
    this.active = name;
    const inst = config ?? {};
    this.instances.set(name, inst);
    return inst;
  }
}

let tmpDir: string;
let cfgPath: string;
let registry: FakeRegistry;
let tools: Map<string, ToolDef>;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-provider-admin-tools-'));
  cfgPath = path.join(tmpDir, 'config.yaml');
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


/** Seed the unified-tree store the way a previous session's provider_add
 *  would have written it (plugins.provider.items.<name>.{model,config}). */
async function seedStoredProviders(
  file: string,
  entries: ReadonlyArray<typeof zaiInput>,
): Promise<void> {
  const items = entries
    .map((e) => {
      const models = e.models
        .map(
          (m) =>
            `            - id: ${m.id}\n              contextWindow: ${m.contextWindow}\n              supportsTools: ${m.supportsTools}\n              supportsStreaming: ${m.supportsStreaming}`,
        )
        .join('\n');
      return [
        `      ${e.name}:`,
        `        model: ${e.defaultModel}`,
        `        config:`,
        `          kind: ${e.kind}`,
        `          baseURL: ${e.baseURL}`,
        `          models:`,
        models,
      ].join('\n');
    })
    .join('\n');
  await fs.writeFile(file, `plugins:\n  provider:\n    items:\n${items}\n`, 'utf8');
}

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
    // Seed a 'zai' entry on disk + run onInit so the PLUGIN owns the live def (a
    // def WE registered, not an external built-in). A later provider_add of the
    // same slug is a genuine replace; if the disk write fails the prior owned
    // def must be restored, not deleted. The read path stays valid; the dir is
    // made read-only so the atomic temp-file write rejects (rollback branch).
    const reg = new FakeRegistry();
    await seedStoredProviders(cfgPath, [zaiInput]);
    const plugin = buildProviderAdminPlugin({ providerRegistry: reg, configPath: cfgPath });
    await plugin.hooks!.onInit!({} as never);
    expect(reg.defs.has('zai')).toBe(true);
    const priorDef = reg.defs.get('zai')!;

    const addTool = plugin.tools!.find((t) => t.name === 'provider_add')!;
    await fs.chmod(tmpDir, 0o500);
    try {
      await expect(
        Promise.resolve(
          addTool.handler(
            addTool.inputSchema.parse({ ...zaiInput, defaultModel: 'glm-4.5-air', models: [{ id: 'glm-4.5-air', contextWindow: 1 }] }),
            {} as never,
          ),
        ),
      ).rejects.toBeTruthy();
    } finally {
      await fs.chmod(tmpDir, 0o700);
    }
    // The owned def must STILL be present and UNCHANGED — restored, not deleted.
    expect(reg.defs.get('zai')).toBe(priorDef);
  });

  it('unregisters a brand-new provider when the disk write fails (no phantom)', async () => {
    // Fresh slug (not owned, not in registry) → register + write. Make the dir
    // read-only so the write fails; the phantom registration must be rolled back.
    const reg = new FakeRegistry();
    await fs.writeFile(cfgPath, 'plugins:\n  provider:\n    items: {}\n', 'utf8');
    const plugin = buildProviderAdminPlugin({ providerRegistry: reg, configPath: cfgPath });
    const addTool = plugin.tools!.find((t) => t.name === 'provider_add')!;
    await fs.chmod(tmpDir, 0o500);
    try {
      await expect(
        Promise.resolve(addTool.handler(addTool.inputSchema.parse(zaiInput), {} as never)),
      ).rejects.toBeTruthy();
    } finally {
      await fs.chmod(tmpDir, 0o700);
    }
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
    await seedStoredProviders(cfgPath, [zaiInput]);
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
    await seedStoredProviders(cfgPath, [zaiInput]);
    // Fresh registry — simulate a brand-new session pointing at the same store.
    const fresh = new FakeRegistry();
    const plugin = buildProviderAdminPlugin({ providerRegistry: fresh, configPath: cfgPath });
    await plugin.hooks!.onInit!({} as never);
    expect(fresh.defs.has('zai')).toBe(true);
    const def = fresh.defs.get('zai')!;
    expect(def.models[0]!.id).toBe('glm-4.6');
  });

  it('does not clobber a built-in when providers.json contains a colliding entry', async () => {
    // A poisoned/hand-edited store smuggling an 'openai' entry must NOT
    // overwrite the built-in OpenAI def on boot — onInit skips reserved names.
    await seedStoredProviders(cfgPath, [
      { ...zaiInput, name: 'openai', baseURL: 'https://evil.example.com/v1' },
      zaiInput,
    ]);
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

describe('built-in shadowing guard — production wiring order (registry empty at build time)', () => {
  // The CLI builds this plugin BEFORE the host registers its built-in provider
  // defs. A build-time snapshot of reserved names is therefore EMPTY in prod;
  // the guard MUST evaluate the built-in set lazily against the live registry.
  it('rejects provider_add({name:openai}) when openai is registered AFTER the plugin is built', async () => {
    const reg = new FakeRegistry();
    // Plugin built against an EMPTY registry (mirrors buildBuiltinsCore running
    // before registerPlugins() seeds the built-in defs).
    const plugin = buildProviderAdminPlugin({ providerRegistry: reg, configPath: cfgPath });
    const addTool = plugin.tools!.find((t) => t.name === 'provider_add')!;
    // NOW the host registers the real built-in OpenAI def.
    const builtinDef = { name: 'openai', models: [{ id: 'gpt-x', contextWindow: 1 }] } as unknown as ProviderDef;
    reg.register(builtinDef);

    await expect(
      Promise.resolve(
        addTool.handler(
          addTool.inputSchema.parse({ ...zaiInput, name: 'openai', baseURL: 'https://evil.example.com/v1' }),
          {} as never,
        ),
      ),
    ).rejects.toThrow(/built-in/i);
    // The real built-in def must be UNTOUCHED — not hot-swapped to the shim.
    expect(reg.defs.get('openai')).toBe(builtinDef);
    expect(await readProvidersConfig(cfgPath)).toEqual({ providers: [] });
  });

  it('rejects configure() of a built-in registered after build', async () => {
    const reg = new FakeRegistry();
    const { api } = buildProviderAdminPluginWithApi({ providerRegistry: reg, configPath: cfgPath });
    const builtinDef = { name: 'openai', models: [{ id: 'gpt-x', contextWindow: 1 }] } as unknown as ProviderDef;
    reg.register(builtinDef);
    const err = await api.configure('openai', { defaultModel: 'gpt-x' }).catch((e) => e);
    expect(err).toBeTruthy();
    expect(String((err as Error).message)).toMatch(/built-in/i);
    expect(reg.defs.get('openai')).toBe(builtinDef);
  });
});

describe('baseURL scheme/host hardening', () => {
  const addSchema = (): { safeParse: (i: unknown) => { success: boolean } } => {
    const plugin = buildProviderAdminPlugin({ providerRegistry: new FakeRegistry(), configPath: cfgPath });
    return plugin.tools!.find((t) => t.name === 'provider_add')!.inputSchema as never;
  };
  const testSchema = (): { safeParse: (i: unknown) => { success: boolean } } => {
    const plugin = buildProviderAdminPlugin({ providerRegistry: new FakeRegistry(), configPath: cfgPath });
    return plugin.tools!.find((t) => t.name === 'provider_test')!.inputSchema as never;
  };

  it('rejects non-https / dangerous baseURLs on provider_add', () => {
    for (const baseURL of [
      'file:///etc/passwd',
      'ftp://vendor/v1',
      'http://evil.example.com/v1',
      'http://169.254.169.254/latest/meta-data',
      'https://169.254.169.254/v1',
    ]) {
      expect(addSchema().safeParse({ ...zaiInput, baseURL }).success).toBe(false);
    }
  });

  it('accepts https and http://localhost', () => {
    expect(addSchema().safeParse({ ...zaiInput, baseURL: 'https://api.z.ai/v1' }).success).toBe(true);
    expect(addSchema().safeParse({ ...zaiInput, baseURL: 'http://localhost:1234/v1' }).success).toBe(true);
    expect(addSchema().safeParse({ ...zaiInput, baseURL: 'http://127.0.0.1:8080/v1' }).success).toBe(true);
  });

  it('rejects credential egress to an arbitrary host via provider_test (http / metadata)', () => {
    expect(
      testSchema().safeParse({ baseURL: 'http://attacker.example.com/v1', keyName: 'DEEPSEEK_API_KEY' }).success,
    ).toBe(false);
    expect(
      testSchema().safeParse({ baseURL: 'https://169.254.169.254/v1', keyName: 'DEEPSEEK_API_KEY' }).success,
    ).toBe(false);
  });

  it('rejects RFC1918 private ranges + loopback over https (SSRF to internal hosts)', () => {
    for (const baseURL of [
      'https://10.0.0.5/v1', // 10.0.0.0/8
      'https://192.168.1.1/v1', // 192.168.0.0/16
      'https://172.16.5.5/v1', // 172.16.0.0/12 (low edge)
      'https://172.31.255.255/v1', // 172.16.0.0/12 (high edge)
      'https://127.0.0.1/v1', // loopback over https (only http://localhost is allowed)
      'https://127.5.6.7/v1', // 127.0.0.0/8
    ]) {
      expect(addSchema().safeParse({ ...zaiInput, baseURL }).success).toBe(false);
      expect(testSchema().safeParse({ baseURL, keyName: 'DEEPSEEK_API_KEY' }).success).toBe(false);
    }
  });

  it('does NOT reject a public 172.x address outside the private /12', () => {
    // 172.15.x and 172.32.x are PUBLIC — the blocklist must not over-reach.
    expect(addSchema().safeParse({ ...zaiInput, baseURL: 'https://172.15.0.1/v1' }).success).toBe(true);
    expect(addSchema().safeParse({ ...zaiInput, baseURL: 'https://172.32.0.1/v1' }).success).toBe(true);
  });

  it('canonicalizes decimal / hex IPv4 encodings before the SSRF check (no bypass)', () => {
    // 2852039166 === 169.254.169.254 (cloud metadata); hex/decimal must not slip past.
    expect(addSchema().safeParse({ ...zaiInput, baseURL: 'https://2852039166/v1' }).success).toBe(false);
    expect(addSchema().safeParse({ ...zaiInput, baseURL: 'https://0xa9.0xfe.0xa9.0xfe/v1' }).success).toBe(false);
    // 2130706433 === 127.0.0.1 (loopback) as a decimal literal.
    expect(testSchema().safeParse({ baseURL: 'https://2130706433/v1', keyName: 'DEEPSEEK_API_KEY' }).success).toBe(
      false,
    );
  });

  it('rejects IPv6 loopback / link-local / unique-local over https', () => {
    for (const baseURL of ['https://[::1]/v1', 'https://[fe80::1]/v1', 'https://[fc00::1]/v1', 'https://[fd12::1]/v1']) {
      expect(addSchema().safeParse({ ...zaiInput, baseURL }).success).toBe(false);
    }
  });
});

describe('per-name lock is bounded + serializes concurrent same-slug calls', () => {
  it('two parallel provider_add for the SAME fresh slug both succeed (no "already registered")', async () => {
    // Without serialization both calls capture prevDef=undefined and the second
    // register() throws "already registered". The per-name lock must turn the
    // race into add→replace. Run them with Promise.all (overlapping).
    const reg = new FakeRegistry();
    await fs.writeFile(cfgPath, 'plugins:\n  provider:\n    items: {}\n', 'utf8');
    const plugin = buildProviderAdminPlugin({ providerRegistry: reg, configPath: cfgPath });
    const addTool = plugin.tools!.find((t) => t.name === 'provider_add')!;
    const fire = (defaultModel: string): Promise<unknown> =>
      Promise.resolve(
        addTool.handler(
          addTool.inputSchema.parse({
            ...zaiInput,
            defaultModel,
            models: [{ id: defaultModel, contextWindow: 1000, supportsTools: true, supportsStreaming: true }],
          }),
          {} as never,
        ),
      );
    const results = (await Promise.all([fire('m-a'), fire('m-b')])) as Array<{ ok: boolean }>;
    expect(results.every((r) => r.ok)).toBe(true);
    // Exactly one 'zai' def survives; disk has exactly one entry.
    expect(reg.defs.has('zai')).toBe(true);
    const cfg = await readProvidersConfig(cfgPath);
    expect(cfg.providers.filter((p) => p.name === 'zai')).toHaveLength(1);
  });

  it('the lock map does not grow with the number of distinct slugs touched', async () => {
    // Each add/remove for a distinct slug must NOT leave a permanent lock entry.
    // We can't read the private map, but we CAN assert no behavioral leak by
    // hammering many distinct slugs sequentially and confirming each completes
    // (a leak would not crash, so this is a smoke that the ref-count finally
    // always runs — paired with the source-level guarantee).
    const reg = new FakeRegistry();
    await fs.writeFile(cfgPath, 'plugins:\n  provider:\n    items: {}\n', 'utf8');
    const plugin = buildProviderAdminPlugin({ providerRegistry: reg, configPath: cfgPath });
    const addTool = plugin.tools!.find((t) => t.name === 'provider_add')!;
    const removeTool = plugin.tools!.find((t) => t.name === 'provider_remove')!;
    for (let i = 0; i < 50; i++) {
      const name = `vendor-${i}`;
      await Promise.resolve(
        addTool.handler(addTool.inputSchema.parse({ ...zaiInput, name }), {} as never),
      );
      await Promise.resolve(removeTool.handler(removeTool.inputSchema.parse({ name }), {} as never));
    }
    // All cleaned up: registry empty, disk empty.
    expect(reg.list()).toHaveLength(0);
    expect((await readProvidersConfig(cfgPath)).providers).toHaveLength(0);
  });
});

describe('active-provider safety', () => {
  it('rebuilds the active provider instance after configure when a resolver is wired', async () => {
    await seedStoredProviders(cfgPath, [zaiInput]);
    const reg = new FakeRegistry();
    const resolved: string[] = [];
    const { plugin, api } = buildProviderAdminPluginWithApi({
      providerRegistry: reg,
      configPath: cfgPath,
      resolveActiveConfig: (name) => {
        resolved.push(name);
        return { apiKey: 'k-for-' + name };
      },
    });
    await plugin.hooks!.onInit!({} as never);
    // Activate zai (mirrors the user selecting it). Drops no instance yet.
    reg.setActive('zai', { apiKey: 'k-for-zai' });

    await api.configure('zai', {
      defaultModel: 'glm-4.5-air',
      models: [{ id: 'glm-4.5-air', contextWindow: 128_000, supportsTools: true, supportsStreaming: true }],
    });

    // The replace() during configure dropped the cached instance; the plugin
    // MUST have rebuilt it via the resolver so getActive() keeps working.
    expect(resolved).toContain('zai');
    expect(reg.instances.get('zai')).toEqual({ apiKey: 'k-for-zai' });
    expect(reg.getActiveName()).toBe('zai');
  });

  it('does not rebuild a non-active provider', async () => {
    await seedStoredProviders(cfgPath, [zaiInput]);
    const reg = new FakeRegistry();
    const resolved: string[] = [];
    const { plugin, api } = buildProviderAdminPluginWithApi({
      providerRegistry: reg,
      configPath: cfgPath,
      resolveActiveConfig: (name) => {
        resolved.push(name);
        return {};
      },
    });
    await plugin.hooks!.onInit!({} as never);
    reg.setActive('anthropic', {});
    await api.configure('zai', {
      defaultModel: 'glm-4.5-air',
      models: [{ id: 'glm-4.5-air', contextWindow: 128_000, supportsTools: true, supportsStreaming: true }],
    });
    expect(resolved).not.toContain('zai');
  });

  it('warns when provider_remove drops the ACTIVE provider', async () => {
    await seedStoredProviders(cfgPath, [zaiInput]);
    const reg = new FakeRegistry();
    const plugin = buildProviderAdminPlugin({ providerRegistry: reg, configPath: cfgPath });
    await plugin.hooks!.onInit!({} as never);
    reg.setActive('zai', {});
    const removeTool = plugin.tools!.find((t) => t.name === 'provider_remove')!;
    const res = (await removeTool.handler(removeTool.inputSchema.parse({ name: 'zai' }), {} as never)) as {
      ok: boolean;
      removedActive: boolean;
      note: string;
    };
    expect(res.ok).toBe(true);
    expect(res.removedActive).toBe(true);
    expect(res.note).toMatch(/NO active provider/i);
    expect(reg.getActiveName()).toBeNull();
  });
});

describe('configure() patch validation (defense-in-depth)', () => {
  it('rejects a malformed baseURL even when the runner schema would not run', async () => {
    await seedStoredProviders(cfgPath, [zaiInput]);
    const reg = new FakeRegistry();
    const { plugin, api } = buildProviderAdminPluginWithApi({ providerRegistry: reg, configPath: cfgPath });
    await plugin.hooks!.onInit!({} as never);
    // file:// would flow straight into buildProviderDef + key-name derivation
    // without validation; configure() must reject it itself.
    const err = await api
      .configure('zai', { baseURL: 'file:///etc/passwd' } as never)
      .catch((e) => e);
    expect(err).toBeTruthy();
    // Disk untouched.
    const stored = (await readProvidersConfig(cfgPath)).providers.find((p) => p.name === 'zai')!;
    expect(stored.baseURL).toBe(zaiInput.baseURL);
  });
});
