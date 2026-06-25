import { describe, expect, it, vi } from 'vitest';
import type { ServiceRegistry } from '@moxxy/sdk';
import { subagentsPlugin } from './index.js';

/**
 * The discovery-loadable default export resolves the `agents` + `tools`
 * registries from the inter-plugin service registry in onInit instead of a
 * `build*({ getAgent, getToolNames })` closure.
 */
describe('subagentsPlugin (discovery-loadable)', () => {
  it('exposes dispatch_agent + an onInit hook', () => {
    expect(subagentsPlugin.tools?.map((t) => t.name)).toEqual(['dispatch_agent']);
    expect(typeof subagentsPlugin.hooks?.onInit).toBe('function');
  });

  it('onInit resolves the agents + tools registries from the service registry', () => {
    const reg = { get: () => undefined, list: () => [], has: () => false };
    const get = vi.fn(() => reg);
    const services = {
      get,
      require: () => reg,
      has: () => true,
      register: () => {},
    } as unknown as ServiceRegistry;
    subagentsPlugin.hooks!.onInit!({ services } as never);
    expect(get).toHaveBeenCalledWith('agents');
    expect(get).toHaveBeenCalledWith('tools');
  });
});
