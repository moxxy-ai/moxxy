import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { bearerTokenMatches, readRequestBody } from './http-utils.js';

function fakeReq(body: string | Buffer): IncomingMessage {
  return Readable.from([Buffer.from(body)]) as unknown as IncomingMessage;
}

describe('bearerTokenMatches', () => {
  it('matches an identical token', () => {
    expect(bearerTokenMatches('s3cret', 's3cret')).toBe(true);
  });
  it('rejects a different token of equal length', () => {
    expect(bearerTokenMatches('aaaaaa', 'bbbbbb')).toBe(false);
  });
  it('rejects a length mismatch without throwing', () => {
    expect(bearerTokenMatches('short', 'longer-token')).toBe(false);
  });
  it('rejects empty/missing presented tokens', () => {
    expect(bearerTokenMatches(undefined, 'x')).toBe(false);
    expect(bearerTokenMatches(null, 'x')).toBe(false);
    expect(bearerTokenMatches('', 'x')).toBe(false);
  });
});

describe('readRequestBody', () => {
  it('reads the full body', async () => {
    const buf = await readRequestBody(fakeReq('hello world'), 1024);
    expect(buf.toString('utf8')).toBe('hello world');
  });

  it('rejects when the body exceeds maxBytes', async () => {
    await expect(readRequestBody(fakeReq('x'.repeat(100)), 10)).rejects.toThrow(/exceeds 10 bytes/);
  });
});
