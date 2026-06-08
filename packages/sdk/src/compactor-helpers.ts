import {
  computeElisionState,
  conversationalStub,
  conversationalStubbed,
  toolResultBytes,
  toolResultStub,
  toolResultStubbed,
} from './elision-state.js';
import type { EmittedEvent, MoxxyEvent } from './events.js';
import type { EventLogReader } from './log.js';
import type { ModeContext } from './mode.js';

/**
 * Cheap, no-network estimate of how many tokens the current event log
 * would consume on the next provider request. Char-based (chars/4) with
 * compaction events honored — events covered by a CompactionEvent.replacedRange
 * count as the (much shorter) summary rather than their original bytes — and
 * elision honored: old tool results (seq ≤ the elision high-water mark) count
 * as their ~stub size rather than their full payload, matching what
 * `projectMessagesFromLog` actually sends.
 *
 * Used by the auto-compact helper (see `runCompactionIfNeeded`) and by
 * the TUI's context meter. For perfect accuracy callers can use the
 * provider's `countTokens(req)`; this is the fast path that doesn't
 * touch the network and is safe to run on every iteration.
 */
export function estimateContextTokens(log: EventLogReader): number {
  const events = log.slice();
  // Share the exact stub decision with projection so the estimate matches what
  // is actually sent — pinned recalls / never-elide / tiny turns counted full,
  // not undercounted (which would let the context overflow before compaction).
  const el = computeElisionState(events);
  let chars = 0;
  const compactedSeqs = new Set<number>();
  for (const e of events) {
    if (e.type === 'compaction') {
      for (let seq = e.replacedRange[0]; seq <= e.replacedRange[1]; seq++) {
        compactedSeqs.add(seq);
      }
      chars += e.summary.length;
    }
  }
  for (const e of events) {
    if (compactedSeqs.has(e.seq)) continue;
    if (e.type === 'tool_result' && toolResultStubbed(e, el)) {
      const recalled = el.recalledCallIds.has(e.callId) || el.recalledSeqs.has(e.seq);
      chars += toolResultStub(e.callId, toolResultBytes(e.output), recalled).length;
      continue;
    }
    if ((e.type === 'user_prompt' || e.type === 'assistant_message') && conversationalStubbed(e, el)) {
      chars += conversationalStub(e.type === 'user_prompt' ? 'user' : 'assistant', e.seq).length;
      continue;
    }
    chars += eventChars(e);
  }
  return Math.ceil(chars / 4);
}

function eventChars(e: MoxxyEvent): number {
  switch (e.type) {
    case 'user_prompt': {
      let n = e.text.length;
      // Inlined text attachments (file/stdin — incl. text extracted from
      // Office docs) cost real prompt tokens, so count them. Image/document
      // bytes are tokenized specially by the provider; char-counting their
      // base64 would wildly over-estimate (an 8 MB image ≈ millions of
      // "tokens"), so skip those.
      for (const att of e.attachments ?? []) {
        if (att.kind === 'file' || att.kind === 'stdin') n += att.content.length;
      }
      return n;
    }
    case 'assistant_message':
      return e.content.length;
    case 'tool_call_requested':
      return e.name.length + safeJsonLen(e.input);
    case 'tool_result':
      if (e.error) return (e.error.message?.length ?? 0) + 12;
      if (typeof e.output === 'string') return e.output.length;
      return safeJsonLen(e.output);
    default:
      return 0;
  }
}

function safeJsonLen(v: unknown): number {
  try {
    return JSON.stringify(v ?? '').length;
  } catch {
    return 0;
  }
}

/**
 * Resolve the active model's context window for the proactive
 * compaction / elision thresholds.
 *
 * `config.model` is a free-form, unvalidated string, and providers happily
 * serve ids that aren't in their fixed descriptor list — a newer release
 * (`claude-opus-4-8`), a dated id, or a model registered at runtime via
 * provider-admin. So an exact `models.find(m => m.id === ctx.model)` often
 * MISSES, and both auto-compaction and auto-elision used to silently turn into
 * permanent no-ops for the whole session (the context then grows unbounded and
 * the agent "loses its context"). Falling back to the provider's first
 * descriptor — exactly what the TUI context meter already does
 * (`resolveContextWindow` in @moxxy/plugin-cli) — keeps both features alive on
 * an unrecognised id. Returns null only when the provider exposes no usable
 * window at all (no models / a zero window).
 */
export function resolveModelContext(
  ctx: ModeContext,
): { readonly contextWindow: number; readonly reserveForOutput: number } | null {
  const descriptor = ctx.provider.models.find((m) => m.id === ctx.model) ?? ctx.provider.models[0];
  const contextWindow = descriptor?.contextWindow;
  if (!contextWindow || contextWindow <= 0) return null;
  return { contextWindow, reserveForOutput: descriptor?.maxOutputTokens ?? 0 };
}

/**
 * Auto-compaction hook every mode calls once per iteration, right
 * before building messages for the next provider call. Reads the
 * active model's real `contextWindow` (not a magic max-int sentinel),
 * estimates current token use, and — if the configured compactor's
 * `shouldCompact` returns true — runs `compact()` and emits the
 * resulting CompactionEvent onto the log. `projectMessagesFromLog`
 * already honors compaction events, so the next provider call sees
 * the summarized prefix automatically.
 *
 * Designed to be tolerant: no compactor or a compactor throw degrade to a
 * no-op so a compactor bug can't kill the turn. Failures emit a non-fatal
 * `error` event for observability.
 */
export async function runCompactionIfNeeded(
  ctx: ModeContext,
  opts: { readonly force?: boolean } = {},
): Promise<boolean> {
  const compactor = ctx.compactor;
  if (!compactor) return false;

  // Resolve the active model's real context window (with a models[0] fallback
  // for unlisted ids). A reactive `force` compaction must still run when the
  // window can't be resolved — the provider has already told us the prompt
  // overflowed — so only the proactive threshold path requires a window. The
  // shipped compactor ignores `contextWindow` inside `compact()`, so the
  // sentinel below only affects `shouldCompact`, which `force` bypasses.
  const resolved = resolveModelContext(ctx);
  if (!resolved && !opts.force) return false;

  const events = ctx.log.slice();
  if (events.length === 0) return false;

  const budget = {
    contextWindow: resolved?.contextWindow ?? Number.MAX_SAFE_INTEGER,
    estimatedTokens: estimateContextTokens(ctx.log),
    reserveForOutput: resolved?.reserveForOutput ?? 0,
  } as const;

  // `force` skips the threshold gate — used reactively after the provider
  // rejects a request for being over the context window (our estimate can
  // lag the provider's real tokenizer), so we compact and retry rather than
  // failing the turn.
  if (!opts.force) {
    let shouldRun = false;
    try {
      shouldRun = compactor.shouldCompact(ctx.log, budget);
    } catch (err) {
      await ctx.emit({
        type: 'error',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        kind: 'retryable',
        message: `compactor.shouldCompact threw: ${err instanceof Error ? err.message : String(err)}`,
      });
      return false;
    }
    if (!shouldRun) return false;
  }

  try {
    const result = await compactor.compact(events, {
      log: ctx.log,
      budget,
      signal: ctx.signal,
    });
    if (result.tokensSaved <= 0 || result.summary.trim().length === 0) return false;
    // `compactor.compact` declares `Omit<CompactionEvent, keyof EventBase>`,
    // but every shipped compactor (and the SDK examples) fills sessionId /
    // turnId / source. Defensive-fill from ctx so a compactor that obeyed
    // the type contract literally still emits a valid event.
    const emittable: EmittedEvent = {
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'compactor',
      ...result,
    } as EmittedEvent;
    await ctx.emit(emittable);
    return true;
  } catch (err) {
    await ctx.emit({
      type: 'error',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      kind: 'retryable',
      message: `compactor.compact threw: ${err instanceof Error ? err.message : String(err)}`,
    });
    return false;
  }
}

/**
 * Heuristic: does this provider error mean "the request was too big for the
 * model's context window"? Providers phrase it many ways (OpenAI "maximum
 * context length is N tokens", Anthropic "prompt is too long", the runner's
 * own "input exceeds context window"), and it usually arrives as a
 * non-retryable 400 — so the turn loop matches on it to compact + retry
 * instead of dying.
 */
const CONTEXT_OVERFLOW_PATTERNS: ReadonlyArray<RegExp> = [
  /context[\s_-]{0,2}(window|length)/i,
  /maximum context/i,
  /context_length_exceeded/i,
  /exceeds?\b[^.]{0,24}context/i,
  /input[^.]{0,24}(exceeds|too long|too large|too many)/i,
  /too many (input )?tokens/i,
  /prompt is too long/i,
  /reduce the length/i,
];

export function isContextOverflowError(message: string): boolean {
  return CONTEXT_OVERFLOW_PATTERNS.some((re) => re.test(message));
}
