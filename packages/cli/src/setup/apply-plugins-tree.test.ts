import { describe, expect, it } from 'vitest';
import { Session, autoAllowResolver, silentLogger } from '@moxxy/core';
import type { MoxxyConfig } from '@moxxy/config';
import type { ReflectorDef } from '@moxxy/sdk';
import { defineMode } from '@moxxy/sdk';
import { applyPluginsTree } from './apply-plugins-tree.js';

function makeSession(): Session {
  return new Session({ cwd: '/tmp', logger: silentLogger, permissionResolver: autoAllowResolver });
}

const def = (name: string): ReflectorDef => ({ name, reflect: async () => [] });

function warnCollector(): { logger: { warn: (m: string, meta?: unknown) => void }; warns: string[] } {
  const warns: string[] = [];
  return { logger: { warn: (m: string) => void warns.push(m) }, warns };
}

describe('applyPluginsTree — reflector (nullable active-def kind)', () => {
  it('leaves reflection off when no default is configured and none registered', () => {
    const session = makeSession();
    const { logger, warns } = warnCollector();
    applyPluginsTree(session, {} as MoxxyConfig, logger);
    expect(session.reflectors.getActiveName()).toBeNull();
    expect(warns).toEqual([]);
  });

  it('activates an explicit reflector default that is registered', () => {
    const session = makeSession();
    session.reflectors.register(def('default'));
    session.reflectors.register(def('smart'));
    const { logger } = warnCollector();
    const config = { plugins: { reflector: { default: 'smart' } } } as unknown as MoxxyConfig;
    applyPluginsTree(session, config, logger);
    expect(session.reflectors.getActiveName()).toBe('smart');
  });

  it('warns-and-skips an explicit reflector default that is not registered', () => {
    const session = makeSession();
    const { logger, warns } = warnCollector();
    const config = { plugins: { reflector: { default: 'ghost' } } } as unknown as MoxxyConfig;
    applyPluginsTree(session, config, logger);
    // No floor to fall back to — stays null rather than throwing at boot.
    expect(session.reflectors.getActiveName()).toBeNull();
    expect(warns.some((w) => w.includes('reflector') && w.includes('ghost'))).toBe(true);
  });
});

describe('applyPluginsTree — transient modes are refused as the boot default', () => {
  const mode = (name: string, transient?: boolean) =>
    defineMode({ name, ...(transient ? { transient } : {}), run: async function* () {} });

  it('warns-and-keeps the protected default when the configured mode is transient', () => {
    // A leftover `plugins.mode.default: goal` (written before transient modes
    // stopped being persisted) must not boot every session straight into an
    // autonomous, auto-approving run.
    const session = makeSession();
    session.modes.register(mode('default'));
    session.modes.register(mode('goal', true));
    const { logger, warns } = warnCollector();
    const config = { plugins: { mode: { default: 'goal' } } } as unknown as MoxxyConfig;
    applyPluginsTree(session, config, logger);
    expect(session.modes.getActiveName()).toBe('default');
    expect(warns.some((w) => w.includes('transient'))).toBe(true);
  });

  it('still applies a non-transient configured mode', () => {
    const session = makeSession();
    session.modes.register(mode('default'));
    session.modes.register(mode('research'));
    const { logger, warns } = warnCollector();
    const config = { plugins: { mode: { default: 'research' } } } as unknown as MoxxyConfig;
    applyPluginsTree(session, config, logger);
    expect(session.modes.getActiveName()).toBe('research');
    expect(warns).toEqual([]);
  });
});
