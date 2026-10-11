/** The image file Codex viewed, read from disk so the conversation can show it. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readImageFile } from './view-image.js';

describe('reading an image Codex viewed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'moxxy-view-image-'));
  writeFileSync(join(dir, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(dir, 'notes.txt'), 'not an image');

  it('reads a picture by its path, relative paths from the project folder', () => {
    expect(readImageFile(join(dir, 'shot.png'), '/elsewhere')).toEqual({ mediaType: 'image/png', base64: 'iVBORw==' });
    expect(readImageFile('shot.png', dir)).toEqual({ mediaType: 'image/png', base64: 'iVBORw==' });
  });

  it('reads nothing that is not a picture, is missing, or is larger than an attached image may be', () => {
    expect(readImageFile(join(dir, 'notes.txt'), dir)).toBeUndefined();
    expect(readImageFile(join(dir, 'gone.png'), dir)).toBeUndefined();
    expect(readImageFile(join(dir, 'shot.png'), dir, 3)).toBeUndefined();
  });
});
