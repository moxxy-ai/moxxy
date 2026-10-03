import { describe, expect, it } from 'vitest';
import { utf8Locale } from './locale.js';

describe('utf8Locale', () => {
  it('gives a GUI-launched runner on macOS a UTF-8 character type, so pbcopy keeps Polish letters', () => {
    expect(utf8Locale({}, 'darwin')).toEqual({ LC_CTYPE: 'en_US.UTF-8' });
  });

  it('uses the C.UTF-8 locale on Linux, where en_US may not be installed', () => {
    expect(utf8Locale({ LANG: '' }, 'linux')).toEqual({ LC_CTYPE: 'C.UTF-8' });
  });

  it('treats the C and POSIX locales as unset', () => {
    expect(utf8Locale({ LANG: 'C' }, 'darwin')).toEqual({ LC_CTYPE: 'en_US.UTF-8' });
    expect(utf8Locale({ LC_CTYPE: 'POSIX' }, 'darwin')).toEqual({ LC_CTYPE: 'en_US.UTF-8' });
  });

  it('leaves a locale that already speaks UTF-8 alone', () => {
    expect(utf8Locale({ LANG: 'pl_PL.UTF-8' }, 'darwin')).toEqual({});
    expect(utf8Locale({ LC_CTYPE: 'UTF-8' }, 'darwin')).toEqual({});
    expect(utf8Locale({ LC_ALL: 'en_US.utf8' }, 'linux')).toEqual({});
  });

  it('respects a non-UTF-8 locale the user chose on purpose', () => {
    expect(utf8Locale({ LANG: 'pl_PL.ISO8859-2' }, 'darwin')).toEqual({});
  });

  it('changes nothing on Windows, which has no POSIX locale variables', () => {
    expect(utf8Locale({}, 'win32')).toEqual({});
  });
});
