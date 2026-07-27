import { describe, it, expect } from 'vitest';
import { PermissionEngine } from '@moxxy/core';
import type { PolicyBundleRule } from '@moxxy/config';

/**
 * The layering `buildSession` relies on when it concatenates config rules and
 * signed-bundle rules into one immutable layer.
 *
 * Concatenating is only safe because the engine checks every deny in the layer
 * before any allow in it, which makes a local operator's deny beat a remote
 * publisher's allow without ranking the two sources against each other. If that
 * order ever changed, a bundle could grant past a local deny, so it is asserted
 * here rather than assumed.
 */
const merge = (
  config: { allow?: PolicyBundleRule[]; deny?: PolicyBundleRule[] },
  bundle: { allow?: PolicyBundleRule[]; deny?: PolicyBundleRule[] },
) => ({
  allow: [...(config.allow ?? []), ...(bundle.allow ?? [])],
  deny: [...(config.deny ?? []), ...(bundle.deny ?? [])],
});

const call = (name: string) => ({ name, input: {} }) as never;

describe('config and bundle rules layered together', () => {
  it('a bundle deny binds', () => {
    const engine = new PermissionEngine();
    engine.setImmutableRules(merge({}, { deny: [{ name: 'Bash', reason: 'corp policy' }] }));

    expect(engine.check(call('Bash'))).toEqual({ mode: 'deny', reason: 'corp policy' });
  });

  it('a local deny beats a bundle allow for the same tool', () => {
    const engine = new PermissionEngine();
    engine.setImmutableRules(
      merge({ deny: [{ name: 'Bash', reason: 'local' }] }, { allow: [{ name: 'Bash' }] }),
    );

    expect(engine.check(call('Bash'))).toEqual({ mode: 'deny', reason: 'local' });
  });

  it('a bundle deny beats a local allow, so subscribing actually restricts', () => {
    const engine = new PermissionEngine();
    engine.setImmutableRules(
      merge({ allow: [{ name: 'Bash' }] }, { deny: [{ name: 'Bash', reason: 'corp' }] }),
    );

    expect(engine.check(call('Bash'))).toEqual({ mode: 'deny', reason: 'corp' });
  });

  it('an allow-always answer cannot remove a bundle deny', async () => {
    const engine = new PermissionEngine();
    engine.setImmutableRules(merge({}, { deny: [{ name: 'Bash' }] }));
    await engine.addAllow({ name: 'Bash' });

    expect(engine.check(call('Bash'))?.mode).toBe('deny');
  });

  it('leaves the engine untouched when no bundle is configured', () => {
    const engine = new PermissionEngine();
    engine.setImmutableRules(merge({}, {}));

    expect(engine.getImmutableRules()).toEqual({ allow: [], deny: [] });
    expect(engine.check(call('Read'))).toBeNull();
  });
});
