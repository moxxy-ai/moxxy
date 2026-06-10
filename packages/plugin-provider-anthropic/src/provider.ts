import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMProvider,
  ModelDescriptor,
  ProviderEvent,
  ProviderRequest,
  StopReason,
} from '@moxxy/sdk';

type MessageStreamParams = Anthropic.Messages.MessageStreamParams;
type MessageCountTokensParams = Anthropic.Messages.MessageCountTokensParams;
import { estimateTextTokens, toFriendlyError } from '@moxxy/sdk';
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
// Values verified against the current Anthropic model catalog: opus-4-7 and
// sonnet-4-6 carry a 1M context window (not the old 800k/200k); haiku-4-5 is 200k.
// maxOutputTokens reflect each model's streaming ceiling.
export const anthropicModels: ReadonlyArray<ModelDescriptor> = [
  { id: 'claude-opus-4-7', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true },
  { id: 'claude-sonnet-4-6', contextWindow: 1_000_000, maxOutputTokens: 64_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true },
  { id: 'claude-haiku-4-5-20251001', contextWindow: 200_000, maxOutputTokens: 64_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true },
];

export class AnthropicProvider implements LLMProvider {
  readonly name: string;
  readonly models = anthropicModels;
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

  constructor(config: AnthropicProviderConfig = {}) {
    this.name = config.name ?? 'anthropic';
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

  /** Force a token refresh and rebuild the client with the new bearer. */
  private async refreshOauthNow(): Promise<void> {
    if (!this.oauth?.refresh) throw new Error('no refresh callback');
    const next = await this.oauth.refresh();
    this.oauthToken = next.token;
    this.oauthExpiresAt = next.expiresAt;
    this.client = this.makeOauthClient(next.token);
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

    yield { type: 'message_start', model };

    // In OAuth mode refresh the bearer proactively when it's near expiry, so
    // we don't fire a request on a token we already knew was about to die.
    if (this.oauth) {
      try {
        await this.ensureFreshOauth();
      } catch (err) {
        yield { type: 'error', ...toFriendlyError(err, { provider: this.name }) };
        return;
      }
    }

    // NARROW cast: `messages`/`tools`/`systemParam` are our hand-rolled
    // Anthropic shapes (e.g. `media_type: string`) which the SDK narrows to
    // literal unions it can't see we never violate. The body is otherwise
    // typed as the SDK's real `MessageStreamParams` — `model`/`max_tokens`/
    // `temperature` are checked at compile time.
    const requestBody: MessageStreamParams = {
      model,
      max_tokens: req.maxTokens ?? 4096,
      system: systemParam as MessageStreamParams['system'],
      messages: messages as MessageStreamParams['messages'],
      tools: tools as MessageStreamParams['tools'],
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    };

    // A 401 always arrives before any SSE body, so in OAuth mode we can force
    // a single refresh and replay the request with no risk of duplicate output.
    try {
      yield* this.streamOnce(requestBody, req.signal);
    } catch (err) {
      if (this.oauth?.refresh && isUnauthorized(err)) {
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
    let stopReason: StopReason = 'end_turn';
    let usage: { inputTokens: number; outputTokens: number } | undefined;

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
            const block = event.content_block;
            if (block && block.type === 'tool_use') {
              pendingToolUses.set(block.id, { name: block.name, partial: '' });
              // Real Anthropic events carry `index` here; fall back to the
              // arrival ordinal when callers (e.g. test fakes) omit it.
              const idx = typeof event.index === 'number' ? event.index : blockIndexToId.size;
              blockIndexToId.set(idx, block.id);
              yield { type: 'tool_use_start', id: block.id, name: block.name };
            }
            break;
          }
          case 'content_block_delta': {
            const delta = event.delta;
            if (!delta) break;
            if (delta.type === 'text_delta' && typeof delta.text === 'string') {
              yield { type: 'text_delta', delta: delta.text };
            } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
              const id = idOfBlock(event, blockIndexToId);
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
            const id = idOfBlock(event, blockIndexToId);
            if (id) {
              const t = pendingToolUses.get(id);
              if (t) {
                let parsed: unknown = {};
                try {
                  parsed = t.partial ? JSON.parse(t.partial) : {};
                } catch {
                  parsed = { _rawPartial: t.partial };
                }
                yield { type: 'tool_use_end', id, input: parsed };
                pendingToolUses.delete(id);
                if (typeof event.index === 'number') blockIndexToId.delete(event.index);
              }
            }
            break;
          }
          case 'message_delta': {
            if (event.delta?.stop_reason) {
              stopReason = mapStopReason(event.delta.stop_reason);
            }
            if (event.usage) {
              // Preserve cache fields captured at message_start — the delta
              // usage only carries the final output_tokens count.
              usage = {
                ...usage,
                inputTokens: usage?.inputTokens ?? 0,
                outputTokens: event.usage.output_tokens ?? usage?.outputTokens ?? 0,
              };
            }
            break;
          }
          case 'message_stop':
            break;
        }
      }
    } catch (err) {
      // A cancel surfaces as a thrown AbortError mid-await — report it as the
      // clean terminal 'aborted' event. Every other error propagates so
      // `stream()` can classify it (OAuth 401 → refresh+replay; else error).
      if (signal?.aborted) {
        yield { type: 'error', message: 'aborted', retryable: false };
        return;
      }
      throw err;
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
      const blob =
        (systemForCount ?? '') +
        messages.map((m) => JSON.stringify(m.content)).join('') +
        JSON.stringify(tools ?? []);
      return estimateTextTokens(blob);
    }
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
  content_block?: { type: 'text' | 'tool_use'; id: string; name: string };
  index?: number;
  delta?: {
    type?: 'text_delta' | 'input_json_delta';
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: { output_tokens?: number };
}

function idOfBlock(
  event: AnthropicStreamEvent,
  blockIndexToId: Map<number, string>,
): string | null {
  if (typeof event.index === 'number') {
    return blockIndexToId.get(event.index) ?? null;
  }
  // Fallback when `index` is missing (older SDKs / hand-rolled fakes): only
  // unambiguous when exactly one tool_use is pending; otherwise refuse to
  // guess and let the delta drop rather than misroute it.
  if (blockIndexToId.size === 1) {
    for (const id of blockIndexToId.values()) return id;
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
