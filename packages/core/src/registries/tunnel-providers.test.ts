import { describe, expect, it } from 'vitest';
import type { TunnelProviderDef } from '@moxxy/sdk';
import { TunnelProviderRegistry } from './tunnel-providers.js';

const mk = (name: string): TunnelProviderDef => ({
  name,
  open: () => Promise.resolve({ url: `http://${name}`, close: () => Promise.resolve() }),
});

describe('TunnelProviderRegistry', () => {
  it('auto-activates first; duplicate throws', () => {
    const r = new TunnelProviderRegistry();
    expect(r.getActive()).toBeNull();
    r.register(mk('localhost'));
    expect(r.getActive()?.name).toBe('localhost');
    expect(() => r.register(mk('localhost'))).toThrow(/already registered/);
  });

  it('replace + setActive + unregister-clears-active behave like the other registries', () => {
    const r = new TunnelProviderRegistry();
    r.register(mk('localhost'));
    r.replace(mk('cloudflared'));
    r.setActive('cloudflared');
    expect(r.getActive()?.name).toBe('cloudflared');
    expect(() => r.setActive('ngrok')).toThrow(/not registered/);
    r.unregister('cloudflared');
    expect(r.getActive()).toBeNull();
    expect(r.list().map((p) => p.name)).toEqual(['localhost']);
  });
});
