import { describe, expect, it } from 'vitest';
import { jkScrolls } from './ApprovalDialog.js';

const MAX = 20; // mirrors MAX_BODY_LINES

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
