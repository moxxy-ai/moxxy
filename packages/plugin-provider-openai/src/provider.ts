import OpenAI from 'openai';
import type {
  LLMProvider,
  ModelDescriptor,
  ProviderEvent,
  ProviderRequest,
  StopReason,
} from '@moxxy/sdk';
import { estimateTextTokens, toFriendlyError } from '@moxxy/sdk';
import { toOpenAIMessages, toOpenAITools } from './translate.js';

export interface OpenAIProviderConfig {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly defaultModel?: string;
  readonly client?: OpenAI;
  /**
   * Override the reported provider name (events, usage stats, error
   * context). Defaults to `'openai'`. Runtime-registered OpenAI-compatible
   * vendors (provider_add → z.ai, deepseek, groq, …) reuse this class and
   * MUST pass their own slug here, otherwise their traffic and errors are
   * all misattributed to OpenAI.
   */
  readonly name?: string;
  /**
   * Override the advertised model catalog. Defaults to the OpenAI catalog.
   * Runtime-registered vendors pass their own descriptors so context-window
   * lookups (compaction/elision budgets) and capability gating
   * (supportsImages/supportsDocuments) work against the vendor's models
   * instead of missing on the OpenAI list.
   */
  readonly models?: ReadonlyArray<ModelDescriptor>;
  /**
   * Per-request timeout (ms) for the default client. The OpenAI SDK default is
   * 10 minutes — far too long for an agentic turn, where a stalled
   * OpenAI-compatible backend (a local vLLM/Ollama box that accepts the
   * connection but never streams) would block the whole turn. Default a couple
   * of minutes; hosts can tune. Ignored when `client` is injected.
   */
  readonly timeoutMs?: number;
  /**
   * Max automatic retries for the default client (SDK default is 2). Ignored
   * when `client` is injected.
   */
  readonly maxRetries?: number;
}

/** Default per-request timeout for streamed agentic turns (2 minutes). */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Model catalog as of OpenAI's 2026 API surface. The 5.x family supersedes
 * the 4o family but the older ones stay listed so existing configs keep
 * working without a forced migration.
 *
 * Output/context numbers are the public documented limits as of April-May
 * 2026; verify against https://developers.openai.com/api/docs/models when
 * picking a model for a long-context workload.
 */
// The gpt-5.x family are reasoning models (`supportsReasoning`): they accept
// `reasoning_effort` and, on backends that stream a summary, surface reasoning
// deltas. Official OpenAI Chat Completions doesn't stream a reasoning summary
// (Responses-API only), so the flag mainly gates the config UI + effort there;
// OpenAI-compatible reasoning backends (DeepSeek/z.ai/local) do stream it.
export const openAIModels: ReadonlyArray<ModelDescriptor> = [
  // GPT-5.5 family (released April 23, 2026): newest frontier class.
  { id: 'gpt-5.5', contextWindow: 1_050_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'gpt-5.5-pro', contextWindow: 1_050_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },

  // GPT-5.4 family: cheaper general-purpose tier; -mini and -nano are the
  // new sweet-spot defaults for high-volume agentic workloads.
  { id: 'gpt-5.4', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'gpt-5.4-pro', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'gpt-5.4-mini', contextWindow: 400_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'gpt-5.4-nano', contextWindow: 400_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },

  // GPT-5.3-Codex: agentic coding specialist. Vision-capable.
  { id: 'gpt-5.3-codex', contextWindow: 400_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },

  // GPT-5.2 and GPT-5: prior reasoning models, configurable effort.
  { id: 'gpt-5.2', contextWindow: 400_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'gpt-5', contextWindow: 400_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },

  // GPT-4 family: kept for explicit-pin use cases.
  // 4.1 is text-only; 4o/4o-mini are vision + document capable; 4-turbo predates file inputs.
  { id: 'gpt-4.1', contextWindow: 1_000_000, maxOutputTokens: 32_768, supportsTools: true, supportsStreaming: true },
  { id: 'gpt-4o', contextWindow: 128_000, maxOutputTokens: 16_384, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true },
  { id: 'gpt-4o-mini', contextWindow: 128_000, maxOutputTokens: 16_384, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true },
  { id: 'gpt-4-turbo', contextWindow: 128_000, maxOutputTokens: 4_096, supportsTools: true, supportsStreaming: true, supportsImages: true },
];

interface PendingToolCall {
  id: string;
  name: string;
  argsBuffer: string;
  emittedStart: boolean;
}

/**
 * Coarse per-block token charge for non-text content (image/document/audio) in
 * the `countTokens` estimate. The real cost is tile/page-based and unknowable
 * without the provider's tokenizer; a small constant keeps the budget heuristic
 * from either ignoring attachments entirely or ballooning on the base64 blob.
 */
const RICH_BLOCK_TOKEN_ESTIMATE = 256;

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

export class OpenAIProvider implements LLMProvider {
  readonly name: string;
  readonly models: ReadonlyArray<ModelDescriptor>;
  private readonly client: OpenAI;
  private readonly defaultModel: string;

  constructor(config: OpenAIProviderConfig = {}) {
    this.name = config.name ?? 'openai';
    this.models = config.models ?? openAIModels;
    this.client =
      config.client ??
      new OpenAI({
        apiKey: config.apiKey ?? process.env.OPENAI_API_KEY,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        // Bound the worst case of a connection that opens but never streams.
        timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
      });
    this.defaultModel = config.defaultModel ?? 'gpt-5.4-mini';
  }

  async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    const messages = toOpenAIMessages(req.messages);
    // `req.system` is the hook-injection side channel (e.g. the memory
    // consolidation nudge): extra system text delivered IN ADDITION to any
    // system-role messages already in `req.messages`. Insert it right after
    // the leading system message(s) so it reads as system guidance without
    // reordering the conversation.
    if (req.system) {
      let insertAt = 0;
      while (insertAt < messages.length && messages[insertAt]!.role === 'system') insertAt += 1;
      messages.splice(insertAt, 0, { role: 'system', content: req.system });
    }
    const tools = req.tools && req.tools.length > 0 ? toOpenAITools(req.tools) : undefined;
    const model = req.model || this.defaultModel;

    yield { type: 'message_start', model };

    // GPT-5.x (and OpenAI's reasoning models) renamed the token cap field
    // from `max_tokens` to `max_completion_tokens` and ALSO reject the
    // legacy name with a 400. Use the new name for any model whose id
    // starts with gpt-5 / o1 / o3; keep the legacy name for the gpt-4
    // family so existing callers don't regress.
    const usesCompletionTokens = /^(?:gpt-5|o1|o3)/.test(model);
    const tokenLimitKey = usesCompletionTokens ? 'max_completion_tokens' : 'max_tokens';

    // Reasoning preview is gated by the per-provider toggle (`req.reasoning`).
    // When on, request `reasoning_effort` for OpenAI reasoning models (improves
    // depth + makes a summary available where the backend streams one) and
    // surface the streamed reasoning/reasoning_content deltas.
    const emitReasoning = req.reasoning != null && req.reasoning !== false;
    const reasoningEffort = typeof req.reasoning === 'object' ? req.reasoning.effort : undefined;

    // Type the request body as the SDK's streaming-create params so field
    // names/value types are checked. The local `OpenAIChatMessage` /
    // `OpenAIToolDef` shapes genuinely diverge from the SDK's wide message/tool
    // unions (we build a narrower, hand-rolled shape), so cast ONLY those two
    // fields — not the whole body — keeping the rest type-checked.
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model,
      messages: messages as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      ...(tools
        ? { tools: tools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[] }
        : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens ? { [tokenLimitKey]: req.maxTokens } : {}),
      // Send `reasoning_effort` independently of the token-field heuristic.
      // The two are unrelated concerns: `usesCompletionTokens` picks the cap
      // FIELD NAME for the OpenAI-hosted reasoning models, while effort applies
      // to any reasoning backend. OpenAI-compatible vendors (z.ai GLM,
      // DeepSeek-R1, vLLM, Ollama) honor reasoning_effort but their model ids
      // never match the gpt-5/o1/o3 regex, so gating effort on it silently
      // dropped a user-requested effort for exactly those backends. The
      // descriptor's `supportsReasoning` already gates this upstream via
      // req.reasoning.
      ...(emitReasoning && reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      stream: true,
      // OpenAI only emits the final `usage` chunk when this is set;
      // without it `raw.usage` is null on every chunk and token usage
      // (and cache-read counts) are silently lost for every streamed turn.
      stream_options: { include_usage: true },
    };

    let stream: AsyncIterable<unknown>;
    try {
      stream = (await this.client.chat.completions.create(
        params,
        // Pass the AbortSignal into the SDK request options so cancelling
        // mid-stream tears down the underlying HTTP request instead of just
        // stopping our consumption loop. Without this, Esc / Ctrl+C felt
        // like nothing happened — the model kept generating and the user
        // got charged for tokens after the cancel.
        req.signal ? { signal: req.signal } : undefined,
      )) as unknown as AsyncIterable<unknown>;
    } catch (err) {
      // A cancel can surface as a thrown AbortError from the create() await —
      // report the clean terminal 'aborted' event (parity with the Anthropic
      // provider) so callers that suppress error UI on user cancel don't get a
      // noisy classified provider error.
      if (req.signal?.aborted) {
        yield { type: 'error', message: 'aborted', retryable: false };
        return;
      }
      yield { type: 'error', ...toFriendlyError(err, { provider: this.name }) };
      return;
    }

    const pending = new Map<number, PendingToolCall>();
    let stopReason: StopReason = 'end_turn';
    let usageIn = 0;
    let usageOut = 0;
    let usageCacheRead = 0;

    try {
      for await (const raw of stream as AsyncIterable<OpenAIStreamChunk>) {
        if (req.signal?.aborted) {
          yield { type: 'error', message: 'aborted', retryable: false };
          return;
        }
        // Usage arrives in a FINAL chunk that has an empty `choices` array
        // (only when stream_options.include_usage is set), so it must be read
        // before the `!choice` guard below — otherwise it's `continue`d past.
        if (raw.usage) {
          usageIn = raw.usage.prompt_tokens ?? usageIn;
          usageOut = raw.usage.completion_tokens ?? usageOut;
          // `prompt_tokens` already includes the cached portion; surface the
          // cached count so cache hit-rate accounting works (parity with the
          // Anthropic provider's cache_read_input_tokens).
          usageCacheRead = raw.usage.prompt_tokens_details?.cached_tokens ?? usageCacheRead;
        }
        const choice = raw.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? {};

        if (typeof delta.content === 'string' && delta.content) {
          yield { type: 'text_delta', delta: delta.content };
        }

        if (emitReasoning) {
          const reasoning = delta.reasoning_content ?? delta.reasoning;
          if (typeof reasoning === 'string' && reasoning) {
            yield { type: 'reasoning_delta', delta: reasoning };
          }
        }

        if (delta.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const idx = tcDelta.index ?? 0;
            let entry = pending.get(idx);
            if (!entry) {
              entry = {
                id: tcDelta.id ?? `call_${idx}`,
                name: tcDelta.function?.name ?? '',
                argsBuffer: '',
                emittedStart: false,
              };
              pending.set(idx, entry);
            } else if (tcDelta.id && !entry.emittedStart) {
              // Adopt a late-arriving id ONLY before tool_use_start fires.
              // Once start is emitted, the id is the dispatcher's correlation
              // key for the matching _delta/_end events; mutating it here (a
              // non-conforming backend that re-echoes a different id mid-call)
              // would orphan the start and drop the tool result silently.
              entry.id = tcDelta.id;
            }
            if (tcDelta.function?.name && !entry.name) entry.name = tcDelta.function.name;
            if (tcDelta.function?.name && !entry.emittedStart && entry.name) {
              entry.emittedStart = true;
              yield { type: 'tool_use_start', id: entry.id, name: entry.name };
            }
            if (typeof tcDelta.function?.arguments === 'string') {
              entry.argsBuffer += tcDelta.function.arguments;
              yield { type: 'tool_use_delta', id: entry.id, partialInput: tcDelta.function.arguments };
            }
          }
        }

        if (choice.finish_reason) {
          stopReason = mapStopReason(choice.finish_reason);
        }
      }
    } catch (err) {
      // The SDK rejects the iterator with an AbortError once req.signal fires;
      // emit the clean 'aborted' event instead of a classified provider error
      // (parity with the Anthropic provider and the in-loop abort check above).
      if (req.signal?.aborted) {
        yield { type: 'error', message: 'aborted', retryable: false };
        return;
      }
      yield { type: 'error', ...toFriendlyError(err, { provider: this.name }) };
      return;
    }

    // Flush tool_use_end events with parsed arguments.
    for (const entry of pending.values()) {
      // A non-conforming OpenAI-compatible backend (DeepSeek/z.ai/vLLM/Ollama)
      // can stream function.arguments for an index without ever sending
      // function.name. Such an entry never emitted a tool_use_start, so it was
      // being dropped silently — the turn looked like it did nothing. Surface
      // the failure instead of swallowing the call.
      if (!entry.emittedStart) {
        if (entry.name) {
          // Named but never started (no name delta after the entry was created
          // with a name on construction yet emittedStart stayed false) — emit
          // the start now so the call is not lost.
          entry.emittedStart = true;
          yield { type: 'tool_use_start', id: entry.id, name: entry.name };
        } else if (entry.argsBuffer) {
          stopReason = 'error';
          yield {
            type: 'error',
            message: `provider streamed tool arguments with no function name for ${entry.id}`,
            retryable: false,
          };
          continue;
        } else {
          // Empty, nameless, never-started: nothing to surface.
          continue;
        }
      }
      let parsed: unknown = {};
      if (entry.argsBuffer) {
        try {
          parsed = JSON.parse(entry.argsBuffer);
        } catch {
          // A truncated/malformed tool-input stream (content-filter cut, a
          // non-conforming backend) is a real failure, not a valid call with
          // junk args. Surface it as an error and mark the turn `error`
          // (parity with the Anthropic provider) instead of feeding an opaque
          // { _rawPartial } object into the tool as if it were valid input.
          stopReason = 'error';
          yield {
            type: 'error',
            message: `tool_use input JSON was malformed/truncated for ${entry.id}`,
            retryable: false,
          };
          continue;
        }
      }
      yield { type: 'tool_use_end', id: entry.id, input: parsed };
    }

    yield {
      type: 'message_end',
      stopReason,
      usage:
        usageIn > 0 || usageOut > 0
          ? {
              inputTokens: usageIn,
              outputTokens: usageOut,
              ...(usageCacheRead > 0 ? { cacheReadTokens: usageCacheRead } : {}),
            }
          : undefined,
    };
  }

  async countTokens(req: Pick<ProviderRequest, 'model' | 'messages' | 'system' | 'tools'>): Promise<number> {
    // OpenAI doesn't expose a free token counter; fall back to a coarse estimate.
    // Only TEXT content is stringified — for image/document/audio blocks the
    // `data` field is a multi-MB base64 blob, and JSON.stringify-ing it here
    // would materialize the whole payload into a transient string on the hot
    // pre-flight budget path AND wildly over-estimate (4 base64 chars != 1
    // token; binary blocks bill by tiles/pages, not characters). Charge a small
    // fixed constant per rich block instead.
    let textBlob = req.system ?? '';
    let richBlockTokens = 0;
    for (const m of req.messages) {
      for (const c of m.content) {
        if (c.type === 'text') {
          textBlob += c.text;
        } else if (c.type === 'tool_result') {
          textBlob += c.content;
        } else if (c.type === 'tool_use') {
          // Tool-call inputs are small structured objects; stringify is cheap.
          textBlob += c.name + safeStringify(c.input);
        } else if (c.type === 'reasoning') {
          textBlob += c.text;
        } else {
          // image / document / audio: opaque base64 — never stringify the data.
          richBlockTokens += RICH_BLOCK_TOKEN_ESTIMATE;
        }
      }
    }
    textBlob += (req.tools ?? []).map((t) => t.name + t.description).join('');
    return estimateTextTokens(textBlob) + richBlockTokens;
  }
}

interface OpenAIStreamChunk {
  choices?: Array<{
    index?: number;
    delta?: {
      content?: string | null;
      // Reasoning summary streamed by OpenAI-compatible reasoning backends
      // (DeepSeek-R1, z.ai/GLM, vLLM, Ollama, …). The field name varies by
      // vendor — handle both. Official OpenAI Chat Completions doesn't stream
      // it (Responses-API only), so it's simply absent there.
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

function mapStopReason(s: string): StopReason {
  if (s === 'tool_calls') return 'tool_use';
  // Legacy single-function finish reason still emitted by older Azure /
  // OpenAI-compatible deployments for the deprecated function-calling shape;
  // it means a tool call is pending, not a clean completion.
  if (s === 'function_call') return 'tool_use';
  if (s === 'length') return 'max_tokens';
  if (s === 'stop') return 'end_turn';
  if (s === 'content_filter') return 'error';
  return 'end_turn';
}
