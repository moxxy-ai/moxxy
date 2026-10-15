import { closeSync, openSync, readSync } from 'node:fs';
import { extname, isAbsolute, resolve } from 'node:path';
import type { ToolImage } from '@moxxy/sdk';

/** As large as an image the person may attach in the desktop. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

const MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/** The picture at `path` (relative to `cwd`), or `undefined` when it is no picture, missing or too large. */
export function readImageFile(path: string, cwd: string, maxBytes = MAX_IMAGE_BYTES): ToolImage | undefined {
  const mediaType = MEDIA_TYPES[extname(path).toLowerCase()];
  if (!mediaType) return undefined;
  const file = isAbsolute(path) ? path : resolve(cwd, path);
  try {
    const bytes = readAtMost(file, maxBytes + 1);
    return bytes.length > maxBytes ? undefined : { mediaType, base64: bytes.toString('base64') };
  } catch {
    return undefined;
  }
}

/** The cap holds while reading: a size checked first could change before the read. */
function readAtMost(file: string, limit: number): Buffer {
  const fd = openSync(file, 'r');
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    while (total < limit) {
      const chunk = Buffer.alloc(Math.min(READ_CHUNK_BYTES, limit - total));
      const read = readSync(fd, chunk, 0, chunk.length, null);
      if (read === 0) break;
      chunks.push(chunk.subarray(0, read));
      total += read;
    }
    return Buffer.concat(chunks, total);
  } finally {
    closeSync(fd);
  }
}
