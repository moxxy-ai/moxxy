import { describe, expect, it } from 'vitest';
import { folderName } from './folder-name';

describe('folderName', () => {
  it('names a folder by its last part, on Windows as on macOS and Linux', () => {
    expect(folderName('C:\\Users\\me\\Desktop\\moxxy')).toBe('moxxy');
    expect(folderName('/Users/me/Projects/moxxy')).toBe('moxxy');
    expect(folderName('C:\\Users\\me\\Desktop\\moxxy\\')).toBe('moxxy');
    expect(folderName('\\\\server\\share\\work')).toBe('work');
  });

  it('has no name for a drive or the root alone', () => {
    expect(folderName('/')).toBeNull();
    expect(folderName('C:\\')).toBeNull();
  });
});
