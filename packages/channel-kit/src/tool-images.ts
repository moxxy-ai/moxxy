import type { ToolImage } from '@moxxy/sdk';

/** One image ready to upload to a messenger. */
export interface ImageUpload {
  readonly name: string;
  readonly mediaType: string;
  readonly bytes: Buffer;
}

/** What a messenger accepts in one turn's worth of image messages. */
export interface ImageUploadLimits {
  /** Files one message (an album, a set of attachments) may carry. */
  readonly perMessage: number;
  /** Bytes all files of one message may add up to. */
  readonly maxMessageBytes: number;
  /** Bytes one file may be. */
  readonly maxFileBytes: number;
  /** Images one turn sends at most; the latest are kept. */
  readonly maxImages: number;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * The images tools returned, grouped into messages within a messenger's limits.
 * A turn that returned more than `maxImages` sends the latest (the screen as the
 * agent left it); an image larger than one file may be is left out. `left` counts
 * the images not sent, so the channel can say so.
 */
export function imageUploads(
  images: ReadonlyArray<ToolImage>,
  limits: ImageUploadLimits,
): { readonly batches: ReadonlyArray<ReadonlyArray<ImageUpload>>; readonly left: number } {
  const latest = images.slice(-limits.maxImages);
  const files = latest
    .map((image, i): ImageUpload => ({
      name: `image-${i + 1}.${EXTENSIONS[image.mediaType] ?? 'bin'}`,
      mediaType: image.mediaType,
      bytes: Buffer.from(image.base64, 'base64'),
    }))
    .filter((file) => file.bytes.length <= limits.maxFileBytes);
  const batches: ImageUpload[][] = [];
  let current: ImageUpload[] = [];
  let currentBytes = 0;
  for (const file of files) {
    if (current.length >= limits.perMessage || currentBytes + file.bytes.length > limits.maxMessageBytes) {
      if (current.length > 0) batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.bytes.length;
  }
  if (current.length > 0) batches.push(current);
  return { batches, left: images.length - files.length };
}
