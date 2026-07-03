import {
  classifyHttpStatus,
  classifyNetworkError,
  MoxxyError,
  type Synthesizer,
  type SynthesizeOptions,
  type SynthesisResult,
} from '@moxxy/sdk';

/** Provider tag attached to classified errors for logs/debug context. */
const OPENAI_TTS_PROVIDER_ID = 'openai';

/** OpenAI `/v1/audio/speech` response formats we expose, mapped to the MIME
 *  type the desktop/channels play the returned bytes as. Kept a small closed
 *  map (OpenAI also serves flac/pcm — not surfaced here). */
const MIME_BY_FORMAT = {
  mp3: 'audio/mpeg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  aac: 'audio/aac',
} as const;

export type OpenAiTtsFormat = keyof typeof MIME_BY_FORMAT;

/** OpenAI rejects `input` longer than 4096 characters. Channels routinely send
 *  long replies, so we truncate at a sentence boundary rather than let the API
 *  400 the whole read-aloud. */
const MAX_INPUT_CHARS = 4096;

/** OpenAI clamps `speed` to this inclusive range; anything outside 400s. */
const MIN_SPEED = 0.25;
const MAX_SPEED = 4.0;

/** Default per-request deadline. Read-aloud is cancellable, but a hung socket
 *  should still free itself so callers can fall back to the OS voice. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Injectable `fetch` — the default is the global; tests pass a stub. Widened
 *  from the global signature so a plain `(url, init) => Response` stub fits. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface OpenAiSynthesizerOptions {
  /** Explicit API key. Normally omitted — the key is read via `getSecret`. */
  readonly apiKey?: string;
  /** Vault-backed secret resolver handed in by `SynthesizerCreateContext`. */
  readonly getSecret?: (name: string) => Promise<string | null>;
  /** API base, default `https://api.openai.com/v1`. Trailing slashes trimmed. */
  readonly baseURL?: string;
  /** TTS model, default `gpt-4o-mini-tts`. */
  readonly model?: string;
  /** Default voice, default `alloy`. Overridden per-call by `opts.voice`. */
  readonly voice?: string;
  /** Output container, default `mp3`. Determines the returned `mimeType`. */
  readonly format?: OpenAiTtsFormat;
  /** Injected `fetch` (tests). Defaults to the global. */
  readonly fetchImpl?: FetchLike;
  /** Per-request timeout in ms. Default 60000. */
  readonly timeoutMs?: number;
}

/**
 * `Synthesizer` backed by OpenAI's `POST /v1/audio/speech` endpoint — one JSON
 * POST returning raw audio bytes, so there's no need for the `openai` SDK. The
 * API key rides the vault (`ctx.getSecret('OPENAI_API_KEY')`, the same key the
 * OpenAI provider uses) with a `process.env.OPENAI_API_KEY` fallback, resolved
 * lazily on the first `synthesize` and cached so `create()` stays cheap.
 */
export class OpenAiSynthesizer implements Synthesizer {
  readonly name = 'openai-tts';
  /** MIME type of the bytes this instance returns (derived from `format`). */
  readonly mimeType: string;

  private readonly explicitKey: string | undefined;
  private readonly getSecret: ((name: string) => Promise<string | null>) | undefined;
  private readonly baseURL: string;
  private readonly model: string;
  private readonly voice: string;
  private readonly format: OpenAiTtsFormat;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private key: string | null = null;

  constructor(opts: OpenAiSynthesizerOptions = {}) {
    this.explicitKey = opts.apiKey;
    this.getSecret = opts.getSecret;
    this.baseURL = (opts.baseURL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.model = opts.model ?? 'gpt-4o-mini-tts';
    this.voice = opts.voice ?? 'alloy';
    this.format = opts.format ?? 'mp3';
    this.mimeType = MIME_BY_FORMAT[this.format];
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike);
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async synthesize(text: string, opts: SynthesizeOptions = {}): Promise<SynthesisResult> {
    // Fast-path a caller who cancelled before we started — propagate their reason.
    opts.signal?.throwIfAborted();

    const key = await this.resolveKey();
    const input = capInput(text);
    const voice = opts.voice ?? this.voice;
    const speed = clampSpeed(opts.rate);
    const body = {
      model: this.model,
      voice,
      input,
      response_format: this.format,
      ...(speed !== undefined ? { speed } : {}),
    };
    const url = `${this.baseURL}/audio/speech`;

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
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
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
          message: `OpenAI text-to-speech request timed out after ${this.timeoutMs} ms.`,
          hint: 'Retry, or shorten the text being read aloud.',
          context: { provider: OPENAI_TTS_PROVIDER_ID, url },
        });
      }
      const network = classifyNetworkError(err, { provider: OPENAI_TTS_PROVIDER_ID, url });
      if (network) throw network;
      throw err;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', forward);
    }

    if (!res.ok) {
      const classified = classifyHttpStatus(res.status, {
        provider: OPENAI_TTS_PROVIDER_ID,
        url,
        body: await res.text().catch(() => ''),
      });
      if (classified) throw classified;
      throw new MoxxyError({
        code: 'PROVIDER_BAD_REQUEST',
        message: `OpenAI text-to-speech returned HTTP ${res.status}.`,
        context: { provider: OPENAI_TTS_PROVIDER_ID, url, status: res.status },
      });
    }

    const audio = new Uint8Array(await res.arrayBuffer());
    return { audio, mimeType: this.mimeType };
  }

  /**
   * Resolve the API key lazily: explicit option → vault (`OPENAI_API_KEY`) →
   * `process.env.OPENAI_API_KEY`. Cache only a successful resolution so a key
   * added after a first failed attempt is still picked up on retry. A missing
   * key becomes a classified, actionable `MoxxyError`.
   */
  private async resolveKey(): Promise<string> {
    if (this.key) return this.key;
    const resolved =
      this.explicitKey ??
      (await this.getSecret?.('OPENAI_API_KEY')) ??
      process.env.OPENAI_API_KEY ??
      null;
    if (!resolved) {
      throw new MoxxyError({
        code: 'AUTH_NO_CREDENTIALS',
        message:
          'No OpenAI API key for text-to-speech. It rides the same OPENAI_API_KEY as the OpenAI provider.',
        hint: 'Run `moxxy init` (stores it in the vault) or set OPENAI_API_KEY.',
        context: { provider: OPENAI_TTS_PROVIDER_ID },
      });
    }
    this.key = resolved;
    return resolved;
  }
}

/** Map a `SynthesizeOptions.rate` multiplier onto OpenAI's `speed`, clamped to
 *  the accepted 0.25–4.0 range. Non-finite / absent rates yield `undefined` so
 *  the field is omitted and OpenAI uses its default. */
export function clampSpeed(rate: number | undefined): number | undefined {
  if (rate === undefined || !Number.isFinite(rate)) return undefined;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, rate));
}

/**
 * Cap `text` to OpenAI's 4096-char `input` limit. When over, truncate at the
 * last sentence boundary (`. `, `! `, `? `, newline) inside the budget — as
 * long as that keeps most of the text — else hard-slice, and append a single
 * ellipsis so the result is always ≤ 4096 characters.
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

export function createOpenAiSynthesizer(opts: OpenAiSynthesizerOptions = {}): OpenAiSynthesizer {
  return new OpenAiSynthesizer(opts);
}
