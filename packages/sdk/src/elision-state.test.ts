import { describe, expect, it } from 'vitest';
import { asEventId, asSessionId, asToolCallId, asTurnId } from './ids.js';
import type { MoxxyEvent } from './events.js';
import {
  computeElisionState,
  toolResultBytes,
  type ElisionState,
} from './elision-state.js';

const sid = asSessionId('s1');
const t1 = asTurnId('t1');
const t2 = asTurnId('t2');

function event(seq: number, partial: Omit<MoxxyEvent, 'id' | 'seq' | 'ts' | 'sessionId'>): MoxxyEvent {
  return { id: asEventId(`e${seq}`), seq, ts: seq, sessionId: sid, ...partial } as MoxxyEvent;
}

// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN reference: a byte-for-byte copy of computeElisionState's PRE-FUSION
// implementation (4 passes: HWM scan, the bookkeeping pass, then a
// filter(...).sort(...) of aged recalls). The optimized implementation under
// test (fused passes + reverse-iteration cap + recall short-circuit) MUST
// return an IDENTICAL ElisionState for every input. If these diverge, the
// optimization is unsound.
// ─────────────────────────────────────────────────────────────────────────────

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

function computeElisionStateOld(events: ReadonlyArray<MoxxyEvent>): ElisionState {
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
            seqRecalls += 1;
          }
        }
      }
    } else if (e.type === 'user_prompt' && firstUserPromptSeq < 0) {
      firstUserPromptSeq = e.seq;
    }
  }

  const unpinnedRecallCallIds = new Set<string>();
  const agedRecalls = events
    .filter(
      (e): e is Extract<MoxxyEvent, { type: 'tool_result' }> =>
        e.type === 'tool_result' && recallResultCallIds.has(e.callId) && e.seq <= hwm,
    )
    .sort((a, b) => b.seq - a.seq);
  let pinned = 0;
  for (const e of agedRecalls) {
    pinned += toolResultBytes(e.output, e.error?.message);
    if (pinned > maxRecallBytes) unpinnedRecallCallIds.add(e.callId);
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

// Compare two ElisionStates field-by-field, INCLUDING Set/Map ordering, so the
// equivalence is exact (insertion-order matters for byte-stable downstream
// projection — toolNameByCall is read by callId so order is irrelevant there,
// but unpinnedRecallCallIds is iterated, so we assert array-of-entries equality).
function assertSameState(a: ElisionState, b: ElisionState): void {
  expect(a.hwm).toBe(b.hwm);
  expect(a.effectiveElideConversational).toBe(b.effectiveElideConversational);
  expect([...a.neverElide]).toEqual([...b.neverElide]);
  expect([...a.toolNameByCall.entries()].sort()).toEqual([...b.toolNameByCall.entries()].sort());
  expect([...a.recalledCallIds].sort()).toEqual([...b.recalledCallIds].sort());
  expect([...a.recalledSeqs].sort()).toEqual([...b.recalledSeqs].sort());
  expect([...a.recallResultCallIds].sort()).toEqual([...b.recallResultCallIds].sort());
  // unpinnedRecallCallIds is the load-bearing one — assert exact insertion order.
  expect([...a.unpinnedRecallCallIds]).toEqual([...b.unpinnedRecallCallIds]);
  expect(a.firstUserPromptSeq).toBe(b.firstUserPromptSeq);
}

describe('computeElisionState (golden: fused == 4-pass reference)', () => {
  it('matches the reference on the empty / no-elision case', () => {
    assertSameState(computeElisionState([]), computeElisionStateOld([]));
    const noElision = [
      event(0, { type: 'user_prompt', turnId: t1, source: 'user', text: 'hi' }),
      event(1, { type: 'assistant_message', turnId: t1, source: 'model', content: 'a', stopReason: 'end_turn' }),
    ];
    assertSameState(computeElisionState(noElision), computeElisionStateOld(noElision));
  });

  // A randomized fuzzer building representative logs: anchor prompt, recall
  // calls (callId- and seq-recalls), recall results of varying size, an elision
  // event with a random HWM / maxRecallBytes / flags. This stresses the cap
  // (newest-first reverse iteration) and the conversational auto-disable.
  it('matches the reference across many randomized logs (cap, recalls, flags)', () => {
    let s = 4242;
    const rand = () => ((s = (s * 1664525 + 1013904329) >>> 0) / 0x100000000);
    for (let trial = 0; trial < 400; trial++) {
      const events: MoxxyEvent[] = [];
      let seq = 0;
      events.push(event(seq++, { type: 'user_prompt', turnId: t1, source: 'user', text: 'the task' }));
      const recallCount = Math.floor(rand() * 6);
      const recallCallIds: string[] = [];
      for (let i = 0; i < recallCount; i++) {
        const cid = asToolCallId(`rc${i}`);
        recallCallIds.push(`rc${i}`);
        // Half callId-recalls, half seq-recalls.
        const input = rand() < 0.5 ? { callId: `target${i}` } : { seq: Math.floor(rand() * seq) };
        events.push(event(seq++, { type: 'tool_call_requested', turnId: t1, source: 'model', callId: cid, name: 'recall', input }));
        // Most recalls have a result; size varies to drive the cap.
        if (rand() < 0.85) {
          const size = Math.floor(rand() * 400);
          events.push(event(seq++, { type: 'tool_result', turnId: t1, source: 'tool', callId: cid, ok: true, output: 'R'.repeat(size) }));
        }
      }
      // Some non-recall tool calls (must NOT count as aged recalls).
      const otherCalls = Math.floor(rand() * 4);
      for (let i = 0; i < otherCalls; i++) {
        const cid = asToolCallId(`oc${i}`);
        events.push(event(seq++, { type: 'tool_call_requested', turnId: t1, source: 'model', callId: cid, name: 'Read', input: { file_path: `/f${i}` } }));
        events.push(event(seq++, { type: 'tool_result', turnId: t1, source: 'tool', callId: cid, ok: true, output: 'X'.repeat(Math.floor(rand() * 300)) }));
      }
      // Occasionally a second user prompt.
      if (rand() < 0.5) events.push(event(seq++, { type: 'user_prompt', turnId: t1, source: 'user', text: 'more' }));
      // Maybe emit one or two elision events (later one with a larger HWM wins).
      const elisions = 1 + Math.floor(rand() * 2);
      for (let i = 0; i < elisions; i++) {
        const through = Math.floor(rand() * (seq + 1)) - (rand() < 0.1 ? 5 : 0); // sometimes negative-ish
        events.push(event(seq++, {
          type: 'elision',
          turnId: t2,
          source: 'system',
          elidedThrough: Math.max(-1, through),
          stubbedRanges: [[0, Math.max(0, through)]],
          elideConversational: rand() < 0.5,
          conversationalRecallThreshold: Math.floor(rand() * 5),
          maxRecallBytes: rand() < 0.3 ? 0 : Math.floor(rand() * 800),
          neverElideTools: rand() < 0.3 ? ['Read'] : [],
          tokensSaved: 100,
        }));
      }
      // A trailing recent prompt (post-HWM).
      events.push(event(seq++, { type: 'user_prompt', turnId: t2, source: 'user', text: 'recent' }));

      assertSameState(computeElisionState(events), computeElisionStateOld(events));
    }
  });

  it('matches on the cap boundary fixture (oldest aged recall over the cap is stubbed)', () => {
    const events: MoxxyEvent[] = [
      event(0, { type: 'user_prompt', turnId: t1, source: 'user', text: 'task' }),
      event(1, { type: 'tool_call_requested', turnId: t1, source: 'model', callId: asToolCallId('ra'), name: 'recall', input: { callId: 'x' } }),
      event(2, { type: 'tool_result', turnId: t1, source: 'tool', callId: asToolCallId('ra'), ok: true, output: 'A'.repeat(300) }),
      event(3, { type: 'tool_call_requested', turnId: t1, source: 'model', callId: asToolCallId('rb'), name: 'recall', input: { callId: 'y' } }),
      event(4, { type: 'tool_result', turnId: t1, source: 'tool', callId: asToolCallId('rb'), ok: true, output: 'B'.repeat(300) }),
      event(5, {
        type: 'elision', turnId: t2, source: 'system', elidedThrough: 4, stubbedRanges: [[0, 4]],
        elideConversational: false, conversationalRecallThreshold: 4, maxRecallBytes: 400, neverElideTools: [], tokensSaved: 100,
      }),
      event(6, { type: 'user_prompt', turnId: t2, source: 'user', text: 'next' }),
    ];
    const state = computeElisionState(events);
    // Newest (rb, seq 4, 300B) fits under 400; adding the older ra (300B) → 600 > 400 → ra stubbed.
    expect([...state.unpinnedRecallCallIds]).toEqual(['ra']);
    assertSameState(state, computeElisionStateOld(events));
  });
});
