import { describe, expect, it } from 'vitest';
import { defineMode } from '@moxxy/sdk';
import { ModeRegistry } from './modes.js';

const mode = (name: string) => defineMode({ name, run: async function* () {} });

describe('ModeRegistry legacy-name migration', () => {
  it('resolves a legacy mode name to the current one on setActive', () => {
    const reg = new ModeRegistry();
    reg.register(mode('default'));
    reg.register(mode('research'));

    // Old names persisted in config/preferences/RPCs must not crash.
    reg.setActive('tool-use');
    expect(reg.getActive().name).toBe('default');

    reg.setActive('deep-research');
    expect(reg.getActive().name).toBe('research');

    // Removed modes fall back to the default mode rather than throwing.
    reg.setActive('plan-execute');
    expect(reg.getActive().name).toBe('default');
  });

  it('still throws on a genuinely unknown mode (not a known legacy name)', () => {
    const reg = new ModeRegistry();
    reg.register(mode('default'));
    expect(() => reg.setActive('totally-made-up')).toThrow(/Mode not registered: totally-made-up/);
  });

  it('passes a current name through unchanged', () => {
    const reg = new ModeRegistry();
    reg.register(mode('default'));
    reg.register(mode('goal'));
    reg.setActive('goal');
    expect(reg.getActive().name).toBe('goal');
  });
});
