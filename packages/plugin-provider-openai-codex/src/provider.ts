import { webcrypto } from 'node:crypto';
import type {
  LLMProvider,
  ProviderEvent,
  ProviderRequest,
} from '@moxxy/sdk';
import { classifyHttpStatus, estimateTextTokens } from '@moxxy/sdk';
import { isAuthRejection, withCredentialLock } from '@moxxy/plugin-oauth';
import { CODEX_RESPONSES_URL, refreshTokens } from './oauth.js';
import { codexModels, DEFAULT_CODEX_MODEL } from './models.js';
import { toResponsesBody } from './translate.js';
import { buildCodexHeaders } from './codex/headers.js';
import { consumeResponsesSse, toErrorEvent } from './codex/stream-consumer.js';
import type { CodexTokens } from './types.js';

/**
 * Internal idle timeout (ms). Guards the whole streaming path against a backend
 * that accepts the POST but then stalls — pre-headers slow-loris, a dropped TCP
 * with no RST, or a wedged proxy — when the caller supplied no AbortSignal. The
 * watchdog is reset on every received byte, so a slow-but-alive reasoning stream
 * is never killed; only a stream that goes silent for this long aborts.
 */
const CODEX_IDLE_TIMEOUT_MS = 120_000;

/**
 * Read the error-response body but cap how much we pull into memory: a hostile
 * or broken backend (or MITM) could otherwise stream a multi-megabyte error body
 * that we'd buffer in full and then interpolate into an error string.
 */
const MAX_ERROR_BODY_CHARS = 2048;

/**
 * Flat token estimate charged per non-text content block (image/document) in
 * `countTokens`. A coarse stand-in for the provider's real multimodal token
 * accounting — enough to keep pre-flight budgeting from treating a multimodal
 * request as if it were nearly empty.
 */
const NON_TEXT_BLOCK_TOKENS = 256;

export interface CodexProviderConfig {
  readonly tokens?: CodexTokens;
  /**
   * Called with the new token bundle whenever an in-process refresh happens.
   * The CLI's setup wires this to a vault writeback so the refreshed
   * refresh_token (single-use, rotates on every refresh) is persisted
   * before the next API call goes out.
   */
  readonly onTokensRefreshed?: (next: CodexTokens) => void | Promise<void>;
  /**
   * Re-reads the persisted token bundle (the vault) and returns it, or null
   * when nothing is stored. The refresh token is SINGLE-USE and rotates on
   * every refresh, so when another consumer/process refreshes first, this is
   * how the provider picks up the rotated bundle instead of burning a dead
   * token: it's consulted under the per-credential lock before refreshing,
   * and once more to retry after an invalid_grant-style rejection.
   */
  readonly reloadTokens?: () => Promise<CodexTokens | null>;
  readonly defaultModel?: string;
  /**
   * Reasoning effort sent with every request (`reasoning.effort`).
   * Defaults to `'medium'`. Reaches here from `provider.config` in
   * moxxy.config.ts (e.g. `{ reasoningEffort: 'high' }`); the CLI's
   * credential resolution merges that config through to `createClient`.
   */
  readonly reasoningEffort?: 'low' | 'medium' | 'high';
  /** Test seam — when omitted we use the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Test seam — when omitted we use crypto.randomUUID for the per-request session id. */
  readonly sessionIdProvider?: () => string;
  /**
   * Idle timeout (ms) for the streaming request: the watchdog aborts the call if
   * the backend goes silent for this long (stalled handshake or mid-stream
   * silence). Reset on every received byte, so slow-but-alive streams survive.
   * Defaults to {@link CODEX_IDLE_TIMEOUT_MS}; mainly a test seam.
   */
  readonly idleTimeoutMs?: number;
}

/**
 * LLMProvider implementation against the ChatGPT-plan Codex backend. Auth is
 * an OAuth bearer plus the optional ChatGPT-Account-Id header; the rest of
 * the request body is the OpenAI Responses-API shape.
 *
 * Request-param support: `req.maxTokens` maps to the Responses
 * `max_output_tokens` field; `req.temperature` is NOT forwarded — the Codex
 * backend only serves gpt-5-family reasoning models, which reject sampling
 * params with a 400, so it is dropped (with a one-shot MOXXY_DEBUG note)
 * instead of breaking the request. Reasoning effort is configurable via
 * `CodexProviderConfig.reasoningEffort` (default `'medium'`).
 */
export class CodexProvider implements LLMProvider {
  readonly name = 'openai-codex';
  readonly models = codexModels;

  private tokens: CodexTokens | undefined;
  private readonly onTokensRefreshed?: (next: CodexTokens) => void | Promise<void>;
  private readonly reloadTokens?: () => Promise<CodexTokens | null>;
  private readonly defaultModel: string;
  private readonly reasoningEffort?: 'low' | 'medium' | 'high';
  private readonly fetchImpl: typeof fetch;
  private readonly sessionIdProvider: () => string;
  private readonly idleTimeoutMs: number;

  constructor(config: CodexProviderConfig = {}) {
    if (config.tokens) this.tokens = config.tokens;
    if (config.onTokensRefreshed) this.onTokensRefreshed = config.onTokensRefreshed;
    if (config.reloadTokens) this.reloadTokens = config.reloadTokens;
    this.defaultModel = config.defaultModel ?? DEFAULT_CODEX_MODEL;
    if (config.reasoningEffort) this.reasoningEffort = config.reasoningEffort;
    this.fetchImpl = config.fetch ?? fetch;
    // Default to ONE id for the instance's lifetime, not a fresh uuid per call.
    // The session id becomes the `prompt_cache_key`, so it must be stable
    // across a session's turns for the Responses prefix cache to hit (and the
    // `session_id` header should be stable for one logical session too).
    const defaultSessionId = webcrypto.randomUUID();
    this.sessionIdProvider = config.sessionIdProvider ?? (() => defaultSessionId);
    this.idleTimeoutMs =
      config.idleTimeoutMs && config.idleTimeoutMs > 0
        ? config.idleTimeoutMs
        : CODEX_IDLE_TIMEOUT_MS;
  }

  async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    const model = req.model || this.defaultModel;
    yield { type: 'message_start', model };

    try {
      await this.ensureFresh();
    } catch (err) {
      yield toErrorEvent(err);
      return;
    }

    const sessionId = this.sessionIdProvider();
    // Reasoning preview is gated by the per-provider toggle (`req.reasoning`):
    // when off we behave exactly as before (discard reasoning). The per-call
    // effort, when set, overrides the instance default from provider config.
    const emitReasoning = req.reasoning != null && req.reasoning !== false;
    const reqEffort = typeof req.reasoning === 'object' ? req.reasoning.effort : undefined;
    const reasoningEffort = reqEffort ?? this.reasoningEffort;
    // Pass the session id as the Responses prefix-cache key so repeated turns
    // in a session reuse the cached prefix (cheaper + faster). Codex DOES
    // support this even though the Chat-Completions providers ignore cacheHints.
    const body = toResponsesBody(
      { ...req, model },
      {
        sessionHint: sessionId,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      },
    );

    // Internal idle watchdog: aborts the request if the backend stalls (accepts
    // the POST but never sends headers/body, or goes silent mid-stream) so the
    // turn can't hang forever when the caller supplied no AbortSignal. Composed
    // with `req.signal` so a caller cancellation still wins, and reset on every
    // received byte by `consumeResponsesSse`'s onActivity callback.
    const idleController = new AbortController();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const armIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => idleController.abort(new Error('Codex request timed out (no response from server)')),
        this.idleTimeoutMs,
      );
      // A bare timer must not keep the event loop alive on its own.
      idleTimer.unref?.();
    };
    const disarmIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = undefined;
    };
    const signal = req.signal
      ? AbortSignal.any([req.signal, idleController.signal])
      : idleController.signal;

    try {
      armIdle();
      let response: Response;
      try {
        response = await this.postCodex(body, sessionId, signal);
      } catch (err) {
        yield toErrorEvent(err);
        return;
      }

      if (response.status === 401) {
        // Token might've been revoked between our pre-check and send; try one
        // forced refresh and replay. A second 401 is fatal.
        try {
          await this.refreshNow();
          armIdle();
          response = await this.postCodex(body, sessionId, signal);
        } catch (err) {
          yield toErrorEvent(err);
          return;
        }
        // A 401 that survives a forced refresh means the OAuth grant itself was
        // rejected (expired/revoked), not a transient skew. Surface the same
        // actionable re-auth guidance as ensureFresh rather than the generic
        // "returned 401" HTTP message below.
        if (response.status === 401) {
          yield {
            type: 'error',
            message:
              'ChatGPT OAuth credentials were rejected after a token refresh. Run `moxxy login openai-codex` to re-authenticate.',
            retryable: false,
          };
          return;
        }
      }

      if (!response.ok || !response.body) {
        // Cap the buffered error body: a hostile/broken backend could otherwise
        // stream a huge body that we'd hold in full and then put into a string.
        const text = await readCappedText(response, MAX_ERROR_BODY_CHARS);
        // Derive the retryable verdict from the SDK's status classifier so it
        // stays consistent with the rest of moxxy (429 + 5xx are retryable).
        const classified = classifyHttpStatus(response.status);
        const retryable =
          classified?.code === 'PROVIDER_RATE_LIMITED' ||
          classified?.code === 'PROVIDER_SERVER_ERROR';
        yield {
          type: 'error',
          message: `Codex /responses returned ${response.status}: ${text || response.statusText}`,
          retryable,
        };
        return;
      }

      yield* consumeResponsesSse(response.body, signal, emitReasoning, armIdle);
    } finally {
      disarmIdle();
    }
  }

  async countTokens(
    req: Pick<ProviderRequest, 'model' | 'messages' | 'system' | 'tools'>,
  ): Promise<number> {
    // Only sum text. For non-text blocks (image/document) we add a flat per-block
    // estimate instead of JSON.stringify-ing the base64 `data`, which would be a
    // multi-megabyte transient allocation AND a meaningless token count (base64
    // char length, not visual tokens) that skews any pre-flight budgeting.
    let blob = req.system ?? '';
    let nonTextBlocks = 0;
    for (const m of req.messages) {
      for (const c of m.content) {
        if ('text' in c && typeof c.text === 'string') blob += c.text;
        else nonTextBlocks += 1;
      }
    }
    blob += (req.tools ?? []).map((t) => t.name + t.description).join('');
    return estimateTextTokens(blob) + nonTextBlocks * NON_TEXT_BLOCK_TOKENS;
  }

  private postCodex(body: unknown, sessionId: string, signal: AbortSignal | undefined): Promise<Response> {
    if (!this.tokens) throw new Error('No tokens');
    return this.fetchImpl(CODEX_RESPONSES_URL, {
      method: 'POST',
      headers: buildCodexHeaders(this.tokens, sessionId),
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  }

  private async ensureFresh(): Promise<void> {
    if (!this.tokens) {
      throw new Error(
        'No ChatGPT OAuth credentials available. Run `moxxy login openai-codex` to sign in.',
      );
    }
    // 60s skew window — refresh proactively if the token will die very soon.
    if (this.tokens.expires > Date.now() + 60_000) return;
    await this.refreshNow();
  }

  /**
   * Refresh + persist under the per-credential lock. The refresh token is
   * SINGLE-USE (rotated + invalidated on every refresh), so concurrent
   * refreshers — a second stream in this process, the whisper-stt
   * transcriber sharing this credential, or another moxxy process — must
   * serialize and coalesce: whoever holds the lock refreshes once, everyone
   * queued behind it adopts the rotated bundle instead of burning it.
   */
  private async refreshNow(): Promise<void> {
    const entry = this.tokens;
    if (!entry) {
      throw new Error('Cannot refresh — no stored tokens.');
    }
    await withCredentialLock(`oauth-${this.name}`, async () => {
      // Coalesce in-process: another stream refreshed while we waited.
      if (this.tokens && this.tokens.access !== entry.access) return;
      // Coalesce cross-process/cross-consumer: adopt a fresher persisted
      // bundle (and at minimum its rotated refresh token) when available.
      let attempt = this.tokens ?? entry;
      if (this.reloadTokens) {
        const latest = await this.reloadTokens().catch(() => null);
        if (latest && latest.access !== attempt.access && latest.expires > Date.now() + 60_000) {
          this.tokens = withAccountId(latest, latest.accountId ?? attempt.accountId);
          return;
        }
        if (latest?.refresh) attempt = { ...attempt, refresh: latest.refresh };
      }
      let next: CodexTokens;
      try {
        next = await refreshTokens(attempt.refresh, this.fetchImpl);
      } catch (err) {
        // invalid_grant-style rejection: someone rotated our refresh token
        // away after the reload above. Re-read once and retry with the
        // fresher token before surfacing the failure.
        const latest = isAuthRejection(err) && this.reloadTokens
          ? await this.reloadTokens().catch(() => null)
          : null;
        if (!latest?.refresh || latest.refresh === attempt.refresh) throw err;
        next = await refreshTokens(latest.refresh, this.fetchImpl);
      }
      // Preserve a previously known accountId if the refresh response didn't
      // re-issue an id_token. Without this we'd silently lose the
      // ChatGPT-Account-Id header on every refresh.
      const merged = withAccountId(next, next.accountId ?? attempt.accountId);
      this.tokens = merged;
      if (this.onTokensRefreshed) {
        // Persist BEFORE the caller issues the API call so a crash here
        // doesn't strand an unwritten refresh token in memory.
        await this.onTokensRefreshed(merged);
      }
    });
  }
}

function withAccountId(tokens: CodexTokens, accountId: string | undefined): CodexTokens {
  return accountId
    ? { access: tokens.access, refresh: tokens.refresh, expires: tokens.expires, accountId }
    : { access: tokens.access, refresh: tokens.refresh, expires: tokens.expires };
}

/**
 * Read an error-response body but stop once `maxChars` is reached, then release
 * the socket. Avoids pulling a hostile/broken multi-megabyte error body fully
 * into memory just to put a prefix of it in an error message. Decode failures or
 * a missing body yield `''` so the caller falls back to `response.statusText`.
 */
async function readCappedText(response: Response, maxChars: number): Promise<string> {
  const body = response.body;
  if (!body) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let out = '';
  try {
    while (out.length < maxChars) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
    return out.slice(0, maxChars);
  } catch {
    return out.slice(0, maxChars);
  } finally {
    reader.cancel().catch(() => {});
  }
}
