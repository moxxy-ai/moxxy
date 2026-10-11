import { readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, resolve } from 'node:path';
import type { ToolImage } from '@moxxy/sdk';

/** As large as an image the person may attach in the desktop. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

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
    if (statSync(file).size > maxBytes) return undefined;
    return { mediaType, base64: readFileSync(file).toString('base64') };
  } catch {
    return undefined;
  }
}
