import { describe, expect, it } from 'vitest';
import { clipboardFlagsFor, formatChord, isSystemKeyCombo, parseKeyCombo } from './keys.js';

describe('parseKeyCombo (xdotool syntax)', () => {
  it.each([
    ['Return', [], 'enter'],
    ['Tab', [], 'tab'],
    ['BackSpace', [], 'backspace'],
    ['Delete', [], 'forward_delete'],
    ['Up', [], 'up'],
    ['Page_Down', [], 'page_down'],
    ['ArrowDown', [], 'down'],
    ['shift+ArrowLeft', ['shift'], 'left'],
    ['Next', [], 'page_down'],
    ['F12', [], 'f12'],
    ['KP_0', [], 'numpad_0'],
    ['KP_Enter', [], 'numpad_enter'],
    ['space', [], 'space'],
    ['comma', [], ','],
    ['a', [], 'a'],
    ['A', [], 'A'],
    ['+', [], '+'],
  ])('%s is one neutral key', (text, modifiers, key) => {
    expect(parseKeyCombo(text)).toEqual({ modifiers, key });
  });

  it('maps super, cmd and windows to the platform meta key and orders modifiers', () => {
    expect(parseKeyCombo('super+c')).toEqual({ modifiers: ['meta'], key: 'c' });
    expect(parseKeyCombo('cmd+shift+z')).toEqual({ modifiers: ['shift', 'meta'], key: 'z' });
    expect(parseKeyCombo('shift+Control_L+alt+Tab')).toEqual({ modifiers: ['ctrl', 'alt', 'shift'], key: 'tab' });
    expect(parseKeyCombo('win+r')).toEqual({ modifiers: ['meta'], key: 'r' });
  });

  it('treats a letter under a modifier as the key, not its capital', () => {
    expect(parseKeyCombo('super+C')).toEqual({ modifiers: ['meta'], key: 'c' });
  });

  it('reads a trailing plus as the plus key', () => {
    expect(parseKeyCombo('ctrl++')).toEqual({ modifiers: ['ctrl'], key: '+' });
  });

  it('accepts modifiers alone for holding', () => {
    expect(parseKeyCombo('shift')).toEqual({ modifiers: ['shift'], key: null });
  });

  it.each([
    ['', /empty/],
    ['ctrl+a+b', /one key/],
    ['Foo_Bar', /unknown key "Foo_Bar"/],
    ['ctrl+', /empty/],
  ])('rejects %j', (text, message) => {
    expect(() => parseKeyCombo(text)).toThrow(message);
  });

  it('carries the invalid_key code', () => {
    expect(() => parseKeyCombo('Nope_Key')).toThrow(expect.objectContaining({ code: 'invalid_key' }));
  });
});

describe('formatChord', () => {
  it('writes the canonical modifier order', () => {
    expect(formatChord(parseKeyCombo('shift+ctrl+Tab'))).toBe('ctrl+shift+tab');
    expect(formatChord(parseKeyCombo('alt'))).toBe('alt');
  });
});

describe('isSystemKeyCombo', () => {
  it.each([
    ['super+q', 'darwin', true],
    ['cmd+Tab', 'darwin', true],
    ['super+space', 'darwin', true],
    ['super+c', 'darwin', false],
    ['Return', 'darwin', false],
    ['alt+F4', 'win32', true],
    ['ctrl+alt+Delete', 'win32', true],
    ['super+l', 'win32', true],
    ['ctrl+c', 'win32', false],
    ['alt+F4', 'linux', true],
    ['alt+Tab', 'linux', true],
    ['ctrl+alt+F2', 'linux', true],
    ['super+l', 'linux', true],
    ['ctrl+c', 'linux', false],
    ['ctrl+t', 'linux', false],
  ] as const)('%s on %s → %s', (text, platform, expected) => {
    expect(isSystemKeyCombo(parseKeyCombo(text), platform)).toBe(expected);
  });
});

describe('clipboardFlagsFor', () => {
  it.each([
    ['super+v', ['clipboardRead']],
    ['ctrl+v', ['clipboardRead']],
    ['super+c', ['clipboardWrite']],
    ['ctrl+x', ['clipboardWrite']],
    ['shift+Insert', ['clipboardRead']],
    ['ctrl+Insert', ['clipboardWrite']],
    ['shift+Delete', ['clipboardWrite']],
    ['Return', []],
    ['v', []],
  ])('%s needs %j', (text, flags) => {
    expect(clipboardFlagsFor(parseKeyCombo(text))).toEqual(flags);
  });
});
