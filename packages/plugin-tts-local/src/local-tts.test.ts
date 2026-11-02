import { describe, expect, it } from 'vitest';

import type { ensureModel } from '@moxxy/model-fetch';

import {
  clampSpeed,
  createLocalSupertonicSynthesizer,
  type LocalSupertonicOptions,
} from './local-tts.js';
import {
  buildLocalTtsPlugin,
  LEGACY_PIPER_SYNTHESIZER_NAME,
  LOCAL_SUPERTONIC_SYNTHESIZER_NAME,
} from './index.js';
import { DEFAULT_VOICE, SPEAKING_PACE, voiceModelPaths } from './voices.js';
import { SILENCE_KEPT_AFTER_MS, SILENCE_KEPT_BEFORE_MS } from './trim-silence.js';
import { WAV_HEADER_BYTES } from './wav.js';
import type { HostClientLike } from './host-client.js';
import type { HostRequest } from './host-protocol.js';

/** A fake host recording each synthesize request; returns canned samples. */
function fakeHost(): { host: HostClientLike; reqs: Array<Omit<HostRequest, 'id' | 'type'>>; shutdowns: number } {
  const state = { reqs: [] as Array<Omit<HostRequest, 'id' | 'type'>>, shutdowns: 0 };
  const host: HostClientLike = {
    async synthesize(req) {
      state.reqs.push(req);
      return { samples: new Float32Array([0.1, -0.1, 0.2]), sampleRate: 44_100 };
    },
    shutdown() {
      state.shutdowns += 1;
    },
  };
  return { host, get reqs() {
    return state.reqs;
  }, get shutdowns() {
    return state.shutdowns;
  } };
}

/** A fake ensureModel recording the urls it was asked to fetch. */
function fakeEnsure(): { impl: typeof ensureModel; urls: string[] } {
  const urls: string[] = [];
  const impl = (async (opts: Parameters<typeof ensureModel>[0]) => {
    urls.push(opts.url);
    return { dir: opts.dir, skipped: false };
  }) as unknown as typeof ensureModel;
  return { impl, urls };
}

function makeSynth(over: Partial<LocalSupertonicOptions> = {}): {
  synth: ReturnType<typeof createLocalSupertonicSynthesizer>;
  host: ReturnType<typeof fakeHost>;
  ensure: ReturnType<typeof fakeEnsure>;
} {
  const host = fakeHost();
  const ensure = fakeEnsure();
  const synth = createLocalSupertonicSynthesizer({
    modelsDir: '/models/tts',
    ensureModelImpl: ensure.impl,
    hostFactory: () => host.host,
    log: () => {},
    ...over,
  });
  return { synth, host, ensure };
}

describe('LocalSupertonicSynthesizer.synthesize', () => {
  it('sends the spoken form of the text, in the language of the original', async () => {
    const { synth, host } = makeSynth();
    await synth.synthesize('Koszt to 1500 zł.', { language: 'pl' });
    await synth.synthesize('It costs $1,500.', { language: 'en' });
    expect(host.reqs.map((req) => req.text)).toEqual([
      'Koszt to tysiąc pięćset złotych.',
      'It costs one thousand five hundred dollars.',
    ]);
  });

  it('fetches the pinned voice and returns WAV bytes', async () => {
    const { synth, host, ensure } = makeSynth();
    const out = await synth.synthesize('hello there world');
    expect(out.mimeType).toBe('audio/wav');
    expect(String.fromCharCode(...out.audio.subarray(0, 4))).toBe('RIFF');
    expect(ensure.urls).toEqual([DEFAULT_VOICE.url]);
    expect(host.reqs[0]!.model).toEqual(voiceModelPaths(DEFAULT_VOICE, '/models/tts'));
    expect(host.reqs[0]!.text).toBe('hello there world');
    expect(host.reqs[0]!.speed).toBe(SPEAKING_PACE);
    expect(host.reqs[0]!.sid).toBe(1);
    expect(host.reqs[0]!.numSteps).toBe(8);
  });

  it('passes a Polish language hint to the model', async () => {
    const { synth, host } = makeSynth();
    await synth.synthesize('cześć', { language: 'pl-PL' });
    expect(host.reqs[0]!.lang).toBe('pl');
  });

  it('reads the language from the text when no hint is given', async () => {
    const { synth, host } = makeSynth();
    await synth.synthesize('Dzień dobry, czy to już działa?');
    expect(host.reqs[0]!.lang).toBe('pl');
  });

  it('keeps speaking when an old voice id is asked for', async () => {
    const { synth, host } = makeSynth();
    await synth.synthesize('lektor', { language: 'pl', voice: 'pl_PL-darkman-medium' });
    await synth.synthesize('lektor', { language: 'pl', voice: 'no-such-voice' });
    expect(host.reqs.map((r) => r.sid)).toEqual([1, 1]);
  });

  it('downloads the voice only once across calls', async () => {
    const { synth, ensure } = makeSynth();
    await synth.synthesize('one');
    await synth.synthesize('two');
    await synth.synthesize('three');
    expect(ensure.urls.length).toBe(1);
  });

  it('maps and clamps rate onto sherpa speed', async () => {
    const { synth, host } = makeSynth();
    await synth.synthesize('this one is fast', { rate: 5 });
    await synth.synthesize('this one is slow', { rate: 0.1 });
    await synth.synthesize('this one is normal');
    expect(host.reqs.map((r) => r.speed)).toEqual([2.0, 0.5, SPEAKING_PACE]);
  });

  it('reads at a conversational pace, keeping the small changes a sentence asks for', async () => {
    const { synth, host } = makeSynth();
    await synth.synthesize('Is this the right question?', { rate: 1.02 });
    await synth.synthesize('And then it trailed off…', { rate: 0.94 });
    expect(SPEAKING_PACE).toBe(1.3);
    expect(host.reqs.map((r) => r.speed)).toEqual([1.33, 1.22]);
  });

  it('reads a reply of one or two words at natural speed, where a faster one blurs', async () => {
    const { synth, host } = makeSynth();
    await synth.synthesize('Gotowe.', { language: 'pl' });
    await synth.synthesize('Hej!', { language: 'pl', rate: 1.06 });
    await synth.synthesize('Nie wiem.', { language: 'pl' });
    await synth.synthesize('Zaraz to sprawdzę.', { language: 'pl' });
    expect(host.reqs.map((r) => r.speed)).toEqual([1, 1.06, 1, SPEAKING_PACE]);
  });

  it('cuts the silence the model leaves around a sentence', async () => {
    const sampleRate = 44_100;
    const silence = new Float32Array(sampleRate / 2);
    const speech = new Float32Array(sampleRate / 10).fill(0.3);
    const padded = new Float32Array([...silence, ...speech, ...silence]);
    const host: HostClientLike = {
      async synthesize() {
        return { samples: padded, sampleRate };
      },
      shutdown() {},
    };
    const { synth } = makeSynth({ hostFactory: () => host });

    const out = await synth.synthesize('Gotowe.', { language: 'pl' });

    const playedMs = ((out.audio.byteLength - WAV_HEADER_BYTES) / 2 / sampleRate) * 1000;
    expect(playedMs).toBeCloseTo(SILENCE_KEPT_BEFORE_MS + 100 + SILENCE_KEPT_AFTER_MS, 0);
  });

  it('respects a pre-aborted signal', async () => {
    const { synth } = makeSynth();
    const ac = new AbortController();
    ac.abort(new Error('stop'));
    await expect(synth.synthesize('x', { signal: ac.signal })).rejects.toThrow(/stop/);
  });

  it('uses numThreads and provider defaults', async () => {
    const { synth, host } = makeSynth({ numThreads: 4 });
    await synth.synthesize('hi');
    expect(host.reqs[0]!.numThreads).toBe(4);
    expect(host.reqs[0]!.provider).toBe('cpu');
  });

  it('shutdown tears down the host', async () => {
    const { synth, host } = makeSynth();
    await synth.synthesize('hi');
    synth.shutdown();
    expect(host.shutdowns).toBe(1);
  });
});

describe('clampSpeed', () => {
  it('clamps to 0.5–2.0 and defaults absent/non-finite to 1.0', () => {
    expect(clampSpeed(undefined)).toBe(1.0);
    expect(clampSpeed(Number.NaN)).toBe(1.0);
    expect(clampSpeed(1.3)).toBe(1.3);
    expect(clampSpeed(9)).toBe(2.0);
    expect(clampSpeed(0.01)).toBe(0.5);
  });
});

describe('buildLocalTtsPlugin', () => {
  it('registers Supertonic and keeps the old name working', () => {
    const plugin = buildLocalTtsPlugin();
    expect(plugin.synthesizers?.map((def) => def.name)).toEqual([
      LOCAL_SUPERTONIC_SYNTHESIZER_NAME,
      LEGACY_PIPER_SYNTHESIZER_NAME,
    ]);
    expect(plugin.synthesizers?.[0]?.displayName).toContain('Supertonic');
  });

  it('create() accepts the voice settings an older install saved', async () => {
    const host = fakeHost();
    const ensure = fakeEnsure();
    const plugin = buildLocalTtsPlugin({
      defaults: {
        modelsDir: '/models/tts',
        ensureModelImpl: ensure.impl,
        hostFactory: () => host.host,
        log: () => {},
      },
    });
    const inst = plugin.synthesizers![1]!.create({
      config: { voice: 'pl_PL-gosia-medium', polishVoice: 'pl_PL-darkman-medium', numThreads: 3 },
    });
    await inst.synthesize('cześć');
    expect(host.reqs[0]!.sid).toBe(1);
    expect(host.reqs[0]!.numThreads).toBe(3);
  });

  it('exposes an onShutdown hook', () => {
    const plugin = buildLocalTtsPlugin();
    expect(typeof plugin.hooks?.onShutdown).toBe('function');
  });
});
