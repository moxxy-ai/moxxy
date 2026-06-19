import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  detectPastedImagePath,
  extractImagePlaceholders,
  loadImageAttachment,
} from './image-attachments.js';

describe('detectPastedImagePath', () => {
  it('matches a plain absolute path to a PNG', () => {
    const result = detectPastedImagePath('/Users/me/screenshot.png');
    expect(result?.absPath).toBe('/Users/me/screenshot.png');
    expect(result?.mediaType).toBe('image/png');
    expect(result?.name).toBe('screenshot.png');
  });

  it('expands ~/ via os.homedir() into an absolute path (never a bare relative path)', () => {
    const prevHome = process.env.HOME;
    try {
      // Even with HOME unset, os.homedir() still resolves on the test host, so
      // the expansion is absolute and never silently joins onto '' (which
      // would later read an unintended file under process.cwd()).
      delete process.env.HOME;
      const result = detectPastedImagePath('~/pics/shot.png');
      expect(result).not.toBeNull();
      expect(path.isAbsolute(result!.absPath)).toBe(true);
      expect(result!.absPath).toBe(path.join(homedir(), 'pics/shot.png'));
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
    }
  });

  it('unescapes backslash-escaped spaces (drag-drop)', () => {
    const result = detectPastedImagePath('/tmp/My\\ Picture.jpg');
    expect(result?.absPath).toBe('/tmp/My Picture.jpg');
    expect(result?.mediaType).toBe('image/jpeg');
  });

  it('strips surrounding quotes', () => {
    const result = detectPastedImagePath('"/tmp/photo.webp"');
    expect(result?.absPath).toBe('/tmp/photo.webp');
    expect(result?.mediaType).toBe('image/webp');
  });

  it('returns null for non-image paths', () => {
    expect(detectPastedImagePath('/etc/hosts')).toBeNull();
  });

  it('returns null for prose pastes', () => {
    expect(detectPastedImagePath('hey check this /tmp/x.png out')).toBeNull();
  });

  it('returns null for multi-line pastes', () => {
    expect(detectPastedImagePath('/tmp/a.png\n/tmp/b.png')).toBeNull();
  });

  it('handles file:// URIs', () => {
    const result = detectPastedImagePath('file:///tmp/x%20y.png');
    expect(result?.absPath).toBe('/tmp/x y.png');
  });
});

describe('loadImageAttachment', () => {
  let dir: string;
  let imagePath: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'moxxy-img-'));
    imagePath = path.join(dir, 'tiny.png');
    // 1x1 transparent PNG.
    await writeFile(
      imagePath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORk5CYII=',
        'base64',
      ),
    );
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads the file and returns a base64 attachment', async () => {
    const detected = detectPastedImagePath(imagePath);
    expect(detected).not.toBeNull();
    const attachment = await loadImageAttachment(detected!);
    expect(attachment.kind).toBe('image');
    expect(attachment.mediaType).toBe('image/png');
    expect(attachment.name).toBe('tiny.png');
    expect(attachment.content.length).toBeGreaterThan(0);
    // Round-trip the base64 to confirm it's a valid PNG header.
    const bytes = Buffer.from(attachment.content, 'base64');
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
  });
});

describe('extractImagePlaceholders', () => {
  it('returns the ids in document order', () => {
    expect(extractImagePlaceholders('describe [Image #3] and [Image #1]')).toEqual([3, 1]);
  });

  it('returns empty when none present', () => {
    expect(extractImagePlaceholders('plain prompt')).toEqual([]);
  });
});
