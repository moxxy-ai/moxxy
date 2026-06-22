import OpenAI, { APIError, APIConnectionError, APIUserAbortError } from 'openai';
import {
  classifyHttpStatus,
  classifyNetworkError,
  MoxxyError,
  type Transcriber,
  type TranscribeOptions,
  type TranscriptionResult,
} from '@moxxy/sdk';
import { normalizeWhisperUpload } from './audio.js';

export type WhisperModel = 'whisper-1' | 'gpt-4o-transcribe' | 'gpt-4o-mini-transcribe';

/** Provider tag attached to classified errors for logs/debug context. */
const WHISPER_PROVIDER_ID = 'openai';

export interface WhisperTranscriberOptions {
  readonly apiKey?: string;
  readonly baseURL?: string;
  /** Defaults to `whisper-1`. */
  readonly model?: WhisperModel;
  /**
   * Default language hint (BCP-47). Overridden per-call by
   * `TranscribeOptions.language`. Omit to let Whisper auto-detect.
   */
  readonly language?: string;
  /** Inject a pre-built OpenAI client (tests pass a stub here). */
  readonly client?: OpenAI;
}

/**
 * `Transcriber` backed by OpenAI's audio.transcriptions endpoint
 * (Whisper-1 by default). Requests `verbose_json` so we can return
 * `language`, `durationSec`, and per-segment text without an extra call.
 *
 * Audio bytes come in as `Uint8Array | ArrayBuffer`; we wrap them in a
 * Node `File` for upload (Node 20.10+ provides File / Blob globals).
 */
export class WhisperTranscriber implements Transcriber {
  readonly name: string;
  private readonly client: OpenAI;
  private readonly model: WhisperModel;
  private readonly defaultLanguage: string | undefined;

  constructor(opts: WhisperTranscriberOptions = {}) {
    this.model = opts.model ?? 'whisper-1';
    this.name = `openai-${this.model}`;
    this.defaultLanguage = opts.language;
    this.client =
      opts.client ??
      new OpenAI({
        apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY,
        ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      });
  }

  async transcribe(
    audio: Uint8Array | ArrayBuffer,
    opts: TranscribeOptions = {},
  ): Promise<TranscriptionResult> {
    // Route through the shared Whisper-family preprocessor so the project's
    // raw-PCM16 contract (MOXXY_PCM16_24KHZ_MIME) gets WAV-wrapped and filename
    // inference stays in lockstep with the Codex sibling. Default the MIME to
    // `audio/ogg` to preserve prior behavior for callers that omit it.
    const upload = normalizeWhisperUpload(audio, opts.mimeType ?? 'audio/ogg');
    // Node 20.10+ exposes File globally; the OpenAI SDK accepts it as
    // an `Uploadable`.
    const file = new File([upload.bytes], upload.filename, { type: upload.mimeType });
    const language = opts.language ?? this.defaultLanguage;
    // verbose_json is only supported by whisper-1; the gpt-4o family
    // returns plain JSON. Branch so callers get rich segments when
    // available, and a graceful text-only result when not.
    if (this.model === 'whisper-1') {
      const response = await this.run(() =>
        this.client.audio.transcriptions.create(
          {
            model: this.model,
            file,
            response_format: 'verbose_json',
            ...(language ? { language } : {}),
            ...(opts.prompt ? { prompt: opts.prompt } : {}),
          },
          { signal: opts.signal },
        ),
      );
      // OpenAI verbose-json response: { text, language, duration, segments[] }
      const r = requireTextResponse(response) as {
        text: string;
        language?: unknown;
        duration?: unknown;
        segments?: unknown;
      };
      const result: {
        text: string;
        language?: string;
        durationSec?: number;
        segments?: Array<{ start: number; end: number; text: string }>;
      } = { text: r.text };
      if (typeof r.language === 'string') result.language = r.language;
      if (typeof r.duration === 'number') result.durationSec = r.duration;
      if (Array.isArray(r.segments)) {
        // The vendor response is untrusted: a malformed/partial `segments`
        // entry (`null`, a non-object, or one missing the numeric start/end /
        // string text) would either crash the blind `.start` read or leak a
        // value that violates the `TranscriptionSegment` type contract.
        // Validate each element and drop the ones that don't conform rather
        // than crashing or emitting `{ text: 123 }` downstream.
        result.segments = sanitizeSegments(r.segments);
      }
      return result;
    }
    const response = await this.run(() =>
      this.client.audio.transcriptions.create(
        {
          model: this.model,
          file,
          ...(language ? { language } : {}),
          ...(opts.prompt ? { prompt: opts.prompt } : {}),
        },
        { signal: opts.signal },
      ),
    );
    return { text: requireTextResponse(response).text };
  }

  /**
   * Run an SDK transcription call, translating failures into structured
   * `MoxxyError`s (network vs. HTTP status) to match the codex sibling.
   * User aborts re-throw unchanged so cancellation isn't masked as an error.
   */
  private async run<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      // Intentional cancellation: propagate as-is so callers see the abort.
      if (err instanceof APIUserAbortError) throw err;
      const ctx = { provider: WHISPER_PROVIDER_ID, url: this.client.baseURL };
      if (err instanceof APIConnectionError) {
        const network = classifyNetworkError(err.cause ?? err, ctx);
        if (network) throw network;
      }
      if (err instanceof APIError && typeof err.status === 'number') {
        const classified = classifyHttpStatus(err.status, { ...ctx, body: err.message });
        if (classified) throw classified;
        throw new MoxxyError({
          code: 'PROVIDER_BAD_REQUEST',
          message: `OpenAI transcription returned HTTP ${err.status}.`,
          context: { ...ctx, status: err.status },
          cause: err,
        });
      }
      const network = classifyNetworkError(err, ctx);
      if (network) throw network;
      throw err;
    }
  }
}

/**
 * Validate that an OpenAI transcription response carries a string `text`
 * field before we trust it. The SDK's union return type is wider than what
 * we consume, so we narrow it here; a response missing `text` (or whose
 * `text` isn't a string) is a real contract violation worth surfacing as a
 * structured error rather than silently returning `{ text: undefined }`.
 */
function requireTextResponse(response: unknown): { text: string } & Record<string, unknown> {
  if (
    !response ||
    typeof response !== 'object' ||
    typeof (response as { text?: unknown }).text !== 'string'
  ) {
    throw new MoxxyError({
      code: 'PROVIDER_UNKNOWN_RESPONSE',
      message: 'OpenAI transcription response was missing a text field.',
      context: { provider: WHISPER_PROVIDER_ID },
    });
  }
  return response as { text: string } & Record<string, unknown>;
}

/**
 * Defensively narrow an untrusted `segments` array from a vendor response into
 * the well-typed `TranscriptionSegment[]` contract. Each element is validated
 * to be an object carrying finite numeric `start`/`end` and a string `text`;
 * non-conforming entries (`null`, primitives, NaN/Infinity bounds, missing
 * fields) are dropped so a hostile/partial response degrades to fewer (or zero)
 * segments instead of crashing the caller or leaking off-contract values.
 */
function sanitizeSegments(
  raw: readonly unknown[],
): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = [];
  for (const seg of raw) {
    if (!seg || typeof seg !== 'object') continue;
    const s = seg as { start?: unknown; end?: unknown; text?: unknown };
    if (
      typeof s.start !== 'number' ||
      typeof s.end !== 'number' ||
      typeof s.text !== 'string' ||
      !Number.isFinite(s.start) ||
      !Number.isFinite(s.end)
    ) {
      continue;
    }
    out.push({ start: s.start, end: s.end, text: s.text });
  }
  return out;
}

export function createWhisperTranscriber(opts: WhisperTranscriberOptions = {}): WhisperTranscriber {
  return new WhisperTranscriber(opts);
}
