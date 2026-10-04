import { inflateSync } from 'node:zlib';

/**
 * Reading the pixels of the agent's last picture of a page, to tell whether the
 * place it is about to press still looks the way it did when it chose it — the
 * browser's twin of Computer Use's "the pixels at the target changed".
 *
 * Chromium's screenshots are 8-bit RGB or RGBA, not interlaced; anything else is
 * reported as unreadable, and the caller then judges by URL and scroll alone.
 */

export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly channels: 3 | 4;
  readonly data: Buffer;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height from a PNG's header, without decoding it. */
export function pngSize(png: Buffer): { width: number; height: number } | null {
  if (png.length < 24 || !png.subarray(0, 8).equals(SIGNATURE)) return null;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export function decodePng(png: Buffer): Pixels | null {
  try {
    if (png.length < 33 || !png.subarray(0, 8).equals(SIGNATURE)) return null;
    let offset = 8;
    let width = 0;
    let height = 0;
    let channels: 3 | 4 | 0 = 0;
    const parts: Buffer[] = [];
    while (offset + 8 <= png.length) {
      const length = png.readUInt32BE(offset);
      const type = png.toString('ascii', offset + 4, offset + 8);
      const body = png.subarray(offset + 8, offset + 8 + length);
      if (type === 'IHDR') {
        width = body.readUInt32BE(0);
        height = body.readUInt32BE(4);
        const [depth, colour, , , interlace] = [body[8], body[9], body[10], body[11], body[12]];
        if (depth !== 8 || interlace !== 0) return null;
        channels = colour === 6 ? 4 : colour === 2 ? 3 : 0;
        if (channels === 0) return null;
      } else if (type === 'IDAT') {
        parts.push(body);
      } else if (type === 'IEND') {
        break;
      }
      offset += 12 + length;
    }
    if (!width || !height || !channels) return null;
    return { width, height, channels, data: unfilter(inflateSync(Buffer.concat(parts)), width, height, channels) };
  } catch {
    return null;
  }
}

function unfilter(raw: Buffer, width: number, height: number, channels: number): Buffer {
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)];
    const line = row * (stride + 1) + 1;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? (out[row * stride + i - channels] ?? 0) : 0;
      const b = row > 0 ? (out[(row - 1) * stride + i] ?? 0) : 0;
      const c = row > 0 && i >= channels ? (out[(row - 1) * stride + i - channels] ?? 0) : 0;
      const predicted = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth(a, b, c) : 0;
      out[row * stride + i] = ((raw[line + i] ?? 0) + predicted) & 0xff;
    }
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Whether the square of `radius` pixels around `at` looks different now. A few
 * stray pixels (a caret, anti-aliasing) are not a change; a picture of another
 * size always is.
 */
export function changedAround(before: Pixels, after: Pixels, at: { x: number; y: number }, radius: number): boolean {
  if (before.width !== after.width || before.height !== after.height) return true;
  const x0 = Math.max(0, Math.round(at.x) - radius);
  const x1 = Math.min(before.width - 1, Math.round(at.x) + radius);
  const y0 = Math.max(0, Math.round(at.y) - radius);
  const y1 = Math.min(before.height - 1, Math.round(at.y) + radius);
  let total = 0;
  let differing = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      total++;
      if (pixelDiffers(before, after, x, y)) differing++;
    }
  }
  return total > 0 && differing / total > 0.02;
}

function pixelDiffers(before: Pixels, after: Pixels, x: number, y: number): boolean {
  const i = (y * before.width + x) * before.channels;
  const j = (y * after.width + x) * after.channels;
  for (let c = 0; c < 3; c++) {
    if (Math.abs((before.data[i + c] ?? 0) - (after.data[j + c] ?? 0)) > 24) return true;
  }
  return false;
}
