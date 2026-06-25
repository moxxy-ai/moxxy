import { describe, expect, it } from 'vitest';
import { ServiceRegistryImpl } from './services.js';

describe('ServiceRegistryImpl', () => {
  it('register / get / has round-trip', () => {
    const r = new ServiceRegistryImpl();
    expect(r.has('vault')).toBe(false);
    expect(r.get('vault')).toBeUndefined();
    const store = { secret: 1 };
    r.register('vault', store);
    expect(r.has('vault')).toBe(true);
    expect(r.get('vault')).toBe(store);
  });

  it('require returns the service or throws with a helpful message', () => {
    const r = new ServiceRegistryImpl();
    expect(() => r.require('vault')).toThrow(/Required service not registered: vault/);
    const store = { secret: 2 };
    r.register('vault', store);
    expect(r.require<typeof store>('vault')).toBe(store);
  });

  it('last write wins (a later plugin may replace a service)', () => {
    const r = new ServiceRegistryImpl();
    r.register('x', 1);
    r.register('x', 2);
    expect(r.get('x')).toBe(2);
  });
});
