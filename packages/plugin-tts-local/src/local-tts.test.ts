import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { ensureModel } from '@moxxy/model-fetch';

import {
  clampSpeed,
  createLocalPiperSynthesizer,
  type LocalPiperOptions,
} from './local-tts.js';
import { buildLocalTtsPlugin, LOCAL_PIPER_SYNTHESIZER_NAME } from './index.js';
import type { HostClientLike } from './host-client.js';
import type { HostRequest } from './host-protocol.js';

/** A fake host recording each synthesize request; returns canned samples. */
function fakeHost(): { host: HostClientLike; reqs: Array<Omit<HostRequest, 'id' | 'type'>>; shutdowns: number } {
  const state = { reqs: [] as Array<Omit<HostRequest, 'id' | 'type'>>, shutdowns: 0 };
  const host: HostClientLike = {
    async synthesize(req) {
      state.reqs.push(req);
      return { samples: new Float32Array([0.1, -0.1, 0.2]), sampleRate: 22050 };
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

function makeSynth(over: Partial<LocalPiperOptions> = {}): {
  synth: ReturnType<typeof createLocalPiperSynthesizer>;
  host: ReturnType<typeof fakeHost>;
  ensure: ReturnType<typeof fakeEnsure>;
} {
  const host = fakeHost();
  const ensure = fakeEnsure();
  const synth = createLocalPiperSynthesizer({
    modelsDir: '/models/tts',
    ensureModelImpl: ensure.impl,
    hostFactory: () => host.host,
    log: () => {},
    ...over,
  });
  return { synth, host, ensure };
}

describe('LocalPiperSynthesizer.synthesize', () => {
  it('defaults to the English voice and returns WAV bytes', async () => {
    const { synth, host, ensure } = makeSynth();
    const out = await synth.synthesize('hello world');
    expect(out.mimeType).toBe('audio/wav');
    expect(String.fromCharCode(...out.audio.subarray(0, 4))).toBe('RIFF');
    expect(ensure.urls).toEqual([
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-amy-medium.tar.bz2',
    ]);
    // The host got the en model path + default sid/speed.
    expect(host.reqs[0]!.model).toBe(path.join('/models/tts/en_US-amy-medium/vits-piper-en_US-amy-medium/en_US-amy-medium.onnx'));
    expect(host.reqs[0]!.dataDir).toContain('espeak-ng-data');
    expect(host.reqs[0]!.text).toBe('hello world');
    expect(host.reqs[0]!.speed).toBe(1);
  });

  it('routes a Polish language hint to the configured Polish voice', async () => {
    const { synth, host, ensure } = makeSynth();
    await synth.synthesize('cześć', { language: 'pl-PL' });
    expect(ensure.urls[0]).toContain('vits-piper-pl_PL-gosia-medium');
    expect(host.reqs[0]!.model).toContain('pl_PL-gosia-medium');
  });

  it('lets an explicit voice override language routing', async () => {
    const { synth, host } = makeSynth();
    await synth.synthesize('lektor', { language: 'pl', voice: 'pl_PL-darkman-medium' });
    expect(host.reqs[0]!.model).toContain('pl_PL-darkman-medium');
  });

  it('honors a configured polishVoice default', async () => {
    const { synth, host } = makeSynth({ polishVoice: 'pl_PL-darkman-medium' });
    await synth.synthesize('dzień dobry', { language: 'pl' });
    expect(host.reqs[0]!.model).toContain('pl_PL-darkman-medium');
  });

  it('rejects an unknown requested voice with a clear error', async () => {
    const { synth } = makeSynth();
    await expect(synth.synthesize('x', { voice: 'no-such-voice' })).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    });
  });

  it('downloads a given voice only once across calls', async () => {
    const { synth, ensure } = makeSynth();
    await synth.synthesize('one');
    await synth.synthesize('two');
    await synth.synthesize('three');
    expect(ensure.urls.length).toBe(1); // en voice ensured once
  });

  it('maps and clamps rate onto sherpa speed', async () => {
    const { synth, host } = makeSynth();
    await synth.synthesize('fast', { rate: 5 });
    await synth.synthesize('slow', { rate: 0.1 });
    await synth.synthesize('normal');
    expect(host.reqs.map((r) => r.speed)).toEqual([2.0, 0.5, 1.0]);
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
    expect(host.reqs[0]!.sid).toBe(0);
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

describe('constructor validation', () => {
  it('throws CONFIG_INVALID for an unknown configured voice', () => {
    expect(() => createLocalPiperSynthesizer({ voice: 'bogus' })).toThrow(/Unknown local voice/);
  });
  it('throws CONFIG_INVALID for an unknown configured polishVoice', () => {
    expect(() => createLocalPiperSynthesizer({ polishVoice: 'nope' })).toThrow(/Unknown local voice/);
  });
});

describe('buildLocalTtsPlugin', () => {
  it('registers exactly one synthesizer named local-piper', () => {
    const plugin = buildLocalTtsPlugin();
    expect(plugin.synthesizers).toHaveLength(1);
    const def = plugin.synthesizers![0]!;
    expect(def.name).toBe(LOCAL_PIPER_SYNTHESIZER_NAME);
    expect(def.displayName).toContain('Local');
  });

  it('create() flows per-activation voice config through to routing', async () => {
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
    const inst = plugin.synthesizers![0]!.create({ config: { voice: 'pl_PL-gosia-medium' } });
    await inst.synthesize('cześć');
    expect(host.reqs[0]!.model).toContain('pl_PL-gosia-medium');
  });

  it('create() rejects an unknown voice in config at construction', () => {
    const plugin = buildLocalTtsPlugin();
    expect(() => plugin.synthesizers![0]!.create({ config: { voice: 'bad-id' } })).toThrow();
  });

  it('exposes an onShutdown hook', () => {
    const plugin = buildLocalTtsPlugin();
    expect(typeof plugin.hooks?.onShutdown).toBe('function');
  });
});
