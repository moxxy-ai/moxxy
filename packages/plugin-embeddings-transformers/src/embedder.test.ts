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
      // dim 3 matches the stub width so the observed-dim check passes.
      dimensions: 3,
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
    const e = new TransformersEmbedder({ dimensions: 3, pipelineFactory: factory });
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
    const e = new TransformersEmbedder({ dimensions: 1, pipelineFactory: factory });
    await Promise.all([e.embed(['x']), e.embed(['y']), e.embed(['z'])]);
    expect(factoryCalls).toBe(1);
  });

  it('normalizes a single flat-vector tensor result into a one-element batch', async () => {
    const factory: PipelineFactory = async () => async () =>
      ({ tolist: () => [0.1, 0.2, 0.3] });
    const e = new TransformersEmbedder({ dimensions: 3, pipelineFactory: factory });
    expect(await e.embed(['only'])).toEqual([[0.1, 0.2, 0.3]]);
  });

  it('throws (not returns []) when the tensor result is empty for a non-empty batch', async () => {
    // A misbehaving/partially-loaded model yielding [] for real inputs must FAIL
    // LOUD: returning [] short-changes the strict positional embed() contract and
    // lets downstream read undefined as the query vector (NaN cosine / crash).
    const factory: PipelineFactory = async () => async () => ({ tolist: () => [] });
    const e = new TransformersEmbedder({ pipelineFactory: factory });
    await expect(e.embed(['x'])).rejects.toThrow(/no vectors for 1 inputs/);
  });

  it('throws when a flat-vector result is returned for a multi-input batch', async () => {
    // A flat number[] is only valid as a batch-of-1; for >1 inputs it means the
    // model collapsed the batch — must not be silently treated as one vector.
    const factory: PipelineFactory = async () => async () =>
      ({ tolist: () => [0.1, 0.2, 0.3] });
    const e = new TransformersEmbedder({ dimensions: 3, pipelineFactory: factory });
    await expect(e.embed(['a', 'b'])).rejects.toThrow(/1 vector for 2 inputs/);
  });

  it('throws when a 3D tensor result has the wrong batch count', async () => {
    // [batch, seq, hidden] with batch !== input count would misalign vectors.
    const factory: PipelineFactory = async () => async () =>
      ({ tolist: () => [[[1, 2, 3]]] });
    const e = new TransformersEmbedder({ dimensions: 3, pipelineFactory: factory });
    await expect(e.embed(['a', 'b'])).rejects.toThrow(/1 vector.* for 2 inputs|vectors for 2 inputs/);
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
    const e = new TransformersEmbedder({ dimensions: 3, pipelineFactory: factory });
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

  it('does NOT mutate process.env.HF_HOME at construction (cheap, side-effect-free createClient)', () => {
    // u84-3: the ctor used to write process.env.HF_HOME = cacheDir, so the
    // last-constructed embedder silently rebound the cache dir for everyone.
    const before = process.env.HF_HOME;
    try {
      new TransformersEmbedder({ cacheDir: '/tmp/cacheA', pipelineFactory: stubFactory([]) });
      new TransformersEmbedder({ cacheDir: '/tmp/cacheB', pipelineFactory: stubFactory([]) });
      // No global clobber: HF_HOME is untouched by construction.
      expect(process.env.HF_HOME).toBe(before);
    } finally {
      if (before === undefined) delete process.env.HF_HOME;
      else process.env.HF_HOME = before;
    }
  });

  it('does not touch HF_HOME when an injected pipelineFactory is used (no real load)', async () => {
    // The injected-factory path (tests/embedded use) must never set the global,
    // since it isn't loading the HF module at all.
    const before = process.env.HF_HOME;
    try {
      const e = new TransformersEmbedder({
        cacheDir: '/tmp/cacheC',
        dimensions: 3,
        pipelineFactory: stubFactory([[1, 2, 3]]),
      });
      await e.embed(['x']);
      expect(process.env.HF_HOME).toBe(before);
    } finally {
      if (before === undefined) delete process.env.HF_HOME;
      else process.env.HF_HOME = before;
    }
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
    const e = new TransformersEmbedder({ dimensions: 1, pipelineFactory: factory, batchSize: 2 });

    const out = await e.embed(['1', '2', '3', '4', '5']);
    // 5 inputs / batch 2 -> ceil = 3 extractor calls.
    expect(seen).toEqual([['1', '2'], ['3', '4'], ['5']]);
    // Output order/length preserved across the chunk boundary.
    expect(out).toEqual([[1], [2], [3], [4], [5]]);
  });

  it('throws when the model emits a different vector length than the declared dim', async () => {
    // Stale KNOWN_DIMS / quantized model / wrong override: a known-dim model that
    // actually returns a different width must fail loud, not silently build the
    // memory index at one dim while emitting another.
    const factory: PipelineFactory = async () => async (input) => {
      const inputs = Array.isArray(input) ? input : [input];
      return { tolist: () => inputs.map(() => [0.1, 0.2]) }; // dim 2
    };
    // Default model declares dim 384 — observed dim 2 must throw.
    const e = new TransformersEmbedder({ pipelineFactory: factory });
    await expect(e.embed(['a'])).rejects.toThrow(/2-dim vectors.*declares dim 384/);
  });

  it('accepts any vector length for a dynamic-dim (unknown) model', async () => {
    const factory: PipelineFactory = async () => async (input) => {
      const inputs = Array.isArray(input) ? input : [input];
      return { tolist: () => inputs.map(() => [1, 2, 3, 4]) };
    };
    const e = new TransformersEmbedder({ model: 'Xenova/unknown', pipelineFactory: factory });
    expect(e.dim).toBe('dynamic');
    expect(await e.embed(['a'])).toEqual([[1, 2, 3, 4]]);
  });

  it('bakes the dimensions override into name (no collision across dim variants)', () => {
    const base = new TransformersEmbedder({ model: 'Xenova/foo', pipelineFactory: stubFactory([]) });
    const truncated = new TransformersEmbedder({
      model: 'Xenova/foo',
      dimensions: 256,
      pipelineFactory: stubFactory([]),
    });
    expect(base.name).toBe('transformers:Xenova/foo');
    expect(truncated.name).toBe('transformers:Xenova/foo:256');
    expect(base.name).not.toBe(truncated.name);
  });

  it('passes truncation:true to the extractor so over-long inputs are bounded', async () => {
    const opts: Array<Record<string, unknown> | undefined> = [];
    const factory: PipelineFactory = async () => async (input, o) => {
      const inputs = Array.isArray(input) ? input : [input];
      opts.push(o);
      return { tolist: () => inputs.map(() => [1]) };
    };
    const e = new TransformersEmbedder({ dimensions: 1, pipelineFactory: factory });
    await e.embed(['x']);
    expect(opts[0]).toMatchObject({ truncation: true, pooling: 'mean', normalize: true });
  });

  it('throws on a zero-length vector (3D empty-sequence / partial-load row)', async () => {
    // A 0-dim embedding cosines to 0 against everything → silently dead-last
    // ranking for that record. Must fail loud, not slip through the dim check.
    const factory: PipelineFactory = async () => async () =>
      ({ tolist: () => [[[]]] }); // 3D, batch-of-1, empty sequence → empty vector
    const e = new TransformersEmbedder({ model: 'Xenova/unknown', pipelineFactory: factory });
    await expect(e.embed(['a'])).rejects.toThrow(/zero-length vector/);
  });

  it('throws on a ragged batch (vectors of differing lengths within one call)', async () => {
    // cosineSimilarity zips to Math.min(len) and never errors, so a short row
    // would silently misrank. The per-vector dim check must reject the batch.
    const factory: PipelineFactory = async () => async (input) => {
      const inputs = Array.isArray(input) ? input : [input];
      // First vector dim 3, second dim 2 — ragged.
      return { tolist: () => inputs.map((_, i) => (i === 0 ? [1, 2, 3] : [1, 2])) };
    };
    const e = new TransformersEmbedder({ model: 'Xenova/unknown', pipelineFactory: factory });
    await expect(e.embed(['a', 'b'])).rejects.toThrow(/ragged batch/);
  });

  it('throws on a ragged batch even across chunk boundaries', async () => {
    // The dim is established on the first chunk's first vector and enforced for
    // every later chunk, so a width change in a later chunk is still caught.
    let call = 0;
    const factory: PipelineFactory = async () => async (input) => {
      const inputs = Array.isArray(input) ? input : [input];
      call++;
      // Chunk 1 emits dim 3, chunk 2 emits dim 4.
      const width = call === 1 ? 3 : 4;
      return { tolist: () => inputs.map(() => Array(width).fill(1)) };
    };
    const e = new TransformersEmbedder({
      model: 'Xenova/unknown',
      pipelineFactory: factory,
      batchSize: 2,
    });
    await expect(e.embed(['a', 'b', 'c'])).rejects.toThrow(/ragged batch/);
  });

  it('coerces a non-string (null/number) input to "" instead of crashing', async () => {
    // embed() is typed ReadonlyArray<string> but an untyped/hostile caller can
    // smuggle a non-string through; it must degrade (empty string), not throw a
    // TypeError that takes down the whole recall.
    const received: string[] = [];
    const factory: PipelineFactory = async () => async (input) => {
      const inputs = (Array.isArray(input) ? input : [input]) as string[];
      received.push(...inputs);
      return { tolist: () => inputs.map(() => [1]) };
    };
    const e = new TransformersEmbedder({ dimensions: 1, pipelineFactory: factory });
    // Cast through unknown to model a hostile/untyped caller.
    const hostile = ['ok', null, 42] as unknown as ReadonlyArray<string>;
    const out = await e.embed(hostile);
    // One vector per input, positionally aligned; non-strings became ''.
    expect(out).toHaveLength(3);
    expect(received).toEqual(['ok', '', '']);
  });

  it('clamps a pathologically huge input to a bounded byte length before embedding', async () => {
    let receivedLen = -1;
    const factory: PipelineFactory = async () => async (input) => {
      const inputs = (Array.isArray(input) ? input : [input]) as string[];
      receivedLen = inputs[0]!.length;
      return { tolist: () => inputs.map(() => [1]) };
    };
    const e = new TransformersEmbedder({ dimensions: 1, pipelineFactory: factory });
    const huge = 'a'.repeat(5 * 1024 * 1024); // 5 MB
    await e.embed([huge]);
    // The extractor must never see the full 5 MB input; it is clamped to the cap.
    expect(receivedLen).toBeLessThanOrEqual(64 * 1024);
    expect(receivedLen).toBeGreaterThan(0);
  });
});
