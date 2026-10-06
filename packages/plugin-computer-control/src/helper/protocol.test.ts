import { describe, expect, it } from 'vitest';
import { JsonLineDecoder, responseSchemaFor } from './protocol.js';

describe('bounded JSON lines', () => {
  it('decodes split UTF-8 and multiple frames without losing bytes', () => {
    const decoder = new JsonLineDecoder(128);
    const bytes = Buffer.from('{"text":"żółć"}\n{}\n');
    const result: unknown[] = [];
    for (const byte of bytes) result.push(...decoder.push(Buffer.from([byte])));
    expect(result).toEqual([{ text: 'żółć' }, {}]);
  });
  it('rejects oversize, malformed and incomplete messages', () => {
    expect(() => new JsonLineDecoder(3).push(Buffer.from('1234'))).toThrow(/limit/);
    expect(() => new JsonLineDecoder(100).push(Buffer.from('{bad}\n'))).toThrow();
    const decoder = new JsonLineDecoder(100);
    decoder.push(Buffer.from('{'));
    expect(() => decoder.finish()).toThrow(/incomplete/);
  });
});

describe('response envelope', () => {
  it('accepts only the configured protocol version and a well-formed result or error', () => {
    const response = responseSchemaFor(5);
    expect(response.safeParse({ version: 5, id: '1', ok: true, result: {} }).success).toBe(true);
    expect(response.safeParse({ version: 5, id: '1', ok: false, error: { code: 'x', message: 'y' } }).success).toBe(true);
    expect(response.safeParse({ version: 4, id: '1', ok: true, result: {} }).success).toBe(false);
    expect(response.safeParse({ version: 5, id: '1', ok: false }).success).toBe(false);
  });
});
