import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/**
 * Read a request body into a Buffer, rejecting (and destroying the socket) once
 * `maxBytes` is exceeded. Bounds in-memory buffering so a malicious or runaway
 * client can't exhaust the host's memory. Shared by every HTTP channel/listener.
 */
export async function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`request body exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Constant-time comparison of a presented bearer token against the expected
 * value. A length mismatch returns false WITHOUT calling `timingSafeEqual`
 * (which throws on unequal lengths and would leak the length); equal-length
 * inputs are compared in constant time so an attacker can't recover the token
 * byte-by-byte via response timing.
 */
export function bearerTokenMatches(presented: string | undefined | null, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
