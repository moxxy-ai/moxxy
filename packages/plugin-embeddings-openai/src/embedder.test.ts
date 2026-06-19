import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { OpenAIEmbedder } from './embedder.js';

function fakeClient(responses: number[][][]): { embeddings: { create: ReturnType<typeof vi.fn> } } {
  let call = 0;
  return {
    embeddings: {
      create: vi.fn(async () => {
        const data = responses[call++]!.map((embedding, index) => ({ embedding, index }));
        return { data };
      }),
    },
  };
}

/** Client whose `create` returns a raw, untrusted response shape verbatim. */
function rawClient(make: () => unknown): { embeddings: { create: ReturnType<typeof vi.fn> } } {
  return { embeddings: { create: vi.fn(async () => make()) } };
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

  it('throws at construction on batchSize <= 0 (would otherwise infinite-loop embed())', () => {
    expect(
      () => new OpenAIEmbedder({ client: fakeClient([[]]) as unknown as OpenAI, batchSize: 0 }),
    ).toThrow(/batchSize/);
    expect(
      () => new OpenAIEmbedder({ client: fakeClient([[]]) as unknown as OpenAI, batchSize: -5 }),
    ).toThrow(/batchSize/);
  });

  it('throws at construction on a non-integer or over-limit batchSize', () => {
    expect(
      () => new OpenAIEmbedder({ client: fakeClient([[]]) as unknown as OpenAI, batchSize: 1.5 }),
    ).toThrow(/batchSize/);
    expect(
      () => new OpenAIEmbedder({ client: fakeClient([[]]) as unknown as OpenAI, batchSize: 4096 }),
    ).toThrow(/batchSize/);
  });

  it('throws at construction on an invalid dimensions override', () => {
    expect(
      () => new OpenAIEmbedder({ client: fakeClient([[]]) as unknown as OpenAI, dimensions: -1 }),
    ).toThrow(/dimensions/);
    expect(
      () => new OpenAIEmbedder({ client: fakeClient([[]]) as unknown as OpenAI, dimensions: 0 }),
    ).toThrow(/dimensions/);
    expect(
      () => new OpenAIEmbedder({ client: fakeClient([[]]) as unknown as OpenAI, dimensions: 1.5 }),
    ).toThrow(/dimensions/);
  });

  it('propagates a rejected embeddings.create call', async () => {
    const client = rawClient(() => {
      throw new Error('boom');
    }) as unknown as OpenAI;
    const e = new OpenAIEmbedder({ client });
    await expect(e.embed(['a'])).rejects.toThrow(/boom/);
  });

  it('throws when the response data length does not match the input length', async () => {
    const client = rawClient(() => ({ data: [{ embedding: [1, 2], index: 0 }] })) as unknown as OpenAI;
    const e = new OpenAIEmbedder({ client });
    await expect(e.embed(['a', 'b'])).rejects.toThrow(/returned 1 embeddings for 2 inputs/);
  });

  it('throws when response.data is not an array', async () => {
    const client = rawClient(() => ({ data: null })) as unknown as OpenAI;
    const e = new OpenAIEmbedder({ client });
    await expect(e.embed(['a'])).rejects.toThrow(/data is not an array/);
  });

  it('throws when an embedding is not a numeric vector', async () => {
    const client = rawClient(() => ({ data: [{ embedding: 'nope', index: 0 }] })) as unknown as OpenAI;
    const e = new OpenAIEmbedder({ client });
    await expect(e.embed(['a'])).rejects.toThrow(/non-vector/);
  });

  it('reorders out-of-order response data by the per-item index', async () => {
    // Proxy returns items in reversed order; we must map by `index`, not array order.
    const client = rawClient(() => ({
      data: [
        { embedding: [9, 9], index: 1 },
        { embedding: [1, 1], index: 0 },
      ],
    })) as unknown as OpenAI;
    const e = new OpenAIEmbedder({ client });
    const out = await e.embed(['a', 'b']);
    expect(out).toEqual([
      [1, 1],
      [9, 9],
    ]);
  });

  it('throws on a duplicate / out-of-range response index', async () => {
    const dup = rawClient(() => ({
      data: [
        { embedding: [1], index: 0 },
        { embedding: [2], index: 0 },
      ],
    })) as unknown as OpenAI;
    await expect(new OpenAIEmbedder({ client: dup }).embed(['a', 'b'])).rejects.toThrow(/duplicate/);

    const oob = rawClient(() => ({ data: [{ embedding: [1], index: 5 }] })) as unknown as OpenAI;
    await expect(new OpenAIEmbedder({ client: oob }).embed(['a'])).rejects.toThrow(/out-of-range/);
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
