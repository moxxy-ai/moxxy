import {
  computeElisionState,
  conversationalStub,
  conversationalStubbed,
  toolResultBytes,
  toolResultStub,
  toolResultStubbed,
  type ElisionState,
} from './elision-state.js';
import type { CompactorDef, TokenBudget } from './compactor.js';
import type { EmittedEvent, MoxxyEvent } from './events.js';
import type { EventLogReader } from './log.js';
import type { ModeContext } from './mode.js';
import type { LLMProvider } from './provider.js';

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
export function estimateContextTokens(
  log: EventLogReader,
  // Optional precomputed elision state for THIS exact log snapshot. When a
  // caller already derived it (e.g. within a single loop iteration that also
  // projects), threading it here skips a redundant full `computeElisionState`
  // fold. MUST be the state of the same log — passing a stale one would
  // mis-size the estimate — so it is purely an opt-in fast path; omitting it
  // recomputes, byte-identically.
  precomputedElisionState?: ElisionState,
): number {
  const events = log.slice();
  // Share the exact stub decision with projection so the estimate matches what
  // is actually sent — pinned recalls / never-elide / tiny turns counted full,
  // not undercounted (which would let the context overflow before compaction).
  const el = precomputedElisionState ?? computeElisionState(events);
  let chars = 0;
  // Collect each compaction's covered range as a [from, to] interval rather
  // than materializing every covered seq into a Set — replacedRange can span
  // thousands of seqs after several compactions, and this runs every iteration.
  // The ranges are disjoint, so a small per-event interval check is equivalent
  // to the old Set membership test but allocates O(#compactions), not O(#seqs).
  const compactedRanges: Array<readonly [number, number]> = [];
  for (const e of events) {
    if (e.type === 'compaction') {
      compactedRanges.push([e.replacedRange[0], e.replacedRange[1]]);
      chars += e.summary.length;
    }
  }
  const isCompacted = (seq: number): boolean =>
    compactedRanges.some(([from, to]) => seq >= from && seq <= to);
  for (const e of events) {
    if (isCompacted(e.seq)) continue;
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
      // Use the shared sizing helper so the estimate matches projection: a
      // ToolDisplayResult (file diff) only ever sends its short `forModel`
      // string, so `toolResultBytes` measures THAT rather than the bulky
      // `display` payload — which would otherwise trip elision/compaction
      // thresholds prematurely. Strings/JSON collapse into the same path.
      return toolResultBytes(e.output);
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
  const exact = ctx.provider.models.find((m) => m.id === ctx.model);
  const descriptor = exact ?? ctx.provider.models[0];
  const contextWindow = descriptor?.contextWindow;
  if (!contextWindow || contextWindow <= 0) return null;
  // Signal (once) when the exact-id lookup missed and we fell back to the first
  // descriptor: the resolved `contextWindow` is that of a DIFFERENT model than
  // the session actually runs, so every proactive-compaction / elision decision
  // for the whole session may calibrate against the wrong window with no other
  // trace. Deduped on (provider, requested id, fallback id) because this runs
  // once per loop iteration — an undeduped warn would spam every turn.
  if (!exact && descriptor) {
    warnModelFallbackOnce(ctx.provider.name, ctx.model, descriptor.id, contextWindow);
  }
  return { contextWindow, reserveForOutput: descriptor?.maxOutputTokens ?? 0 };
}

// One-shot guard for the unlisted-model fallback warning above, keyed on the
// (provider name, requested model id, fallback descriptor id) tuple so a
// steady-state session logs the mismatch exactly once, not per iteration.
const warnedModelFallbacks = new Set<string>();

function warnModelFallbackOnce(
  providerName: string,
  requestedModel: string,
  fallbackId: string,
  contextWindow: number,
): void {
  const key = `${providerName}\u0000${requestedModel}\u0000${fallbackId}`;
  if (warnedModelFallbacks.has(key)) return;
  warnedModelFallbacks.add(key);
  // `console.warn` matches the SDK's existing non-fatal diagnostic seam (see
  // `resolveChannelToken`'s stale-token hint); there is no logger on ModeContext.
  console.warn(
    `[moxxy] model id "${requestedModel}" not found in provider "${providerName}" catalog; ` +
      `falling back to descriptor "${fallbackId}" with contextWindow ${contextWindow} — ` +
      `proactive compaction/elision may calibrate against the wrong window.`,
  );
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

  // Derive the elision state ONCE for this snapshot and thread it into the
  // estimate — `computeElisionState` is memoized on the log version, but
  // threading skips even the memo lookup and guarantees the estimate folds the
  // exact same state the rest of this iteration uses.
  const elisionState = computeElisionState(events);

  const budget = {
    contextWindow: resolved?.contextWindow ?? Number.MAX_SAFE_INTEGER,
    estimatedTokens: estimateContextTokens(ctx.log, elisionState),
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
      // Hand the compactor the session's provider/model so the default
      // summarize compactor can write a real summary (it truncates honestly
      // when no provider is reachable).
      provider: ctx.provider,
      model: ctx.model,
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
 * Outcome of {@link runManualCompaction}. `compacted` is false (with the other
 * counts at 0) whenever there was nothing to compact — empty log, no usable
 * summary, or `tokensSaved <= 0` — so a caller can format "nothing to compact"
 * vs "compacted N events" without re-deriving the gate.
 */
export interface ManualCompactionResult {
  /** Did a CompactionEvent get appended? */
  readonly compacted: boolean;
  /** Estimated tokens the summary saves vs the replaced range. */
  readonly tokensSaved: number;
  /** Count of events whose `seq` fell inside the (inclusive) replaced range. */
  readonly eventsCompacted: number;
}

const NO_COMPACTION: ManualCompactionResult = {
  compacted: false,
  tokensSaved: 0,
  eventsCompacted: 0,
};

/**
 * Shape a manual `/compact` needs from the session, kept structural so callers
 * (plugin-commands) stay free of a `@moxxy/core` dependency — the host always
 * passes a real Session that satisfies it. Mirrors the fields
 * {@link runCompactionIfNeeded} reads off `ModeContext`, but log-first because
 * a manual compaction has no live turn/mode context.
 */
export interface ManualCompactionInput {
  readonly compactor: CompactorDef;
  /** Authoring log the CompactionEvent is appended to. */
  readonly log: EventLogReader & {
    append(event: EmittedEvent): Promise<MoxxyEvent>;
  };
  /** Active provider/model so the default compactor writes a real summary. */
  readonly provider?: LLMProvider;
  readonly model?: string;
  /** Active model's resolved context window (for `shouldCompact`). */
  readonly contextWindow?: number;
  readonly reserveForOutput?: number;
  /** Cancellation signal; a fresh one is used when omitted. */
  readonly signal?: AbortSignal;
  /** Override the appended event's sessionId/turnId (else taken from the log tail). */
  readonly sessionId?: string;
  readonly turnId?: string;
}

/**
 * Run ONE compaction now, unconditionally (the `/compact` command's force
 * semantics — the threshold gate is skipped). The single shared implementation
 * of the manual-compaction flow that `compactSession` in `@moxxy/plugin-commands`
 * used to hand-roll: build the {@link TokenBudget} (with the same `estimate`
 * + context-window fallback as the auto path), call `compactor.compact`, guard
 * on an empty/zero-saving result, defensively fill the event's
 * sessionId/turnId/source, append it, and report `{ compacted, tokensSaved,
 * eventsCompacted }` so the caller only formats the message.
 *
 * Distinct from {@link runCompactionIfNeeded}, which is the per-iteration
 * auto-compaction hook bound to a live `ModeContext` and gated by
 * `shouldCompact` (unless forced). This one is log-first and always runs,
 * matching how a user-invoked `/compact` works. Errors propagate to the caller
 * (the command formats them); a no-op returns {@link NO_COMPACTION}.
 */
export async function runManualCompaction(
  input: ManualCompactionInput,
): Promise<ManualCompactionResult> {
  const { compactor, log } = input;
  const events = log.slice();
  if (events.length === 0) return NO_COMPACTION;

  // Match the auto path's window fallback: an unresolved window degrades to
  // MAX_SAFE_INTEGER (manual compaction ignores the threshold anyway).
  const contextWindow =
    input.contextWindow && input.contextWindow > 0
      ? input.contextWindow
      : Number.MAX_SAFE_INTEGER;
  const budget: TokenBudget = {
    contextWindow,
    estimatedTokens: estimateContextTokens(log),
    reserveForOutput: input.reserveForOutput ?? 0,
  };

  const result = await compactor.compact(events, {
    log,
    budget,
    signal: input.signal ?? new AbortController().signal,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
  });
  if (result.tokensSaved <= 0 || result.summary.trim().length === 0) {
    return NO_COMPACTION;
  }

  // Defensive-fill identity fields a spec-compliant compactor may omit
  // (`compact` declares `Omit<CompactionEvent, keyof EventBase>`). The
  // compactor's own values win (result spreads last). Mirrors
  // `runCompactionIfNeeded`.
  const lastEvent = events[events.length - 1];
  const emittable: EmittedEvent = {
    sessionId: input.sessionId ?? lastEvent?.sessionId,
    turnId: input.turnId ?? lastEvent?.turnId,
    source: 'compactor',
    ...result,
  } as EmittedEvent;
  await log.append(emittable);

  // `replacedRange` is an INCLUSIVE [fromSeq, toSeq] of event `seq` VALUES, not
  // array indices — and `seq === arrayIndex` is not guaranteed for
  // mirrors/partial views. Count the events actually inside the range rather
  // than differencing the seqs (which would overstate across any seq gap).
  const [fromSeq, toSeq] = result.replacedRange;
  const eventsCompacted = events.filter((e) => e.seq >= fromSeq && e.seq <= toSeq).length;

  return { compacted: true, tokensSaved: result.tokensSaved, eventsCompacted };
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
