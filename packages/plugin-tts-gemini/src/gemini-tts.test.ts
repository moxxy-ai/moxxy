import { describe, expect, it } from 'vitest';
import {
  GeminiTtsSynthesizer,
  buildGeminiTtsPlugin,
  listGeminiVoices,
  GEMINI_TTS_MODEL,
  GEMINI_TTS_SYNTHESIZER_NAME,
  type FetchLike,
} from './index.js';

interface CapturedCall {
  readonly url: string;
  readonly init: RequestInit;
}

function makeFetch(body: unknown, status = 200): { fetchImpl: FetchLike; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetchImpl, calls };
}

const audioResponse = {
  steps: [{
    type: 'model_output',
    content: [{
      type: 'audio',
      mime_type: 'audio/wav',
      data: Buffer.from('RIFFaudio').toString('base64'),
    }],
  }],
};

describe('GeminiTtsSynthesizer', () => {
  it('requests one short text chunk through Interactions and returns the WAV', async () => {
    const { fetchImpl, calls } = makeFetch(audioResponse);
    const synth = new GeminiTtsSynthesizer({
      apiKey: 'test-key',
      fetchImpl,
    });

    const result = await synth.synthesize('Pierwsze zdanie.', { voice: 'Fola', language: 'pl' });

    expect(result.mimeType).toBe('audio/wav');
    expect(Buffer.from(result.audio).toString()).toBe('RIFFaudio');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect((calls[0]?.init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    expect(JSON.parse(calls[0]?.init.body as string)).toMatchObject({
      model: GEMINI_TTS_MODEL,
      input: [{ type: 'user_input', content: [{
        type: 'text',
        text: 'Pierwsze zdanie.',
        annotations: [{ type: 'speech_metadata', style: 'Natural, conversational delivery.' }],
      }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: 'Fola' }] },
    });
  });

  it('resolves the API key lazily from the vault and honors cancellation', async () => {
    const { fetchImpl, calls } = makeFetch(audioResponse);
    const synth = new GeminiTtsSynthesizer({
      getSecret: async (name) => name === 'GEMINI_API_KEY' ? 'vault-key' : null,
      fetchImpl,
    });
    const controller = new AbortController();

    await synth.synthesize('Cześć.', { signal: controller.signal });
    expect((calls[0]?.init.headers as Record<string, string>)['x-goog-api-key']).toBe('vault-key');
    expect(calls[0]?.init.signal).toBe(controller.signal);

    controller.abort(new Error('interrupted'));
    await expect(synth.synthesize('Przerwane.', { signal: controller.signal })).rejects.toThrow('interrupted');
    expect(calls).toHaveLength(1);
  });

  it('uses a rotated vault key on the next sentence without rebuilding the synthesizer', async () => {
    let key = 'first-key';
    const { fetchImpl, calls } = makeFetch(audioResponse);
    const synth = new GeminiTtsSynthesizer({
      getSecret: async () => key,
      fetchImpl,
    });

    await synth.synthesize('Pierwsze zdanie.');
    key = 'rotated-key';
    await synth.synthesize('Następne zdanie.');

    expect(calls.map(({ init }) => (init.headers as Record<string, string>)['x-goog-api-key']))
      .toEqual(['first-key', 'rotated-key']);
  });

  it('classifies missing credentials and provider errors', async () => {
    const noKey = new GeminiTtsSynthesizer({ getSecret: async () => null, fetchImpl: makeFetch(audioResponse).fetchImpl });
    await expect(noKey.synthesize('Hej.')).rejects.toMatchObject({ code: 'AUTH_NO_CREDENTIALS' });

    const limited = new GeminiTtsSynthesizer({ apiKey: 'bad', fetchImpl: makeFetch({ error: { message: 'quota' } }, 429).fetchImpl });
    await expect(limited.synthesize('Hej.')).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' });
  });
});

describe('listGeminiVoices', () => {
  it('loads all pages and returns ids with display metadata', async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      if (url.includes('page_token')) {
        return Response.json({ voices: [{ id: 'voice_2', display_name: 'Warm Fola', language_code: 'pl-PL' }] });
      }
      return Response.json({
        voices: [{ id: 'Fola', display_name: 'Fola', language_code: 'en-US' }],
        next_page_token: 'next-page',
      });
    };

    const voices = await listGeminiVoices('test-key', { fetchImpl });

    expect(voices).toEqual([
      { id: 'Fola', displayName: 'Fola', languageCode: 'en-US' },
      { id: 'voice_2', displayName: 'Warm Fola', languageCode: 'pl-PL' },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('page_token=next-page');
  });
});

describe('buildGeminiTtsPlugin', () => {
  it('registers a single Gemini synthesizer with the selected default voice', () => {
    const plugin = buildGeminiTtsPlugin();
    expect(plugin.synthesizers).toHaveLength(1);
    expect(plugin.synthesizers?.[0]?.name).toBe(GEMINI_TTS_SYNTHESIZER_NAME);

    const synth = plugin.synthesizers?.[0]?.create({ config: { voice: 'Fola' } });
    expect(synth.name).toBe(GEMINI_TTS_SYNTHESIZER_NAME);
  });
});
