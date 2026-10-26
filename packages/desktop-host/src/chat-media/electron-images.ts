import { nativeImage } from 'electron';
import { createHash } from 'node:crypto';
import type { ImageFingerprint } from './collect';
import type { Thumbnailer } from './store';

/** The shorter side of a thumbnail: a library tile at twice the pixel density. */
const THUMB_SIDE = 320;

/**
 * Shrink an image with Electron, so no image library ships for it. A copy
 * keeps its transparency as PNG; anything opaque (every screenshot) becomes a
 * far smaller JPEG. Types Electron cannot decode answer null.
 */
export const electronThumbnail: Thumbnailer = async (bytes) => {
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  const scale = Math.min(
    1,
    THUMB_SIDE / Math.max(1, Math.min(width, height)),
    640 / Math.max(1, width, height),
  );
  const small =
    scale < 1
      ? image.resize({
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
          quality: 'good',
        })
      : image;
  return hasTransparency(small.toBitmap())
    ? { mediaType: 'image/png', bytes: small.toPNG() }
    : { mediaType: 'image/jpeg', bytes: small.toJPEG(82) };
};

/** Whether any pixel of a BGRA bitmap is not fully opaque. */
function hasTransparency(bitmap: Buffer): boolean {
  for (let alpha = 3; alpha < bitmap.length; alpha += 4) {
    if (bitmap[alpha] !== 255) return true;
  }
  return false;
}

/** Identical pixels count once even when the PNG encodings differ. No lossy similarity matching. */
export const electronFingerprint: ImageFingerprint = (base64) => {
  const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'));
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  return createHash('sha256').update(`${width}x${height}:`).update(image.toBitmap()).digest('hex');
};
