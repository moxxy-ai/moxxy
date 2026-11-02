import { describe, expect, it } from 'vitest';
import { localFilePath } from './local-file-link';

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

  it('refuses a file URL on another host', () => {
    expect(localFilePath('file://server/share/clip.mp4')).toBeNull();
  });

  it('refuses a Windows network path: opening one hands the sign-in to that server', () => {
    expect(localFilePath('\\\\server\\share\\clip.mp4')).toBeNull();
    expect(localFilePath('//server/share/clip.mp4')).toBeNull();
  });
});
