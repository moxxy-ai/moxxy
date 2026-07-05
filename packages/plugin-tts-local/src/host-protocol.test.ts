import { describe, expect, it } from 'vitest';
import {
  createMessageHandler,
  type HostRequest,
  type SherpaModule,
  type SherpaOfflineTts,
} from './host-protocol.js';

function req(over: Partial<HostRequest> = {}): HostRequest {
  return {
    id: 1,
    type: 'synthesize',
    voiceKey: '/models/en/model.onnx',
    model: '/models/en/model.onnx',
    tokens: '/models/en/tokens.txt',
    dataDir: '/models/en/espeak-ng-data',
    numThreads: 2,
    provider: 'cpu',
    text: 'hello',
    sid: 0,
    speed: 1,
    ...over,
  };
}

/** A fake sherpa module recording how many OfflineTts instances + generate
 *  calls it saw, with configurable behaviour. */
function fakeSherpa(opts: {
  onGenerate?: (args: { text: string; sid: number; speed: number }) => {
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
    async generateAsync(args: { text: string; sid: number; speed: number }): Promise<{
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

  it('passes the vits model config through to sherpa', async () => {
    const s = fakeSherpa();
    const handle = createMessageHandler(() => s.module);
    await handle(req());
    expect(s.lastConfig).toMatchObject({
      model: {
        vits: { model: '/models/en/model.onnx', tokens: '/models/en/tokens.txt', dataDir: '/models/en/espeak-ng-data' },
        numThreads: 2,
        provider: 'cpu',
      },
      maxNumSentences: 1,
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
    await handle(req({ id: 3, voiceKey: '/models/pl/model.onnx', model: '/models/pl/model.onnx' }));
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
