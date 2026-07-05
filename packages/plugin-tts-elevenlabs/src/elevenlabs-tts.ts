import {
  classifyHttpStatus,
  classifyNetworkError,
  MoxxyError,
  type Synthesizer,
  type SynthesizeOptions,
  type SynthesisResult,
} from '@moxxy/sdk';

/** Provider tag attached to classified errors for logs/debug context. */
const ELEVENLABS_TTS_PROVIDER_ID = 'elevenlabs';

/** ElevenLabs `output_format` query values we expose, mapped to the MIME type
 *  the desktop/channels play the returned bytes as. Deliberately a small closed
 *  map of only the mp3 variants — every one is a self-contained, playable
 *  container that maps cleanly to `audio/mpeg`. `mp3_44100_128` is the default
 *  (44.1 kHz / 128 kbps).
 *
 *  Formats intentionally NOT surfaced, and why:
 *   - `pcm_*` (raw 16-bit LE PCM): headerless — there is no container, so the
 *     honest options are to WAV-wrap the bytes or omit them. We omit rather than
 *     hand a caller unplayable bytes under a bogus `audio/wav`/`audio/pcm` label.
 *   - `ulaw_8000` / `alaw_8000`: telephony codecs, likewise headerless.
 *   - opus: some newer API versions document an `opus_48000_*` family, but we
 *     are not confident of the exact stable token on this endpoint, and inventing
 *     a query value would 4xx the request — so it is left out rather than guessed. */
const MIME_BY_FORMAT = {
  mp3_44100_128: 'audio/mpeg',
  mp3_44100_64: 'audio/mpeg',
  mp3_22050_32: 'audio/mpeg',
} as const;

export type ElevenLabsTtsFormat = keyof typeof MIME_BY_FORMAT;

/** Rachel — a stock ElevenLabs voice present on every account. */
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

/** ElevenLabs' input length caps vary by plan/model (roughly 2500–5000 chars).
 *  We truncate at the conservative 2500 so a long channel reply never 4xx's the
 *  whole read-aloud regardless of the caller's plan; the cut lands on a sentence
 *  boundary, same mechanism as the OpenAI sibling. */
const MAX_INPUT_CHARS = 2500;

/** Default per-request deadline. Read-aloud is cancellable, but a hung socket
 *  should still free itself so callers can fall back to the OS voice. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Injectable `fetch` — the default is the global; tests pass a stub. Widened
 *  from the global signature so a plain `(url, init) => Response` stub fits. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ElevenLabsSynthesizerOptions {
  /** Explicit API key. Normally omitted — the key is read via `getSecret`. */
  readonly apiKey?: string;
  /** Vault-backed secret resolver handed in by `SynthesizerCreateContext`. */
  readonly getSecret?: (name: string) => Promise<string | null>;
  /** API base, default `https://api.elevenlabs.io/v1`. Trailing slashes trimmed. */
  readonly baseURL?: string;
  /** TTS model, default `eleven_multilingual_v2`. */
  readonly model?: string;
  /** Default voice id, default Rachel (`21m00Tcm4TlvDq8ikWAM`). Overridden
   *  per-call by `opts.voice`. */
  readonly voiceId?: string;
  /** Output container, default `mp3_44100_128`. Determines the returned `mimeType`. */
  readonly format?: ElevenLabsTtsFormat;
  /** Injected `fetch` (tests). Defaults to the global. */
  readonly fetchImpl?: FetchLike;
  /** Per-request timeout in ms. Default 60000. */
  readonly timeoutMs?: number;
}

/**
 * `Synthesizer` backed by ElevenLabs' `POST /v1/text-to-speech/{voiceId}`
 * endpoint — one JSON POST returning raw audio bytes, so there's no need for a
 * vendor SDK. The API key rides the vault (`ctx.getSecret('ELEVENLABS_API_KEY')`)
 * with a `process.env.ELEVENLABS_API_KEY` fallback, resolved lazily on the first
 * `synthesize` and cached so `create()` stays cheap. This is the "quality"
 * Synthesizer option alongside the OpenAI backend.
 */
export class ElevenLabsSynthesizer implements Synthesizer {
  readonly name = 'elevenlabs';
  /** MIME type of the bytes this instance returns (derived from `format`). */
  readonly mimeType: string;

  private readonly explicitKey: string | undefined;
  private readonly getSecret: ((name: string) => Promise<string | null>) | undefined;
  private readonly baseURL: string;
  private readonly model: string;
  private readonly voiceId: string;
  private readonly format: ElevenLabsTtsFormat;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private key: string | null = null;

  constructor(opts: ElevenLabsSynthesizerOptions = {}) {
    this.explicitKey = opts.apiKey;
    this.getSecret = opts.getSecret;
    this.baseURL = (opts.baseURL ?? 'https://api.elevenlabs.io/v1').replace(/\/+$/, '');
    this.model = opts.model ?? 'eleven_multilingual_v2';
    this.voiceId = opts.voiceId ?? DEFAULT_VOICE_ID;
    this.format = opts.format ?? 'mp3_44100_128';
    this.mimeType = MIME_BY_FORMAT[this.format];
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike);
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async synthesize(text: string, opts: SynthesizeOptions = {}): Promise<SynthesisResult> {
    // Fast-path a caller who cancelled before we started — propagate their reason.
    opts.signal?.throwIfAborted();

    const key = await this.resolveKey();
    const input = capInput(text);
    const voiceId = opts.voice ?? this.voiceId;
    // `opts.rate` is intentionally ignored: ElevenLabs has no reliable, model-
    // agnostic speaking-rate parameter (`voice_settings` covers stability /
    // similarity / style, not speed), so mapping it would be guesswork. We omit
    // `voice_settings` entirely and let the model use its own defaults.
    const body = {
      text: input,
      model_id: this.model,
    };
    // `output_format` is a QUERY parameter on this endpoint, not a body field.
    const url = `${this.baseURL}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${this.format}`;

    // Chain the caller's abort signal with our own timeout onto one controller
    // passed to fetch, so either cancels the request and frees the socket.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const forward = (): void => controller.abort();
    if (opts.signal) {
      // The signal may have fired during key resolution above; a listener added
      // to an already-aborted signal is never called, so abort directly here.
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener('abort', forward, { once: true });
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      // Caller-initiated cancellation: re-throw their reason unchanged so a
      // stopped read-aloud isn't masked as a provider/network error.
      if (opts.signal?.aborted && !timedOut) throw opts.signal.reason ?? err;
      if (timedOut) {
        throw new MoxxyError({
          code: 'NETWORK_TIMEOUT',
          message: `ElevenLabs text-to-speech request timed out after ${this.timeoutMs} ms.`,
          hint: 'Retry, or shorten the text being read aloud.',
          context: { provider: ELEVENLABS_TTS_PROVIDER_ID, url },
        });
      }
      const network = classifyNetworkError(err, { provider: ELEVENLABS_TTS_PROVIDER_ID, url });
      if (network) throw network;
      throw err;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', forward);
    }

    if (!res.ok) {
      const classified = classifyHttpStatus(res.status, {
        provider: ELEVENLABS_TTS_PROVIDER_ID,
        url,
        body: await res.text().catch(() => ''),
      });
      if (classified) throw classified;
      throw new MoxxyError({
        code: 'PROVIDER_BAD_REQUEST',
        message: `ElevenLabs text-to-speech returned HTTP ${res.status}.`,
        context: { provider: ELEVENLABS_TTS_PROVIDER_ID, url, status: res.status },
      });
    }

    const audio = new Uint8Array(await res.arrayBuffer());
    return { audio, mimeType: this.mimeType };
  }

  /**
   * Resolve the API key lazily: explicit option → vault (`ELEVENLABS_API_KEY`) →
   * `process.env.ELEVENLABS_API_KEY`. Cache only a successful resolution so a key
   * added after a first failed attempt is still picked up on retry. A missing
   * key becomes a classified, actionable `MoxxyError`.
   */
  private async resolveKey(): Promise<string> {
    if (this.key) return this.key;
    const resolved =
      this.explicitKey ??
      (await this.getSecret?.('ELEVENLABS_API_KEY')) ??
      process.env.ELEVENLABS_API_KEY ??
      null;
    if (!resolved) {
      throw new MoxxyError({
        code: 'AUTH_NO_CREDENTIALS',
        message: 'No ElevenLabs API key for text-to-speech.',
        hint: 'Run `moxxy init` (stores it in the vault) or set ELEVENLABS_API_KEY.',
        context: { provider: ELEVENLABS_TTS_PROVIDER_ID },
      });
    }
    this.key = resolved;
    return resolved;
  }
}

/**
 * Cap `text` to ElevenLabs' input limit. When over, truncate at the last
 * sentence boundary (`. `, `! `, `? `, newline) inside the budget — as long as
 * that keeps most of the text — else hard-slice, and append a single ellipsis so
 * the result is always ≤ {@link MAX_INPUT_CHARS} characters.
 */
export function capInput(text: string): string {
  if (text.length <= MAX_INPUT_CHARS) return text;
  const budget = MAX_INPUT_CHARS - 1; // leave room for the ellipsis
  const slice = text.slice(0, budget);
  const boundary = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('\n'),
  );
  // Only honor a boundary that doesn't discard more than half the budget,
  // otherwise a single very long sentence would be cut to almost nothing.
  const cut = boundary > budget * 0.5 ? boundary + 1 : budget;
  return `${slice.slice(0, cut).trimEnd()}…`;
}

export function createElevenLabsSynthesizer(
  opts: ElevenLabsSynthesizerOptions = {},
): ElevenLabsSynthesizer {
  return new ElevenLabsSynthesizer(opts);
}
