import { MoxxyError } from '@moxxy/sdk';
import { describe, expect, it } from 'vitest';
import { buildKeyScript } from './key.js';
import { toAppleScriptString } from './type.js';

describe('toAppleScriptString', () => {
  it('wraps a plain string in quotes', () => {
    expect(toAppleScriptString('hello')).toBe('"hello"');
  });

  it('escapes embedded double-quotes and backslashes', () => {
    // `a"b` -> a\"b ; backslashes are doubled.
    expect(toAppleScriptString('a"b')).toBe('"a\\"b"');
    expect(toAppleScriptString('a\\b')).toBe('"a\\\\b"');
    // A backslash followed by a quote: both escaped, order preserved.
    expect(toAppleScriptString('\\"')).toBe('"\\\\\\""');
  });

  it('splits newlines into separate literals joined by AppleScript return', () => {
    expect(toAppleScriptString('a\nb')).toBe('"a" & return & "b"');
    expect(toAppleScriptString('one\ntwo\nthree')).toBe(
      '"one" & return & "two" & return & "three"',
    );
  });
});

describe('buildKeyScript', () => {
  it('uses key code for named keys with no modifiers', () => {
    expect(buildKeyScript('return', [])).toBe('tell application "System Events" to key code 36');
    expect(buildKeyScript('escape', [])).toBe('tell application "System Events" to key code 53');
  });

  it('is case-insensitive for named keys', () => {
    expect(buildKeyScript('Return', [])).toBe('tell application "System Events" to key code 36');
  });

  it('appends a using-clause mapping short modifier names to AppleScript', () => {
    expect(buildKeyScript('return', ['cmd'])).toBe(
      'tell application "System Events" to key code 36 using {command down}',
    );
    expect(buildKeyScript('c', ['cmd', 'shift'])).toBe(
      'tell application "System Events" to keystroke "c" using {command down, shift down}',
    );
    expect(buildKeyScript('a', ['option', 'control'])).toBe(
      'tell application "System Events" to keystroke "a" using {option down, control down}',
    );
  });

  it('uses keystroke for single characters and escapes them', () => {
    expect(buildKeyScript('/', [])).toBe('tell application "System Events" to keystroke "/"');
    expect(buildKeyScript('"', [])).toBe('tell application "System Events" to keystroke "\\""');
  });

  it('throws a TOOL_ERROR for an unknown multi-char key', () => {
    expect(() => buildKeyScript('notakey', [])).toThrow(MoxxyError);
    try {
      buildKeyScript('notakey', []);
    } catch (err) {
      expect((err as MoxxyError).code).toBe('TOOL_ERROR');
      expect((err as MoxxyError).message).toContain('unknown key "notakey"');
    }
  });
});
