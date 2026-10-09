import { describe, expect, it } from 'vitest';
import { ATTACHMENT_LIMITS, attachmentSizeProblem, isImageFileName } from './attachment-limits.js';

const MB = 1024 * 1024;

describe('attachmentSizeProblem', () => {
  it('has nothing to say about a file that fits', () => {
    expect(attachmentSizeProblem({ name: 'notes.md', size: 12_000 })).toBeNull();
    expect(attachmentSizeProblem({ name: 'shot.png', size: ATTACHMENT_LIMITS.imageBytes })).toBeNull();
    expect(attachmentSizeProblem({ name: 'report.pdf', size: ATTACHMENT_LIMITS.fileBytes })).toBeNull();
  });

  it('names the file, its size and the limit when an image is too large', () => {
    expect(attachmentSizeProblem({ name: 'holiday.png', size: 12.4 * MB })).toBe(
      'holiday.png is 12.4 MB. An image can be up to 8 MB.',
    );
  });

  it('holds any other file to the larger limit', () => {
    expect(attachmentSizeProblem({ name: 'holiday.pdf', size: 12.4 * MB })).toBeNull();
    expect(attachmentSizeProblem({ name: 'dump.sql', size: 80 * MB })).toBe(
      'dump.sql is 80 MB. A file can be up to 32 MB.',
    );
  });

  it('says so when there is nothing in the file', () => {
    expect(attachmentSizeProblem({ name: 'empty.txt', size: 0 })).toBe('empty.txt is empty.');
  });

  it('writes a size the way a file manager does', () => {
    expect(attachmentSizeProblem({ name: 'a.bin', size: 2.5 * 1024 * MB })).toMatch(/^a\.bin is 2\.5 GB\./u);
    expect(attachmentSizeProblem({ name: 'b.png', size: 8 * MB + 1 })).toMatch(/^b\.png is 8\.1 MB\./u);
  });
});

describe('isImageFileName', () => {
  it('knows the images the model can see, whatever the case', () => {
    for (const name of ['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.webp', 'f.bmp']) expect(isImageFileName(name)).toBe(true);
    for (const name of ['a.svg', 'b.pdf', 'png', 'c.png.txt']) expect(isImageFileName(name)).toBe(false);
  });
});
