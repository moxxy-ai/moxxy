/**
 * Small, dependency-free byte helpers shared by the handshake/frame/identity
 * modules. Encodings are hand-rolled (not `node:buffer`) so the `.` export stays
 * RN-safe — React Native has no global `Buffer`.
 */

/** Concatenate byte arrays into one fresh `Uint8Array`. */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Constant-time equality for two byte arrays. Returns false immediately on a
 * length mismatch (lengths here are public — fixed-size keys), then XOR-folds
 * every byte so the compare time doesn't depend on where the first difference
 * is. Used for the pinned-fingerprint check, where a timing leak would let an
 * attacker probe the expected key byte by byte.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

/** UTF-8 encode without depending on `Buffer` (TextEncoder is in Node + RN). */
export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** UTF-8 decode (TextDecoder is in Node + modern RN/Hermes). */
export function utf8Decode(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

/**
 * Big-endian 8-byte encoding of a non-negative JS number. Written as two 32-bit
 * halves to avoid `BigInt`/`setBigUint64` (Hermes/older RN engines are spotty);
 * safe for any sequence counter below `Number.MAX_SAFE_INTEGER`.
 */
export function u64be(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`u64be: out of range: ${n}`);
  }
  const out = new Uint8Array(8);
  const hi = Math.floor(n / 0x1_0000_0000);
  const lo = n >>> 0;
  out[0] = (hi >>> 24) & 0xff;
  out[1] = (hi >>> 16) & 0xff;
  out[2] = (hi >>> 8) & 0xff;
  out[3] = hi & 0xff;
  out[4] = (lo >>> 24) & 0xff;
  out[5] = (lo >>> 16) & 0xff;
  out[6] = (lo >>> 8) & 0xff;
  out[7] = lo & 0xff;
  return out;
}

/** Decode a big-endian 8-byte counter back to a JS number. */
export function readU64be(b: Uint8Array, off = 0): number {
  const hi =
    ((b[off] as number) << 24) |
    ((b[off + 1] as number) << 16) |
    ((b[off + 2] as number) << 8) |
    (b[off + 3] as number);
  const lo =
    ((b[off + 4] as number) << 24) |
    ((b[off + 5] as number) << 16) |
    ((b[off + 6] as number) << 8) |
    (b[off + 7] as number);
  return (hi >>> 0) * 0x1_0000_0000 + (lo >>> 0);
}

// ---------------------------------------------------------------------------
// base64url (RFC 4648 §5, no padding) — used to carry the 32-byte Ed25519
// public-key fingerprint in the QR/connect URL.
// ---------------------------------------------------------------------------

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function base64urlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = i + 1 < bytes.length ? (bytes[i + 1] as number) : 0;
    const b2 = i + 2 < bytes.length ? (bytes[i + 2] as number) : 0;
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64URL[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64URL[b2 & 0x3f];
  }
  return out;
}

export function base64urlDecode(s: string): Uint8Array {
  const lut = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64URL.length; i++) lut[B64URL.charCodeAt(i)] = i;
  const clean = s.trim();
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    const code = ch.charCodeAt(0);
    const v = code < 128 ? lut[code] : -1;
    if (v === undefined || v < 0) throw new Error('base64urlDecode: invalid character');
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// base32 (RFC 4648 §6, lowercase, no padding) — used for the uuid subdomain
// label. Lowercase a-z + 2-7 is a valid DNS label, and the alphabet avoids the
// visually ambiguous 0/1/8/9.
// ---------------------------------------------------------------------------

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let buf = 0;
  let bits = 0;
  for (const byte of bytes) {
    buf = (buf << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32[(buf >> bits) & 0x1f];
    }
  }
  if (bits > 0) out += B32[(buf << (5 - bits)) & 0x1f];
  return out;
}
