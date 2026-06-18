/**
 * GOLDEN render-equivalence test for the dual-history consolidation.
 *
 * Proves that paging a workspace's history from the RUNNER's authoritative log
 * (`session.loadHistory` — RAW events, `seq` cursor, projected client-side with
 * the same rendered+reconstruct logic the live reducer uses) yields the EXACT
 * same VISIBLE transcript as the legacy NDJSON path (`chat.loadSegment` — the
 * already-rendered events the live reducer committed, line-index cursor). If
 * these two ever diverge, switching the renderer onto the runner log would
 * silently change what the user sees — this test is the gate against that.
 *
 * The ground truth is NOT `RAW_LOG.filter(isRenderedEvent)` (which would be
 * tautological with the production projection). It is built by running the RAW
 * log through the REAL live reducer (`applyAction`, including its
 * turn_complete synth) — an independent code path — so the test actually pins
 * runner-projection == live-renderer.
 *
 * Fixtures exercise the risky cases:
 *  - SEALED streamed turns (assistant_chunk deltas + a runner-sealed
 *    assistant_message): chunks filtered, message kept;
 *  - an UNSEALED turn (assistant_chunk deltas + a FATAL error, NO
 *    assistant_message — a legacy log written before the runner sealed such
 *    turns): the reply must be RECONSTRUCTED, not dropped;
 *  - reasoning (reasoning_chunk filtered, reasoning_message kept);
 *  - a tool turn (tool_call_requested + tool_result kept);
 *  - a subagent plugin_event (the isRenderedEvent plugin branch);
 *  - a compaction event (non-rendered → dropped by both);
 *  - enough rendered rows to span several scroll-up pages.
 */

import { describe, expect, it } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import { chatStore } from './store.js';
import { applyAction, createRuntime } from '../chatModel.js';
import type { ChatPersistence } from '../chatPersistence.js';

const UNSEALED_TURN = 35; // legacy: streams text then a FATAL error, NO seal
const SEALED_AFTER_ERROR_TURN = 22; // post-seal: chunks + error + the runner's REAL seal
const PLUGIN_TURN = 12;
const REASONING_TURN = 9;
const TOOL_TURN = 17;
const COMPACTION_TURN = 25;

/** Build a realistic RAW runner log: contiguous seq 0..n-1, one logical turn at
 *  a time, rendered and non-rendered events interleaved as a real turn emits. */
function buildRawLog(): MoxxyEvent[] {
  const events: MoxxyEvent[] = [];
  let seq = 0;
  const push = (turnId: string, type: string, extra: Record<string, unknown> = {}): void => {
    events.push({
      id: `e${seq}`,
      seq,
      ts: seq,
      sessionId: 'sess',
      turnId,
      source: 'system',
      type,
      ...extra,
    } as unknown as MoxxyEvent);
    seq += 1;
  };
  for (let turn = 0; turn < 40; turn += 1) {
    const t = `t${turn}`;
    push(t, 'user_prompt', { source: 'user', text: `q${turn}` }); // rendered
    push(t, 'provider_request', { provider: 'fake', model: 'm' }); // non-rendered
    for (let c = 0; c < 8; c += 1) push(t, 'assistant_chunk', { delta: `${turn}.${c} ` }); // non-rendered
    if (turn === REASONING_TURN) {
      push(t, 'reasoning_chunk', { delta: 'thinking…' }); // non-rendered
      push(t, 'reasoning_message', { source: 'model', content: 'a thought' }); // rendered
    }
    if (turn === TOOL_TURN) {
      push(t, 'tool_call_requested', { source: 'model', name: 'Read', input: {}, callId: `c${turn}` });
      push(t, 'tool_result', { source: 'tool', callId: `c${turn}`, content: 'file body' });
    }
    if (turn === PLUGIN_TURN) {
      push(t, 'plugin_event', { pluginId: '@moxxy/subagents', kind: 'spawned', agentId: 'a1' }); // rendered
    }
    push(t, 'provider_response', { provider: 'fake', model: 'm' }); // non-rendered
    if (turn === UNSEALED_TURN) {
      // Streamed text then a FATAL error, NO assistant_message — the pre-seal
      // legacy shape. The reply text must survive via reconstruction.
      push(t, 'error', { source: 'system', kind: 'fatal', message: 'provider died mid-stream' }); // rendered
    } else if (turn === SEALED_AFTER_ERROR_TURN) {
      // Post-seal shape: the turn errored mid-stream but the runner THEN sealed
      // the streamed text into a real assistant_message. The reconstruction must
      // NOT fire here (that would double the reply) — the real seal stands.
      push(t, 'error', { source: 'system', kind: 'fatal', message: 'transient' }); // rendered
      push(t, 'assistant_message', { source: 'model', content: `a${turn}`, stopReason: 'end_turn' }); // the runner's seal
    } else {
      push(t, 'assistant_message', { source: 'model', content: `a${turn}`, stopReason: 'end_turn' }); // rendered (seal)
    }
    if (turn === COMPACTION_TURN) push(t, 'compaction', { tokensSaved: 1234 }); // non-rendered → dropped by both
  }
  return events;
}

const RAW_LOG = buildRawLog();

/** Independent ground truth: feed the RAW log through the REAL live reducer
 *  (applyAction), firing turn_complete at each turn boundary so an unsealed
 *  turn's streamed text is synthesized exactly as the old renderer committed it
 *  to NDJSON. This is a DIFFERENT code path than the production runner
 *  projection, so the equivalence assertion is not tautological. */
function liveRenderedTranscript(raw: ReadonlyArray<MoxxyEvent>): MoxxyEvent[] {
  const rt = createRuntime();
  let curTurn: string | null = null;
  for (const e of raw) {
    if (curTurn !== null && e.turnId !== curTurn) {
      applyAction(rt, { type: 'turn_complete', turnId: curTurn, error: null });
    }
    curTurn = e.turnId;
    applyAction(rt, { type: 'event', event: e });
  }
  if (curTurn !== null) applyAction(rt, { type: 'turn_complete', turnId: curTurn, error: null });
  return rt.log.toArray();
}

const NDJSON_TRANSCRIPT = liveRenderedTranscript(RAW_LOG);

/** What the user actually SEES — id-independent (the runner reconstruction and
 *  the live-reducer synth use different synth ids, but must show the same text
 *  in the same order). */
function visible(events: ReadonlyArray<MoxxyEvent>): string[] {
  return events.map((e) => {
    const ev = e as Record<string, unknown>;
    switch (e.type) {
      case 'user_prompt':
        return `user:${ev.text as string}`;
      case 'assistant_message':
        return `assistant:${ev.content as string}`;
      case 'reasoning_message':
        return `reasoning:${ev.content as string}`;
      case 'tool_call_requested':
        return `tool_req:${ev.callId as string}`;
      case 'tool_result':
        return `tool_res:${ev.callId as string}`;
      case 'plugin_event':
        return `plugin:${ev.pluginId as string}`;
      case 'error':
        return `error:${ev.kind as string}`;
      case 'abort':
        return 'abort';
      default:
        return e.type;
    }
  });
}

const EXPECTED_VISIBLE = visible(NDJSON_TRANSCRIPT);

/** Page the RAW log newest-first by `seq` — the runner's session.loadHistory
 *  semantics (matches @moxxy/core's pageEvents). */
function pageRawBySeq(before: number | null, limit: number): { events: MoxxyEvent[]; prevCursor: number | null } {
  let end = RAW_LOG.length;
  if (before !== null) {
    end = 0;
    for (let i = 0; i < RAW_LOG.length; i += 1) {
      if (RAW_LOG[i]!.seq < before) end = i + 1;
      else break;
    }
  }
  const start = Math.max(0, end - limit);
  const page = RAW_LOG.slice(start, end);
  return { events: page, prevCursor: start <= 0 ? null : page[0]!.seq };
}

/** Page the NDJSON transcript newest-first by line-index — the NDJSON
 *  chat.loadSegment semantics (matches desktop-host's chat-log). */
function pageNdjsonByIndex(
  before: number | null,
  limit: number,
): { events: MoxxyEvent[]; prevCursor: number | null } {
  const total = NDJSON_TRANSCRIPT.length;
  const end = before === null ? total : Math.min(before, total);
  const start = Math.max(0, end - limit);
  return { events: NDJSON_TRANSCRIPT.slice(start, end), prevCursor: start > 0 ? start : null };
}

/** A fake serving history from the RUNNER (raw events + seq cursor). */
const runnerBackend: ChatPersistence = {
  async loadHistory(_ws, before, limit) {
    return pageRawBySeq(before, limit);
  },
  async loadSegment() {
    throw new Error('runner-backed slot must never hit loadSegment');
  },
  async append() {},
  async clear() {},
};

/** A fake standing in for an OLDER (<v10) runner: loadHistory returns null, so
 *  the store falls back to the NDJSON loadSegment path. */
const ndjsonBackend: ChatPersistence = {
  async loadHistory() {
    return null;
  },
  async loadSegment(_ws, before, limit) {
    return pageNdjsonByIndex(before, limit);
  },
  async append() {},
  async clear() {},
};

async function loadWholeTranscript(persistence: ChatPersistence, workspaceId: string): Promise<MoxxyEvent[]> {
  chatStore.setPersistence(persistence);
  await chatStore.loadInitial(workspaceId);
  for (let guard = 0; guard < 100 && chatStore.getChat(workspaceId).hasOlder; guard += 1) {
    await chatStore.loadOlder(workspaceId);
  }
  return [...chatStore.getChat(workspaceId).events];
}

describe('history render-equivalence: runner stream vs NDJSON', () => {
  it('the fixture actually exercises the hard cases', () => {
    expect(RAW_LOG.some((e) => e.type === 'assistant_chunk')).toBe(true);
    expect(RAW_LOG.some((e) => e.type === 'compaction')).toBe(true);
    expect(RAW_LOG.some((e) => e.type === 'plugin_event')).toBe(true);
    // An UNSEALED turn really is present (chunks + fatal error, no message)...
    const unsealed = RAW_LOG.filter((e) => e.turnId === `t${UNSEALED_TURN}`);
    expect(unsealed.some((e) => e.type === 'assistant_chunk')).toBe(true);
    expect(unsealed.some((e) => e.type === 'assistant_message')).toBe(false);
    expect(unsealed.some((e) => e.type === 'error')).toBe(true);
    // ...and the live reducer DID reconstruct its reply into the NDJSON truth.
    const synthText = `${UNSEALED_TURN}.0 ${UNSEALED_TURN}.1 ${UNSEALED_TURN}.2 ${UNSEALED_TURN}.3 ${UNSEALED_TURN}.4 ${UNSEALED_TURN}.5 ${UNSEALED_TURN}.6 ${UNSEALED_TURN}.7 `;
    expect(EXPECTED_VISIBLE).toContain(`assistant:${synthText}`);
    // The post-seal errored turn yields EXACTLY ONE assistant reply (the real
    // seal) — reconstruction must not double it.
    expect(EXPECTED_VISIBLE.filter((v) => v === `assistant:a${SEALED_AFTER_ERROR_TURN}`)).toHaveLength(1);
    // ...and more rendered rows than one page, so scroll-up runs many times.
    expect(EXPECTED_VISIBLE.length).toBeGreaterThan(50);
    expect(RAW_LOG.length).toBeGreaterThan(200);
  });

  it('runner-stream projection reconstructs exactly the live-rendered transcript (incl. the unsealed reply)', async () => {
    const events = await loadWholeTranscript(runnerBackend, 'equiv-runner');
    expect(visible(events)).toEqual(EXPECTED_VISIBLE);
  });

  it('NDJSON fallback (older runner) reconstructs exactly the same transcript', async () => {
    const events = await loadWholeTranscript(ndjsonBackend, 'equiv-ndjson');
    expect(visible(events)).toEqual(EXPECTED_VISIBLE);
  });

  it('the two sources are render-equivalent', async () => {
    const viaRunner = await loadWholeTranscript(runnerBackend, 'equiv-runner-2');
    const viaNdjson = await loadWholeTranscript(ndjsonBackend, 'equiv-ndjson-2');
    expect(visible(viaRunner)).toEqual(visible(viaNdjson));
  });

  it('a runner that drops mid-scroll keeps hasOlder so a later scroll resumes (no NDJSON cursor-mixing)', async () => {
    let live = true;
    const flaky: ChatPersistence = {
      async loadHistory(_ws, before, limit) {
        return live ? pageRawBySeq(before, limit) : null;
      },
      async loadSegment() {
        throw new Error('must not fall back to NDJSON mid-runner-scroll');
      },
      async append() {},
      async clear() {},
    };
    chatStore.setPersistence(flaky);
    await chatStore.loadInitial('equiv-flaky');
    expect(chatStore.getChat('equiv-flaky').hasOlder).toBe(true);
    live = false; // runner drops
    await chatStore.loadOlder('equiv-flaky');
    expect(chatStore.getChat('equiv-flaky').hasOlder).toBe(true);
  });
});
