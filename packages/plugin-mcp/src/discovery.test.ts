import { describe, expect, it, vi } from 'vitest';
import type { ServiceRegistry } from '@moxxy/sdk';
import { mcpAdminPlugin } from './index.js';

/**
 * The discovery-loadable default export resolves the tools + skills registries
 * and the secret resolver from the service registry in onInit, and publishes its
 * runtime api as the 'mcpAdmin' service (which Session.mcpAdmin exposes), instead
 * of the host `{ toolRegistry, skillRegistry, secretResolver }` closure + stash.
 */
describe('mcpAdminPlugin (discovery-loadable)', () => {
  it('exposes the mcp tools + an onInit hook', () => {
    const names = mcpAdminPlugin.tools?.map((t) => t.name) ?? [];
    expect(names).toContain('mcp_add_server');
    expect(typeof mcpAdminPlugin.hooks?.onInit).toBe('function');
  });

  it('onInit resolves tools/skills/resolveSecrets and publishes mcpAdmin', async () => {
    const reg = {
      has: () => false,
      register: () => {},
      unregister: () => {},
      byName: () => undefined,
      list: () => [],
    };
    const get = vi.fn((name: string) =>
      name === 'tools' || name === 'skills'
        ? reg
        : name === 'resolveSecrets'
          ? async (v: string) => v
          : undefined,
    );
    const register = vi.fn();
    const services = { get, register, require: () => undefined, has: () => true } as unknown as ServiceRegistry;

    // The inner onInit reads ~/.moxxy/mcp.json (absent on CI → caught + skipped);
    // we only assert the service wiring here.
    await mcpAdminPlugin.hooks!.onInit!({ services } as never);

    expect(get).toHaveBeenCalledWith('tools');
    expect(get).toHaveBeenCalledWith('skills');
    expect(get).toHaveBeenCalledWith('resolveSecrets');
    expect(register).toHaveBeenCalledWith('mcpAdmin', expect.anything());
  });
});
