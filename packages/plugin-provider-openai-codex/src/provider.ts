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
    // Pass the session id as the Responses prefix-cache key so repeated turns
    // in a session reuse the cached prefix (cheaper + faster). Codex DOES
    // support this even though the Chat-Completions providers ignore cacheHints.
    const body = toResponsesBody(
      { ...req, model },
      {
        sessionHint: sessionId,
        ...(this.reasoningEffort ? { reasoningEffort: this.reasoningEffort } : {}),
      },
    );

    let response: Response;
    try {
      response = await this.postCodex(body, sessionId, req.signal);
    } catch (err) {
      yield toErrorEvent(err);
      return;
    }

    if (response.status === 401) {
      // Token might've been revoked between our pre-check and send; try one
      // forced refresh and replay. A second 401 is fatal.
      try {
        await this.refreshNow();
        response = await this.postCodex(body, sessionId, req.signal);
      } catch (err) {
        yield toErrorEvent(err);
        return;
      }
    }

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
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

    yield* consumeResponsesSse(response.body, req.signal);
  }

  async countTokens(
    req: Pick<ProviderRequest, 'model' | 'messages' | 'system' | 'tools'>,
  ): Promise<number> {
    const blob =
      (req.system ?? '') +
      req.messages
        .map((m) => m.content.map((c) => ('text' in c ? c.text : JSON.stringify(c))).join(''))
        .join('') +
      (req.tools ?? []).map((t) => t.name + t.description).join('');
    return estimateTextTokens(blob);
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
