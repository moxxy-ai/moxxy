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
}

export class CodexOAuthTranscriber implements Transcriber {
  readonly name = OPENAI_CODEX_TRANSCRIBER_NAME;
  private readonly vault: CodexOAuthVault;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sessionIdProvider: () => string;

  constructor(opts: CodexOAuthTranscriberOptions) {
    this.vault = opts.vault;
    this.endpoint = buildCodexTranscribeUrl(opts.baseUrl);
    this.fetchImpl = opts.fetch ?? fetch;
    this.sessionIdProvider = opts.sessionIdProvider ?? randomUUID;
  }

  async transcribe(
    audio: Uint8Array | ArrayBuffer,
    opts: TranscribeOptions = {},
  ): Promise<TranscriptionResult> {
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

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: buildCodexTranscribeHeaders(tokens, sessionId),
        body: form,
        signal: opts.signal,
      });
    } catch (err) {
      const network = classifyNetworkError(err, { url: this.endpoint, provider: CODEX_PROVIDER_ID });
      if (network) throw network;
      throw err;
    }

    const raw = await response.text();
    if (!response.ok) {
      const classified = classifyHttpStatus(response.status, {
        provider: CODEX_PROVIDER_ID,
        url: this.endpoint,
        body: summarizeCodexErrorBody(raw),
      });
      if (classified) throw classified;

      throw new MoxxyError({
        code: 'PROVIDER_BAD_REQUEST',
        message: `Codex transcription returned HTTP ${response.status}.`,
        context: { provider: CODEX_PROVIDER_ID, url: this.endpoint, status: response.status },
        ...(raw ? { cause: new Error(raw) } : {}),
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

export function buildCodexTranscribeUrl(baseUrl = DEFAULT_CODEX_TRANSCRIBE_BASE_URL): string {
  const url = new URL(baseUrl);
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

function summarizeCodexErrorBody(raw: string): string | undefined {
  const body = raw.trim();
  if (!body) return undefined;
  if (/^(?:<!doctype html|<html[\s>])/i.test(body)) {
    return 'HTML error page from ChatGPT backend';
  }
  return body;
}
