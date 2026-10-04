import { deflateSync } from 'node:zlib';

/** A solid-colour RGBA picture, to paint on and encode. */
export function canvas(width: number, height: number, rgba: [number, number, number, number] = [255, 255, 255, 255]) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return {
    width,
    height,
    data,
    paint(x: number, y: number, w: number, h: number, colour: [number, number, number, number]) {
      for (let row = y; row < Math.min(y + h, height); row++) {
        for (let col = x; col < Math.min(x + w, width); col++) data.set(colour, (row * width + col) * 4);
      }
    },
  };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Encode RGBA (or RGB, dropping alpha) pixels as a PNG, filtering row `r` with
 * filter `filters[r % filters.length]` — so a decoder meets every filter type.
 */
export function encodePng(
  picture: { width: number; height: number; data: Buffer },
  opts: { filters?: number[]; rgb?: boolean } = {},
): Buffer {
  const { width, height, data } = picture;
  const channels = opts.rgb ? 3 : 4;
  const filters = opts.filters ?? [0];
  const stride = width * channels;
  const raw = Buffer.alloc(height * stride);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < channels; c++) raw[i * channels + c] = data[i * 4 + c] ?? 0;
  }
  const out = Buffer.alloc(height * (stride + 1));
  for (let row = 0; row < height; row++) {
    const filter = filters[row % filters.length] ?? 0;
    out[row * (stride + 1)] = filter;
    for (let i = 0; i < stride; i++) {
      const x = raw[row * stride + i] ?? 0;
      const a = i >= channels ? (raw[row * stride + i - channels] ?? 0) : 0;
      const b = row > 0 ? (raw[(row - 1) * stride + i] ?? 0) : 0;
      const c = row > 0 && i >= channels ? (raw[(row - 1) * stride + i - channels] ?? 0) : 0;
      const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter] ?? 0;
      out[row * (stride + 1) + 1 + i] = (x - predicted) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = opts.rgb ? 2 : 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(out)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
