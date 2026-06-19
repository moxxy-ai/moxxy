import type { ProviderEvent, ProviderMessage, TokenUsage } from '../provider.js';
import type { ModeContext } from '../mode.js';
import type { StopReason } from '../provider-utils.js';
import { applyLazyTools } from '../tool-gating.js';

/**
 * Shared bits used by every loop strategy: a typed tool-use struct and a
 * common stream-collection helper that runs `onBeforeProviderCall` hooks
 * and reduces a provider stream down to `{text, toolUses, stopReason}`.
 *
 * Lives in core (not in each loop package) so a new loop strategy stays
 * consistent — and so behavioral fixes here propagate. Previously
 * loop-plan-execute had its own copy that skipped the hook (audit bug).
 */

export interface CollectedToolUse {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

/** Sum two usage frames so multi-`message_end` responses don't undercount. */
function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  const cacheRead =
    a.cacheReadTokens !== undefined || b.cacheReadTokens !== undefined
      ? (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0)
      : undefined;
  const cacheCreation =
    a.cacheCreationTokens !== undefined || b.cacheCreationTokens !== undefined
      ? (a.cacheCreationTokens ?? 0) + (b.cacheCreationTokens ?? 0)
      : undefined;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    ...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
    ...(cacheCreation !== undefined ? { cacheCreationTokens: cacheCreation } : {}),
  };
}

export interface StreamResult {
  readonly text: string;
  readonly toolUses: ReadonlyArray<CollectedToolUse>;
  readonly stopReason: StopReason;
  readonly error: { readonly message: string; readonly retryable: boolean } | null;
  /** Token usage reported by the provider on `message_end`, including cache hits/writes. */
  readonly usage?: TokenUsage;
  /**
   * Reasoning/thinking summary for this provider call, when the model emitted
   * any. The mode emits it as a `reasoning_message` event (so it persists and
   * round-trips). `signature`/`encrypted` carry Anthropic's signed thinking
   * block / redacted blob; `redacted` marks display-suppressed reasoning.
   */
  readonly reasoning?: {
    readonly text: string;
    readonly signature?: string;
    readonly redacted?: boolean;
    readonly encrypted?: string;
  };
}

/**
 * Pulls a provider stream, emits `assistant_chunk` events for text deltas,
 * collects tool_use blocks, and returns the final `{text, toolUses, stopReason}`.
 * Runs `onBeforeProviderCall` lifecycle hooks before the call.
 */
export async function collectProviderStream(
  ctx: ModeContext,
  messages: ReadonlyArray<ProviderMessage>,
  opts: {
    iteration?: number;
    includeTools?: boolean;
    maxTokens?: number;
    /**
     * Index (into `messages`) of the last stable-prefix message, from
     * {@link projectMessages}. Passed to the active cache strategy as
     * `stablePrefixMessageIndex` so it can place a long-lived cross-turn
     * breakpoint at the elision boundary. Omit (or -1) when unknown — the
     * strategy then falls back to its tools/system/tail breakpoints only.
     */
    stablePrefixIndex?: number;
    /**
     * Number of trailing messages in `messages` that are volatile — injected
     * for this call only (e.g. goal mode's `trailingUserText` nudge) and
     * absent from the append-only log, so they won't recur at the same
     * position next call. Forwarded to the cache strategy as
     * `volatileTailMessageCount` so it keeps its rolling tail breakpoint
     * before them instead of paying a guaranteed-wasted cache write.
     */
    volatileTailCount?: number;
  } = {},
): Promise<StreamResult> {
  // Lazy tool gating (opt-in): send only always-on + loaded tool schemas, and
  // index the rest in the system prompt. Runs BEFORE cache planning since it
  // rewrites the system message and the tool list.
  let effectiveMessages = messages;
  let toolList: ReadonlyArray<import('../tool.js').ToolDef> | undefined =
    opts.includeTools === false ? undefined : ctx.tools.list();
  if (ctx.lazyTools && toolList) {
    const gated = applyLazyTools(messages, toolList, ctx.log);
    effectiveMessages = gated.messages;
    toolList = gated.tools;
  }

  // Ask the active cache strategy where to place prompt-cache breakpoints.
  // The strategy is provider-neutral (returns CacheHints); the provider
  // translates them (Anthropic → cache_control). Falls back to no hints when
  // no strategy is registered. The onBeforeProviderCall hook can still adjust.
  const descriptor = ctx.provider.models.find((m) => m.id === ctx.model);
  const cacheHints = ctx.cacheStrategy
    ? ctx.cacheStrategy.plan(effectiveMessages, {
        model: ctx.model,
        contextWindow: descriptor?.contextWindow ?? 0,
        log: ctx.log,
        ...(opts.stablePrefixIndex != null && opts.stablePrefixIndex >= 0
          ? { stablePrefixMessageIndex: opts.stablePrefixIndex }
          : {}),
        ...(opts.volatileTailCount != null && opts.volatileTailCount > 0
          ? { volatileTailMessageCount: opts.volatileTailCount }
          : {}),
      })
    : undefined;

  // NOTE: `system` is deliberately NOT prefilled with ctx.systemPrompt — the
  // composed system prompt already rides as the leading system-role message
  // (see projectMessages), and providers deliver `req.system` IN ADDITION to
  // message-derived system text. Prefilling it would duplicate the prompt.
  // It stays as the side channel `onBeforeProviderCall` hooks use to inject
  // per-request system text (e.g. the memory consolidation nudge).
  // Forward the per-provider reasoning preference, but only when THIS model
  // advertises `supportsReasoning` — providers ignore the knob otherwise, but
  // gating here keeps requests clean and avoids unsupported-param errors.
  const reqReasoning = descriptor?.supportsReasoning ? ctx.reasoning : undefined;
  const req = {
    model: ctx.model,
    messages: effectiveMessages,
    ...(toolList ? { tools: toolList } : {}),
    ...(cacheHints && cacheHints.length > 0 ? { cacheHints } : {}),
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
    ...(reqReasoning ? { reasoning: reqReasoning } : {}),
    signal: ctx.signal,
  };
  const transformed = await ctx.hooks.dispatchBeforeProviderCall(req, {
    sessionId: ctx.sessionId,
    // Thread the session's real cwd/env (mirrored on ModeContext) so path-based
    // policy/security `onBeforeProviderCall` hooks see the true per-session
    // values rather than blank placeholders — matching the dispatchToolCall path.
    cwd: ctx.cwd,
    log: ctx.log,
    env: ctx.env,
    turnId: ctx.turnId,
    iteration: opts.iteration ?? 0,
  });

  let text = '';
  const toolUses = new Map<string, { name?: string; input?: unknown }>();
  let stopReason: StopReason = 'end_turn';
  let error: StreamResult['error'] = null;
  let usage: TokenUsage | undefined;
  // Reasoning/thinking accumulation for this single provider call. Emitted as a
  // finalized `reasoning_message` by the mode (turn-iterator / goal-loop) so it
  // persists and round-trips; `signature`/`encrypted` carry Anthropic's signed
  // thinking block / redacted blob for replay.
  let reasoningText = '';
  let reasoningSignature: string | undefined;
  let reasoningRedacted = false;
  let reasoningEncrypted: string | undefined;

  let stream: AsyncIterable<ProviderEvent>;
  try {
    stream = ctx.provider.stream(transformed);
  } catch (err) {
    return {
      text: '',
      toolUses: [],
      stopReason: 'error',
      error: { message: err instanceof Error ? err.message : String(err), retryable: false },
    };
  }

  try {
    for await (const event of stream) {
      switch (event.type) {
        case 'text_delta': {
          text += event.delta;
          await ctx.emit({
            type: 'assistant_chunk',
            sessionId: ctx.sessionId,
            turnId: ctx.turnId,
            source: 'model',
            delta: event.delta,
          });
          break;
        }
        case 'tool_use_start': {
          toolUses.set(event.id, { name: event.name });
          break;
        }
        case 'tool_use_end': {
          const existing = toolUses.get(event.id) ?? {};
          toolUses.set(event.id, { ...existing, input: event.input });
          break;
        }
        case 'message_end': {
          stopReason = event.stopReason;
          // Accumulate across frames: a provider that splits a response into
          // multiple message segments (or emits an interim then a final usage)
          // must not have its token counts clobbered to only the last frame —
          // that would undercount input/output/cache tokens for billing.
          if (event.usage) usage = usage ? addUsage(usage, event.usage) : event.usage;
          break;
        }
        case 'error': {
          error = { message: event.message, retryable: event.retryable };
          break;
        }
        case 'reasoning_delta': {
          reasoningText += event.delta;
          // Live preview only — parallels `assistant_chunk`; renderers
          // accumulate ephemerally and clear on the finalized reasoning_message.
          await ctx.emit({
            type: 'reasoning_chunk',
            sessionId: ctx.sessionId,
            turnId: ctx.turnId,
            source: 'model',
            delta: event.delta,
          });
          break;
        }
        case 'reasoning_signature': {
          if (event.signature) reasoningSignature = event.signature;
          if (event.encrypted) reasoningEncrypted = event.encrypted;
          if (event.redacted) reasoningRedacted = true;
          break;
        }
        case 'message_start':
        case 'tool_use_delta':
        default:
          break;
      }
    }
  } catch (err) {
    // A stream-level `error` event is the more authoritative classification —
    // don't let a subsequent iterator throw downgrade its `retryable: true` to
    // false (which would stop the turn loop from retrying a transient failure).
    if (!error) {
      error = {
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
      };
    }
  }

  const finalToolUses: CollectedToolUse[] = [];
  for (const [id, partial] of toolUses) {
    if (!partial.name) continue;
    finalToolUses.push({ id, name: partial.name, input: partial.input ?? {} });
  }
  // Surface reasoning when there's visible text OR an opaque blob to replay
  // (a redacted_thinking block has no text but must still round-trip).
  const reasoning =
    reasoningText.trim().length > 0 || reasoningEncrypted
      ? {
          text: reasoningText,
          ...(reasoningSignature ? { signature: reasoningSignature } : {}),
          ...(reasoningRedacted ? { redacted: true } : {}),
          ...(reasoningEncrypted ? { encrypted: reasoningEncrypted } : {}),
        }
      : undefined;
  return {
    text,
    toolUses: finalToolUses,
    stopReason,
    error,
    ...(usage ? { usage } : {}),
    ...(reasoning ? { reasoning } : {}),
  };
}
