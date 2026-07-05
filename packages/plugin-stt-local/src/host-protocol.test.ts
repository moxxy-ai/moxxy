import { describe, expect, it } from 'vitest';
import {
  createMessageHandler,
  type HostRequest,
  type SherpaModule,
  type SherpaOfflineRecognizer,
  type SherpaOfflineRecognizerResult,
  type SherpaOfflineStream,
} from './host-protocol.js';

function req(over: Partial<HostRequest> = {}): HostRequest {
  return {
    id: 1,
    type: 'transcribe',
    modelKey: '/models/base/base-encoder.onnx',
    encoder: '/models/base/base-encoder.onnx',
    decoder: '/models/base/base-decoder.onnx',
    tokens: '/models/base/base-tokens.txt',
    numThreads: 2,
    provider: 'cpu',
    language: '',
    task: 'transcribe',
    samples: new Float32Array([0.1, -0.1, 0.2]),
    sampleRate: 16_000,
    ...over,
  };
}

/** A fake sherpa module recording constructions + decode calls, with
 *  configurable text/behaviour. */
function fakeSherpa(
  opts: {
    text?: string;
    lang?: string;
    throwOnConstruct?: boolean;
    throwOnDecode?: boolean;
  } = {},
): {
  module: SherpaModule;
  constructed: number;
  decoded: number;
  lastConfig: unknown;
  lastSamples: Float32Array | null;
} {
  const state = {
    constructed: 0,
    decoded: 0,
    lastConfig: undefined as unknown,
    lastSamples: null as Float32Array | null,
  };
  class FakeStream implements SherpaOfflineStream {
    accepted: Float32Array | null = null;
    acceptWaveform(args: { sampleRate: number; samples: Float32Array }): void {
      this.accepted = args.samples;
      state.lastSamples = args.samples;
    }
  }
  class FakeRecognizer implements SherpaOfflineRecognizer {
    constructor(config: unknown) {
      if (opts.throwOnConstruct) throw new Error('addon failed to load libonnxruntime.dylib');
      state.constructed += 1;
      state.lastConfig = config;
    }
    createStream(): SherpaOfflineStream {
      return new FakeStream();
    }
    decode(): void {
      state.decoded += 1;
      if (opts.throwOnDecode) throw new Error('decode blew up');
    }
    getResult(): SherpaOfflineRecognizerResult {
      return opts.lang !== undefined
        ? { text: opts.text ?? 'hello world', lang: opts.lang }
        : { text: opts.text ?? 'hello world' };
    }
  }
  return {
    module: { OfflineRecognizer: FakeRecognizer as unknown as SherpaModule['OfflineRecognizer'] },
    get constructed() {
      return state.constructed;
    },
    get decoded() {
      return state.decoded;
    },
    get lastConfig() {
      return state.lastConfig;
    },
    get lastSamples() {
      return state.lastSamples;
    },
  };
}

describe('createMessageHandler', () => {
  it('transcribes and returns the text', async () => {
    const s = fakeSherpa({ text: 'the quick brown fox' });
    const handle = createMessageHandler(() => s.module);
    const reply = await handle(req({ id: 7 }));
    expect(reply).toMatchObject({ id: 7, ok: true, text: 'the quick brown fox' });
    expect(s.lastSamples).toEqual(new Float32Array([0.1, -0.1, 0.2]));
  });

  it('passes the whisper model config (encoder/decoder/tokens/language/task) through', async () => {
    const s = fakeSherpa();
    const handle = createMessageHandler(() => s.module);
    await handle(req({ language: 'pl', task: 'transcribe' }));
    expect(s.lastConfig).toMatchObject({
      featConfig: { sampleRate: 16_000, featureDim: 80 },
      modelConfig: {
        whisper: {
          encoder: '/models/base/base-encoder.onnx',
          decoder: '/models/base/base-decoder.onnx',
          language: 'pl',
          task: 'transcribe',
        },
        tokens: '/models/base/base-tokens.txt',
        numThreads: 2,
        provider: 'cpu',
      },
    });
  });

  it('surfaces a detected language when the native result reports one', async () => {
    const s = fakeSherpa({ text: 'cześć', lang: 'pl' });
    const handle = createMessageHandler(() => s.module);
    const reply = await handle(req());
    expect(reply).toMatchObject({ ok: true, text: 'cześć', language: 'pl' });
  });

  it('caches one OfflineRecognizer per modelKey (loads the model once)', async () => {
    const s = fakeSherpa();
    let loads = 0;
    const handle = createMessageHandler(() => {
      loads += 1;
      return s.module;
    });
    await handle(req({ id: 1 }));
    await handle(req({ id: 2 }));
    await handle(
      req({ id: 3, modelKey: '/models/small/small-encoder.onnx', encoder: '/models/small/small-encoder.onnx' }),
    );
    expect(loads).toBe(1); // module loaded once
    expect(s.constructed).toBe(2); // one recognizer per distinct modelKey
    expect(s.decoded).toBe(3);
  });

  it('classifies a construct failure as an init error', async () => {
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

  it('classifies a decode failure as a runtime error', async () => {
    const s = fakeSherpa({ throwOnDecode: true });
    const handle = createMessageHandler(() => s.module);
    const reply = await handle(req());
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.kind).toBe('runtime');
  });
});
