import { describe, expect, it } from 'vitest';
import type { MoxxyConfig } from './schema.js';
import { lockedKeysOf, stripLockedKeys, systemConfigCandidates } from './system-scope.js';

describe('systemConfigCandidates', () => {
  it('honours an explicit override above the conventional paths', () => {
    expect(systemConfigCandidates({ MOXXY_SYSTEM_CONFIG: '/opt/moxxy.yaml' }, 'linux')).toEqual([
      '/opt/moxxy.yaml',
    ]);
  });

  it('falls back to /etc on posix', () => {
    expect(systemConfigCandidates({}, 'darwin')).toEqual([
      '/etc/moxxy/config.yaml',
      '/etc/moxxy/config.yml',
    ]);
  });

  it('uses PROGRAMDATA on windows', () => {
    const found = systemConfigCandidates({ PROGRAMDATA: 'C:\\ProgramData' }, 'win32');
    expect(found[0]).toContain('moxxy');
    expect(found).toHaveLength(2);
  });

  it('yields nothing on windows without PROGRAMDATA rather than guessing', () => {
    expect(systemConfigCandidates({}, 'win32')).toEqual([]);
  });
});

describe('lockedKeysOf', () => {
  it('reads the declared dot-paths', () => {
    const cfg = { locked: ['security.enabled', 'network.proxy'] } as MoxxyConfig;
    expect(lockedKeysOf(cfg)).toEqual(['security.enabled', 'network.proxy']);
  });

  it('is empty for a config that declares none', () => {
    expect(lockedKeysOf({} as MoxxyConfig)).toEqual([]);
    expect(lockedKeysOf(undefined)).toEqual([]);
  });

  it('drops non-string entries', () => {
    const cfg = { locked: ['ok', 42, ''] } as unknown as MoxxyConfig;
    expect(lockedKeysOf(cfg)).toEqual(['ok']);
  });
});

describe('stripLockedKeys', () => {
  it('removes a locked leaf and reports the attempt', () => {
    const user = { security: { enabled: false, strict: true } } as MoxxyConfig;
    const { config, overrides } = stripLockedKeys(user, ['security.enabled'], 'user');
    expect(config.security).toEqual({ strict: true });
    expect(overrides).toEqual([{ key: 'security.enabled', scope: 'user' }]);
  });

  // Locking a whole subtree must take the siblings with it, otherwise a user
  // layer keeps contributing under a parent the operator meant to pin whole.
  it('removes a locked subtree entirely', () => {
    const user = { network: { proxy: 'http://mine:1', noProxy: 'x' } } as MoxxyConfig;
    const { config } = stripLockedKeys(user, ['network'], 'project');
    expect(config.network).toBeUndefined();
  });

  it('prunes a parent left empty by the strip', () => {
    const user = { security: { enabled: false } } as MoxxyConfig;
    const { config } = stripLockedKeys(user, ['security.enabled'], 'user');
    expect('security' in config).toBe(false);
  });

  it('reports nothing when the layer never set the locked key', () => {
    const user = { maxIterations: 5 } as MoxxyConfig;
    const { config, overrides } = stripLockedKeys(user, ['security.enabled'], 'user');
    expect(overrides).toEqual([]);
    expect(config).toEqual(user);
  });

  it('does not mutate its input', () => {
    const user = { security: { enabled: false } } as MoxxyConfig;
    stripLockedKeys(user, ['security.enabled'], 'user');
    expect(user.security?.enabled).toBe(false);
  });

  it('is a no-op with no locked keys', () => {
    const user = { security: { enabled: false } } as MoxxyConfig;
    expect(stripLockedKeys(user, [], 'user').config).toBe(user);
  });

  // A missing intermediate must not throw the whole load.
  it('tolerates a dot-path whose parent is absent or not an object', () => {
    const user = { maxIterations: 5 } as MoxxyConfig;
    expect(() => stripLockedKeys(user, ['a.b.c', 'maxIterations.deep'], 'user')).not.toThrow();
  });

  it('handles prototype-shaped locked paths without changing object prototypes', () => {
    const user = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"name":"mine"}}') as MoxxyConfig;
    const { config, overrides } = stripLockedKeys(user, ['__proto__.polluted', 'constructor.name'], 'user');
    expect(overrides).toEqual([
      { key: '__proto__.polluted', scope: 'user' },
      { key: 'constructor.name', scope: 'user' },
    ]);
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(Object.prototype).not.toHaveProperty('name', 'mine');
    expect(Object.prototype.hasOwnProperty.call(config, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(config, 'constructor')).toBe(false);
  });
});
