import { describe, expect, it, vi } from 'vitest';
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

  it('notifies onActiveChange when the ACTIVE mode def is replaced in place', () => {
    // u42-3: a hot-reloaded active mode must tell observers its behaviour
    // swapped, even though the active name is unchanged.
    const reg = new ModeRegistry();
    reg.register(mode('default')); // auto-active
    let fired = 0;
    reg.onActiveChange(() => {
      fired += 1;
    });
    const replacement = mode('default');
    reg.replace(replacement);
    expect(fired).toBe(1);
    // getActive() returns the new def reference.
    expect(reg.getActive()).toBe(replacement);
  });

  it('does NOT notify onActiveChange when replacing a NON-active mode', () => {
    const reg = new ModeRegistry();
    reg.register(mode('default')); // auto-active
    reg.register(mode('goal'));
    let fired = 0;
    reg.onActiveChange(() => {
      fired += 1;
    });
    reg.replace(mode('goal')); // not the active mode
    expect(fired).toBe(0);
  });

  it('isolates a throwing change listener so register/setActive never aborts', () => {
    const reg = new ModeRegistry();
    const after = vi.fn();
    reg.onActiveChange(() => {
      throw new Error('observer down (e.g. dead socket on InfoChanged)');
    });
    reg.onActiveChange(after);
    // A throwing observer must NOT abort the remaining listeners nor unwind into
    // the registration that triggered the notification.
    expect(() => reg.register(mode('default'))).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    expect(reg.getActive().name).toBe('default');

    // Same isolation on an explicit setActive (mode switch).
    reg.register(mode('goal'));
    after.mockClear();
    expect(() => reg.setActive('goal')).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });
});

describe('ModeRegistry previous-mode tracking', () => {
  it('records the previously active mode across switches', () => {
    const reg = new ModeRegistry();
    reg.register(mode('default')); // auto-active, no previous
    expect(reg.getPreviousActiveName()).toBeNull();

    reg.register(mode('goal'));
    reg.setActive('goal');
    expect(reg.getPreviousActiveName()).toBe('default');

    // Reverting (a transient mode handing back) updates previous too.
    reg.setActive('default');
    expect(reg.getPreviousActiveName()).toBe('goal');
  });

  it('a same-name setActive does not clobber the previous mode', () => {
    const reg = new ModeRegistry();
    reg.register(mode('default'));
    reg.register(mode('goal'));
    reg.setActive('goal');
    // Re-arming goal (e.g. /goal twice in a row) keeps 'default' as the mode
    // to hand back to — activate() early-returns on the name match.
    reg.setActive('goal');
    expect(reg.getPreviousActiveName()).toBe('default');
  });
});
