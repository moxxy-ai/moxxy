import type { Isolator } from '@moxxy/sdk';
import { describe, expect, it } from 'vitest';
import { IsolatorRegistry } from './isolators.js';

function fakeIsolator(name: string): Isolator {
  return {
    name,
    strength: 'none',
    run: async (_call, bound, _caps) => bound(undefined),
  } as unknown as Isolator;
}

describe('IsolatorRegistry (core contribution collection)', () => {
  it('registers, looks up, lists, and unregisters by name', () => {
    const reg = new IsolatorRegistry();
    expect(reg.has('docker')).toBe(false);
    reg.register(fakeIsolator('docker'));
    expect(reg.has('docker')).toBe(true);
    expect(reg.get('docker')?.name).toBe('docker');
    expect(reg.list().map((i) => i.name)).toEqual(['docker']);
    reg.unregister('docker');
    expect(reg.has('docker')).toBe(false);
  });

  it('overwrites by name (an isolator may arrive via more than one path)', () => {
    const reg = new IsolatorRegistry();
    const first = fakeIsolator('worker');
    const second = fakeIsolator('worker');
    reg.register(first);
    reg.register(second);
    expect(reg.list()).toHaveLength(1);
    expect(reg.get('worker')).toBe(second);
  });

  it('refuses to let a discovered (untrusted) isolator shadow a trusted builtin', () => {
    const reg = new IsolatorRegistry();
    const trusted = fakeIsolator('worker');
    const rogue = fakeIsolator('worker');
    // Static builtins register as trusted (default).
    expect(reg.register(trusted, { trusted: true })).toBe(true);
    // A discovered plugin contributing the SAME name must not swap the impl the
    // security layer resolves by config — the trusted one stays. register()
    // returns false so the host knows the registration never took effect (and
    // must not track it for rollback / unload).
    expect(reg.register(rogue, { trusted: false })).toBe(false);
    expect(reg.get('worker')).toBe(trusted);
    expect(reg.list()).toHaveLength(1);
  });

  it('returns true when a registration actually takes effect', () => {
    const reg = new IsolatorRegistry();
    expect(reg.register(fakeIsolator('docker'), { trusted: false })).toBe(true);
    expect(reg.register(fakeIsolator('docker'), { trusted: false })).toBe(true); // overwrite still applied
  });

  it('lets a trusted registration still overwrite (builtin re-register / bundled+discovered same role)', () => {
    const reg = new IsolatorRegistry();
    const a = fakeIsolator('subprocess');
    const b = fakeIsolator('subprocess');
    reg.register(a, { trusted: true });
    reg.register(b, { trusted: true });
    expect(reg.get('subprocess')).toBe(b);
  });

  it('allows a discovered isolator with a brand-new name', () => {
    const reg = new IsolatorRegistry();
    const novel = fakeIsolator('docker');
    reg.register(novel, { trusted: false });
    expect(reg.get('docker')).toBe(novel);
  });

  it('has no concept of an active isolator (selection stays with the security layer)', () => {
    const reg = new IsolatorRegistry();
    reg.register(fakeIsolator('wasm'));
    // The registry is a plain collection — merely registering never activates
    // anything; the security layer picks one by `security.isolator` config.
    expect('getActive' in reg).toBe(false);
    expect('setActive' in reg).toBe(false);
  });
});
