import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

export interface EncryptedBlob {
  readonly iv: string;
  readonly tag: string;
  readonly data: string;
}

const KEY_BYTES = 32;
const IV_BYTES = 12;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_BYTES, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
}

export function generateSalt(): Buffer {
  return randomBytes(16);
}

export function encrypt(plaintext: string, key: Buffer): EncryptedBlob {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: data.toString('base64'),
  };
}

export function decrypt(blob: EncryptedBlob, key: Buffer): string {
  const iv = Buffer.from(blob.iv, 'base64');
  const tag = Buffer.from(blob.tag, 'base64');
  const data = Buffer.from(blob.data, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString('utf8');
}

/**
 * A uniformly-random decimal string of exactly `digits` digits (zero-padded).
 *
 * Draws enough entropy for the requested width (not a fixed 4 bytes, which
 * capped any code wider than ~9 digits — 10**digits overflowed a uint32, so
 * the leading digits were always 0) and rejection-samples to strip the
 * modulo bias that `% 10**digits` introduces when the byte range isn't an
 * exact multiple of the modulus. Used for short pairing codes today; correct
 * for any width.
 */
export function randomCode(digits = 6): string {
  if (!Number.isInteger(digits) || digits < 1) {
    throw new Error(`randomCode: digits must be a positive integer, got ${digits}`);
  }
  const modulus = 10n ** BigInt(digits);
  // Enough whole bytes to cover the modulus, with one spare byte so the
  // accepted region is a large fraction of the draw space (few rejections).
  const byteLen = Math.ceil((digits * Math.log2(10)) / 8) + 1;
  const space = 1n << BigInt(byteLen * 8);
  // Largest multiple of `modulus` that fits in `space`; draws at or above it
  // would bias the low digits, so reject and redraw.
  const limit = space - (space % modulus);
  for (;;) {
    let value = 0n;
    for (const byte of randomBytes(byteLen)) {
      value = (value << 8n) | BigInt(byte);
    }
    if (value < limit) {
      return (value % modulus).toString().padStart(digits, '0');
    }
  }
}
