import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { OpenAIEmbedder } from './embedder.js';

function fakeClient(responses: number[][][]): { embeddings: { create: ReturnType<typeof vi.fn> } } {
  let call = 0;
  return {
    embeddings: {
      create: vi.fn(async () => {
        const data = responses[call++]!.map((embedding) => ({ embedding }));
        return { data };
      }),
    },
  };
}

describe('OpenAIEmbedder', () => {
  it('default model is text-embedding-3-small with dim 1536', () => {
    const e = new OpenAIEmbedder({ client: fakeClient([[]]) as unknown as OpenAI });
    expect(e.model).toBe('text-embedding-3-small');
    expect(e.dim).toBe(1536);
  });

  it('dim respects explicit override', () => {
    const e = new OpenAIEmbedder({ client: fakeClient([[]]) as unknown as OpenAI, dimensions: 512 });
    expect(e.dim).toBe(512);
  });

  it('embed() returns vectors in input order', async () => {
    const responses = [[[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]];
    const client = fakeClient(responses) as unknown as OpenAI;
    const e = new OpenAIEmbedder({ client });
    const out = await e.embed(['a', 'b']);
    expect(out).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
  });

  it('batches calls when input exceeds batchSize', async () => {
    const responses = [
      [[1], [2]],
      [[3]],
    ];
    const client = fakeClient(responses) as unknown as OpenAI;
    const e = new OpenAIEmbedder({ client, batchSize: 2 });
    const out = await e.embed(['x', 'y', 'z']);
    expect(out).toEqual([[1], [2], [3]]);
    expect((client.embeddings.create as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);
  });

  it('embed([]) is a no-op (no API call)', async () => {
    const client = fakeClient([[]]) as unknown as OpenAI;
    const e = new OpenAIEmbedder({ client });
    expect(await e.embed([])).toEqual([]);
    expect((client.embeddings.create as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });

  it('forwards dimensions option to the SDK call when set', async () => {
    const client = fakeClient([[[1, 2]]]) as unknown as OpenAI;
    const e = new OpenAIEmbedder({ client, dimensions: 2 });
    await e.embed(['x']);
    const create = client.embeddings.create as unknown as { mock: { calls: unknown[][] } };
    const args = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.dimensions).toBe(2);
  });

  it('omits dimensions when not set', async () => {
    const client = fakeClient([[[1, 2]]]) as unknown as OpenAI;
    const e = new OpenAIEmbedder({ client });
    await e.embed(['x']);
    const create = client.embeddings.create as unknown as { mock: { calls: unknown[][] } };
    const args = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.dimensions).toBeUndefined();
  });

  it('throws on an unknown model with no dimensions override (no silent undefined dim)', () => {
    expect(
      () =>
        new OpenAIEmbedder({
          client: fakeClient([[]]) as unknown as OpenAI,
          model: 'text-embedding-4' as never,
        }),
    ).toThrow(/unknown embedding model/);
  });

  it('accepts an unknown model when an explicit dimensions override is supplied', () => {
    const e = new OpenAIEmbedder({
      client: fakeClient([[]]) as unknown as OpenAI,
      model: 'text-embedding-4' as never,
      dimensions: 768,
    });
    expect(e.dim).toBe(768);
  });

  it('ignores dimensions for ada-002 (API does not support it) and keeps dim 1536', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const client = fakeClient([[[1, 2]]]) as unknown as OpenAI;
      const e = new OpenAIEmbedder({
        client,
        model: 'text-embedding-ada-002',
        dimensions: 512,
      });
      // dim/name must reflect what the API actually returns, not the dropped override.
      expect(e.dim).toBe(1536);
      expect(e.name).toBe('openai:text-embedding-ada-002');
      expect(warn).toHaveBeenCalledTimes(1);

      await e.embed(['x']);
      const create = client.embeddings.create as unknown as { mock: { calls: unknown[][] } };
      const args = create.mock.calls[0]?.[0] as Record<string, unknown>;
      // The unsupported `dimensions` parameter is not forwarded to the API.
      expect(args.dimensions).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });
});
