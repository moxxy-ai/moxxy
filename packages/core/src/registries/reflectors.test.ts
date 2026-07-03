import { describe, expect, it } from 'vitest';
import type { ReflectorDef } from '@moxxy/sdk';
import { Session, autoAllowResolver, silentLogger } from '../index.js';

function makeSession(): Session {
  return new Session({ cwd: '/tmp', logger: silentLogger, permissionResolver: autoAllowResolver });
}

const def = (name: string): ReflectorDef => ({ name, reflect: async () => [] });

describe('Reflector registry (nullable, no floor)', () => {
  it('starts empty — no core-seeded floor, reflection is off by default', () => {
    const session = makeSession();
    expect(session.reflectors.getActiveName()).toBeNull();
    expect(session.reflectors.getFloorName()).toBeNull();
    expect(session.reflectors.list()).toEqual([]);
    expect(session.reflectors.getActive()).toBeNull();
  });

  it('publishes the registry on the service registry for the driver to resolve', () => {
    const session = makeSession();
    expect(session.services.get('reflectors')).toBe(session.reflectors);
  });

  it('auto-adopts the first registered reflector as active', () => {
    const session = makeSession();
    session.reflectors.register(def('default'));
    expect(session.reflectors.getActiveName()).toBe('default');
    expect(session.reflectors.getActive()?.name).toBe('default');
  });

  it('throws on a duplicate name and swaps via setActive', () => {
    const session = makeSession();
    session.reflectors.register(def('default'));
    expect(() => session.reflectors.register(def('default'))).toThrow(/already registered/);
    session.reflectors.register(def('smart'));
    // Second registration does NOT steal active from the first.
    expect(session.reflectors.getActiveName()).toBe('default');
    session.reflectors.setActive('smart');
    expect(session.reflectors.getActiveName()).toBe('smart');
  });

  it('reverts to null (no floor) when the active reflector is unregistered', () => {
    const session = makeSession();
    session.reflectors.register(def('default'));
    session.reflectors.unregister('default');
    expect(session.reflectors.getActiveName()).toBeNull();
    expect(session.reflectors.getActive()).toBeNull();
  });
});
