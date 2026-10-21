import { describe, expect, it } from 'vitest';
import { localMediaFilePath } from './local-file';

describe('local media paths', () => {
  it('decodes file links using the target platform', () => {
    expect(localMediaFilePath('file:///C:/Users/me/report%20v2.pdf', true)).toBe(
      'C:\\Users\\me\\report v2.pdf',
    );
    expect(localMediaFilePath('file:///Users/me/report%20v2.pdf', false)).toBe('/Users/me/report v2.pdf');
  });
  it('recognizes absolute Windows and POSIX paths', () => {
    expect(localMediaFilePath('C:\\Users\\me\\report.pdf', true)).toBe('C:\\Users\\me\\report.pdf');
    expect(localMediaFilePath('/Users/me/report.pdf', false)).toBe('/Users/me/report.pdf');
  });
  it('rejects remote shares, relative paths and other URL schemes', () => {
    for (const windows of [true, false]) {
      for (const input of [
        'file://server/share/report.pdf',
        '//server/share',
        '\\\\server\\share',
        'relative.pdf',
        'https://example.com/x',
        'javascript:alert(1)',
      ]) {
        expect(localMediaFilePath(input, windows), input).toBeNull();
      }
    }
  });
});
