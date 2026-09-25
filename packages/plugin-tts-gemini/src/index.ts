import {
  classifyHttpStatus,
  classifyNetworkError,
  MoxxyError,
  definePlugin,
  defineSynthesizer,
  type Plugin,
  type SynthesizeOptions,
  type SynthesisResult,
  type Synthesizer,
  type SynthesizerCreateContext,
} from '@moxxy/sdk';

export const GEMINI_TTS_SYNTHESIZER_NAME = 'gemini-tts';
export const GEMINI_TTS_MODEL = 'gemini-3.8-flash-lite-tts';
export const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_TTS_API_KEY_NAME = 'GEMINI_API_KEY';

const DEFAULT_VOICE = 'Fola';
const VOICE_PAGE_SIZE = 1000;
const MAX_VOICE_PAGES = 20;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GeminiTtsOptions {
  readonly apiKey?: string;
  readonly getSecret?: (name: string) => Promise<string | null>;
  readonly voice?: string;
  readonly baseURL?: string;
  readonly fetchImpl?: FetchLike;
}

export interface GeminiVoice {
  readonly id: string;
  readonly displayName: string;
  readonly languageCode?: string;
  readonly description?: string;
}

export class GeminiTtsSynthesizer implements Synthesizer {
  readonly name = GEMINI_TTS_SYNTHESIZER_NAME;

  private readonly explicitKey: string | undefined;
  private readonly getSecret: ((name: string) => Promise<string | null>) | undefined;
  private readonly defaultVoice: string;
  private readonly baseURL: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: GeminiTtsOptions = {}) {
    this.explicitKey = options.apiKey;
    this.getSecret = options.getSecret;
    this.defaultVoice = options.voice ?? DEFAULT_VOICE;
    this.baseURL = trimTrailingSlashes(options.baseURL ?? GEMINI_API_BASE_URL);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async synthesize(text: string, opts: SynthesizeOptions = {}): Promise<SynthesisResult> {
    opts.signal?.throwIfAborted();
    const apiKey = await this.resolveKey();
    opts.signal?.throwIfAborted();

    const url = `${this.baseURL}/interactions`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          model: GEMINI_TTS_MODEL,
          input: [{
            type: 'user_input',
            content: [{
              type: 'text',
              text,
              annotations: [{ type: 'speech_metadata', style: speechStyle(opts.rate) }],
            }],
          }],
          response_format: { type: 'audio' },
          generation_config: {
            speech_config: [{ voice: opts.voice ?? this.defaultVoice }],
          },
        }),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (error) {
      if (opts.signal?.aborted) throw opts.signal.reason ?? error;
      const network = classifyNetworkError(error, { provider: 'gemini-tts', url });
      if (network) throw network;
      throw error;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const classified = classifyHttpStatus(response.status, {
        provider: 'gemini-tts',
        url,
        body,
      });
      if (classified) throw classified;
      throw new MoxxyError({
        code: 'PROVIDER_BAD_REQUEST',
        message: `Gemini text-to-speech returned HTTP ${response.status}.`,
        context: { provider: 'gemini-tts', url, status: response.status },
      });
    }

    const payload = await response.json() as InteractionsResponse;
    const audioPart = payload.steps
      ?.flatMap((step) => step.content ?? [])
      .find((part) => part.type === 'audio' && part.data);
    if (!audioPart?.data) {
      throw new MoxxyError({
        code: 'PROVIDER_UNKNOWN_RESPONSE',
        message: 'Gemini text-to-speech returned no audio data.',
        context: { provider: 'gemini-tts', url },
      });
    }

    const rawAudio = Buffer.from(audioPart.data, 'base64');
    const encodedAudio = wrapLinearPcmAsWav(rawAudio, audioPart.mime_type || 'audio/wav');
    const usage = parseTtsUsage(payload.usage);
    return {
      audio: new Uint8Array(encodedAudio.audio),
      mimeType: encodedAudio.mimeType,
      ...(usage ? { usage } : {}),
    };
  }

  private async resolveKey(): Promise<string> {
    const key = this.explicitKey ?? (await this.getSecret?.(GEMINI_TTS_API_KEY_NAME)) ?? null;
    if (!key) {
      throw new MoxxyError({
        code: 'AUTH_NO_CREDENTIALS',
        message: 'No Gemini API key is configured for cloud text-to-speech.',
        hint: 'Add a Gemini API key in Settings → Voice. It is stored in the local vault.',
        context: { provider: 'gemini-tts' },
      });
    }
    return key;
  }
}

export async function listGeminiVoices(
  apiKey: string,
  options: { readonly baseURL?: string; readonly fetchImpl?: FetchLike; readonly signal?: AbortSignal } = {},
): Promise<ReadonlyArray<GeminiVoice>> {
  const baseURL = trimTrailingSlashes(options.baseURL ?? GEMINI_API_BASE_URL);
  const fetchImpl = options.fetchImpl ?? fetch;
  const voices: GeminiVoice[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_VOICE_PAGES; page += 1) {
    options.signal?.throwIfAborted();
    const query = new URLSearchParams({ page_size: String(VOICE_PAGE_SIZE) });
    if (pageToken) query.set('page_token', pageToken);
    const url = `${baseURL}/voices?${query.toString()}`;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { 'x-goog-api-key': apiKey },
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason ?? error;
      const network = classifyNetworkError(error, { provider: 'gemini-tts', url });
      if (network) throw network;
      throw error;
    }
    if (!response.ok) {
      const classified = classifyHttpStatus(response.status, {
        provider: 'gemini-tts',
        url,
        body: await response.text().catch(() => ''),
      });
      if (classified) throw classified;
      throw new MoxxyError({
        code: 'PROVIDER_BAD_REQUEST',
        message: `Gemini voice library returned HTTP ${response.status}.`,
        context: { provider: 'gemini-tts', url, status: response.status },
      });
    }

    const payload = await response.json() as VoicesListResponse;
    for (const voice of payload.voices ?? []) {
      if (!voice.id) continue;
      voices.push({
        id: voice.id,
        displayName: voice.display_name || voice.id,
        ...(voice.language_code ? { languageCode: voice.language_code } : {}),
        ...(voice.description ? { description: voice.description } : {}),
      });
    }
    pageToken = payload.next_page_token;
    if (!pageToken) return voices;
  }

  throw new MoxxyError({
    code: 'PROVIDER_UNKNOWN_RESPONSE',
    message: `Gemini voice library exceeded the ${MAX_VOICE_PAGES}-page safety limit.`,
    context: { provider: 'gemini-tts' },
  });
}

export async function listGeminiVoicesWithSecret(
  getSecret: (name: string) => Promise<string | null>,
  options: { readonly fetchImpl?: FetchLike; readonly signal?: AbortSignal } = {},
): Promise<ReadonlyArray<GeminiVoice>> {
  const apiKey = await getSecret(GEMINI_TTS_API_KEY_NAME);
  if (!apiKey) {
    throw new MoxxyError({
      code: 'AUTH_NO_CREDENTIALS',
      message: 'No Gemini API key is configured for cloud text-to-speech.',
      hint: 'Add a Gemini API key in Settings → Voice. It is stored in the local vault.',
      context: { provider: 'gemini-tts' },
    });
  }
  return listGeminiVoices(apiKey, options);
}

/** Gemini returns raw PCM (`audio/L16;codec=pcm;rate=24000`) rather than a
 *  container. The browser audio element consumes WAV, so wrap supported PCM
 *  before crossing the IPC boundary. Already-containerized formats pass through. */
function wrapLinearPcmAsWav(
  audio: Buffer,
  mimeType: string,
): { readonly audio: Buffer; readonly mimeType: string } {
  if (/^audio\/(?:wav|x-wav)(?:;|$)/i.test(mimeType)) return { audio, mimeType };
  const [type, ...params] = mimeType.split(';').map((part) => part.trim());
  const format = type?.split('/')[1] ?? '';
  const linear = /^L(8|16|24|32)$/i.exec(format);
  if (!/^audio\/(?:L(?:8|16|24|32)|pcm)$/i.test(type ?? '')) return { audio, mimeType };
  const bitsPerSample = linear ? Number(linear[1]) : 16;
  const rateParam = params.find((param) => param.toLowerCase().startsWith('rate='));
  const parsedRate = rateParam ? Number(rateParam.slice(rateParam.indexOf('=') + 1)) : 24_000;
  const sampleRate = Number.isInteger(parsedRate) && parsedRate > 0 ? parsedRate : 24_000;
  const channels = 1;
  const blockAlign = channels * bitsPerSample / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + audio.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(audio.length, 40);
  return { audio: Buffer.concat([header, audio]), mimeType: 'audio/wav' };
}

function speechStyle(rate: number | undefined): string {
  if (rate !== undefined && rate >= 1.1) return 'Natural, conversational delivery at a slightly brisk pace.';
  if (rate !== undefined && rate <= 0.9) return 'Natural, conversational delivery at a slightly slower pace.';
  return 'Natural, conversational delivery.';
}

export function buildGeminiTtsPlugin(options: { readonly defaults?: GeminiTtsOptions } = {}): Plugin {
  const defaults = options.defaults ?? {};
  return definePlugin({
    name: '@moxxy/plugin-tts-gemini',
    version: '0.0.0',
    synthesizers: [
      defineSynthesizer({
        name: GEMINI_TTS_SYNTHESIZER_NAME,
        displayName: 'Cloud (Gemini Flash-Lite)',
        create: (ctx) => new GeminiTtsSynthesizer({
          ...defaults,
          ...optionsFromConfig(ctx.config),
          ...(ctx.getSecret ? { getSecret: ctx.getSecret } : {}),
        }),
      }),
    ],
  });
}

function optionsFromConfig(config: Record<string, unknown>): Pick<GeminiTtsOptions, 'voice'> {
  return typeof config.voice === 'string' && config.voice.length > 0
    ? { voice: config.voice }
    : {};
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

interface ModalityTokenCount {
  readonly modality?: string;
  readonly tokens?: number;
}

interface InteractionsResponse {
  readonly steps?: ReadonlyArray<{
    readonly content?: ReadonlyArray<{
      readonly type?: string;
      readonly data?: string;
      readonly mime_type?: string;
    }>;
  }>;
  readonly usage?: {
    readonly input_tokens_by_modality?: ReadonlyArray<ModalityTokenCount>;
    readonly output_tokens_by_modality?: ReadonlyArray<ModalityTokenCount>;
    readonly total_input_tokens?: number;
    readonly total_output_tokens?: number;
  };
}

function parseTtsUsage(usage: InteractionsResponse['usage']):
  | { readonly inputTextTokens: number; readonly outputAudioTokens: number }
  | undefined {
  if (!usage) return undefined;
  const inputTextTokens = tokensForModality(usage.input_tokens_by_modality, 'text')
    ?? validTokenCount(usage.total_input_tokens);
  const outputAudioTokens = tokensForModality(usage.output_tokens_by_modality, 'audio')
    ?? validTokenCount(usage.total_output_tokens);
  if (inputTextTokens === undefined || outputAudioTokens === undefined) return undefined;
  return { inputTextTokens, outputAudioTokens };
}

function tokensForModality(
  counts: ReadonlyArray<ModalityTokenCount> | undefined,
  modality: string,
): number | undefined {
  if (!counts) return undefined;
  let total = 0;
  let found = false;
  for (const item of counts) {
    if (item.modality !== modality) continue;
    const count = validTokenCount(item.tokens);
    if (count === undefined) return undefined;
    total += count;
    found = true;
  }
  return found && Number.isSafeInteger(total) ? total : undefined;
}

function validTokenCount(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

interface VoicesListResponse {
  readonly voices?: ReadonlyArray<{
    readonly id?: string;
    readonly display_name?: string;
    readonly language_code?: string;
    readonly description?: string;
  }>;
  readonly next_page_token?: string;
}

export { DEFAULT_VOICE };
export { type SynthesizerCreateContext };

export default buildGeminiTtsPlugin();
