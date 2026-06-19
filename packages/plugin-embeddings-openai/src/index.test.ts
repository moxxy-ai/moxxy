import { describe, expect, it } from 'vitest';
import { openaiEmbedderDef, OpenAIEmbedder } from './index.js';

describe('openaiEmbedderDef.createClient config validation', () => {
  it('builds an embedder from a well-typed config', () => {
    const e = openaiEmbedderDef.createClient({
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
    });
    expect(e).toBeInstanceOf(OpenAIEmbedder);
    expect((e as OpenAIEmbedder).dim).toBe(1536);
  });

  it('rejects a non-string baseURL from untrusted config', () => {
    expect(() => openaiEmbedderDef.createClient({ baseURL: 123 })).toThrow(/baseURL/);
  });

  it('rejects a non-string model from untrusted config', () => {
    expect(() => openaiEmbedderDef.createClient({ model: { evil: true } })).toThrow(/model/);
  });

  it('rejects a non-number / non-finite batchSize before it can wedge embed()', () => {
    expect(() => openaiEmbedderDef.createClient({ batchSize: '10' })).toThrow(/batchSize/);
    expect(() => openaiEmbedderDef.createClient({ batchSize: Number.NaN })).toThrow(/batchSize/);
  });

  it('rejects a non-number dimensions from untrusted config', () => {
    expect(() => openaiEmbedderDef.createClient({ dimensions: 'big' })).toThrow(/dimensions/);
  });

  it('still enforces the constructor range checks after coercion', () => {
    // A finite-but-invalid numeric passes the index.ts type guard but the
    // constructor must still reject it (no infinite loop / corrupt index).
    expect(() => openaiEmbedderDef.createClient({ batchSize: 0 })).toThrow(/batchSize/);
    expect(() => openaiEmbedderDef.createClient({ dimensions: -1 })).toThrow(/dimensions/);
  });

  it('rejects a non-number timeoutMs / maxRetries and enforces the range after coercion', () => {
    expect(() => openaiEmbedderDef.createClient({ timeoutMs: '30s' })).toThrow(/timeoutMs/);
    expect(() => openaiEmbedderDef.createClient({ maxRetries: Number.NaN })).toThrow(/maxRetries/);
    // Finite-but-invalid: type guard passes, constructor range check must reject.
    expect(() => openaiEmbedderDef.createClient({ timeoutMs: 0 })).toThrow(/timeoutMs/);
    expect(() => openaiEmbedderDef.createClient({ maxRetries: -1 })).toThrow(/maxRetries/);
  });

  it('threads a valid timeoutMs through to the constructed client', () => {
    const e = openaiEmbedderDef.createClient({ apiKey: 'sk-test', timeoutMs: 7_500 });
    const client = (e as unknown as { client: { timeout: number } }).client;
    expect(client.timeout).toBe(7_500);
  });
});
