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

  it('refuses a file URL on another host', () => {
    expect(localFilePath('file://server/share/clip.mp4')).toBeNull();
  });
});
