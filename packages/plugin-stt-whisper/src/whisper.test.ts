import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { APIError, APIConnectionError, APIUserAbortError } from 'openai';
import { WhisperTranscriber } from './whisper.js';
import { buildWhisperPlugin } from './index.js';
import { MOXXY_PCM16_24KHZ_MIME, normalizeWhisperUpload, pcm16MonoToWav } from './audio.js';
import { assertDefined } from '@moxxy/sdk';

const fakeOpenAI = (impl: (req: unknown) => unknown): OpenAI =>
  ({
    audio: {
      transcriptions: {
        create: vi.fn(async (req: unknown) => impl(req)),
      },
    },
  }) as unknown as OpenAI;

/** A client whose `create` always rejects with the supplied error — exercises
 *  the `run()` failure-translation surface without touching the network. */
const throwingOpenAI = (err: unknown): OpenAI =>
  ({
    audio: {
      transcriptions: {
        create: vi.fn(async () => {
          throw err;
        }),
      },
    },
    // `run()` reads client.baseURL for error context.
    baseURL: 'https://api.openai.com/v1',
  }) as unknown as OpenAI;

describe('WhisperTranscriber', () => {
  it('returns text, language, duration, and segments from verbose_json', async () => {
    const client = fakeOpenAI(() => ({
      text: 'hello world',
      language: 'en',
      duration: 1.5,
      segments: [
        { start: 0, end: 1.5, text: 'hello world' },
      ],
    }));
    const t = new WhisperTranscriber({ client });
    const result = await t.transcribe(new Uint8Array([1, 2, 3]), { mimeType: 'audio/ogg' });
    expect(result.text).toBe('hello world');
    expect(result.language).toBe('en');
    expect(result.durationSec).toBe(1.5);
    expect(result.segments).toEqual([{ start: 0, end: 1.5, text: 'hello world' }]);
  });

  it('passes language hint + prompt to the OpenAI client', async () => {
    const create = vi.fn(async () => ({ text: 'cześć', language: 'pl', segments: [] }));
    const client = { audio: { transcriptions: { create } } } as unknown as OpenAI;
    const t = new WhisperTranscriber({ client, language: 'pl' });
    await t.transcribe(new Uint8Array(), { mimeType: 'audio/ogg', prompt: 'jargon-list' });
    const call = create.mock.calls[0];
    assertDefined(call, 'transcribe invokes the OpenAI create() exactly once');
    const req = call[0] as { language: string; prompt: string; response_format: string };
    expect(req.language).toBe('pl');
    expect(req.prompt).toBe('jargon-list');
    expect(req.response_format).toBe('verbose_json');
  });

  it('uses the per-call language over the default', async () => {
    const create = vi.fn(async () => ({ text: '' }));
    const client = { audio: { transcriptions: { create } } } as unknown as OpenAI;
    const t = new WhisperTranscriber({ client, language: 'pl' });
    await t.transcribe(new Uint8Array(), { language: 'en' });
    const call = create.mock.calls[0];
    assertDefined(call, 'transcribe invokes the OpenAI create() exactly once');
    const req = call[0] as { language: string };
    expect(req.language).toBe('en');
  });

  it('falls back to plain text on gpt-4o-transcribe (no verbose_json branch)', async () => {
    const create = vi.fn(async () => ({ text: 'plain' }));
    const client = { audio: { transcriptions: { create } } } as unknown as OpenAI;
    const t = new WhisperTranscriber({ client, model: 'gpt-4o-transcribe' });
    const out = await t.transcribe(new Uint8Array(), { mimeType: 'audio/wav' });
    expect(out.text).toBe('plain');
    const call = create.mock.calls[0];
    assertDefined(call, 'transcribe invokes the OpenAI create() exactly once');
    const req = call[0] as { response_format?: string };
    expect(req.response_format).toBeUndefined();
  });

  it('plugin registers a transcriber whose createClient yields the right name', () => {
    const plugin = buildWhisperPlugin({});
    expect(plugin.transcribers).toHaveLength(1);
    const transcribers = plugin.transcribers;
    assertDefined(transcribers, 'buildWhisperPlugin always registers transcribers');
    const def = transcribers[0];
    assertDefined(def, 'the plugin registers at least one transcriber');
    expect(def.name).toBe('openai-whisper-1');
    expect(def.displayName).toBe('OpenAI whisper-1');
    const inst = def.createClient({ apiKey: 'sk-test' });
    expect(inst.name).toBe('openai-whisper-1');
  });

  it('WAV-wraps the project raw-PCM16 MIME before upload', async () => {
    const create = vi.fn(async () => ({ text: '' }));
    const client = { audio: { transcriptions: { create } } } as unknown as OpenAI;
    const t = new WhisperTranscriber({ client });
    // 4 raw s16le samples of silence.
    const raw = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);
    await t.transcribe(raw, { mimeType: MOXXY_PCM16_24KHZ_MIME });

    const call = create.mock.calls[0];
    assertDefined(call, 'transcribe invokes the OpenAI create() exactly once');
    const req = call[0] as { file: File };
    expect(req.file.type).toBe('audio/wav');
    const header = new Uint8Array(await req.file.arrayBuffer());
    const ascii = (s: number, e: number): string =>
      String.fromCharCode(...header.slice(s, e));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 12)).toBe('WAVE');
    // Header (44 bytes) + the 8 raw sample bytes.
    expect(header.byteLength).toBe(44 + raw.byteLength);
  });

  it('plugin honors a non-default model name', () => {
    const plugin = buildWhisperPlugin({ model: 'gpt-4o-mini-transcribe' });
    const transcribers = plugin.transcribers;
    assertDefined(transcribers, 'buildWhisperPlugin always registers transcribers');
    const def = transcribers[0];
    assertDefined(def, 'the plugin registers at least one transcriber');
    expect(def.name).toBe('openai-gpt-4o-mini-transcribe');
  });

  it('throws PROVIDER_UNKNOWN_RESPONSE when verbose_json lacks a string text', async () => {
    const client = fakeOpenAI(() => ({ language: 'en', segments: [] }));
    const t = new WhisperTranscriber({ client });
    await expect(
      t.transcribe(new Uint8Array([1, 2, 3]), { mimeType: 'audio/ogg' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNKNOWN_RESPONSE' });
  });

  it('throws PROVIDER_UNKNOWN_RESPONSE when the gpt-4o response lacks text', async () => {
    const client = fakeOpenAI(() => ({ foo: 'bar' }));
    const t = new WhisperTranscriber({ client, model: 'gpt-4o-transcribe' });
    await expect(
      t.transcribe(new Uint8Array([1, 2, 3]), { mimeType: 'audio/wav' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNKNOWN_RESPONSE' });
  });

  it('ignores a non-string language/duration in verbose_json', async () => {
    const client = fakeOpenAI(() => ({ text: 'ok', language: 123, duration: 'nope' }));
    const t = new WhisperTranscriber({ client });
    const result = await t.transcribe(new Uint8Array([1]), { mimeType: 'audio/ogg' });
    expect(result.text).toBe('ok');
    expect(result.language).toBeUndefined();
    expect(result.durationSec).toBeUndefined();
  });

  it('drops malformed segments from a hostile verbose_json response without crashing', async () => {
    // A vendor (or man-in-the-middle) response whose segments array is full of
    // junk: null, a primitive, missing fields, wrong types, and non-finite
    // bounds. A blind `.start` read on `null` would throw; an unchecked map
    // would leak `{ text: 123 }`. Each bad entry must be dropped; only the one
    // well-formed segment survives.
    const client = fakeOpenAI(() => ({
      text: 'ok',
      segments: [
        null,
        42,
        'not-an-object',
        { start: 0, end: 1 }, // missing text
        { start: 0, text: 'no end' }, // missing end
        { start: 'x', end: 1, text: 'bad start' }, // non-number start
        { start: 0, end: 1, text: 99 }, // non-string text
        { start: Number.NaN, end: 1, text: 'nan start' }, // non-finite
        { start: 0, end: Infinity, text: 'inf end' }, // non-finite
        { start: 1, end: 2, text: 'good' }, // the only valid one
      ],
    }));
    const t = new WhisperTranscriber({ client });
    const result = await t.transcribe(new Uint8Array([1]), { mimeType: 'audio/ogg' });
    expect(result.text).toBe('ok');
    expect(result.segments).toEqual([{ start: 1, end: 2, text: 'good' }]);
  });

  it('returns an empty segments array when every segment is malformed', async () => {
    const client = fakeOpenAI(() => ({ text: 'ok', segments: [null, undefined, {}] }));
    const t = new WhisperTranscriber({ client });
    const result = await t.transcribe(new Uint8Array([1]), { mimeType: 'audio/ogg' });
    expect(result.segments).toEqual([]);
  });

  it('does not crash when mimeType is a non-string at runtime (untrusted Telegram path)', async () => {
    const create = vi.fn(async () => ({ text: 'ok' }));
    const client = { audio: { transcriptions: { create } } } as unknown as OpenAI;
    const t = new WhisperTranscriber({ client });
    // A crafted Telegram update could deliver a non-string mime_type; the type
    // says `string` but the runtime value is hostile. Must degrade, not throw.
    const result = await t.transcribe(new Uint8Array([1]), {
      mimeType: 123 as unknown as string,
    });
    expect(result.text).toBe('ok');
    const call = create.mock.calls[0];
    assertDefined(call, 'transcribe invokes the OpenAI create() exactly once');
    const req = call[0] as { file: File };
    // Defaults to the audio/wav fallback filename rather than crashing.
    expect(req.file.name).toBe('audio.wav');
  });
});

describe('WhisperTranscriber.run() error translation', () => {
  const audio = new Uint8Array([1, 2, 3]);

  it('re-throws a user abort unchanged (not masked as a provider error)', async () => {
    const abort = new APIUserAbortError();
    const t = new WhisperTranscriber({ client: throwingOpenAI(abort) });
    await expect(t.transcribe(audio, { mimeType: 'audio/ogg' })).rejects.toBe(abort);
  });

  it('maps a refused connection to NETWORK_UNREACHABLE', async () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const conn = new APIConnectionError({ cause });
    const t = new WhisperTranscriber({ client: throwingOpenAI(conn) });
    await expect(t.transcribe(audio, { mimeType: 'audio/ogg' })).rejects.toMatchObject({
      code: 'NETWORK_UNREACHABLE',
    });
  });

  it('maps HTTP 401 to AUTH_INVALID', async () => {
    const err = new APIError(401, { error: { message: 'bad key' } }, 'Unauthorized', {});
    const t = new WhisperTranscriber({ client: throwingOpenAI(err) });
    await expect(t.transcribe(audio, { mimeType: 'audio/ogg' })).rejects.toMatchObject({
      code: 'AUTH_INVALID',
    });
  });

  it('maps HTTP 500 to PROVIDER_SERVER_ERROR', async () => {
    const err = new APIError(500, undefined, 'boom', {});
    const t = new WhisperTranscriber({ client: throwingOpenAI(err) });
    await expect(t.transcribe(audio, { mimeType: 'audio/ogg' })).rejects.toMatchObject({
      code: 'PROVIDER_SERVER_ERROR',
    });
  });

  it('falls back to PROVIDER_BAD_REQUEST for an unmapped status', async () => {
    const err = new APIError(418, undefined, 'teapot', {});
    const t = new WhisperTranscriber({ client: throwingOpenAI(err) });
    await expect(t.transcribe(audio, { mimeType: 'audio/ogg' })).rejects.toMatchObject({
      code: 'PROVIDER_BAD_REQUEST',
      context: { status: 418 },
    });
  });

  it('re-throws an unclassifiable non-network error rather than swallowing it', async () => {
    const odd = new Error('totally unexpected');
    const t = new WhisperTranscriber({ client: throwingOpenAI(odd) });
    await expect(t.transcribe(audio, { mimeType: 'audio/ogg' })).rejects.toBe(odd);
  });
});

describe('normalizeWhisperUpload hardening', () => {
  it('does not resolve inherited prototype members for a crafted MIME', () => {
    // 'constructor' / 'toString' / '__proto__' must NOT surface a function/object.
    for (const mt of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      const out = normalizeWhisperUpload(new Uint8Array([1]), mt);
      expect(out.filename).toBe('audio.bin');
      expect(typeof out.filename).toBe('string');
    }
  });

  it('does not throw inside the prefix path for a crafted MIME', () => {
    // extOf() would have thrown if the lookup returned a function.
    const out = normalizeWhisperUpload(new Uint8Array([1]), 'constructor', 'moxxy');
    expect(out.filename).toBe('moxxy.bin');
  });

  it('matches MIME case-insensitively and strips codec params', () => {
    expect(normalizeWhisperUpload(new Uint8Array([1]), 'AUDIO/OGG').filename).toBe('audio.ogg');
    expect(
      normalizeWhisperUpload(new Uint8Array([1]), 'audio/webm; codecs=opus').filename,
    ).toBe('audio.webm');
    expect(normalizeWhisperUpload(new Uint8Array([1]), '  Audio/Wav ').filename).toBe('audio.wav');
  });
});

describe('pcm16MonoToWav hardening', () => {
  it('drops a trailing odd byte so the data chunk stays even-aligned', () => {
    const wav = pcm16MonoToWav(new Uint8Array([1, 2, 3]));
    const view = new DataView(wav.buffer);
    // 3 input bytes → 2 retained (one whole 16-bit sample).
    expect(view.getUint32(40, true)).toBe(2);
    expect(wav.byteLength).toBe(44 + 2);
  });

  it('rejects a payload too large for the 32-bit WAV size fields', () => {
    // Fake a (real) Uint8Array reporting an oversized, even byteLength without
    // allocating 4GiB. Even length skips the odd-byte subarray branch, so the
    // size guard is what must fire. 0xfffffffe > 0xffffffff - 36.
    const huge = new Uint8Array(2);
    Object.defineProperty(huge, 'byteLength', { value: 0xfffffffe });
    expect(() => pcm16MonoToWav(huge)).toThrow(RangeError);
  });
});
