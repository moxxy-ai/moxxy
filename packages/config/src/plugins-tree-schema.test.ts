import { describe, expect, it } from 'vitest';
import { PLUGIN_CATEGORY_KEYS, pluginsTreeSchema } from './plugins-tree-schema.js';

describe('plugins-tree schema — reflector category', () => {
  it('lists reflector as an active-def category key', () => {
    expect(PLUGIN_CATEGORY_KEYS).toContain('reflector');
  });

  it('round-trips plugins.reflector.default', () => {
    const tree = { reflector: { default: 'default' } };
    const parsed = pluginsTreeSchema.parse(tree);
    expect(parsed.reflector?.default).toBe('default');
  });

  it('accepts a per-item option bag on the reflector slot', () => {
    const parsed = pluginsTreeSchema.parse({
      reflector: { default: 'default', items: { default: { window: 'session' } } },
    });
    expect(parsed.reflector?.items?.default).toEqual({ window: 'session' });
  });

  it('rejects an unknown key inside the reflector slot (.strict())', () => {
    expect(() => pluginsTreeSchema.parse({ reflector: { nope: true } })).toThrow();
  });
});
