import { describe, expect, it } from 'vitest';
import { matchEscape, type EscapeMatch } from './escape.js';

const ESC = '\x1b';

describe('matchEscape — kitty keyboard protocol (CSI <code>;<mods> u)', () => {
  // len always counts the leading ESC (1 char) plus the rest of the sequence.
  it('Shift+Enter (CSI 13;2 u) → alt-enter (newline insert)', () => {
    expect(matchEscape(`${ESC}[13;2u`)).toEqual<EscapeMatch>({ action: 'alt-enter', len: 7 });
  });

  it('any modified Enter (modifiers>1) → alt-enter', () => {
    expect(matchEscape(`${ESC}[13;5u`)).toMatchObject({ action: 'alt-enter' });
    // plain Enter is keycode 13 with modifiers=1 → not alt-enter, falls through
    // to the "unhandled kitty key" consume branch (ESC + "[13u" = 5 chars).
    // Consumed as a NOOP (not esc-clear) so an unknown key can't wipe input.
    expect(matchEscape(`${ESC}[13u`)).toMatchObject({ action: 'noop', len: 5 });
  });

  it('Shift+Tab (CSI 9;2 u) → shift-tab', () => {
    expect(matchEscape(`${ESC}[9;2u`)).toEqual<EscapeMatch>({ action: 'shift-tab', len: 6 });
  });

  it('Ctrl+letter (modifiers=5) → command-hotkey with lowercased letter', () => {
    // keycode 65 = 'A', ctrl modifier value is 5.
    expect(matchEscape(`${ESC}[65;5u`)).toEqual<EscapeMatch>({
      action: 'command-hotkey',
      letter: 'a',
      len: 7,
    });
    // lowercase keycode passes through unchanged
    expect(matchEscape(`${ESC}[122;5u`)).toEqual<EscapeMatch>({
      action: 'command-hotkey',
      letter: 'z',
      len: 8,
    });
  });

  it('a kitty key we do not handle is consumed as a noop (not rendered as junk, not a clear)', () => {
    // keycode 99 ('c') with no modifier → no special handling → consume.
    expect(matchEscape(`${ESC}[99u`)).toMatchObject({ action: 'noop', len: 5 });
  });
});

describe('matchEscape — legacy CSI arrows / nav', () => {
  const cases: ReadonlyArray<[string, EscapeMatch]> = [
    [`${ESC}[A`, { action: 'up', len: 3 }],
    [`${ESC}[B`, { action: 'down', len: 3 }],
    [`${ESC}[C`, { action: 'right', len: 3 }],
    [`${ESC}[D`, { action: 'left', len: 3 }],
    [`${ESC}[H`, { action: 'home', len: 3 }],
    [`${ESC}[F`, { action: 'end', len: 3 }],
    [`${ESC}[Z`, { action: 'shift-tab', len: 3 }],
    [`${ESC}[3~`, { action: 'delete', len: 4 }],
    [`${ESC}[1~`, { action: 'home', len: 4 }],
    [`${ESC}[7~`, { action: 'home', len: 4 }],
    [`${ESC}[4~`, { action: 'end', len: 4 }],
    [`${ESC}[8~`, { action: 'end', len: 4 }],
    [`${ESC}[1;3D`, { action: 'word-left', len: 6 }],
    [`${ESC}[1;5D`, { action: 'word-left', len: 6 }],
    [`${ESC}[1;3C`, { action: 'word-right', len: 6 }],
    [`${ESC}[1;5C`, { action: 'word-right', len: 6 }],
    [`${ESC}[1;3A`, { action: 'up', len: 6 }],
    [`${ESC}[1;3B`, { action: 'down', len: 6 }],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${expected.action}`, () => {
      expect(matchEscape(input)).toEqual(expected);
    });
  }
});

describe('matchEscape — SS3, meta, and edge cases', () => {
  it('SS3 home/end', () => {
    expect(matchEscape(`${ESC}OH`)).toEqual<EscapeMatch>({ action: 'home', len: 3 });
    expect(matchEscape(`${ESC}OF`)).toEqual<EscapeMatch>({ action: 'end', len: 3 });
    // Unknown SS3 is consumed as a noop (not a clear).
    expect(matchEscape(`${ESC}OP`)).toMatchObject({ action: 'noop', len: 3 });
  });

  it('meta+b / meta+f → word motion; meta+DEL → word-back-delete', () => {
    expect(matchEscape(`${ESC}b`)).toEqual<EscapeMatch>({ action: 'word-left', len: 2 });
    expect(matchEscape(`${ESC}f`)).toEqual<EscapeMatch>({ action: 'word-right', len: 2 });
    expect(matchEscape(`${ESC}\x7f`)).toEqual<EscapeMatch>({ action: 'word-back-delete', len: 2 });
  });

  it('alt+enter via meta CR/LF', () => {
    expect(matchEscape(`${ESC}\r`)).toEqual<EscapeMatch>({ action: 'alt-enter', len: 2 });
    expect(matchEscape(`${ESC}\n`)).toEqual<EscapeMatch>({ action: 'alt-enter', len: 2 });
  });

  it('a bare ESC with no following byte returns null (awaits more data)', () => {
    // The `rest.length < 2` guard fires before the standalone-ESC branch, so a
    // lone ESC byte is treated as an incomplete sequence, not a clear.
    expect(matchEscape(ESC)).toBeNull();
  });

  it('ESC ESC consumes one ESC and clears', () => {
    expect(matchEscape(`${ESC}${ESC}`)).toEqual<EscapeMatch>({ action: 'esc-clear', len: 1 });
  });

  it('unknown CSI is consumed (noop) up to the final-byte terminator', () => {
    // CSI 200~ (bracketed paste marker is two-digit; use an unrecognized but
    // terminated sequence). `\x1b[99;99X` ends at the 'X' final byte.
    // Consumed as a noop (not esc-clear) so a fancy-terminal key can't wipe
    // a half-typed prompt.
    const seq = `${ESC}[99;99X`;
    expect(matchEscape(seq)).toMatchObject({ action: 'noop', len: seq.length });
  });

  it('an incomplete CSI (no terminator yet) returns null to await more data', () => {
    expect(matchEscape(`${ESC}[`)).toBeNull();
    expect(matchEscape(`${ESC}[12`)).toBeNull();
  });

  it('an incomplete SS3 returns null', () => {
    expect(matchEscape(`${ESC}O`)).toBeNull();
  });
});
