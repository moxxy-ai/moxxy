import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMProvider,
  ModelDescriptor,
  ProviderEvent,
  ProviderRequest,
  StopReason,
  TokenUsage,
} from '@moxxy/sdk';

type MessageStreamParams = Anthropic.Messages.MessageStreamParams;
type MessageCountTokensParams = Anthropic.Messages.MessageCountTokensParams;
import { toFriendlyError } from '@moxxy/sdk';
import type { AnthropicContentBlock } from './translate.js';
import { toAnthropicMessages, toAnthropicTools } from './translate.js';

export interface AnthropicProviderConfig {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly defaultModel?: string;
  readonly client?: Anthropic;
  /**
   * Override the reported provider name (used in error context). Defaults
   * to `'anthropic'`. The `claude-code` subscription provider reuses this
   * class with `name: 'claude-code'` so errors/metering attribute correctly.
   */
  readonly name?: string;
  /**
   * Override the advertised model catalog. Defaults to the Anthropic catalog
   * ({@link anthropicModels}). An Anthropic-compatible vendor that reuses this
   * class (e.g. `@moxxy/plugin-provider-zai`'s GLM Coding Plan path, which
   * points `baseURL` at z.ai's Anthropic Messages endpoint) passes its own
   * descriptors so context-window lookups (compaction/elision budgets) and
   * capability gating run against the vendor's models, not Claude's.
   */
  readonly models?: ReadonlyArray<ModelDescriptor>;
  /**
   * OAuth (Claude subscription) mode. When set, the client authenticates
   * with `Authorization: Bearer <oauthToken>` instead of an `x-api-key`,
   * and the request/response is otherwise the standard Messages API. Used
   * by `@moxxy/plugin-provider-claude-code`; the plain `anthropic` provider
   * leaves all of these unset and behaves exactly as before.
   */
  readonly oauthToken?: string;
  /** `anthropic-beta` values sent with every OAuth-mode request (joined by `,`). */
  readonly oauthBeta?: ReadonlyArray<string>;
  /**
   * Text injected as the FIRST system block in OAuth mode. Claude rejects
   * subscription tokens unless the system prompt leads with the Claude Code
   * identity line, so the provider prepends this ahead of the real system
   * prompt (which follows as the next block).
   */
  readonly systemPreamble?: string;
  /** Epoch-ms expiry of `oauthToken`, if known — drives proactive refresh. */
  readonly oauthExpiresAt?: number;
  /**
   * Refresh callback. Returns a fresh access token (and its expiry). Invoked
   * proactively just before a request when the current token is near expiry,
   * and once more reactively if a request still comes back 401. Omit for
   * non-refreshable tokens (e.g. a pasted `claude setup-token`).
   */
  readonly oauthRefresh?: () => Promise<{ readonly token: string; readonly expiresAt?: number }>;
}

// Hardcoded model catalog (re-exported to @moxxy/plugin-provider-claude-code, which
// reuses this provider class for the subscription path). Deriving it from the Models
// API is a larger change (auth + caching) — deliberately deferred (TECH_DEBT P3 #8).
// Values verified against the current Anthropic model catalog (2026-06): fable-5,
// opus-4-8, opus-4-7 and opus-4-6 carry a 1M context window with a 128k streaming
// ceiling; sonnet-4-6 is 1M/64k; haiku-4-5 is 200k/64k. fable-5 is Anthropic's most
// capable model (always-on reasoning); the loop never sets `temperature`, which
// fable-5/opus-4-8/4.7 reject — so they stream cleanly here, same as opus-4-7 already did.
// `supportsReasoning` marks models that accept adaptive thinking (`thinking:
// {type:'adaptive', display:'summarized'}`) — fable-5/opus-4-8/4-7/4-6 and sonnet-4-6
// do; haiku-4-5 does not (effort/adaptive-thinking error there), so it stays off.
export const anthropicModels: ReadonlyArray<ModelDescriptor> = [
  { id: 'claude-fable-5', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'claude-opus-4-8', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'claude-opus-4-7', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'claude-opus-4-6', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'claude-sonnet-4-6', contextWindow: 1_000_000, maxOutputTokens: 64_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'claude-haiku-4-5-20251001', contextWindow: 200_000, maxOutputTokens: 64_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true },
];

export class AnthropicProvider implements LLMProvider {
  readonly name: string;
  readonly models: ReadonlyArray<ModelDescriptor>;
  // Mutable so OAuth-mode refresh can swap in a client carrying the new
  // bearer token; the plain apiKey client never changes after construction.
  private client: Anthropic;
  private readonly defaultModel: string;
  private readonly baseURL?: string;
  // Present only in OAuth (Claude subscription) mode.
  private readonly oauth?: {
    readonly beta: ReadonlyArray<string>;
    readonly systemPreamble?: string;
    readonly refresh?: () => Promise<{ readonly token: string; readonly expiresAt?: number }>;
  };
  private oauthToken?: string;
  private oauthExpiresAt?: number;
  // Single in-flight refresh shared by concurrent callers (parallel streams /
  // countTokens near expiry) so the refresh endpoint is hit once and the
  // client is swapped once — a second refresh can rotate/invalidate the token
  // and poison state on providers that rotate refresh tokens.
  private refreshing?: Promise<void>;

  constructor(config: AnthropicProviderConfig = {}) {
    this.name = config.name ?? 'anthropic';
    this.models = config.models ?? anthropicModels;
    this.defaultModel = config.defaultModel ?? 'claude-sonnet-4-6';
    if (config.baseURL) this.baseURL = config.baseURL;

    if (config.oauthToken) {
      this.oauthToken = config.oauthToken;
      this.oauthExpiresAt = config.oauthExpiresAt;
      this.oauth = {
        beta: config.oauthBeta ?? [],
        ...(config.systemPreamble ? { systemPreamble: config.systemPreamble } : {}),
        ...(config.oauthRefresh ? { refresh: config.oauthRefresh } : {}),
      };
      this.client = config.client ?? this.makeOauthClient(config.oauthToken);
    } else {
      this.client =
        config.client ??
        new Anthropic({
          apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY,
          ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        });
    }
  }

  /**
   * Build an Anthropic client in OAuth (bearer) mode. `apiKey: null` stops
   * the SDK from falling back to `ANTHROPIC_API_KEY` and suppresses the
   * `x-api-key` header (its `apiKeyAuth()` returns `{}` when apiKey is null),
   * so only `Authorization: Bearer <token>` goes out, plus the beta header.
   */
  private makeOauthClient(token: string): Anthropic {
    const beta = this.oauth?.beta ?? [];
    return new Anthropic({
      apiKey: null,
      authToken: token,
      ...(beta.length > 0 ? { defaultHeaders: { 'anthropic-beta': beta.join(',') } } : {}),
      ...(this.baseURL ? { baseURL: this.baseURL } : {}),
    });
  }

  /** Proactively refresh the bearer token when it's within the skew window. */
  private async ensureFreshOauth(): Promise<void> {
    if (!this.oauth?.refresh) return;
    if (this.oauthExpiresAt === undefined) return;
    if (Date.now() + 60_000 < this.oauthExpiresAt) return;
    await this.refreshOauthNow();
  }

  /**
   * Force a token refresh and rebuild the client with the new bearer.
   * Coalesces concurrent calls onto a single in-flight refresh so the endpoint
   * is hit once and the client is swapped once.
   */
  private async refreshOauthNow(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const refresh = this.oauth?.refresh;
    if (!refresh) throw new Error('no refresh callback');
    this.refreshing = (async () => {
      const next = await refresh();
      this.oauthToken = next.token;
      this.oauthExpiresAt = next.expiresAt;
      this.client = this.makeOauthClient(next.token);
    })().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  /**
   * Build the `system` request field. In OAuth mode the Claude Code identity
   * preamble MUST lead, so we always emit block form with the preamble first;
   * the real system prompt follows (carrying the cache breakpoint if set).
   * In apiKey mode the behaviour is unchanged: a bare string, upgraded to a
   * single cache-marked block only when a system cache hint is present.
   *
   * `extraSystem` is `ProviderRequest.system` — the hook-injection side
   * channel (e.g. the memory consolidation nudge), delivered IN ADDITION to
   * the message-derived system prompt. It rides as a separate block AFTER
   * the cache-marked one so volatile per-request text never busts the
   * stable system-prefix cache.
   */
  private buildSystemParam(
    system: string | undefined,
    cacheSystem: boolean,
    extraSystem?: string,
  ): string | undefined | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> {
    const preamble = this.oauth?.systemPreamble;
    if (preamble || extraSystem) {
      const blocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = [];
      if (preamble) blocks.push({ type: 'text', text: preamble });
      if (system) {
        blocks.push(
          cacheSystem
            ? { type: 'text', text: system, cache_control: { type: 'ephemeral' } }
            : { type: 'text', text: system },
        );
      }
      if (extraSystem) blocks.push({ type: 'text', text: extraSystem });
      return blocks.length > 0 ? blocks : undefined;
    }
    return cacheSystem && system
      ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
      : system;
  }

  async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    // Translate provider-neutral cache hints into Anthropic cache_control
    // markers. `tools`/`system` mark those session-stable regions; a
    // `{ messageIndex }` hint marks the end of that message (the rolling
    // prefix breakpoint). Anthropic honors at most 4 breakpoints.
    const hints = req.cacheHints ?? [];
    const cacheTools = hints.some((h) => h.target === 'tools');
    const cacheSystem = hints.some((h) => h.target === 'system');
    const cacheMessageIndices = new Set<number>();
    for (const h of hints) {
      if (typeof h.target === 'object') cacheMessageIndices.add(h.target.messageIndex);
    }

    const { system, messages } = toAnthropicMessages(req.messages, { cacheMessageIndices });
    const tools =
      req.tools && req.tools.length > 0
        ? toAnthropicTools(req.tools, { cacheLast: cacheTools })
        : undefined;
    // OAuth mode prepends the Claude Code identity preamble as the first
    // system block; apiKey mode keeps the prior string/cache-block behaviour.
    // req.system (hook-injected extra system text) is appended last.
    const systemParam = this.buildSystemParam(system, cacheSystem, req.system);
    const model = req.model || this.defaultModel;

    // In OAuth mode refresh the bearer proactively when it's near expiry, so
    // we don't fire a request on a token we already knew was about to die.
    // Done BEFORE emitting message_start so a turn that never reaches the API
    // (proactive refresh throws) doesn't leave a dangling open message for
    // consumers that pair message_start/message_end.
    if (this.oauth) {
      try {
        await this.ensureFreshOauth();
      } catch (err) {
        yield { type: 'error', ...toFriendlyError(err, { provider: this.name }) };
        return;
      }
    }

    yield { type: 'message_start', model };

    // Default + clamp max_tokens to the active model's output ceiling. We hold
    // the catalog, so default to the descriptor's `maxOutputTokens` (4096 when
    // unknown) and never forward a caller-supplied value above the ceiling —
    // an over-ceiling request 400s server-side after the whole body is built.
    const ceiling = this.models.find((m) => m.id === model)?.maxOutputTokens;
    const maxTokens =
      req.maxTokens !== undefined
        ? ceiling !== undefined
          ? Math.min(req.maxTokens, ceiling)
          : req.maxTokens
        : (ceiling ?? 4096);

    // NARROW cast: `messages`/`tools`/`systemParam` are our hand-rolled
    // Anthropic shapes (e.g. `media_type: string`) which the SDK narrows to
    // literal unions it can't see we never violate. The body is otherwise
    // typed as the SDK's real `MessageStreamParams` — `model`/`max_tokens`/
    // `temperature` are checked at compile time.
    const requestBody: MessageStreamParams = {
      model,
      max_tokens: maxTokens,
      system: systemParam as MessageStreamParams['system'],
      messages: messages as MessageStreamParams['messages'],
      tools: tools as MessageStreamParams['tools'],
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    };

    // Reasoning: on supported models (gated upstream by `supportsReasoning`),
    // enable adaptive thinking with summarized display so the model streams a
    // readable reasoning summary (`display: 'omitted'` — the default — would
    // stream empty thinking blocks). Adaptive thinking auto-enables interleaved
    // thinking on the 4.6+ catalog, so no beta header is needed. `effort` maps
    // to `output_config.effort`. Fields are attached via a cast because the
    // pinned SDK's `MessageStreamParams` predates these params (same hand-rolled
    // approach used for system/messages/tools above).
    const reasoningOn = req.reasoning !== undefined && req.reasoning !== false;
    if (reasoningOn) {
      const effort = typeof req.reasoning === 'object' ? req.reasoning.effort : undefined;
      const body = requestBody as unknown as Record<string, unknown>;
      body.thinking = { type: 'adaptive', display: 'summarized' };
      if (effort) body.output_config = { effort };
    }

    // A genuine auth 401 arrives before any SSE body, so in OAuth mode we can
    // force a single refresh and replay the request. But `isUnauthorized()`
    // also matches a 401 surfaced MID-stream (token revoked during a long
    // generation, proxy 401 on a chunk); replaying after content already
    // streamed would duplicate text/tool calls into the same turn. Track
    // whether the first attempt produced any output and only replay when it
    // produced none.
    const progress = { produced: false };
    try {
      yield* this.streamOnce(requestBody, req.signal, progress);
    } catch (err) {
      if (this.oauth?.refresh && isUnauthorized(err) && !progress.produced) {
        try {
          await this.refreshOauthNow();
          yield* this.streamOnce(requestBody, req.signal);
          return;
        } catch (retryErr) {
          yield { type: 'error', ...toFriendlyError(retryErr, { provider: this.name }) };
          return;
        }
      }
      yield { type: 'error', ...toFriendlyError(err, { provider: this.name }) };
    }
  }

  /**
   * One streaming attempt. THROWS on transport/HTTP errors so `stream()` can
   * decide whether to refresh-and-replay (OAuth 401) or surface the error;
   * yields content events plus a terminal `message_end` on the happy path.
   * Abort is terminal here (yields the abort error and returns).
   */
  private async *streamOnce(
    requestBody: MessageStreamParams,
    signal: AbortSignal | undefined,
    // Set to `true` the moment this attempt yields any content event (anything
    // past message_start). `stream()` reads it to decide whether a 401 is safe
    // to refresh-and-replay (replaying after output already streamed would
    // duplicate text/tool calls). Optional so the replay attempt can omit it.
    progress?: { produced: boolean },
  ): AsyncIterable<ProviderEvent> {
    const stream = this.client.messages.stream(
      requestBody,
      // Pass the AbortSignal into the SDK request options so cancelling
      // tears down the underlying HTTP request. Without this, Esc only
      // stopped our loop while the model kept generating upstream.
      signal ? { signal } : undefined,
    );

    const pendingToolUses = new Map<string, { name: string; partial: string }>();
    // Anthropic's stream events carry a block `index` on every delta/stop;
    // we map that index to the tool_use id at content_block_start time so
    // parallel tool_use blocks route their deltas correctly. Without this,
    // we used to return the first key in `pendingToolUses` for every event,
    // causing two parallel blocks to overwrite each other's partial JSON.
    const blockIndexToId = new Map<number, string>();
    // Track which block indices are `thinking` blocks so their signature_delta
    // accumulates and flushes as a reasoning_signature at content_block_stop.
    const thinkingBlockIndices = new Set<number>();
    let pendingThinkingSig = '';
    let stopReason: StopReason = 'end_turn';
    // Type as the SDK's `TokenUsage` (which carries the optional cache fields)
    // so cacheReadTokens/cacheCreationTokens are first-class on the accumulator
    // and the message_delta merge below is type-checked to preserve them —
    // rather than the cache fields sneaking in only via a spread (which bypasses
    // the excess-property check) against a narrower declared type.
    let usage: TokenUsage | undefined;

    // Set once the stream is fully drained on the happy path; gates the
    // finally-block teardown so we only force-abort on an early exit
    // (abort/throw/consumer abandonment), never on a clean completion.
    let drained = false;
    try {
      for await (const event of stream as AsyncIterable<AnthropicStreamEvent>) {
        if (signal?.aborted) {
          yield { type: 'error', message: 'aborted', retryable: false };
          return;
        }
        switch (event.type) {
          case 'message_start': {
            // Anthropic reports cache hits/writes only on the message_start
            // usage block — `cache_read_input_tokens` (billed 0.1x) and
            // `cache_creation_input_tokens` (billed 1.25x). Capture them here
            // so the metering layer can prove cache savings; without this the
            // fields are silently dropped and cache wins are invisible.
            const u = event.message?.usage;
            usage = {
              inputTokens: u?.input_tokens ?? 0,
              outputTokens: u?.output_tokens ?? 0,
              ...(u?.cache_read_input_tokens !== undefined
                ? { cacheReadTokens: u.cache_read_input_tokens }
                : {}),
              ...(u?.cache_creation_input_tokens !== undefined
                ? { cacheCreationTokens: u.cache_creation_input_tokens }
                : {}),
            };
            break;
          }
          case 'content_block_start': {
            if (progress) progress.produced = true;
            const block = event.content_block;
            if (block && block.type === 'tool_use') {
              pendingToolUses.set(block.id, { name: block.name, partial: '' });
              // Real Anthropic events carry `index` here; fall back to the
              // arrival ordinal when callers (e.g. test fakes) omit it.
              const idx = typeof event.index === 'number' ? event.index : blockIndexToId.size;
              blockIndexToId.set(idx, block.id);
              yield { type: 'tool_use_start', id: block.id, name: block.name };
            } else if (block && block.type === 'thinking') {
              if (typeof event.index === 'number') thinkingBlockIndices.add(event.index);
              pendingThinkingSig = '';
            } else if (block && block.type === 'redacted_thinking') {
              // No readable text — replay the opaque blob verbatim on round-trip.
              yield { type: 'reasoning_signature', redacted: true, ...(block.data ? { encrypted: block.data } : {}) };
            }
            break;
          }
          case 'content_block_delta': {
            if (progress) progress.produced = true;
            const delta = event.delta;
            if (!delta) break;
            if (delta.type === 'text_delta' && typeof delta.text === 'string') {
              yield { type: 'text_delta', delta: delta.text };
            } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
              yield { type: 'reasoning_delta', delta: delta.thinking };
            } else if (delta.type === 'signature_delta' && typeof delta.signature === 'string') {
              pendingThinkingSig += delta.signature;
            } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
              const id = idOfBlock(event, blockIndexToId, pendingToolUses);
              if (id) {
                const t = pendingToolUses.get(id);
                if (t) {
                  t.partial += delta.partial_json;
                  yield { type: 'tool_use_delta', id, partialInput: delta.partial_json };
                }
              }
            }
            break;
          }
          case 'content_block_stop': {
            if (progress) progress.produced = true;
            if (typeof event.index === 'number' && thinkingBlockIndices.has(event.index)) {
              thinkingBlockIndices.delete(event.index);
              if (pendingThinkingSig) yield { type: 'reasoning_signature', signature: pendingThinkingSig };
              pendingThinkingSig = '';
              break;
            }
            const id = idOfBlock(event, blockIndexToId, pendingToolUses);
            if (id) {
              const t = pendingToolUses.get(id);
              if (t) {
                let parsed: unknown;
                try {
                  parsed = t.partial ? JSON.parse(t.partial) : {};
                } catch {
                  // A truncated/malformed tool-input stream is a real failure, not
                  // a valid call with junk args. Surface it as an error (the loop
                  // treats a stream-level error as authoritative) and mark the turn
                  // `error`, instead of feeding `{ _rawPartial }` into the tool —
                  // which erased all signal that the model's call was garbage.
                  pendingToolUses.delete(id);
                  if (typeof event.index === 'number') blockIndexToId.delete(event.index);
                  stopReason = 'error';
                  yield {
                    type: 'error',
                    message: `tool_use input JSON was malformed/truncated for ${id}`,
                    retryable: false,
                  };
                  break;
                }
                yield { type: 'tool_use_end', id, input: parsed };
                pendingToolUses.delete(id);
                if (typeof event.index === 'number') blockIndexToId.delete(event.index);
              }
            }
            break;
          }
          case 'message_delta': {
            // STICKY error: once a malformed/truncated tool-input stream marked
            // the turn `error` at content_block_stop, a trailing message_delta
            // (which a truncated tool-use turn still reports as `tool_use`) must
            // NOT clobber it back to a clean completion — that would re-run the
            // junk tool. Usage numbers below still merge as usual.
            if (event.delta?.stop_reason && stopReason !== 'error') {
              stopReason = mapStopReason(event.delta.stop_reason);
            }
            if (event.usage) {
              // Prefer delta-reported input/cache numbers when present (some
              // streaming modes report or correct them here), but fall back to
              // the message_start values otherwise — mirroring the defensive
              // `?? previous` pattern used for outputTokens.
              const du = event.usage;
              const cacheRead = du.cache_read_input_tokens ?? usage?.cacheReadTokens;
              const cacheCreation = du.cache_creation_input_tokens ?? usage?.cacheCreationTokens;
              usage = {
                inputTokens: du.input_tokens ?? usage?.inputTokens ?? 0,
                outputTokens: du.output_tokens ?? usage?.outputTokens ?? 0,
                ...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
                ...(cacheCreation !== undefined ? { cacheCreationTokens: cacheCreation } : {}),
              };
            }
            break;
          }
          case 'message_stop':
            break;
        }
      }
      drained = true;
    } catch (err) {
      // A cancel surfaces as a thrown AbortError mid-await — report it as the
      // clean terminal 'aborted' event. Every other error propagates so
      // `stream()` can classify it (OAuth 401 → refresh+replay; else error).
      if (signal?.aborted) {
        yield { type: 'error', message: 'aborted', retryable: false };
        return;
      }
      throw err;
    } finally {
      // Guarantee socket teardown independent of whether the AbortSignal
      // propagated into the SDK. On any early exit (abort, throw, or the
      // consumer abandoning the generator — at which point the JS runtime
      // runs this finally) explicitly abort the SDK stream so a half-open
      // HTTP connection can't linger under repeated rapid cancellation.
      if (!drained) {
        const s = stream as unknown as { abort?: () => void; controller?: { abort?: () => void } };
        try {
          s.abort?.();
          s.controller?.abort?.();
        } catch {
          // Best-effort cleanup — a fake/partial stream may expose neither.
        }
      }
    }

    yield { type: 'message_end', stopReason, usage };
  }

  async countTokens(req: Pick<ProviderRequest, 'model' | 'messages' | 'system' | 'tools'>): Promise<number> {
    const { system, messages } = toAnthropicMessages(req.messages);
    const tools = req.tools && req.tools.length > 0 ? toAnthropicTools(req.tools) : undefined;
    // Mirror stream(): in OAuth mode the request carries the identity preamble
    // as an extra system block, and req.system (hook-injected extra system
    // text) is appended as another — count both for a faithful estimate.
    const parts = [this.oauth?.systemPreamble, system, req.system].filter(
      (s): s is string => typeof s === 'string' && s.length > 0,
    );
    const systemForCount = parts.length > 0 ? parts.join('\n\n') : undefined;
    try {
      // Mirror stream(): in OAuth mode refresh a near-expiry bearer before the
      // request so a token we already knew was about to die doesn't 401 us
      // straight into the (less accurate) text-estimate fallback below.
      if (this.oauth) await this.ensureFreshOauth();
      const result = await this.client.messages.countTokens({
        model: req.model || this.defaultModel,
        ...(systemForCount !== undefined ? { system: systemForCount } : {}),
        // NARROW cast: our hand-rolled message/tool shapes carry `media_type:
        // string`, which the SDK narrows to a literal union it can't see we
        // never violate. The method itself is fully typed (no `as unknown` on
        // the resource anymore); only these two args need the structural cast.
        messages: messages as MessageCountTokensParams['messages'],
        ...(tools !== undefined ? { tools: tools as MessageCountTokensParams['tools'] } : {}),
      });
      return result.input_tokens;
    } catch {
      // Estimate WITHOUT serializing megabytes of base64 into one mega-string:
      // a media block's bytes have nothing to do with its token cost, and
      // stringifying them both spikes memory on a large multimodal history and
      // wildly inflates the estimate. Sum char-lengths of textual content and
      // charge each media block a small fixed allowance instead.
      let chars = systemForCount?.length ?? 0;
      for (const m of messages) {
        for (const block of m.content) {
          chars += estimateBlockChars(block);
        }
      }
      chars += JSON.stringify(tools ?? []).length;
      // Mirror estimateTextTokens (≈4 chars/token) on the accumulated length
      // without ever materializing the concatenated string.
      return Math.ceil(chars / 4);
    }
  }
}

/** Rough per-image/-document token allowance for the offline estimate fallback. */
const MEDIA_BLOCK_TOKENS = 1500;

/**
 * Char-length contribution of one Anthropic content block for the offline
 * token estimate. Skips the base64 `data` of image/document blocks (charging a
 * fixed token allowance, scaled back to chars) so a multi-MB blob never gets
 * stringified just to be divided by 4.
 */
function estimateBlockChars(block: AnthropicContentBlock): number {
  switch (block.type) {
    case 'text':
      return block.text.length;
    case 'tool_use':
      return block.name.length + JSON.stringify(block.input ?? {}).length;
    case 'tool_result':
      return block.content.length;
    case 'thinking':
      return block.thinking.length + block.signature.length;
    case 'redacted_thinking':
      return block.data.length;
    case 'image':
    case 'document':
      // Charge a fixed allowance instead of the base64 byte length.
      return MEDIA_BLOCK_TOKENS * 4;
  }
}

interface AnthropicStreamEvent {
  type:
    | 'message_start'
    | 'content_block_start'
    | 'content_block_delta'
    | 'content_block_stop'
    | 'message_delta'
    | 'message_stop';
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  content_block?: {
    type: 'text' | 'tool_use' | 'thinking' | 'redacted_thinking';
    id: string;
    name: string;
    /** redacted_thinking carries an opaque encrypted blob (no readable text). */
    data?: string;
  };
  index?: number;
  delta?: {
    type?: 'text_delta' | 'input_json_delta' | 'thinking_delta' | 'signature_delta';
    text?: string;
    partial_json?: string;
    /** thinking_delta payload (the summarized reasoning text). */
    thinking?: string;
    /** signature_delta payload (the thinking-block signature for round-trip). */
    signature?: string;
    stop_reason?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

function idOfBlock(
  event: AnthropicStreamEvent,
  blockIndexToId: Map<number, string>,
  pendingToolUses?: ReadonlyMap<string, unknown>,
): string | null {
  if (typeof event.index === 'number') {
    return blockIndexToId.get(event.index) ?? null;
  }
  // Fallback when `index` is missing (older SDKs / hand-rolled fakes): only
  // unambiguous when exactly one tool_use is pending. `blockIndexToId` is only
  // pruned on content_block_stop with a numeric index, so in an index-less
  // stream a finished block's entry can linger and falsely satisfy size===1;
  // require the id to still be PENDING (deleted on tool_use_end) so a new
  // block's deltas never route onto a stale, already-finished entry.
  if (blockIndexToId.size === 1) {
    for (const id of blockIndexToId.values()) {
      if (!pendingToolUses || pendingToolUses.has(id)) return id;
    }
  }
  return null;
}

function mapStopReason(s: string): StopReason {
  if (s === 'tool_use') return 'tool_use';
  if (s === 'max_tokens') return 'max_tokens';
  if (s === 'stop_sequence') return 'stop_sequence';
  if (s === 'end_turn') return 'end_turn';
  return 'error';
}

/**
 * True when the SDK error is an HTTP 401. The Anthropic SDK throws
 * `APIError` instances carrying a numeric `status`; an expired/revoked OAuth
 * bearer is the only 401 we want to refresh-and-retry on.
 */
function isUnauthorized(err: unknown): boolean {
  return typeof (err as { status?: unknown } | null | undefined)?.status === 'number'
    ? (err as { status: number }).status === 401
    : false;
}
