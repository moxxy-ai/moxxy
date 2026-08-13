import { describe, expect, it } from 'vitest';
import { Session, autoAllowResolver, silentLogger } from '@moxxy/core';
import type { MoxxyConfig } from '@moxxy/config';
import type { ReflectorDef, SynthesizerDef } from '@moxxy/sdk';
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

describe('applyPluginsTree — synthesizer default', () => {
  const synthesizer = (name: string): SynthesizerDef => ({
    name,
    create: () => ({
      name,
      synthesize: async () => ({ audio: new Uint8Array([1]), mimeType: 'audio/wav' }),
    }),
  });

  it('activates the configured synthesizer instead of the first registered plugin', () => {
    const session = makeSession();
    session.synthesizers.register(synthesizer('elevenlabs'));
    session.synthesizers.register(synthesizer('local-piper'));
    const { logger, warns } = warnCollector();
    const config = {
      plugins: { synthesizer: { default: 'local-piper' } },
    } as unknown as MoxxyConfig;

    applyPluginsTree(session, config, logger);

    expect(session.synthesizers.getActiveName()).toBe('local-piper');
    expect(warns).toEqual([]);
  });
});

describe('applyPluginsTree: compactor default and floor', () => {
  const compactor = (name: string) => ({
    name,
    shouldCompact: () => false,
    compact: async () => ({}) as never,
  });

  /** Registration order mirrors a real boot: the floor first, then segments. */
  function sessionWithBothCompactors(): Session {
    const session = makeSession();
    session.compactors.register(compactor('summarize-old-turns'));
    session.compactors.register(compactor('segments'));
    return session;
  }

  it('activates sub-session compaction by default', () => {
    const session = sessionWithBothCompactors();
    const { logger, warns } = warnCollector();
    applyPluginsTree(session, {} as MoxxyConfig, logger);
    // First-registered auto-activation would have left the floor active; the
    // built-in default is what makes long sessions bounded out of the box.
    expect(session.compactors.getActiveName()).toBe('segments');
    expect(warns).toEqual([]);
  });

  it('honours an explicit opt-out back to summarize-old-turns', () => {
    const session = sessionWithBothCompactors();
    const { logger, warns } = warnCollector();
    const config = {
      plugins: { compactor: { default: 'summarize-old-turns' } },
    } as unknown as MoxxyConfig;
    applyPluginsTree(session, config, logger);
    expect(session.compactors.getActiveName()).toBe('summarize-old-turns');
    expect(warns).toEqual([]);
  });

  it('keeps the floor active when only the floor is installed', () => {
    const session = makeSession();
    session.compactors.register(compactor('summarize-old-turns'));
    const { logger, warns } = warnCollector();
    applyPluginsTree(session, {} as MoxxyConfig, logger);
    // A built-in default whose plugin isn't installed is a silent skip.
    expect(session.compactors.getActiveName()).toBe('summarize-old-turns');
    expect(warns).toEqual([]);
  });
});
