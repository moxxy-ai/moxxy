import { describe, expect, it } from 'vitest';
import {
  copySamplesForIpc,
  createMessageHandler,
  type HostRequest,
  type SherpaGenerateArgs,
  type SherpaModule,
  type SherpaOfflineTts,
} from './host-protocol.js';

describe('copySamplesForIpc', () => {
  it('owns a fresh ArrayBuffer before samples cross Electron IPC', () => {
    const nativeSamples = new Float32Array([0.25, -0.5, 1]);

    const copied = copySamplesForIpc(nativeSamples);

    expect(copied).not.toBe(nativeSamples);
    expect(copied.buffer).not.toBe(nativeSamples.buffer);
    expect(Array.from(copied)).toEqual([0.25, -0.5, 1]);
  });
});

const MODEL = {
  durationPredictor: '/models/supertonic/duration_predictor.int8.onnx',
  textEncoder: '/models/supertonic/text_encoder.int8.onnx',
  vectorEstimator: '/models/supertonic/vector_estimator.int8.onnx',
  vocoder: '/models/supertonic/vocoder.int8.onnx',
  ttsJson: '/models/supertonic/tts.json',
  unicodeIndexer: '/models/supertonic/unicode_indexer.bin',
  voiceStyle: '/models/supertonic/voice.bin',
};

function req(over: Partial<HostRequest> = {}): HostRequest {
  return {
    id: 1,
    type: 'synthesize',
    voiceKey: '/models/supertonic/vocoder.int8.onnx',
    model: MODEL,
    numThreads: 2,
    provider: 'cpu',
    text: 'hello',
    sid: 1,
    speed: 1,
    lang: 'en',
    numSteps: 8,
    ...over,
  };
}

/** A fake sherpa module recording how many OfflineTts instances + generate
 *  calls it saw, with configurable behaviour. */
function fakeSherpa(opts: {
  onGenerate?: (args: SherpaGenerateArgs) => {
    samples: Float32Array;
    sampleRate: number;
  };
  throwOnConstruct?: boolean;
  throwOnGenerate?: boolean;
} = {}): { module: SherpaModule; constructed: number; generated: number; lastConfig: unknown } {
  const state = { constructed: 0, generated: 0, lastConfig: undefined as unknown };
  class FakeTts implements SherpaOfflineTts {
    constructor(config: unknown) {
      if (opts.throwOnConstruct) throw new Error('addon failed to load libonnxruntime.dylib');
      state.constructed += 1;
      state.lastConfig = config;
    }
    async generateAsync(args: SherpaGenerateArgs): Promise<{
      samples: Float32Array;
      sampleRate: number;
    }> {
      state.generated += 1;
      if (opts.throwOnGenerate) throw new Error('generate blew up');
      return opts.onGenerate?.(args) ?? { samples: new Float32Array([0.1, 0.2]), sampleRate: 22050 };
    }
  }
  return {
    module: { OfflineTts: FakeTts as unknown as SherpaModule['OfflineTts'] },
    get constructed() {
      return state.constructed;
    },
    get generated() {
      return state.generated;
    },
    get lastConfig() {
      return state.lastConfig;
    },
  };
}

describe('createMessageHandler', () => {
  it('synthesizes and returns samples + sampleRate', async () => {
    const s = fakeSherpa({ onGenerate: () => ({ samples: new Float32Array([1, -1]), sampleRate: 16000 }) });
    const handle = createMessageHandler(() => s.module);
    const reply = await handle(req({ id: 7, text: 'hi', speed: 1.25 }));
    expect(reply).toMatchObject({ id: 7, ok: true, sampleRate: 16000 });
    if (reply.ok) expect(Array.from(reply.samples)).toEqual([1, -1]);
  });

  it('passes the Supertonic model config through to sherpa', async () => {
    const s = fakeSherpa();
    const handle = createMessageHandler(() => s.module);
    await handle(req());
    expect(s.lastConfig).toMatchObject({
      model: { supertonic: MODEL, numThreads: 2, provider: 'cpu' },
      maxNumSentences: 1,
    });
  });

  it('asks for the voice, pace, steps and language of the request', async () => {
    let seen: SherpaGenerateArgs | undefined;
    const s = fakeSherpa({
      onGenerate: (args) => {
        seen = args;
        return { samples: new Float32Array([0.5]), sampleRate: 44_100 };
      },
    });
    const handle = createMessageHandler(() => s.module);
    await handle(req({ text: 'cześć', speed: 1.06, lang: 'pl' }));
    expect(seen).toEqual({
      text: 'cześć',
      enableExternalBuffer: false,
      generationConfig: { sid: 1, speed: 1.06, numSteps: 8, extra: { lang: 'pl' } },
    });
  });

  it('caches one OfflineTts per voiceKey (loads the model once)', async () => {
    const s = fakeSherpa();
    let loads = 0;
    const handle = createMessageHandler(() => {
      loads += 1;
      return s.module;
    });
    await handle(req({ id: 1 }));
    await handle(req({ id: 2 }));
    await handle(req({ id: 3, voiceKey: '/models/other/vocoder.int8.onnx' }));
    expect(loads).toBe(1); // module loaded once
    expect(s.constructed).toBe(2); // one OfflineTts per distinct voiceKey
    expect(s.generated).toBe(3);
  });

  it('classifies a load/construct failure as an init error', async () => {
    const s = fakeSherpa({ throwOnConstruct: true });
    const handle = createMessageHandler(() => s.module);
    const reply = await handle(req());
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.kind).toBe('init');
  });

  it('classifies a load-time throw as an init error', async () => {
    const handle = createMessageHandler(() => {
      throw new Error('cannot find module sherpa-onnx-node');
    });
    const reply = await handle(req());
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.kind).toBe('init');
  });

  it('classifies a synthesis failure as a runtime error', async () => {
    const s = fakeSherpa({ throwOnGenerate: true });
    const handle = createMessageHandler(() => s.module);
    const reply = await handle(req());
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.kind).toBe('runtime');
  });
});
