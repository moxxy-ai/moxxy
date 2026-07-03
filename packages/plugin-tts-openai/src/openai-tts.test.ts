import { describe, expect, it } from 'vitest';
import { OpenAiSynthesizer, capInput, clampSpeed, type FetchLike } from './openai-tts.js';
import { buildOpenAiTtsPlugin, OPENAI_TTS_SYNTHESIZER_NAME } from './index.js';

interface Captured {
  url: string;
  init: RequestInit;
}

/** A stub `fetch` that records the request and returns fixed audio bytes. */
function okFetch(
  bytes: Uint8Array = new Uint8Array([1, 2, 3, 4]),
  status = 200,
): { fetchImpl: FetchLike; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(bytes, { status });
  };
  return { fetchImpl, calls };
}

/** A stub `fetch` that returns an error status with a body. */
function statusFetch(status: number, body = 'boom'): FetchLike {
  return async () => new Response(body, { status });
}

/** A `fetch` that never resolves and only rejects when its signal aborts —
 *  checking `aborted` synchronously (as real fetch does) so it works even when
 *  the signal fired before the request was issued. Drives abort + timeout. */
const abortAwareFetch: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    const signal = init.signal;
    const fail = (): void => reject(new DOMException('Aborted', 'AbortError'));
    if (signal?.aborted) fail();
    else signal?.addEventListener('abort', fail, { once: true });
  });

/** Parse the JSON body a captured request carried. */
function bodyOf(calls: Captured[]): Record<string, unknown> {
  return JSON.parse(calls[0]!.init.body as string) as Record<string, unknown>;
}

describe('OpenAiSynthesizer.synthesize', () => {
  it('returns audio bytes and the mp3 mimeType by default', async () => {
    const { fetchImpl, calls } = okFetch(new Uint8Array([9, 8, 7]));
    const synth = new OpenAiSynthesizer({ apiKey: 'sk-test', fetchImpl });
    const out = await synth.synthesize('hello world');

    expect(Array.from(out.audio)).toEqual([9, 8, 7]);
    expect(out.mimeType).toBe('audio/mpeg');
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/audio/speech');
    expect(calls[0]!.init.method).toBe('POST');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test');
    expect(headers['content-type']).toBe('application/json');
    const body = bodyOf(calls);
    expect(body.model).toBe('gpt-4o-mini-tts');
    expect(body.voice).toBe('alloy');
    expect(body.input).toBe('hello world');
    expect(body.response_format).toBe('mp3');
    expect(body.speed).toBeUndefined();
  });

  it.each([
    ['mp3', 'audio/mpeg'],
    ['opus', 'audio/ogg'],
    ['wav', 'audio/wav'],
    ['aac', 'audio/aac'],
  ] as const)('maps format %s to mimeType %s', async (format, mimeType) => {
    const { fetchImpl, calls } = okFetch();
    const synth = new OpenAiSynthesizer({ apiKey: 'sk-test', fetchImpl, format });
    const out = await synth.synthesize('hi');
    expect(out.mimeType).toBe(mimeType);
    expect(bodyOf(calls).response_format).toBe(format);
  });

  it('lets opts.voice override the configured voice', async () => {
    const { fetchImpl, calls } = okFetch();
    const synth = new OpenAiSynthesizer({ apiKey: 'sk-test', fetchImpl, voice: 'alloy' });
    await synth.synthesize('hi', { voice: 'nova' });
    expect(bodyOf(calls).voice).toBe('nova');
  });

  it('maps rate to speed', async () => {
    const { fetchImpl, calls } = okFetch();
    const synth = new OpenAiSynthesizer({ apiKey: 'sk-test', fetchImpl });
    await synth.synthesize('hi', { rate: 1.5 });
    expect(bodyOf(calls).speed).toBe(1.5);
  });

  it.each([
    [10, 4.0],
    [0.01, 0.25],
    [Number.NaN, undefined],
  ])('clamps rate %s to speed %s', async (rate, expected) => {
    const { fetchImpl, calls } = okFetch();
    const synth = new OpenAiSynthesizer({ apiKey: 'sk-test', fetchImpl });
    await synth.synthesize('hi', { rate });
    expect(bodyOf(calls).speed).toBe(expected);
  });

  it('truncates input over 4096 chars at a sentence boundary with an ellipsis', async () => {
    const { fetchImpl, calls } = okFetch();
    const synth = new OpenAiSynthesizer({ apiKey: 'sk-test', fetchImpl });
    // 'a'*4000 + '. ' then more — the sentence boundary at index 4000 is the
    // last one inside the 4095-char budget.
    const long = `${'a'.repeat(4000)}. ${'b'.repeat(200)}. ${'c'.repeat(200)}`;
    await synth.synthesize(long);
    const input = bodyOf(calls).input as string;
    expect(input.length).toBeLessThanOrEqual(4096);
    expect(input.length).toBeLessThan(long.length);
    expect(input.endsWith('…')).toBe(true);
    // Cut fell right after the sentence-ending period, not mid-word.
    expect(input.endsWith('.…')).toBe(true);
  });

  it('leaves short input untouched (no ellipsis)', async () => {
    const { fetchImpl, calls } = okFetch();
    const synth = new OpenAiSynthesizer({ apiKey: 'sk-test', fetchImpl });
    await synth.synthesize('a short reply.');
    expect(bodyOf(calls).input).toBe('a short reply.');
  });

  it('throws AUTH_NO_CREDENTIALS when no key is available anywhere', async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const { fetchImpl } = okFetch();
      const synth = new OpenAiSynthesizer({ getSecret: async () => null, fetchImpl });
      await expect(synth.synthesize('hi')).rejects.toMatchObject({
        code: 'AUTH_NO_CREDENTIALS',
      });
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });

  it('reads the key from getSecret (OPENAI_API_KEY) when no explicit key', async () => {
    const { fetchImpl, calls } = okFetch();
    const synth = new OpenAiSynthesizer({
      getSecret: async (name) => (name === 'OPENAI_API_KEY' ? 'sk-vault' : null),
      fetchImpl,
    });
    await synth.synthesize('hi');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-vault');
  });

  it.each([
    [401, 'AUTH_INVALID'],
    [403, 'AUTH_DENIED'],
    [429, 'PROVIDER_RATE_LIMITED'],
    [500, 'PROVIDER_SERVER_ERROR'],
    [503, 'PROVIDER_SERVER_ERROR'],
  ])('maps HTTP %s to %s', async (status, code) => {
    const synth = new OpenAiSynthesizer({ apiKey: 'sk-test', fetchImpl: statusFetch(status) });
    await expect(synth.synthesize('hi')).rejects.toMatchObject({ code });
  });

  it('falls back to PROVIDER_BAD_REQUEST for an unmapped status', async () => {
    const synth = new OpenAiSynthesizer({ apiKey: 'sk-test', fetchImpl: statusFetch(418) });
    await expect(synth.synthesize('hi')).rejects.toMatchObject({
      code: 'PROVIDER_BAD_REQUEST',
      context: { status: 418 },
    });
  });

  it('classifies a network failure', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('fetch failed');
    };
    const synth = new OpenAiSynthesizer({ apiKey: 'sk-test', fetchImpl });
    await expect(synth.synthesize('hi')).rejects.toMatchObject({
      code: 'NETWORK_UNREACHABLE',
    });
  });

  it('honors an already-aborted signal, propagating its reason', async () => {
    const { fetchImpl } = okFetch();
    const synth = new OpenAiSynthesizer({ apiKey: 'sk-test', fetchImpl });
    const ac = new AbortController();
    const reason = new Error('user stopped');
    ac.abort(reason);
    await expect(synth.synthesize('hi', { signal: ac.signal })).rejects.toBe(reason);
  });

  it('honors an in-flight abort, propagating the caller reason', async () => {
    const synth = new OpenAiSynthesizer({ apiKey: 'sk-test', fetchImpl: abortAwareFetch });
    const ac = new AbortController();
    const reason = new Error('cancelled mid-flight');
    const p = synth.synthesize('hi', { signal: ac.signal });
    ac.abort(reason);
    await expect(p).rejects.toBe(reason);
  });

  it('times out a hung request as NETWORK_TIMEOUT', async () => {
    const synth = new OpenAiSynthesizer({
      apiKey: 'sk-test',
      fetchImpl: abortAwareFetch,
      timeoutMs: 10,
    });
    await expect(synth.synthesize('hi')).rejects.toMatchObject({ code: 'NETWORK_TIMEOUT' });
  });
});

describe('capInput / clampSpeed helpers', () => {
  it('capInput passes through under the limit', () => {
    expect(capInput('short')).toBe('short');
    expect(capInput('a'.repeat(4096))).toBe('a'.repeat(4096));
  });

  it('capInput hard-slices a single boundary-less sentence', () => {
    const out = capInput('x'.repeat(5000));
    expect(out.length).toBe(4096); // 4095 chars + the ellipsis
    expect(out.endsWith('…')).toBe(true);
  });

  it('clampSpeed clamps and drops non-finite', () => {
    expect(clampSpeed(undefined)).toBeUndefined();
    expect(clampSpeed(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(clampSpeed(1)).toBe(1);
    expect(clampSpeed(9)).toBe(4);
    expect(clampSpeed(0)).toBe(0.25);
  });
});

describe('buildOpenAiTtsPlugin', () => {
  it('registers exactly one synthesizer named openai-tts', () => {
    const plugin = buildOpenAiTtsPlugin();
    expect(plugin.synthesizers).toHaveLength(1);
    const def = plugin.synthesizers![0]!;
    expect(def.name).toBe(OPENAI_TTS_SYNTHESIZER_NAME);
    expect(def.displayName).toBe('OpenAI TTS');
  });

  it('create() yields a synthesizer whose config voice/format flow through', async () => {
    const { fetchImpl, calls } = okFetch();
    const plugin = buildOpenAiTtsPlugin({ defaults: { fetchImpl, apiKey: 'sk-test' } });
    const def = plugin.synthesizers![0]!;
    const inst = def.create({ config: { voice: 'nova', format: 'opus' } });
    expect(inst.name).toBe('openai-tts');
    const out = await inst.synthesize('hi');
    expect(out.mimeType).toBe('audio/ogg');
    expect(bodyOf(calls).voice).toBe('nova');
  });

  it('create() wires ctx.getSecret through for key resolution', async () => {
    const { fetchImpl, calls } = okFetch();
    const plugin = buildOpenAiTtsPlugin({ defaults: { fetchImpl } });
    const def = plugin.synthesizers![0]!;
    const inst = def.create({
      config: {},
      getSecret: async (name) => (name === 'OPENAI_API_KEY' ? 'sk-ctx' : null),
    });
    await inst.synthesize('hi');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-ctx');
  });

  it('create() ignores an unknown config format', async () => {
    const { fetchImpl } = okFetch();
    const plugin = buildOpenAiTtsPlugin({ defaults: { fetchImpl, apiKey: 'sk-test' } });
    const inst = plugin.synthesizers![0]!.create({ config: { format: 'flac' } });
    const out = await inst.synthesize('hi');
    // Unknown format ignored → default mp3.
    expect(out.mimeType).toBe('audio/mpeg');
  });
});
