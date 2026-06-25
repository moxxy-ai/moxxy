import { describe, expect, it, vi } from 'vitest';
import { pinFirstPartySpec } from './pin.js';
import { provision, type ProvisionEffects } from './provision.js';

describe('pinFirstPartySpec', () => {
  it('pins a bare first-party package to the cli version', () => {
    expect(pinFirstPartySpec('@moxxy/plugin-provider-anthropic', undefined, '1.2.3')).toBe(
      '@moxxy/plugin-provider-anthropic@1.2.3',
    );
  });
  it('respects an explicit version', () => {
    expect(pinFirstPartySpec('@moxxy/plugin-x', '0.9.0', '1.2.3')).toBe('@moxxy/plugin-x@0.9.0');
  });
  it('leaves a version already embedded in the name', () => {
    expect(pinFirstPartySpec('@moxxy/plugin-x@2.0.0', undefined, '1.2.3')).toBe('@moxxy/plugin-x@2.0.0');
  });
  it('leaves non-first-party packages alone', () => {
    expect(pinFirstPartySpec('some-pkg', undefined, '1.2.3')).toBe('some-pkg');
  });
  it('is a no-op without a cli version', () => {
    expect(pinFirstPartySpec('@moxxy/plugin-x', undefined, undefined)).toBe('@moxxy/plugin-x');
  });
});

function makeEffects(overrides: Partial<ProvisionEffects> = {}): ProvisionEffects {
  return {
    loadedProviderNames: new Set<string>(),
    install: vi.fn(async () => {}),
    writeConfig: vi.fn(async () => {}),
    storeSecret: vi.fn(async () => {}),
    cliVersion: '1.0.0',
    ...overrides,
  };
}

describe('provision', () => {
  it('skips installing a bundled provider but configures it + stores the key', async () => {
    const eff = makeEffects({ loadedProviderNames: new Set(['anthropic']) });
    const res = await provision(
      { provider: 'anthropic', key: 'sk-x', model: 'claude-opus-4-8' },
      eff,
    );
    expect(eff.install).not.toHaveBeenCalled();
    expect(res.skipped).toContain('@moxxy/plugin-provider-anthropic');
    expect(eff.storeSecret).toHaveBeenCalledWith(expect.any(String), 'sk-x', ['anthropic']);
    expect(res.keyStored).toBe(true);
    expect(eff.writeConfig).toHaveBeenCalledWith(
      expect.objectContaining({ providerSlug: 'anthropic', providerBundled: true, model: 'claude-opus-4-8' }),
    );
  });

  it('installs a non-bundled provider (pinned) BEFORE writing config', async () => {
    const order: string[] = [];
    const eff = makeEffects({
      loadedProviderNames: new Set(),
      install: vi.fn(async (s: string) => {
        order.push(`install:${s}`);
      }),
      writeConfig: vi.fn(async () => {
        order.push('config');
      }),
    });
    const res = await provision({ provider: 'openai' }, eff);
    expect(res.installed).toContain('@moxxy/plugin-provider-openai');
    expect(eff.install).toHaveBeenCalledWith('@moxxy/plugin-provider-openai@1.0.0'); // pinned to cli version
    expect(order).toEqual(['install:@moxxy/plugin-provider-openai@1.0.0', 'config']); // config last
  });

  it('does not store a key for an oauth provider', async () => {
    const eff = makeEffects({ loadedProviderNames: new Set(['claude-code']) });
    const res = await provision({ provider: 'claude-code', key: 'should-ignore' }, eff);
    expect(eff.storeSecret).not.toHaveBeenCalled();
    expect(res.keyStored).toBe(false);
  });

  it('installs accepted basics too (pinned)', async () => {
    const eff = makeEffects({ loadedProviderNames: new Set(['anthropic']) });
    await provision({ provider: 'anthropic', basics: ['@moxxy/plugin-memory'] }, eff);
    expect(eff.install).toHaveBeenCalledWith('@moxxy/plugin-memory@1.0.0');
  });

  it('throws on an unknown provider', async () => {
    await expect(provision({ provider: 'nope' }, makeEffects())).rejects.toThrow(/unknown provider/);
  });
});
