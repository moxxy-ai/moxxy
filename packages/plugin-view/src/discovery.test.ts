import { describe, expect, it, vi } from 'vitest';
import type { ServiceRegistry } from '@moxxy/sdk';
import { viewPlugin } from './index.js';

/**
 * The discovery-loadable default export resolves the active view-renderer
 * registry + the shared web-surface ref from the service registry in onInit,
 * instead of the host `{ getRenderer, getSurface }` closure.
 */
describe('viewPlugin (discovery-loadable)', () => {
  it('exposes present_view + an onInit hook', () => {
    expect(viewPlugin.tools?.map((t) => t.name)).toEqual(['present_view']);
    expect(typeof viewPlugin.hooks?.onInit).toBe('function');
  });

  it('onInit resolves viewRenderers + viewSurface from the registry', () => {
    const get = vi.fn((name: string) =>
      name === 'viewRenderers'
        ? { getActive: () => null }
        : name === 'viewSurface'
          ? { current: null }
          : undefined,
    );
    const services = { get, register: () => {}, require: () => undefined, has: () => true } as unknown as ServiceRegistry;
    viewPlugin.hooks!.onInit!({ services } as never);
    expect(get).toHaveBeenCalledWith('viewRenderers');
    expect(get).toHaveBeenCalledWith('viewSurface');
  });
});
