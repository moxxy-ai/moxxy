import { describe, expect, it } from 'vitest';
import { ElevenLabsSynthesizer, capInput, type FetchLike } from './elevenlabs-tts.js';
import { buildElevenLabsTtsPlugin, ELEVENLABS_TTS_SYNTHESIZER_NAME } from './index.js';

interface Captured {
  url: string;
  init: RequestInit;
}

const RACHEL = '21m00Tcm4TlvDq8ikWAM';

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

describe('ElevenLabsSynthesizer.synthesize', () => {
  it('returns audio bytes and the mp3 mimeType by default', async () => {
    const { fetchImpl, calls } = okFetch(new Uint8Array([9, 8, 7]));
    const synth = new ElevenLabsSynthesizer({ apiKey: 'sk-test', fetchImpl });
    const out = await synth.synthesize('hello world');

    expect(Array.from(out.audio)).toEqual([9, 8, 7]);
    expect(out.mimeType).toBe('audio/mpeg');
    expect(calls[0]!.url).toBe(
      `https://api.elevenlabs.io/v1/text-to-speech/${RACHEL}?output_format=mp3_44100_128`,
    );
    expect(calls[0]!.init.method).toBe('POST');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['xi-api-key']).toBe('sk-test');
    expect(headers['content-type']).toBe('application/json');
    const body = bodyOf(calls);
    expect(body.text).toBe('hello world');
    expect(body.model_id).toBe('eleven_multilingual_v2');
    // No speaking-rate/voice_settings field is ever sent (see `rate` below).
    expect(Object.keys(body).sort()).toEqual(['model_id', 'text']);
  });

  it.each([
    ['mp3_44100_128', 'audio/mpeg'],
    ['mp3_44100_64', 'audio/mpeg'],
    ['mp3_22050_32', 'audio/mpeg'],
  ] as const)('maps format %s to mimeType %s (as an output_format query)', async (format, mimeType) => {
    const { fetchImpl, calls } = okFetch();
    const synth = new ElevenLabsSynthesizer({ apiKey: 'sk-test', fetchImpl, format });
    const out = await synth.synthesize('hi');
    expect(out.mimeType).toBe(mimeType);
    expect(calls[0]!.url).toContain(`output_format=${format}`);
  });

  it('lets opts.voice override the configured voiceId (in the URL path)', async () => {
    const { fetchImpl, calls } = okFetch();
    const synth = new ElevenLabsSynthesizer({ apiKey: 'sk-test', fetchImpl, voiceId: RACHEL });
    await synth.synthesize('hi', { voice: 'AZnzlk1XvdvUeBnXmlld' });
    expect(calls[0]!.url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/AZnzlk1XvdvUeBnXmlld?output_format=mp3_44100_128',
    );
  });

  it('ignores opts.rate (no speaking-rate parameter is sent)', async () => {
    const { fetchImpl, calls } = okFetch();
    const synth = new ElevenLabsSynthesizer({ apiKey: 'sk-test', fetchImpl });
    await synth.synthesize('hi', { rate: 1.5 });
    const body = bodyOf(calls);
    expect(body.speed).toBeUndefined();
    expect(body.voice_settings).toBeUndefined();
    expect(Object.keys(body).sort()).toEqual(['model_id', 'text']);
  });

  it('truncates input over 2500 chars at a sentence boundary with an ellipsis', async () => {
    const { fetchImpl, calls } = okFetch();
    const synth = new ElevenLabsSynthesizer({ apiKey: 'sk-test', fetchImpl });
    // 'a'*2400 + '. ' then more — the sentence boundary at index 2400 is the
    // last one inside the 2499-char budget.
    const long = `${'a'.repeat(2400)}. ${'b'.repeat(200)}. ${'c'.repeat(200)}`;
    await synth.synthesize(long);
    const input = bodyOf(calls).text as string;
    expect(input.length).toBeLessThanOrEqual(2500);
    expect(input.length).toBeLessThan(long.length);
    expect(input.endsWith('…')).toBe(true);
    // Cut fell right after the sentence-ending period, not mid-word.
    expect(input.endsWith('.…')).toBe(true);
  });

  it('leaves short input untouched (no ellipsis)', async () => {
    const { fetchImpl, calls } = okFetch();
    const synth = new ElevenLabsSynthesizer({ apiKey: 'sk-test', fetchImpl });
    await synth.synthesize('a short reply.');
    expect(bodyOf(calls).text).toBe('a short reply.');
  });

  it('throws AUTH_NO_CREDENTIALS when no key is available anywhere', async () => {
    const prev = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    try {
      const { fetchImpl } = okFetch();
      const synth = new ElevenLabsSynthesizer({ getSecret: async () => null, fetchImpl });
      await expect(synth.synthesize('hi')).rejects.toMatchObject({
        code: 'AUTH_NO_CREDENTIALS',
      });
    } finally {
      if (prev !== undefined) process.env.ELEVENLABS_API_KEY = prev;
    }
  });

  it('reads the key from getSecret (ELEVENLABS_API_KEY) when no explicit key', async () => {
    const { fetchImpl, calls } = okFetch();
    const synth = new ElevenLabsSynthesizer({
      getSecret: async (name) => (name === 'ELEVENLABS_API_KEY' ? 'sk-vault' : null),
      fetchImpl,
    });
    await synth.synthesize('hi');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['xi-api-key']).toBe('sk-vault');
  });

  it.each([
    [401, 'AUTH_INVALID'],
    [403, 'AUTH_DENIED'],
    [429, 'PROVIDER_RATE_LIMITED'],
    [500, 'PROVIDER_SERVER_ERROR'],
    [503, 'PROVIDER_SERVER_ERROR'],
  ])('maps HTTP %s to %s', async (status, code) => {
    const synth = new ElevenLabsSynthesizer({ apiKey: 'sk-test', fetchImpl: statusFetch(status) });
    await expect(synth.synthesize('hi')).rejects.toMatchObject({ code });
  });

  it('falls back to PROVIDER_BAD_REQUEST for an unmapped status', async () => {
    const synth = new ElevenLabsSynthesizer({ apiKey: 'sk-test', fetchImpl: statusFetch(418) });
    await expect(synth.synthesize('hi')).rejects.toMatchObject({
      code: 'PROVIDER_BAD_REQUEST',
      context: { status: 418 },
    });
  });

  it('classifies a network failure', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('fetch failed');
    };
    const synth = new ElevenLabsSynthesizer({ apiKey: 'sk-test', fetchImpl });
    await expect(synth.synthesize('hi')).rejects.toMatchObject({
      code: 'NETWORK_UNREACHABLE',
    });
  });

  it('honors an already-aborted signal, propagating its reason', async () => {
    const { fetchImpl } = okFetch();
    const synth = new ElevenLabsSynthesizer({ apiKey: 'sk-test', fetchImpl });
    const ac = new AbortController();
    const reason = new Error('user stopped');
    ac.abort(reason);
    await expect(synth.synthesize('hi', { signal: ac.signal })).rejects.toBe(reason);
  });

  it('honors an in-flight abort, propagating the caller reason', async () => {
    const synth = new ElevenLabsSynthesizer({ apiKey: 'sk-test', fetchImpl: abortAwareFetch });
    const ac = new AbortController();
    const reason = new Error('cancelled mid-flight');
    const p = synth.synthesize('hi', { signal: ac.signal });
    ac.abort(reason);
    await expect(p).rejects.toBe(reason);
  });

  it('times out a hung request as NETWORK_TIMEOUT', async () => {
    const synth = new ElevenLabsSynthesizer({
      apiKey: 'sk-test',
      fetchImpl: abortAwareFetch,
      timeoutMs: 10,
    });
    await expect(synth.synthesize('hi')).rejects.toMatchObject({ code: 'NETWORK_TIMEOUT' });
  });
});

describe('capInput helper', () => {
  it('passes through under the limit', () => {
    expect(capInput('short')).toBe('short');
    expect(capInput('a'.repeat(2500))).toBe('a'.repeat(2500));
  });

  it('hard-slices a single boundary-less sentence', () => {
    const out = capInput('x'.repeat(4000));
    expect(out.length).toBe(2500); // 2499 chars + the ellipsis
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('buildElevenLabsTtsPlugin', () => {
  it('registers exactly one synthesizer named elevenlabs', () => {
    const plugin = buildElevenLabsTtsPlugin();
    expect(plugin.synthesizers).toHaveLength(1);
    const def = plugin.synthesizers![0]!;
    expect(def.name).toBe(ELEVENLABS_TTS_SYNTHESIZER_NAME);
    expect(def.displayName).toBe('ElevenLabs');
  });

  it('create() yields a synthesizer whose config voiceId/format flow through', async () => {
    const { fetchImpl, calls } = okFetch();
    const plugin = buildElevenLabsTtsPlugin({ defaults: { fetchImpl, apiKey: 'sk-test' } });
    const def = plugin.synthesizers![0]!;
    const inst = def.create({ config: { voiceId: 'AZnzlk1XvdvUeBnXmlld', format: 'mp3_22050_32' } });
    expect(inst.name).toBe('elevenlabs');
    const out = await inst.synthesize('hi');
    expect(out.mimeType).toBe('audio/mpeg');
    expect(calls[0]!.url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/AZnzlk1XvdvUeBnXmlld?output_format=mp3_22050_32',
    );
  });

  it('create() wires ctx.getSecret through for key resolution', async () => {
    const { fetchImpl, calls } = okFetch();
    const plugin = buildElevenLabsTtsPlugin({ defaults: { fetchImpl } });
    const def = plugin.synthesizers![0]!;
    const inst = def.create({
      config: {},
      getSecret: async (name) => (name === 'ELEVENLABS_API_KEY' ? 'sk-ctx' : null),
    });
    await inst.synthesize('hi');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['xi-api-key']).toBe('sk-ctx');
  });

  it('create() ignores an unknown config format', async () => {
    const { fetchImpl } = okFetch();
    const plugin = buildElevenLabsTtsPlugin({ defaults: { fetchImpl, apiKey: 'sk-test' } });
    const inst = plugin.synthesizers![0]!.create({ config: { format: 'pcm_24000' } });
    const out = await inst.synthesize('hi');
    // Unknown/unsupported format ignored → default mp3_44100_128.
    expect(out.mimeType).toBe('audio/mpeg');
  });

  it('default export registers and builds a synthesizer with a fake getSecret', async () => {
    // Registry-level smoke: the default export is what `createPluginLoader`
    // discovers. It must register exactly one synthesizer whose `create`, given a
    // vault-backed `getSecret`, builds a ready instance without touching the
    // network or a live key.
    const { default: plugin } = await import('./index.js');
    expect(plugin.name).toBe('@moxxy/plugin-tts-elevenlabs');
    expect(plugin.synthesizers).toHaveLength(1);
    const def = plugin.synthesizers![0]!;
    const inst = def.create({
      config: {},
      getSecret: async (name) => (name === 'ELEVENLABS_API_KEY' ? 'sk-smoke' : null),
    });
    expect(inst.name).toBe('elevenlabs');
    expect(inst.mimeType).toBe('audio/mpeg');
  });
});
