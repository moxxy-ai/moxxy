import { describe, expect, it, vi } from 'vitest';
import { formatChord, isEditableTarget, matchesChord, parseChord } from './chord';
import { HotkeyRegistry, type HotkeyBinding } from './registry';

function key(k: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) {
  return {
    key: k,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  };
}

function binding(over: Partial<HotkeyBinding> & { id: string; chord: string }): HotkeyBinding {
  return { label: 'x', group: 'g', run: () => {}, ...over };
}

describe('parseChord', () => {
  it('parses modifiers and the key', () => {
    expect(parseChord('mod+shift+n')).toEqual({ key: 'n', mod: true, alt: false, shift: true });
    expect(parseChord('escape')).toEqual({ key: 'escape', mod: false, alt: false, shift: false });
  });

  it('rejects a typo instead of silently never firing', () => {
    expect(() => parseChord('cmd+k')).toThrow(/unknown hotkey modifier/);
    expect(() => parseChord('mod+')).toThrow(/empty segment/);
    expect(() => parseChord('mod+shift')).toThrow(/no key/);
  });
});

describe('matchesChord', () => {
  it('accepts either platform modifier for `mod`', () => {
    const chord = parseChord('mod+k');
    expect(matchesChord(key('k', { metaKey: true }), chord)).toBe(true);
    expect(matchesChord(key('k', { ctrlKey: true }), chord)).toBe(true);
    expect(matchesChord(key('k'), chord)).toBe(false);
  });

  it('requires an EXACT modifier match, so ⌘⇧N never fires ⌘N', () => {
    const modN = parseChord('mod+n');
    expect(matchesChord(key('n', { metaKey: true, shiftKey: true }), modN)).toBe(false);
    expect(matchesChord(key('n', { metaKey: true, altKey: true }), modN)).toBe(false);
    expect(matchesChord(key('n', { metaKey: true }), modN)).toBe(true);
  });

  it('is case-insensitive about the key the browser reports', () => {
    expect(matchesChord(key('K', { metaKey: true }), parseChord('mod+k'))).toBe(true);
  });
});

describe('formatChord', () => {
  it('renders platform-appropriate labels', () => {
    expect(formatChord(parseChord('mod+shift+k'), true)).toBe('⌘⇧K');
    expect(formatChord(parseChord('mod+shift+k'), false)).toBe('Ctrl+Shift+K');
    expect(formatChord(parseChord('mod+alt+arrowdown'), true)).toBe('⌘⌥↓');
    expect(formatChord(parseChord('escape'), false)).toBe('Esc');
  });
});

describe('isEditableTarget', () => {
  it('recognizes every text-entry surface from the canonical hotkey helper', () => {
    const make = (tag: string): HTMLElement => document.createElement(tag);
    expect(isEditableTarget(make('input'))).toBe(true);
    expect(isEditableTarget(make('textarea'))).toBe(true);
    expect(isEditableTarget(make('select'))).toBe(true);
    expect(isEditableTarget(make('div'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    const contentEditable = make('div');
    Object.defineProperty(contentEditable, 'isContentEditable', { value: true });
    expect(isEditableTarget(contentEditable)).toBe(true);
  });
});

describe('HotkeyRegistry', () => {
  it('resolves a registered chord and drops it on unregister', () => {
    const registry = new HotkeyRegistry();
    const dispose = registry.register(binding({ id: 'a', chord: 'mod+k' }));
    expect(registry.resolve(key('k', { metaKey: true }), null)?.id).toBe('a');
    dispose();
    expect(registry.resolve(key('k', { metaKey: true }), null)).toBeNull();
  });

  it('skips disabled bindings', () => {
    const registry = new HotkeyRegistry();
    registry.register(binding({ id: 'a', chord: 'mod+k', disabled: true }));
    expect(registry.resolve(key('k', { metaKey: true }), null)).toBeNull();
  });

  it('lets a higher-priority binding shadow a global one', () => {
    const registry = new HotkeyRegistry();
    registry.register(binding({ id: 'global', chord: 'mod+k' }));
    registry.register(binding({ id: 'overlay', chord: 'mod+k', priority: 100 }));
    expect(registry.resolve(key('k', { metaKey: true }), null)?.id).toBe('overlay');
  });

  it('does not fire an unmodified chord while the user is typing', () => {
    const registry = new HotkeyRegistry();
    registry.register(binding({ id: 'esc', chord: 'escape' }));
    const input = document.createElement('input');
    expect(registry.resolve(key('escape'), input)).toBeNull();
    expect(registry.resolve(key('escape'), document.createElement('div'))).not.toBeNull();
  });

  it('fires a modified chord while typing, unless opted out', () => {
    const registry = new HotkeyRegistry();
    registry.register(binding({ id: 'palette', chord: 'mod+k' }));
    registry.register(binding({ id: 'bold', chord: 'mod+b', allowInEditable: false }));
    const textarea = document.createElement('textarea');
    expect(registry.resolve(key('k', { metaKey: true }), textarea)?.id).toBe('palette');
    expect(registry.resolve(key('b', { metaKey: true }), textarea)).toBeNull();
  });

  it('replaces a binding re-registered under the same id', () => {
    const registry = new HotkeyRegistry();
    const first = vi.fn();
    const second = vi.fn();
    registry.register(binding({ id: 'a', chord: 'mod+k', run: first }));
    registry.register(binding({ id: 'a', chord: 'mod+k', run: second }));
    registry.resolve(key('k', { metaKey: true }), null)?.run();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(registry.list()).toHaveLength(1);
  });

  it('hands out a stable snapshot until something changes', () => {
    const registry = new HotkeyRegistry();
    registry.register(binding({ id: 'a', chord: 'mod+k' }));
    const first = registry.list();
    expect(registry.list()).toBe(first);
    registry.register(binding({ id: 'b', chord: 'mod+j' }));
    expect(registry.list()).not.toBe(first);
  });
});
