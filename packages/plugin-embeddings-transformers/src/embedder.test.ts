import { describe, expect, it, vi } from 'vitest';
import { TransformersEmbedder, type PipelineFactory } from './embedder.js';

function stubFactory(vectors: number[][]): PipelineFactory & { calls: () => number } {
  let calls = 0;
  const factory: PipelineFactory = async (_task, _model) => {
    return async (input, _opts) => {
      calls++;
      const inputs = Array.isArray(input) ? input : [input];
      // Return the slice of vectors matching the batch size.
      const slice = vectors.slice(0, inputs.length);
      return { tolist: () => slice };
    };
  };
  return Object.assign(factory, { calls: () => calls });
}

describe('TransformersEmbedder', () => {
  it('defaults to all-MiniLM-L6-v2 with dim 384', () => {
    const e = new TransformersEmbedder({ pipelineFactory: stubFactory([]) });
    expect(e.model).toBe('Xenova/all-MiniLM-L6-v2');
    expect(e.dim).toBe(384);
  });

  it('reports "dynamic" dim for unknown models', () => {
    const e = new TransformersEmbedder({
      model: 'Xenova/some-unknown-model',
      pipelineFactory: stubFactory([]),
    });
    expect(e.dim).toBe('dynamic');
  });

  it('respects explicit dimensions override', () => {
    const e = new TransformersEmbedder({
      model: 'Xenova/some-unknown-model',
      dimensions: 256,
      pipelineFactory: stubFactory([]),
    });
    expect(e.dim).toBe(256);
  });

  it('embed() returns vectors in input order', async () => {
    const e = new TransformersEmbedder({
      pipelineFactory: stubFactory([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ]),
    });
    expect(await e.embed(['a', 'b'])).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
  });

  it('embed([]) is a no-op (no pipeline initialization)', async () => {
    const factory = vi.fn(async () => async () => ({ tolist: () => [] }));
    const e = new TransformersEmbedder({ pipelineFactory: factory as unknown as PipelineFactory });
    expect(await e.embed([])).toEqual([]);
    expect(factory).not.toHaveBeenCalled();
  });

  it('caches the extractor across calls (lazy load, once)', async () => {
    let factoryCalls = 0;
    const factory: PipelineFactory = async () => {
      factoryCalls++;
      return async (input) => {
        const inputs = Array.isArray(input) ? input : [input];
        return { tolist: () => inputs.map(() => [1, 2, 3]) };
      };
    };
    const e = new TransformersEmbedder({ pipelineFactory: factory });
    await e.embed(['a']);
    await e.embed(['b', 'c']);
    expect(factoryCalls).toBe(1);
  });

  it('handles concurrent calls without double-loading the extractor', async () => {
    let factoryCalls = 0;
    const factory: PipelineFactory = async () => {
      factoryCalls++;
      // Simulate slow init
      await new Promise((r) => setTimeout(r, 10));
      return async (input) => {
        const inputs = Array.isArray(input) ? input : [input];
        return { tolist: () => inputs.map(() => [9]) };
      };
    };
    const e = new TransformersEmbedder({ pipelineFactory: factory });
    await Promise.all([e.embed(['x']), e.embed(['y']), e.embed(['z'])]);
    expect(factoryCalls).toBe(1);
  });

  it('normalizes a single flat-vector tensor result into a one-element batch', async () => {
    const factory: PipelineFactory = async () => async () =>
      ({ tolist: () => [0.1, 0.2, 0.3] });
    const e = new TransformersEmbedder({ pipelineFactory: factory });
    expect(await e.embed(['only'])).toEqual([[0.1, 0.2, 0.3]]);
  });

  it('returns empty list when the tensor result is malformed', async () => {
    const factory: PipelineFactory = async () => async () => ({ tolist: () => [] });
    const e = new TransformersEmbedder({ pipelineFactory: factory });
    expect(await e.embed(['x'])).toEqual([]);
  });

  it('retries the factory after a transient load failure (latch is not bricked)', async () => {
    let factoryCalls = 0;
    const factory: PipelineFactory = async () => {
      factoryCalls++;
      if (factoryCalls === 1) throw new Error('transient ONNX init failure');
      return async (input) => {
        const inputs = Array.isArray(input) ? input : [input];
        return { tolist: () => inputs.map(() => [1, 2, 3]) };
      };
    };
    const e = new TransformersEmbedder({ pipelineFactory: factory });
    await expect(e.embed(['a'])).rejects.toThrow('transient ONNX init failure');
    // Second call must retry the load rather than re-throw the cached rejection.
    expect(await e.embed(['b'])).toEqual([[1, 2, 3]]);
    expect(factoryCalls).toBe(2);
  });

  it('throws when a 2D batch returns fewer vectors than inputs (no silent misalignment)', async () => {
    // Model returns one vector for a two-text batch — passing it through would
    // zip vectors to the wrong record ids in the memory index.
    const factory: PipelineFactory = async () => async () => ({ tolist: () => [[0.1, 0.2]] });
    const e = new TransformersEmbedder({ pipelineFactory: factory });
    await expect(e.embed(['a', 'b'])).rejects.toThrow(/2 inputs/);
  });

  it('throws when a 2D batch returns more vectors than inputs', async () => {
    const factory: PipelineFactory = async () => async () =>
      ({ tolist: () => [[1], [2], [3]] });
    const e = new TransformersEmbedder({ pipelineFactory: factory });
    await expect(e.embed(['a', 'b'])).rejects.toThrow(/2 inputs/);
  });

  it('chunks embed() by batchSize, calling the extractor ceil(n/batch) times in order', async () => {
    // The extractor echoes each input's numeric value as a one-element vector,
    // so we can assert both call count and output order across chunks.
    const seen: string[][] = [];
    const factory: PipelineFactory = async () => async (input) => {
      const inputs = (Array.isArray(input) ? input : [input]) as string[];
      seen.push([...inputs]);
      return { tolist: () => inputs.map((t) => [Number(t)]) };
    };
    const e = new TransformersEmbedder({ pipelineFactory: factory, batchSize: 2 });

    const out = await e.embed(['1', '2', '3', '4', '5']);
    // 5 inputs / batch 2 -> ceil = 3 extractor calls.
    expect(seen).toEqual([['1', '2'], ['3', '4'], ['5']]);
    // Output order/length preserved across the chunk boundary.
    expect(out).toEqual([[1], [2], [3], [4], [5]]);
  });
});
