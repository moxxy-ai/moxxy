import type { MoxxyEvent } from './events.js';
import { isToolDisplayResult } from './tool-display.js';

/**
 * Shared elision decision logic — the single source of truth for "is this event
 * stubbed, and to what size", consumed by BOTH `projectMessagesFromLog` (what we
 * send) and `estimateContextTokens` (what we think we send). Keeping them in one
 * leaf module guarantees the estimate matches reality (no overflow from
 * undercounting pinned recalls) and avoids a circular import between the
 * projection and the estimate.
 */

/** Below this size, eliding a turn/result saves nothing — keep it verbatim. */
export const TINY_TURN_CHARS = 200;

/** Bytes of a tool_result payload (for stub labels + the recall cap). */
export function toolResultBytes(output: unknown, errorMessage?: string): number {
  if (errorMessage !== undefined) return errorMessage.length;
  if (typeof output === 'string') return output.length;
  // Rich results (e.g. file diffs) only ever send their short `forModel`
  // string to the model — measure THAT so the estimate matches projection
  // and the bulky `display` payload never trips elision.
  if (isToolDisplayResult(output)) return output.forModel.length;
  try {
    return JSON.stringify(output ?? '').length;
  } catch {
    return 0;
  }
}

/** Deterministic stub for an elided tool result. Stable bytes → cache-safe. */
export function toolResultStub(callId: string, bytes: number, recalled: boolean): string {
  if (recalled) return `[output elided — already recalled below · call "${callId}"]`;
  const label = bytes >= 1024 ? `${(Math.round(bytes / 102.4) / 10).toFixed(1)} KB` : `${bytes} B`;
  return `[output elided — ${label} · recall("${callId}") to view]`;
}

/** Deterministic stub for an elided conversational (user/assistant) turn. */
export function conversationalStub(role: 'user' | 'assistant', seq: number): string {
  return `[elided ${role} turn · recall({ seq: ${seq} }) to view]`;
}

export interface ElisionState {
  /** Inclusive seq high-water mark; -1 when no elision is active. */
  readonly hwm: number;
  /** Conversational elision after the adaptive auto-disable check. */
  readonly effectiveElideConversational: boolean;
  readonly neverElide: ReadonlySet<string>;
  readonly toolNameByCall: ReadonlyMap<string, string>;
  /** callIds an earlier `recall` referenced (their stub says "already recalled"). */
  readonly recalledCallIds: ReadonlySet<string>;
  readonly recalledSeqs: ReadonlySet<number>;
  /** callIds whose tool_result IS a recall's output — pinned verbatim... */
  readonly recallResultCallIds: ReadonlySet<string>;
  /** ...except these, which exceeded `maxRecallBytes` and get stubbed. */
  readonly unpinnedRecallCallIds: ReadonlySet<string>;
  /** Seq of the first user_prompt (task anchor) — never elided. */
  readonly firstUserPromptSeq: number;
}

const EMPTY_STATE: ElisionState = {
  hwm: -1,
  effectiveElideConversational: false,
  neverElide: new Set(),
  toolNameByCall: new Map(),
  recalledCallIds: new Set(),
  recalledSeqs: new Set(),
  recallResultCallIds: new Set(),
  unpinnedRecallCallIds: new Set(),
  firstUserPromptSeq: -1,
};

/**
 * Single-slot memo of the most recent {@link computeElisionState} result,
 * keyed on the IDENTITY of the events array it was folded from.
 *
 * The event log is append-only and every held event is immutable (invariant
 * #6: events at/below the HWM never change), so a given snapshot array is a
 * stable, never-mutated value: the same array reference always denotes the
 * same content and therefore the same state. A new turn produces a NEW snapshot
 * array (the live `log.slice()` returns a fresh array each call), so the memo
 * self-invalidates the moment the log changes — there is no way for it to serve
 * a state that is stale for the array it is keyed on.
 *
 * Keying on identity (not a content hash of `id`/`seq`/payload) is the only
 * SOUND single-slot choice for a pure fold over an arbitrary array: two
 * logically-different logs can share ids/seqs (e.g. a test that rebuilds the
 * same prefix with different payload, or a re-config), and a content hash that
 * missed a payload field would serve a stale state — a correctness bug. Array
 * identity can never collide across distinct values.
 *
 * The win: callers that re-ask over the SAME snapshot within an iteration
 * (e.g. the elision/compaction gates and the estimate, when they thread the
 * one `log.slice()` array — see `estimateContextTokens`) fold it only once;
 * `WeakMap` would also help a held snapshot survive GC pressure, but a single
 * slot keeps it allocation-free and matches the "one live snapshot at a time"
 * access pattern. Threading a precomputed state is the explicit zero-cost fast
 * path; this memo covers callers that re-pass the same array but can't thread.
 */
let memoEvents: ReadonlyArray<MoxxyEvent> | null = null;
let memoState: ElisionState | null = null;

/**
 * Derive elision state purely from the log: the active high-water mark + flags
 * (from the latest ElisionEvent), the callId→tool map, recall bookkeeping, the
 * adaptive conversational auto-disable, and which pinned recalls exceed the cap.
 *
 * Memoized on the input array's identity (see above) so repeated calls over the
 * same immutable snapshot fold it only once. The returned state is identical
 * (and `===` on a cache hit) to a fresh fold.
 */
export function computeElisionState(events: ReadonlyArray<MoxxyEvent>): ElisionState {
  if (memoEvents === events && memoState !== null) return memoState;
  const state = computeElisionStateUncached(events);
  memoEvents = events;
  memoState = state;
  return state;
}

function computeElisionStateUncached(events: ReadonlyArray<MoxxyEvent>): ElisionState {
  let hwm = -1;
  let elideConversational = false;
  let conversationalRecallThreshold = Number.POSITIVE_INFINITY;
  let maxRecallBytes = Number.POSITIVE_INFINITY;
  let neverElide: ReadonlyArray<string> = [];
  for (const e of events) {
    if (e.type === 'elision' && e.elidedThrough > hwm) {
      hwm = e.elidedThrough;
      elideConversational = e.elideConversational;
      conversationalRecallThreshold = e.conversationalRecallThreshold;
      maxRecallBytes = e.maxRecallBytes;
      neverElide = e.neverElideTools;
    }
  }
  if (hwm < 0) return EMPTY_STATE;

  const toolNameByCall = new Map<string, string>();
  const recalledCallIds = new Set<string>();
  const recalledSeqs = new Set<number>();
  const recallResultCallIds = new Set<string>();
  let seqRecalls = 0;
  let firstUserPromptSeq = -1;
  // Aged recall tool_results collected DURING the fused pass (events arrive in
  // strictly ascending seq, so this is seq-ascending = oldest-first). A recall's
  // tool_call_requested always precedes its tool_result in the log, so by the
  // time we hit that result `recallResultCallIds` already contains its callId —
  // making this single forward pass equivalent to the old "build the set fully,
  // THEN filter" two-pass shape.
  const agedRecallsAsc: Array<Extract<MoxxyEvent, { type: 'tool_result' }>> = [];

  for (const e of events) {
    if (e.type === 'tool_call_requested') {
      toolNameByCall.set(e.callId, e.name);
      if (e.name === 'recall') {
        recallResultCallIds.add(e.callId);
        const input = e.input as { callId?: unknown; seq?: unknown } | null | undefined;
        if (input && typeof input === 'object') {
          if (typeof input.callId === 'string') recalledCallIds.add(input.callId);
          if (typeof input.seq === 'number') {
            recalledSeqs.add(input.seq);
            seqRecalls += 1; // seq-recalls = signal that TEXT elision is hurting
          }
        }
      }
    } else if (e.type === 'user_prompt') {
      if (firstUserPromptSeq < 0) firstUserPromptSeq = e.seq;
    } else if (e.type === 'tool_result' && e.seq <= hwm && recallResultCallIds.has(e.callId)) {
      agedRecallsAsc.push(e);
    }
  }

  // Cap pinned recalls: keep the newest recall outputs within maxRecallBytes
  // verbatim, stub the rest. Only matters once a recall result ages below HWM.
  // Common case (no recalls) skips the loop entirely. `agedRecallsAsc` is
  // strictly seq-ascending, so iterating it in REVERSE visits newest-first —
  // byte-identical to the old `.sort((a, b) => b.seq - a.seq)` over unique seqs,
  // with no allocation/sort.
  const unpinnedRecallCallIds = new Set<string>();
  if (recallResultCallIds.size > 0) {
    let pinned = 0;
    for (let i = agedRecallsAsc.length - 1; i >= 0; i--) {
      const e = agedRecallsAsc[i]!;
      pinned += toolResultBytes(e.output, e.error?.message);
      if (pinned > maxRecallBytes) unpinnedRecallCallIds.add(e.callId);
    }
  }

  return {
    hwm,
    effectiveElideConversational: elideConversational && seqRecalls < conversationalRecallThreshold,
    neverElide: new Set(neverElide),
    toolNameByCall,
    recalledCallIds,
    recalledSeqs,
    recallResultCallIds,
    unpinnedRecallCallIds,
    firstUserPromptSeq,
  };
}

/** Is this tool_result sent as a stub? (Shared by projection + estimate.) */
export function toolResultStubbed(
  e: Extract<MoxxyEvent, { type: 'tool_result' }>,
  state: ElisionState,
): boolean {
  if (e.seq > state.hwm || e.error) return false;
  const name = state.toolNameByCall.get(e.callId);
  if (name !== undefined && state.neverElide.has(name)) return false;
  if (state.recallResultCallIds.has(e.callId)) {
    // Recall outputs are pinned verbatim unless they blew the cap.
    return state.unpinnedRecallCallIds.has(e.callId);
  }
  if (toolResultBytes(e.output) <= TINY_TURN_CHARS) return false; // tiny: keep full
  return true;
}

/** Is this user/assistant turn collapsed to a conversational stub? */
export function conversationalStubbed(
  e: Extract<MoxxyEvent, { type: 'user_prompt' | 'assistant_message' }>,
  state: ElisionState,
): boolean {
  if (e.seq > state.hwm || !state.effectiveElideConversational) return false;
  if (e.type === 'user_prompt' && e.seq === state.firstUserPromptSeq) return false; // anchor
  const len = e.type === 'user_prompt' ? e.text.length : e.content.length;
  if (len <= TINY_TURN_CHARS) return false;
  return true;
}
