import { describe, expect, it } from 'vitest';
import { imageUploads } from './tool-images.js';

const image = (bytes: number, mediaType = 'image/png') => ({
  mediaType,
  base64: Buffer.alloc(bytes, bytes % 251).toString('base64'),
});

describe('imageUploads', () => {
  it('names each image by its type and groups them under the per-message count', () => {
    const plan = imageUploads([image(1), image(2, 'image/jpeg'), image(3, 'image/webp')], {
      perMessage: 2,
      maxMessageBytes: 1_000,
      maxFileBytes: 1_000,
      maxImages: 10,
    });
    expect(plan.batches.map((batch) => batch.map((file) => file.name))).toEqual([
      ['image-1.png', 'image-2.jpg'],
      ['image-3.webp'],
    ]);
    expect(plan.batches[0]?.[1]?.bytes.length).toBe(2);
    expect(plan.left).toBe(0);
  });

  it('keeps the latest images when there are more than a turn sends, and counts the rest', () => {
    const images = Array.from({ length: 5 }, (_, i) => image(i + 1));
    const plan = imageUploads(images, { perMessage: 10, maxMessageBytes: 1_000, maxFileBytes: 1_000, maxImages: 3 });
    expect(plan.batches.flat().map((file) => file.bytes.length)).toEqual([3, 4, 5]);
    expect(plan.left).toBe(2);
  });

  it('leaves out an image too big to upload and starts a new message before the size cap', () => {
    const plan = imageUploads([image(600), image(500), image(2_000)], {
      perMessage: 10,
      maxMessageBytes: 1_000,
      maxFileBytes: 1_000,
      maxImages: 10,
    });
    expect(plan.batches.map((batch) => batch.map((file) => file.bytes.length))).toEqual([[600], [500]]);
    expect(plan.left).toBe(1);
  });
});
