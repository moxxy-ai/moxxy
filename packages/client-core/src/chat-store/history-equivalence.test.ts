/**
 * GOLDEN render-equivalence test for the dual-history consolidation.
 *
 * Proves that paging a workspace's history from the RUNNER's authoritative log
 * (`session.loadHistory` — RAW events, `seq` cursor, filtered client-side with
 * `isRenderedEvent`, "page-until-K-rendered") yields the EXACT same rendered
 * transcript as the legacy NDJSON path (`chat.loadSegment` — already-rendered
 * events, line-index cursor). If these two ever diverge, switching the renderer
 * onto the runner log would silently change what the user sees — this test is
 * the gate against that.
 *
 * The fixture deliberately exercises the risky cases:
 *  - stream-without-seal turns (assistant_chunk deltas + the runner-sealed
 *    assistant_message): the chunks must be filtered, the message kept;
 *  - reasoning (reasoning_chunk filtered, reasoning_message kept);
 *  - tool turns (tool_call_requested + tool_result kept);
 *  - a compaction event (non-rendered → dropped by BOTH paths);
 *  - provider_request/provider_response bookends (non-rendered);
 *  - enough rendered rows to span several scroll-up pages (multi-page), and
 *    enough RAW events that one runner window walks multiple raw pages.
 */

import { describe, expect, it } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import { chatStore } from './store.js';
import { isRenderedEvent } from '../chatModel.js';
import type { ChatPersistence } from '../chatPersistence.js';

/** Build a realistic RAW runner log: contiguous seq 0..n-1, rendered and
 *  non-rendered events interleaved exactly as a real turn emits them. */
function buildRawLog(): MoxxyEvent[] {
  const events: MoxxyEvent[] = [];
  let seq = 0;
  const push = (type: string, extra: Record<string, unknown> = {}): void => {
    events.push({
      id: `e${seq}`,
      seq,
      ts: seq,
      sessionId: 'sess',
      turnId: `t${Math.floor(seq / 16)}`,
      source: 'system',
      type,
      ...extra,
    } as unknown as MoxxyEvent);
    seq += 1;
  };
  for (let turn = 0; turn < 40; turn += 1) {
    push('user_prompt', { source: 'user', text: `q${turn}` }); // rendered
    push('provider_request', { provider: 'fake', model: 'm' }); // non-rendered
    // A streamed reply: several chunks (non-rendered) the runner then SEALS.
    for (let c = 0; c < 8; c += 1) push('assistant_chunk', { delta: `${turn}.${c} ` });
    if (turn === 9) {
      push('reasoning_chunk', { delta: 'thinking…' }); // non-rendered
      push('reasoning_message', { source: 'model', content: 'a thought' }); // rendered
    }
    if (turn === 17) {
      push('tool_call_requested', { source: 'model', name: 'Read', input: {}, callId: `c${turn}` }); // rendered
      push('tool_result', { source: 'tool', callId: `c${turn}`, content: 'file body' }); // rendered
    }
    push('assistant_message', { source: 'model', content: `a${turn}`, stopReason: 'end_turn' }); // rendered (the seal)
    push('provider_response', { provider: 'fake', model: 'm' }); // non-rendered
    if (turn === 25) push('compaction', { tokensSaved: 1234 }); // non-rendered → dropped by both
  }
  return events;
}

const RAW_LOG = buildRawLog();
/** Ground truth: exactly the events the renderer commits = isRenderedEvent. */
const EXPECTED_RENDERED_IDS = RAW_LOG.filter(isRenderedEvent).map((e) => e.id);

/** Page the RAW log newest-first by `seq` — the runner's `session.loadHistory`
 *  semantics (matches @moxxy/core's pageEvents). */
function pageRawBySeq(
  before: number | null,
  limit: number,
): { events: MoxxyEvent[]; prevCursor: number | null } {
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

/** Page the RENDERED subset newest-first by line-index — the NDJSON
 *  `chat.loadSegment` semantics (matches desktop-host's chat-log). */
const RENDERED = RAW_LOG.filter(isRenderedEvent);
function pageRenderedByIndex(
  before: number | null,
  limit: number,
): { events: MoxxyEvent[]; prevCursor: number | null } {
  const total = RENDERED.length;
  const end = before === null ? total : Math.min(before, total);
  const start = Math.max(0, end - limit);
  return { events: RENDERED.slice(start, end), prevCursor: start > 0 ? start : null };
}

/** A fake that serves history from the RUNNER (raw + seq cursor). */
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
 *  the store falls back to the NDJSON loadSegment path (rendered + line cursor). */
const ndjsonBackend: ChatPersistence = {
  async loadHistory() {
    return null;
  },
  async loadSegment(_ws, before, limit) {
    return pageRenderedByIndex(before, limit);
  },
  async append() {},
  async clear() {},
};

/** Drive a workspace's full scroll-up to exhaustion and return the rendered
 *  transcript the store ended up with. */
async function loadWholeTranscript(persistence: ChatPersistence, workspaceId: string): Promise<string[]> {
  chatStore.setPersistence(persistence);
  await chatStore.loadInitial(workspaceId);
  for (let guard = 0; guard < 100 && chatStore.getChat(workspaceId).hasOlder; guard += 1) {
    await chatStore.loadOlder(workspaceId);
  }
  return chatStore.getChat(workspaceId).events.map((e) => e.id);
}

describe('history render-equivalence: runner stream vs NDJSON', () => {
  it('the fixture actually exercises the hard cases', () => {
    // Non-rendered events present (so filtering is meaningful)...
    expect(RAW_LOG.some((e) => e.type === 'assistant_chunk')).toBe(true);
    expect(RAW_LOG.some((e) => e.type === 'compaction')).toBe(true);
    expect(RAW_LOG.some((e) => e.type === 'provider_request')).toBe(true);
    // ...and more rendered rows than one page, so scroll-up runs many times.
    expect(EXPECTED_RENDERED_IDS.length).toBeGreaterThan(50);
    // ...and more raw events than one runner window, so page-until-K loops.
    expect(RAW_LOG.length).toBeGreaterThan(200);
  });

  it('runner-stream + isRenderedEvent reconstructs exactly the rendered transcript', async () => {
    const ids = await loadWholeTranscript(runnerBackend, 'equiv-runner');
    expect(ids).toEqual(EXPECTED_RENDERED_IDS); // order, no dupes, no gaps
  });

  it('NDJSON fallback (older runner) reconstructs exactly the same transcript', async () => {
    const ids = await loadWholeTranscript(ndjsonBackend, 'equiv-ndjson');
    expect(ids).toEqual(EXPECTED_RENDERED_IDS);
  });

  it('the two sources are render-equivalent', async () => {
    const viaRunner = await loadWholeTranscript(runnerBackend, 'equiv-runner-2');
    const viaNdjson = await loadWholeTranscript(ndjsonBackend, 'equiv-ndjson-2');
    expect(viaRunner).toEqual(viaNdjson);
  });

  it('a runner that drops mid-scroll keeps hasOlder so a later scroll resumes (no NDJSON cursor-mixing)', async () => {
    // First window serves from the runner, then loadHistory starts returning
    // null (runner disconnected). The slot stays on the runner source and keeps
    // hasOlder set rather than silently switching to the NDJSON line cursor.
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
    // No throw (didn't hit loadSegment), and still resumable.
    expect(chatStore.getChat('equiv-flaky').hasOlder).toBe(true);
  });
});
