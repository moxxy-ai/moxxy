import { describe, expect, it, vi } from 'vitest';
import type { ServiceRegistry } from '@moxxy/sdk';
import { assertDefined } from '@moxxy/sdk';
import { webChannelPlugin } from './index.js';

/**
 * The discovery-loadable default export resolves the tunnel registry + the
 * shared viewSurface/webControls refs + the configured default tunnel from the
 * service registry in onInit (a lazy `tunnels` object keeps the tools + boot
 * hook present), instead of the host `{ getTunnel, publishSurface, … }` closure.
 */
describe('webChannelPlugin (discovery-loadable)', () => {
  it('exposes the web channel + tunnel tools + an onInit hook', () => {
    expect(webChannelPlugin.channels?.map((c) => c.name)).toContain('web');
    const tools = webChannelPlugin.tools?.map((t) => t.name) ?? [];
    expect(tools).toContain('web_set_tunnel');
    expect(tools).toContain('web_tunnel_status');
    expect(typeof webChannelPlugin.hooks?.onInit).toBe('function');
  });

  it('onInit resolves tunnelProviders + viewSurface + webControls', () => {
    const tp = { getActive: () => null, list: () => [], setActive: () => {} };
    const get = vi.fn((name: string) => {
      switch (name) {
        case 'tunnelProviders':
          return tp;
        case 'viewSurface':
          return { current: null };
        case 'webControls':
          return { current: null };
        default:
          return undefined;
      }
    });
    const services = { get, register: () => {}, require: () => undefined, has: () => true } as unknown as ServiceRegistry;
    const hooks = webChannelPlugin.hooks;
    assertDefined(hooks, 'plugin defines hooks');
    const onInit = hooks.onInit;
    assertDefined(onInit, 'hooks define onInit');
    onInit({ services } as never);
    expect(get).toHaveBeenCalledWith('tunnelProviders');
    expect(get).toHaveBeenCalledWith('viewSurface');
    expect(get).toHaveBeenCalledWith('webControls');
  });
});
