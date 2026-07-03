import { describe, expect, it, vi } from 'vitest';

// Never let ensureInstalled shell out to npm in tests.
vi.mock('@moxxy/plugin-plugins-admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moxxy/plugin-plugins-admin')>();
  return {
    ...actual,
    installPluginPackagePinned: vi.fn(async () => ({ installed: 'x', dir: '/p' })),
    setPluginEnabled: vi.fn(async () => undefined),
  };
});

import { installPluginPackagePinned } from '@moxxy/plugin-plugins-admin';
import { buildProviderSetupView } from './provider-setup.js';

interface FakeDef {
  name: string;
  auth?: { kind: 'oauth' | 'apiKey'; login?: (ctx: unknown) => Promise<unknown> };
  validateKey?: (key: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  models: [];
}

function fakeSession(defs: FakeDef[]) {
  const runtime = new Map<string, string>();
  return {
    providers: { list: () => defs },
    readyProviders: new Set<string>(),
    requirements: { setRuntime: (k: string, v: string) => runtime.set(k, v) },
    pluginHost: { reload: vi.fn(async () => undefined) },
    _runtime: runtime,
  };
}

function fakeVault() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    delete: vi.fn(async () => true),
    _store: store,
  };
}

describe('buildProviderSetupView', () => {
  it('authKind: registered def wins, catalog falls back, unknown is null', () => {
    const session = fakeSession([{ name: 'custom-oauth', auth: { kind: 'oauth' }, models: [] }]);
    const view = buildProviderSetupView({ session: session as never, vault: fakeVault() as never });
    expect(view.authKind('custom-oauth')).toBe('oauth');
    // 'anthropic' is not registered here but is in PROVIDER_CATALOG (auth: key).
    expect(view.authKind('anthropic')).toBe('apiKey');
    expect(view.authKind('local')).toBe('none');
    expect(view.authKind('definitely-not-a-provider')).toBeNull();
  });

  it('ensureInstalled: registered → true without installing; catalog → pinned install + enable + reload', async () => {
    const session = fakeSession([{ name: 'openai', models: [] }]);
    const view = buildProviderSetupView({ session: session as never, vault: fakeVault() as never });
    await expect(view.ensureInstalled('openai')).resolves.toBe(true);
    expect(installPluginPackagePinned).not.toHaveBeenCalled();

    // Catalog-only: install runs; the provider still isn't registered after
    // reload in this fake, so it reports false.
    await expect(view.ensureInstalled('anthropic')).resolves.toBe(false);
    expect(installPluginPackagePinned).toHaveBeenCalledWith(
      expect.objectContaining({ packageName: '@moxxy/plugin-provider-anthropic' }),
    );
    expect(session.pluginHost.reload).toHaveBeenCalledTimes(1);
  });

  it('testKey: provider without validateKey accepts; with validateKey delegates', async () => {
    const validateKey = vi.fn(async () => ({ ok: false, message: 'bad' }) as const);
    const session = fakeSession([
      { name: 'novalidate', models: [] },
      { name: 'strict', validateKey, models: [] },
    ]);
    const view = buildProviderSetupView({ session: session as never, vault: fakeVault() as never });
    await expect(view.testKey('novalidate', 'k')).resolves.toEqual({ ok: true });
    await expect(view.testKey('strict', 'k')).resolves.toEqual({ ok: false, message: 'bad' });
  });

  it('saveKey stores under the canonical vault key and marks the provider ready', async () => {
    const session = fakeSession([{ name: 'anthropic', models: [] }]);
    const vault = fakeVault();
    const view = buildProviderSetupView({ session: session as never, vault: vault as never });
    await view.saveKey('anthropic', 'sk-ant-123');
    expect(vault.set).toHaveBeenCalledWith('ANTHROPIC_API_KEY', 'sk-ant-123', ['anthropic']);
    expect(session.readyProviders.has('anthropic')).toBe(true);
    expect(session._runtime.get('auth:provider:anthropic')).toBe('ready');
  });

  it('loginOAuth rejects a non-OAuth provider and routes io into the auth context', async () => {
    const login = vi.fn(async (ctx: { write: (s: string) => void; prompt?: unknown; headless: boolean }) => {
      ctx.write('hello');
      expect(ctx.headless).toBe(false);
      return { accountId: 'acct' };
    });
    const session = fakeSession([
      { name: 'keyed', models: [] },
      { name: 'oauthy', auth: { kind: 'oauth', login }, models: [] },
    ]);
    const view = buildProviderSetupView({ session: session as never, vault: fakeVault() as never });

    await expect(view.loginOAuth('keyed')).rejects.toThrow(/does not advertise an OAuth flow/);

    const lines: string[] = [];
    const result = await view.loginOAuth('oauthy', { write: (s) => lines.push(s) });
    expect(result).toEqual({ accountId: 'acct' });
    expect(lines).toEqual(['hello']);
    expect(session.readyProviders.has('oauthy')).toBe(true);
  });
});
