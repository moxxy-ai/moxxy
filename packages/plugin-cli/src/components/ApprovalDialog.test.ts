import { describe, expect, it } from 'vitest';
import { jkScrolls, sanitizeEntry } from './ApprovalDialog.js';

const MAX = 20; // mirrors MAX_BODY_LINES

describe('ApprovalDialog sanitizeEntry (multi-line paste must not corrupt the single-line reply)', () => {
  it('collapses embedded newlines / CR to spaces', () => {
    expect(sanitizeEntry('line one\nline two')).toBe('line one line two');
    expect(sanitizeEntry('a\r\nb')).toBe('a b');
    expect(sanitizeEntry('a\rb')).toBe('a b');
  });

  it('result never contains a raw newline or carriage return', () => {
    const out = sanitizeEntry('don\'t write\nso many\r\ndocs\n');
    expect(out).not.toMatch(/[\r\n]/);
  });

  it('strips the other control bytes (tab/backspace/del) as before', () => {
    expect(sanitizeEntry('a\tb\x08\x7fc')).toBe('abc');
  });

  it('leaves ordinary single-line input untouched', () => {
    expect(sanitizeEntry('approve please')).toBe('approve please');
  });
});

describe('ApprovalDialog jkScrolls (u74-3: j/k must not shadow an option hotkey)', () => {
  it('scrolls on j/k when the body overflows and no option claims the letter', () => {
    expect(jkScrolls('j', MAX + 5, [{ hotkey: 'y' }, { hotkey: 'n' }])).toBe(true);
    expect(jkScrolls('k', MAX + 5, [{ hotkey: 'y' }, { hotkey: 'n' }])).toBe(true);
  });

  it('does NOT scroll when the body fits (so j/k can still hit a hotkey/no-op cleanly)', () => {
    expect(jkScrolls('j', MAX, [{ hotkey: 'a' }])).toBe(false);
    expect(jkScrolls('k', 3, [{ hotkey: 'a' }])).toBe(false);
  });

  it('yields to an option whose hotkey is the scroll letter, even when the body overflows', () => {
    // The previously-unreachable case: an overflowing body + an option bound to 'j'.
    expect(jkScrolls('j', MAX + 50, [{ hotkey: 'j' }, { hotkey: 'n' }])).toBe(false);
    expect(jkScrolls('k', MAX + 50, [{ hotkey: 'k' }])).toBe(false);
    // The other letter still scrolls.
    expect(jkScrolls('k', MAX + 50, [{ hotkey: 'j' }, { hotkey: 'n' }])).toBe(true);
  });
});
