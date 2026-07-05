import { describe, expect, it } from 'vitest';

import { MOXXY_PCM16_24KHZ_MIME } from '@moxxy/sdk';
import { ensureModel } from '@moxxy/model-fetch';

import {
  createLocalWhisperTranscriber,
  type LocalWhisperOptions,
} from './local-stt.js';
import { buildLocalSttPlugin, LOCAL_WHISPER_TRANSCRIBER_NAME } from './index.js';
import type { HostClientLike } from './host-client.js';
import type { HostRequest, TranscribeResult } from './host-protocol.js';

/** Raw PCM16 mono little-endian bytes (the moxxy mic contract) for N samples. */
function rawPcm16(n: number, value = 0.3): Uint8Array {
  const bytes = new Uint8Array(n * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < n; i += 1) view.setInt16(i * 2, Math.round(value * 32767), true);
  return bytes;
}

const AUDIO = rawPcm16(240); // 240 @24k → 160 @16k after resample

/** A fake host recording each transcribe request; returns a canned result. */
function fakeHost(result: TranscribeResult = { text: 'hello world' }): {
  host: HostClientLike;
  reqs: Array<Omit<HostRequest, 'id' | 'type'>>;
  shutdowns: number;
} {
  const state = { reqs: [] as Array<Omit<HostRequest, 'id' | 'type'>>, shutdowns: 0 };
  const host: HostClientLike = {
    async transcribe(req) {
      state.reqs.push(req);
      return result;
    },
    shutdown() {
      state.shutdowns += 1;
    },
  };
  return {
    host,
    get reqs() {
      return state.reqs;
    },
    get shutdowns() {
      return state.shutdowns;
    },
  };
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

function makeTranscriber(
  over: Partial<LocalWhisperOptions> = {},
  result?: TranscribeResult,
): {
  transcriber: ReturnType<typeof createLocalWhisperTranscriber>;
  host: ReturnType<typeof fakeHost>;
  ensure: ReturnType<typeof fakeEnsure>;
} {
  const host = fakeHost(result);
  const ensure = fakeEnsure();
  const transcriber = createLocalWhisperTranscriber({
    modelsDir: '/models/stt',
    ensureModelImpl: ensure.impl,
    hostFactory: () => host.host,
    log: () => {},
    ...over,
  });
  return { transcriber, host, ensure };
}

describe('LocalWhisperTranscriber.transcribe', () => {
  it('defaults to the base model, decodes raw PCM, and returns the transcript', async () => {
    const { transcriber, host, ensure } = makeTranscriber();
    const out = await transcriber.transcribe(AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME });
    expect(out.text).toBe('hello world');
    expect(ensure.urls).toEqual([
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.tar.bz2',
    ]);
    const req = host.reqs[0]!;
    expect(req.encoder).toContain('sherpa-onnx-whisper-base/base-encoder.onnx');
    expect(req.decoder).toContain('base-decoder.onnx');
    expect(req.tokens).toContain('base-tokens.txt');
    expect(req.sampleRate).toBe(16_000);
    expect(req.samples.length).toBe(160); // resampled 24k → 16k
    expect(req.task).toBe('transcribe');
    expect(out.durationSec).toBeCloseTo(160 / 16_000, 6);
  });

  it('selects a configured model (small) and its files', async () => {
    const { transcriber, host, ensure } = makeTranscriber({ model: 'small' });
    await transcriber.transcribe(AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME });
    expect(ensure.urls[0]).toContain('sherpa-onnx-whisper-small.tar.bz2');
    expect(host.reqs[0]!.encoder).toContain('small-encoder.onnx');
  });

  it('passes a per-call language hint through to the recognizer', async () => {
    const { transcriber, host } = makeTranscriber();
    await transcriber.transcribe(AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME, language: 'pl' });
    expect(host.reqs[0]!.language).toBe('pl');
  });

  it('falls back to the configured default language when no per-call hint is given', async () => {
    const { transcriber, host } = makeTranscriber({ language: 'en' });
    await transcriber.transcribe(AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME });
    expect(host.reqs[0]!.language).toBe('en');
  });

  it('sends an empty language (auto-detect) when neither is set', async () => {
    const { transcriber, host } = makeTranscriber();
    await transcriber.transcribe(AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME });
    expect(host.reqs[0]!.language).toBe('');
  });

  it('prefers the language the recognizer detected in the result', async () => {
    const { transcriber } = makeTranscriber({ language: 'en' }, { text: 'cześć', language: 'pl' });
    const out = await transcriber.transcribe(AUDIO, {
      mimeType: MOXXY_PCM16_24KHZ_MIME,
      language: 'en',
    });
    expect(out.language).toBe('pl');
  });

  it('reports the hint language when the recognizer returns none', async () => {
    const { transcriber } = makeTranscriber({}, { text: 'x' });
    const out = await transcriber.transcribe(AUDIO, {
      mimeType: MOXXY_PCM16_24KHZ_MIME,
      language: 'de',
    });
    expect(out.language).toBe('de');
  });

  it('downloads the model only once across calls', async () => {
    const { transcriber, ensure } = makeTranscriber();
    await transcriber.transcribe(AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME });
    await transcriber.transcribe(AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME });
    await transcriber.transcribe(AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME });
    expect(ensure.urls.length).toBe(1);
  });

  it('returns empty text for empty/silent audio without touching the model', async () => {
    const { transcriber, host, ensure } = makeTranscriber();
    const out = await transcriber.transcribe(new Uint8Array(0), { mimeType: MOXXY_PCM16_24KHZ_MIME });
    expect(out.text).toBe('');
    expect(ensure.urls.length).toBe(0);
    expect(host.reqs.length).toBe(0);
  });

  it('respects a pre-aborted signal', async () => {
    const { transcriber } = makeTranscriber();
    const ac = new AbortController();
    ac.abort(new Error('stop'));
    await expect(
      transcriber.transcribe(AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME, signal: ac.signal }),
    ).rejects.toThrow(/stop/);
  });

  it('trims whitespace from the transcript', async () => {
    const { transcriber } = makeTranscriber({}, { text: '  padded  ' });
    const out = await transcriber.transcribe(AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME });
    expect(out.text).toBe('padded');
  });

  it('shutdown tears down the host', async () => {
    const { transcriber, host } = makeTranscriber();
    await transcriber.transcribe(AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME });
    transcriber.shutdown();
    expect(host.shutdowns).toBe(1);
  });
});

describe('constructor validation', () => {
  it('throws CONFIG_INVALID for an unknown configured model', () => {
    expect(() => createLocalWhisperTranscriber({ model: 'medium' })).toThrow(
      /Unknown local Whisper model/,
    );
  });
});

describe('buildLocalSttPlugin', () => {
  it('registers exactly one transcriber named local-whisper', () => {
    const plugin = buildLocalSttPlugin();
    expect(plugin.transcribers).toHaveLength(1);
    const def = plugin.transcribers![0]!;
    expect(def.name).toBe(LOCAL_WHISPER_TRANSCRIBER_NAME);
    expect(def.displayName).toContain('Local Whisper');
  });

  it('createClient() flows per-activation model config through to routing', async () => {
    const host = fakeHost();
    const ensure = fakeEnsure();
    const plugin = buildLocalSttPlugin({
      defaults: {
        modelsDir: '/models/stt',
        ensureModelImpl: ensure.impl,
        hostFactory: () => host.host,
        log: () => {},
      },
    });
    const inst = plugin.transcribers![0]!.createClient({ model: 'small', language: 'pl' });
    await inst.transcribe(AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME });
    expect(ensure.urls[0]).toContain('sherpa-onnx-whisper-small.tar.bz2');
    expect(host.reqs[0]!.language).toBe('pl');
  });

  it('createClient() rejects an unknown model in config at construction', () => {
    const plugin = buildLocalSttPlugin();
    expect(() => plugin.transcribers![0]!.createClient({ model: 'bad-id' })).toThrow();
  });

  it('exposes an onShutdown hook', () => {
    const plugin = buildLocalSttPlugin();
    expect(typeof plugin.hooks?.onShutdown).toBe('function');
  });
});
