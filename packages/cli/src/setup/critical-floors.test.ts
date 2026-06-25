import { describe, expect, it } from 'vitest';
import { Session, autoAllowResolver, silentLogger } from '@moxxy/core';
import { MoxxyError } from '@moxxy/sdk';
import { assertCriticalFloors, markBuiltinFloors } from './apply-plugins-tree.js';
import { isCriticalPackage, CRITICAL_PACKAGES } from './critical-packages.js';
import { buildSetPluginEnabledLive } from './plugin-toggle.js';

function makeSession(): Session {
  const session = new Session({
    cwd: '/tmp',
    logger: silentLogger,
    permissionResolver: autoAllowResolver,
  });
  // Seed the kernel-plugin-contributed defaults the kernel would register.
  session.modes.register({ name: 'default', run: async function* () {} });
  session.compactors.register({
    name: 'summarize',
    shouldCompact: () => false,
    compact: async () => ({}) as never,
  });
  session.cacheStrategies.register({ name: 'stable-prefix', place: () => [] } as never);
  return session;
}

describe('critical packages', () => {
  it('flags the kernel set and nothing else', () => {
    expect(isCriticalPackage('@moxxy/plugin-cli')).toBe(true);
    expect(isCriticalPackage('@moxxy/tools-builtin')).toBe(true);
    expect(isCriticalPackage('@moxxy/mode-default')).toBe(true);
    expect(isCriticalPackage('@moxxy/plugin-telegram')).toBe(false);
    expect(isCriticalPackage('@moxxy/plugin-provider-anthropic')).toBe(false);
    expect(CRITICAL_PACKAGES.has('@moxxy/plugin-plugins-admin')).toBe(true);
  });

  it('refuses to disable a critical package (PLUGIN_PROTECTED)', async () => {
    const session = makeSession();
    const setEnabled = buildSetPluginEnabledLive({
      session,
      disabledPackages: new Set<string>(),
      getEntries: () => [],
    });
    await expect(setEnabled('@moxxy/tools-builtin', false)).rejects.toMatchObject({
      code: 'PLUGIN_PROTECTED',
    });
    await expect(setEnabled('@moxxy/tools-builtin', false)).rejects.toBeInstanceOf(MoxxyError);
  });
});

describe('critical floors', () => {
  it('passes when every non-nullable slot has an active def', () => {
    const session = makeSession();
    markBuiltinFloors(session);
    expect(() => assertCriticalFloors(session)).not.toThrow();
    // The kernel-plugin floors were marked, so a swap-then-remove reverts here.
    session.compactors.register({
      name: 'other',
      shouldCompact: () => false,
      compact: async () => ({}) as never,
    });
    session.compactors.setActive('other');
    session.compactors.unregister('other');
    expect(session.compactors.getActiveName()).toBe('summarize');
  });

  it('throws when a non-nullable floor is missing', () => {
    const session = new Session({
      cwd: '/tmp',
      logger: silentLogger,
      permissionResolver: autoAllowResolver,
    });
    // No mode/compactor/cacheStrategy registered → those floors are empty.
    expect(() => assertCriticalFloors(session)).toThrow(/Critical floor missing/);
  });
});
