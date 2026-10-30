import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MOXXY_PCM16_24KHZ_MIME } from '@moxxy/sdk';
import type { ensureModelFiles } from '@moxxy/model-fetch';

import {
  createLocalParakeetTranscriber,
  createLocalWhisperTranscriber,
  type LocalSttOptions,
} from './local-stt.js';
import {
  buildLocalSttPlugin,
  LOCAL_PARAKEET_TRANSCRIBER_NAME,
  LOCAL_WHISPER_TRANSCRIBER_NAME,
} from './index.js';
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

/** A fake ensureModelFiles recording each model it was asked to fetch. */
function fakeEnsure(): { impl: typeof ensureModelFiles; calls: Parameters<typeof ensureModelFiles>[0][] } {
  const calls: Parameters<typeof ensureModelFiles>[0][] = [];
  const impl = (async (opts: Parameters<typeof ensureModelFiles>[0]) => {
    calls.push(opts);
    return { dir: opts.dir, skipped: false };
  }) as typeof ensureModelFiles;
  return { impl, calls };
}

function makeTranscriber(
  over: Partial<LocalSttOptions> = {},
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
    ensureModelFilesImpl: ensure.impl,
    hostFactory: () => host.host,
    log: () => {},
    ...over,
  });
  return { transcriber, host, ensure };
}

describe('LocalSttTranscriber.transcribe', () => {
  it('defaults to the turbo model, decodes raw PCM, and returns the transcript', async () => {
    const { transcriber, host, ensure } = makeTranscriber();
    const out = await transcriber.transcribe(AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME });
    expect(out.text).toBe('hello world');
    const modelRoot = path.join('/models/stt', 'turbo');
    expect(ensure.calls.map((call) => call.dir)).toEqual([modelRoot]);
    expect(ensure.calls[0]!.files.map((file) => file.name)).toEqual([
      'turbo-encoder.int8.onnx',
      'turbo-decoder.int8.onnx',
      'turbo-tokens.txt',
    ]);
    const req = host.reqs[0]!;
    expect(req.encoder).toBe(path.join(modelRoot, 'turbo-encoder.int8.onnx'));
    expect(req.decoder).toBe(path.join(modelRoot, 'turbo-decoder.int8.onnx'));
    expect(req.tokens).toBe(path.join(modelRoot, 'turbo-tokens.txt'));
    expect(req.sampleRate).toBe(16_000);
    expect(req.samples.length).toBe(160); // resampled 24k → 16k
    expect(req.task).toBe('transcribe');
    expect(out.durationSec).toBeCloseTo(160 / 16_000, 6);
  });

  it('rejects a removed model (small) left in config, before any download', () => {
    expect(() => makeTranscriber({ model: 'small' })).toThrow(/Unknown local speech model "small"/);
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
    expect(ensure.calls.length).toBe(1);
  });

  it('returns empty text for empty/silent audio without touching the model', async () => {
    const { transcriber, host, ensure } = makeTranscriber();
    const out = await transcriber.transcribe(new Uint8Array(0), { mimeType: MOXXY_PCM16_24KHZ_MIME });
    expect(out.text).toBe('');
    expect(ensure.calls.length).toBe(0);
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
      /Unknown local speech model/,
    );
  });
});

describe('buildLocalSttPlugin', () => {
  it('registers local-whisper first', () => {
    const plugin = buildLocalSttPlugin();
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
        ensureModelFilesImpl: ensure.impl,
        hostFactory: () => host.host,
        log: () => {},
      },
    });
    const inst = plugin.transcribers![0]!.createClient({ model: 'turbo', language: 'pl' });
    await inst.transcribe(AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME });
    expect(ensure.calls[0]!.dir).toBe(path.join('/models/stt', 'turbo'));
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

describe('local-parakeet', () => {
  /** A minute and a half of loud audio, as a 16-bit PCM WAV-free raw clip @ 24 kHz. */
  const LONG_AUDIO = rawPcm16(24_000 * 90);

  function makeParakeet(over: Partial<LocalSttOptions> = {}, result?: TranscribeResult) {
    const host = fakeHost(result);
    const ensure = fakeEnsure();
    const hosts = { made: 0 };
    const transcriber = createLocalParakeetTranscriber({
      modelsDir: '/models/stt',
      ensureModelFilesImpl: ensure.impl,
      hostFactory: () => {
        hosts.made += 1;
        return host.host;
      },
      log: () => {},
      ...over,
    });
    return { transcriber, host, ensure, hosts };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('downloads its four files and sends the joiner to the sidecar', async () => {
    const { transcriber, host, ensure } = makeParakeet();
    const out = await transcriber.transcribe(AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME });
    expect(transcriber.name).toBe(LOCAL_PARAKEET_TRANSCRIBER_NAME);
    expect(out.text).toBe('hello world');
    expect(ensure.calls[0]!.dir).toBe(path.join('/models/stt', 'parakeet'));
    expect(ensure.calls[0]!.files.map((file) => file.name)).toEqual([
      'encoder.int8.onnx',
      'decoder.int8.onnx',
      'joiner.int8.onnx',
      'tokens.txt',
    ]);
    expect(host.reqs[0]!.joiner).toBe(path.join('/models/stt', 'parakeet', 'joiner.int8.onnx'));
  });

  it('reads a long recording piece by piece and joins the text', async () => {
    const { transcriber, host } = makeParakeet();
    const out = await transcriber.transcribe(LONG_AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME });
    expect(host.reqs).toHaveLength(2);
    expect(out.text).toBe('hello world hello world');
    expect(out.durationSec).toBeCloseTo(90, 0);
  });

  it('stops between pieces when the caller aborts', async () => {
    const controller = new AbortController();
    const host = fakeHost();
    const transcribe = host.host.transcribe.bind(host.host);
    host.host.transcribe = async (req) => {
      controller.abort(new Error('stop'));
      return transcribe(req);
    };
    const transcriber = createLocalParakeetTranscriber({
      modelsDir: '/models/stt',
      ensureModelFilesImpl: fakeEnsure().impl,
      hostFactory: () => host.host,
      log: () => {},
    });
    await expect(
      transcriber.transcribe(LONG_AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME, signal: controller.signal }),
    ).rejects.toThrow(/stop/);
    expect(host.reqs).toHaveLength(1);
  });

  it('does not report the hint as the language it heard', async () => {
    const { transcriber } = makeParakeet();
    const out = await transcriber.transcribe(AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME, language: 'pl' });
    expect(out.language).toBeUndefined();
  });

  it('gives its memory back after five idle minutes and loads again on the next use', async () => {
    vi.useFakeTimers();
    const { transcriber, host, hosts } = makeParakeet();
    await transcriber.transcribe(AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME });
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(host.shutdowns).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(host.shutdowns).toBe(1);
    await transcriber.transcribe(AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME });
    expect(hosts.made).toBe(2);
  });

  it('keeps the model while another transcription is running', async () => {
    vi.useFakeTimers();
    const { transcriber, host } = makeParakeet();
    await transcriber.transcribe(AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME });
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    await transcriber.transcribe(AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME });
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(host.shutdowns).toBe(0);
  });

  it('keeps Whisper loaded, as it always was', async () => {
    vi.useFakeTimers();
    const { transcriber, host } = makeTranscriber();
    await transcriber.transcribe(AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(host.shutdowns).toBe(0);
  });

  it('registers next to local-whisper without choosing itself', () => {
    const plugin = buildLocalSttPlugin({ defaults: { modelsDir: '/models/stt' } });
    expect(plugin.transcribers?.map((def) => def.name)).toEqual([
      LOCAL_WHISPER_TRANSCRIBER_NAME,
      LOCAL_PARAKEET_TRANSCRIBER_NAME,
    ]);
    const inst = plugin.transcribers![1]!.createClient({ model: 'turbo' });
    expect(inst.name).toBe(LOCAL_PARAKEET_TRANSCRIBER_NAME);
  });
});
