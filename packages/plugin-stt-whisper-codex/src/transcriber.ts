import { randomUUID } from 'node:crypto';
import {
  CODEX_PROVIDER_ID,
  ensureFreshCodexTokens,
  type CodexTokens,
} from '@moxxy/plugin-provider-openai-codex';
import {
  MOXXY_PCM16_24KHZ_MIME,
  normalizeWhisperUpload,
} from '@moxxy/plugin-stt-whisper';
import {
  classifyHttpStatus,
  classifyNetworkError,
  MoxxyError,
  type Transcriber,
  type TranscribeOptions,
  type TranscriptionResult,
} from '@moxxy/sdk';

export const OPENAI_CODEX_TRANSCRIBER_NAME = 'openai-codex-transcribe';
export const DEFAULT_CODEX_TRANSCRIBE_BASE_URL = 'https://chatgpt.com';
export { MOXXY_PCM16_24KHZ_MIME };
const CODEX_TRANSCRIBE_ORIGINATOR = 'Codex Desktop';
const CODEX_TRANSCRIBE_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
// Deadline for the whole transcribe round-trip. Several callers pass no
// AbortSignal at all, so without this a half-open proxy / slow-loris peer that
// accepts the TCP connection but never responds would leave the promise (and
// the in-flight audio buffer) pending forever.
const DEFAULT_CODEX_TRANSCRIBE_TIMEOUT_MS = 60_000;
// The success body is a tiny `{ text }` JSON; error bodies (HTML pages) are the
// only large ones. Cap the buffered read so a hostile/broken backend can't
// balloon memory by streaming a multi-GB body before we even inspect it.
const MAX_CODEX_TRANSCRIBE_BODY_BYTES = 4 * 1024 * 1024;
// Upper bound on any raw upstream body we embed in a thrown error's cause, so
// an unmapped status can't smuggle an arbitrarily long (or PII-bearing) body
// into stack traces / debug logs.
const MAX_CODEX_ERROR_CAUSE_CHARS = 500;

interface TimeoutHandle {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  readonly clear: () => void;
}

/** Merge an optional caller signal with an optional internal one. */
function combineSignals(
  a: AbortSignal | undefined,
  b: AbortSignal | undefined,
): AbortSignal | undefined {
  if (a && b) return AbortSignal.any([a, b]);
  return a ?? b;
}

export interface CodexOAuthVault {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, tags?: ReadonlyArray<string>): Promise<void>;
  delete?(key: string): Promise<boolean>;
}

export interface CodexOAuthTranscriberOptions {
  readonly vault: CodexOAuthVault;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly sessionIdProvider?: () => string;
  /** Whole-request deadline in ms; defaults to 60s. `<= 0` disables it. */
  readonly requestTimeoutMs?: number;
}

export class CodexOAuthTranscriber implements Transcriber {
  readonly name = OPENAI_CODEX_TRANSCRIBER_NAME;
  private readonly vault: CodexOAuthVault;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sessionIdProvider: () => string;
  private readonly requestTimeoutMs: number;

  constructor(opts: CodexOAuthTranscriberOptions) {
    this.vault = opts.vault;
    this.endpoint = buildCodexTranscribeUrl(opts.baseUrl);
    this.fetchImpl = opts.fetch ?? fetch;
    this.sessionIdProvider = opts.sessionIdProvider ?? randomUUID;
    this.requestTimeoutMs =
      opts.requestTimeoutMs ?? DEFAULT_CODEX_TRANSCRIBE_TIMEOUT_MS;
  }

  async transcribe(
    audio: Uint8Array | ArrayBuffer,
    opts: TranscribeOptions = {},
  ): Promise<TranscriptionResult> {
    // Empty audio can never yield a transcript: fast-fail before loading tokens
    // (which may trigger an OAuth refresh) or hitting the network.
    if (audio.byteLength === 0) return { text: '' };

    const tokens = await this.loadTokens();
    const sessionId = this.sessionIdProvider();
    // NB: `opts.language` / `opts.prompt` are intentionally NOT forwarded.
    // This hits the undocumented, reverse-engineered ChatGPT `backend-api/
    // transcribe` endpoint (mimicking Codex Desktop), which only accepts the
    // audio file part — sending extra multipart fields risks a rejection or
    // silent behavior change. The OpenAI Whisper sibling (which does support
    // language/prompt) is the path for callers that need those hints.
    const upload = normalizeWhisperUpload(audio, opts.mimeType, 'moxxy');
    const form = new FormData();
    form.append('file', new File([upload.bytes], upload.filename, { type: upload.mimeType }));

    // Always race the request against an internal deadline (combined with any
    // caller signal) so a connection the peer accepts but never answers still
    // rejects instead of hanging forever. We own the timeout controller so we
    // can tell our deadline apart from a caller abort and surface NETWORK_TIMEOUT
    // explicitly (classifyNetworkError keys off `AbortError`, not the
    // `TimeoutError` an AbortSignal.timeout would raise).
    //
    // The single deadline spans BOTH the fetch AND the subsequent body read: a
    // slow-loris peer can send response *headers* promptly (resolving the fetch
    // promise) and then dribble the *body* one byte at a time, so capping only
    // the body SIZE isn't enough — the body read must also abort on the same
    // deadline. We therefore keep the timer armed through the body read and only
    // clear it in the outer `finally`.
    const timeout = this.armTimeout();
    const signal = combineSignals(opts.signal, timeout?.signal);

    const timedOutError = (err: unknown): MoxxyError =>
      new MoxxyError({
        code: 'NETWORK_TIMEOUT',
        message: `Codex transcription timed out after ${this.requestTimeoutMs}ms.`,
        context: { provider: CODEX_PROVIDER_ID, url: this.endpoint },
        cause: err,
      });

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: buildCodexTranscribeHeaders(tokens, sessionId),
          body: form,
          ...(signal ? { signal } : {}),
        });
      } catch (err) {
        if (timeout?.timedOut() && !opts.signal?.aborted) throw timedOutError(err);
        const network = classifyNetworkError(err, { url: this.endpoint, provider: CODEX_PROVIDER_ID });
        if (network) throw network;
        throw err;
      }

      const raw = await readCappedBody(response, MAX_CODEX_TRANSCRIBE_BODY_BYTES, signal);
      // A body read that stalled past the deadline aborts via `signal`; surface
      // it as a timeout (our deadline) or a NETWORK_ABORTED (caller cancelled)
      // the same way a hung fetch is, instead of silently parsing a truncated body.
      if (timeout?.timedOut() && !opts.signal?.aborted) throw timedOutError(undefined);
      if (opts.signal?.aborted) {
        const aborted = classifyNetworkError(
          Object.assign(new Error('Request aborted while reading the response body.'), {
            name: 'AbortError',
          }),
          { url: this.endpoint, provider: CODEX_PROVIDER_ID },
        );
        if (aborted) throw aborted;
      }
      return this.parseResponse(response, raw);
    } finally {
      timeout?.clear();
    }
  }

  private parseResponse(response: Response, raw: string): TranscriptionResult {
    if (!response.ok) {
      const summary = summarizeCodexErrorBody(raw);
      const classified = classifyHttpStatus(response.status, {
        provider: CODEX_PROVIDER_ID,
        url: this.endpoint,
        body: summary,
      });
      if (classified) throw classified;

      // Mirror the classified path: never embed the raw, untruncated body
      // verbatim into the error cause/context — collapse HTML pages and bound
      // the length so an unmapped status can't leak an arbitrary body.
      const summarized = summary?.slice(0, MAX_CODEX_ERROR_CAUSE_CHARS);
      throw new MoxxyError({
        code: 'PROVIDER_BAD_REQUEST',
        message: `Codex transcription returned HTTP ${response.status}.`,
        context: {
          provider: CODEX_PROVIDER_ID,
          url: this.endpoint,
          status: response.status,
          ...(summarized ? { body: summarized } : {}),
        },
        ...(summarized ? { cause: new Error(summarized) } : {}),
      });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch (err) {
      throw new MoxxyError({
        code: 'PROVIDER_UNKNOWN_RESPONSE',
        message: 'Codex transcription returned invalid JSON.',
        context: { provider: CODEX_PROVIDER_ID, url: this.endpoint },
        cause: err,
      });
    }

    // A 200 with a string `text` field is a SUCCESS even when that string is
    // empty/whitespace — that just means the clip held no intelligible speech
    // (silence, a clipped tap, a muted mic). Return `{ text: '' }` so callers
    // take their graceful "no speech" path (the TUI shows a notice, the desktop
    // a hint, Telegram/HTTP their own empty-text replies) instead of treating a
    // normal outcome as a provider failure — every caller already guards on an
    // empty transcript, and this is the one backend that used to throw past
    // them. Only a response MISSING the `text` field (or whose `text` isn't a
    // string) is a real contract violation worth throwing on.
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof (payload as { text?: unknown }).text !== 'string'
    ) {
      throw new MoxxyError({
        code: 'PROVIDER_UNKNOWN_RESPONSE',
        message: 'Codex transcription response was missing a text field.',
        context: { provider: CODEX_PROVIDER_ID, url: this.endpoint },
      });
    }

    // Surface the richer fields when the backend reports them (it returns only
    // `{ text }` today, so these are normally absent and the result is
    // unchanged). Guarding each field keeps a schema drift from corrupting the
    // result while letting diarization/segment-aware consumers benefit if the
    // endpoint ever starts emitting them.
    const obj = payload as {
      text: string;
      language?: unknown;
      duration?: unknown;
      segments?: unknown;
    };
    const result: {
      text: string;
      language?: string;
      durationSec?: number;
      segments?: ReadonlyArray<{ start: number; end: number; text: string }>;
    } = { text: obj.text.trim() };
    if (typeof obj.language === 'string') result.language = obj.language;
    if (typeof obj.duration === 'number') result.durationSec = obj.duration;
    if (Array.isArray(obj.segments)) {
      const segments = obj.segments
        .filter(
          (s): s is { start: number; end: number; text: string } =>
            !!s &&
            typeof s === 'object' &&
            typeof (s as { start?: unknown }).start === 'number' &&
            typeof (s as { end?: unknown }).end === 'number' &&
            typeof (s as { text?: unknown }).text === 'string',
        )
        .map((s) => ({ start: s.start, end: s.end, text: s.text }));
      if (segments.length > 0) result.segments = segments;
    }
    return result;
  }

  /**
   * Arm an internal abort timer for the request deadline. Returns `undefined`
   * when the timeout is disabled (`<= 0`). The caller MUST `clear()` it once the
   * response (or rejection) is in hand so a bare timer can't keep the process
   * alive.
   */
  private armTimeout(): TimeoutHandle | undefined {
    if (!(this.requestTimeoutMs > 0)) return undefined;
    const controller = new AbortController();
    let fired = false;
    const timer = setTimeout(() => {
      fired = true;
      controller.abort();
    }, this.requestTimeoutMs);
    timer.unref?.();
    return {
      signal: controller.signal,
      timedOut: () => fired,
      clear: () => clearTimeout(timer),
    };
  }

  private async loadTokens(): Promise<CodexTokens> {
    try {
      return await ensureFreshCodexTokens(this.vault);
    } catch (err) {
      if (
        MoxxyError.isMoxxyError(err) &&
        (err.code === 'AUTH_NO_CREDENTIALS' || err.code === 'AUTH_EXPIRED')
      ) {
        throw new MoxxyError({
          code: err.code,
          message: `No OpenAI Codex OAuth credentials available. Run \`moxxy login openai-codex\` to sign in.`,
          hint: err.hint ?? 'Run `moxxy login openai-codex` to sign in.',
          context: { provider: CODEX_PROVIDER_ID },
          cause: err,
        });
      }
      throw err;
    }
  }
}

function isLoopbackHostname(hostname: string): boolean {
  // URL() wraps IPv6 literals in brackets.
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function buildCodexTranscribeUrl(baseUrl = DEFAULT_CODEX_TRANSCRIBE_BASE_URL): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (cause) {
    throw new MoxxyError({
      code: 'CONFIG_INVALID',
      message: `Invalid Codex transcribe base URL: ${baseUrl}`,
      context: { baseUrl: String(baseUrl) },
      cause,
    });
  }

  // The transcriber attaches a live `Authorization: Bearer <access-token>`
  // header to this endpoint, so a config-controlled baseUrl must not be able to
  // redirect that credential to an arbitrary origin. Pin to chatgpt.com over
  // https, and allow loopback (the test/local seam) over http or https. Reject
  // everything else as a misconfiguration rather than exfiltrating the token.
  const loopback = isLoopbackHostname(url.hostname);
  const httpsChatgpt = url.protocol === 'https:' && url.hostname === 'chatgpt.com';
  if (!httpsChatgpt && !loopback) {
    throw new MoxxyError({
      code: 'CONFIG_INVALID',
      message:
        `Refusing to send Codex OAuth credentials to ${url.origin}. ` +
        'The Codex transcribe base URL must be https://chatgpt.com (or a loopback host for local testing).',
      context: { baseUrl: String(baseUrl), origin: url.origin },
    });
  }
  if (loopback && url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new MoxxyError({
      code: 'CONFIG_INVALID',
      message: `Unsupported scheme for Codex transcribe base URL: ${url.protocol}`,
      context: { baseUrl: String(baseUrl), protocol: url.protocol },
    });
  }

  let pathname = url.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/') pathname = '';
  if (url.hostname === 'chatgpt.com' && !pathname.endsWith('/backend-api')) {
    pathname = `${pathname}/backend-api`;
  }
  if (!pathname.endsWith('/transcribe')) {
    pathname = `${pathname}/transcribe`;
  }
  url.pathname = pathname;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function buildCodexTranscribeHeaders(tokens: CodexTokens, sessionId: string): Headers {
  const headers = new Headers({
    accept: 'application/json',
    authorization: `Bearer ${tokens.access}`,
    originator: CODEX_TRANSCRIBE_ORIGINATOR,
    origin: 'https://chatgpt.com',
    referer: 'https://chatgpt.com/',
    'user-agent': CODEX_TRANSCRIBE_USER_AGENT,
    session_id: sessionId,
  });
  if (tokens.accountId) headers.set('ChatGPT-Account-Id', tokens.accountId);
  return headers;
}

/**
 * Read a response body to text, but stop once `maxBytes` have been buffered and
 * cancel the rest of the stream. A success body is a tiny `{ text }` JSON; only
 * a hostile/broken backend would stream more, so a tight cap is safe and keeps a
 * multi-GB body from ballooning memory before we parse/inspect it.
 *
 * `signal` carries the same request deadline (and caller abort) the fetch used:
 * a slow-loris peer that returns headers promptly then dribbles the body would
 * otherwise hang this read forever (the size cap doesn't help when bytes arrive
 * slowly, not all at once), so the read also aborts on the deadline. A missing
 * body, an abort, or a decode/read failure yields whatever was read so far (or
 * `''`); the caller checks the timeout flag to decide whether to surface it as
 * NETWORK_TIMEOUT.
 */
async function readCappedBody(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  const body = response.body;
  if (!body) {
    // No stream (e.g. some fetch polyfills / mocks); fall back to text() — those
    // bodies are already in memory so there's nothing to cap. Race it against the
    // deadline so even a polyfill that buffers slowly can't hang us.
    try {
      return await abortable(response.text(), signal);
    } catch {
      return '';
    }
  }
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let received = 0;
  let out = '';
  const onAbort = () => {
    // Unblock a pending reader.read() on the deadline / caller abort.
    reader.cancel().catch(() => {});
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        out += decoder.decode(value, { stream: true });
      }
    }
    return out;
  } catch {
    return out;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.cancel().catch(() => {});
  }
}

/**
 * Reject `promise` as soon as `signal` aborts, so a body that can't be streamed
 * (e.g. a mock's `text()` that never settles) still honours the deadline. The
 * underlying work is left to settle/garbage-collect on its own — we only stop
 * awaiting it.
 */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function summarizeCodexErrorBody(raw: string): string | undefined {
  const body = raw.trim();
  if (!body) return undefined;
  if (/^(?:<!doctype html|<html[\s>])/i.test(body)) {
    return 'HTML error page from ChatGPT backend';
  }
  return body;
}
