import { describe, expect, it } from 'vitest';
import { localFilePath, windowsLinkSlashes } from './local-file-link';

describe('localFilePath (links the agent writes to files on this machine)', () => {
  it('reads a file:// URL, decoding escapes', () => {
    expect(localFilePath('file:///Users/me/Downloads/ellen%20trailer.mp4')).toBe('/Users/me/Downloads/ellen trailer.mp4');
  });

  it('reads a bare absolute path', () => {
    expect(localFilePath('/Users/me/Downloads/clip.mp4')).toBe('/Users/me/Downloads/clip.mp4');
  });

  it('decodes the escapes markdown adds to a bare path, so a space stays a space', () => {
    expect(localFilePath('/Users/me/Propozycje%20YouTube/RECLAIM-RESULTS.md')).toBe(
      '/Users/me/Propozycje YouTube/RECLAIM-RESULTS.md',
    );
  });

  it('keeps a bare path whose percent sign is not an escape', () => {
    expect(localFilePath('/Users/me/100%.md')).toBe('/Users/me/100%.md');
  });

  it('leaves web links alone', () => {
    expect(localFilePath('https://example.com/clip.mp4')).toBeNull();
    expect(localFilePath('mailto:me@example.com')).toBeNull();
    expect(localFilePath('#section')).toBeNull();
  });

  it('reads a file:// URL to a Windows drive without a slash before the drive', () => {
    expect(localFilePath('file:///C:/Users/Jan/Moje%20dokumenty/raport.docx')).toBe('C:/Users/Jan/Moje dokumenty/raport.docx');
  });

  it('reads a bare Windows path with either kind of slash', () => {
    expect(localFilePath('C:\\Users\\Jan\\raport.docx')).toBe('C:\\Users\\Jan\\raport.docx');
    expect(localFilePath('d:/Projekty/Moje%20notatki.md')).toBe('d:/Projekty/Moje notatki.md');
  });

  it('reads a bare path with a slash before the Windows drive, as agents write it, without that slash', () => {
    expect(localFilePath('/D:/Moxxy%20Projects/3dsite/index.html')).toBe('D:/Moxxy Projects/3dsite/index.html');
    expect(localFilePath('/c:\\Users\\Jan\\raport.docx')).toBe('c:\\Users\\Jan\\raport.docx');
  });

  it('refuses a file URL on another host', () => {
    expect(localFilePath('file://server/share/clip.mp4')).toBeNull();
  });

  it('refuses a Windows network path: opening one hands the sign-in to that server', () => {
    expect(localFilePath('\\\\server\\share\\clip.mp4')).toBeNull();
    expect(localFilePath('//server/share/clip.mp4')).toBeNull();
  });
});

describe('windowsLinkSlashes (a Windows path Markdown would change)', () => {
  it('turns the backslashes of a link to a Windows drive into slashes, so Markdown cannot eat one', () => {
    expect(windowsLinkSlashes('[cfg](C:\\Users\\Jan\\.config\\notes.md) i [d](<D:\\Moje _pliki\\a.md>)')).toBe(
      '[cfg](C:/Users/Jan/.config/notes.md) i [d](<D:/Moje _pliki/a.md>)',
    );
  });

  it('does the same when the link puts a slash before the drive', () => {
    expect(windowsLinkSlashes('[cfg](</D:\\Moje projekty\\.config\\notes.md>)')).toBe(
      '[cfg](</D:/Moje projekty/.config/notes.md>)',
    );
  });

  it('leaves prose, web links and code alone', () => {
    const text = 'Folder C:\\Users\\Jan\\.config, [x](https://a.b/c\\d)\n```\n[y](C:\\a\\.b)\n```';
    expect(windowsLinkSlashes(text)).toBe(text);
  });
});
