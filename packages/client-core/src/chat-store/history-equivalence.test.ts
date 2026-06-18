/**
 * Runner-read projection test for the consolidated chat history.
 *
 * The runner's authoritative log is now the SOLE history source. This pins that
 * paging the runner's RAW log (`session.loadHistory`, `seq` cursor) and
 * projecting it client-side (`projectRunnerWindow` — `isRenderedEvent` plus the
 * unsealed-reply reconstruction) yields the EXACT transcript the live reducer
 * (`applyAction`, including its turn_complete synth) would commit. The ground
 * truth is built by an independent code path (the live reducer), so the
 * assertion is not tautological.
 *
 * Fixtures exercise the risky cases:
 *  - SEALED streamed turns (chunks + a runner-sealed assistant_message);
 *  - an UNSEALED turn (chunks + a FATAL error, NO assistant_message — a log
 *    written before the runner sealed such turns): the reply is RECONSTRUCTED;
 *  - an errored-then-sealed turn (chunks + error + the real seal): NOT doubled;
 *  - reasoning / tool / plugin / compaction / multi-page.
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
    push(t, 'user_prompt', { source: 'user', text: `q${turn}` });
    push(t, 'provider_request', { provider: 'fake', model: 'm' });
    for (let c = 0; c < 8; c += 1) push(t, 'assistant_chunk', { delta: `${turn}.${c} ` });
    if (turn === REASONING_TURN) {
      push(t, 'reasoning_chunk', { delta: 'thinking…' });
      push(t, 'reasoning_message', { source: 'model', content: 'a thought' });
    }
    if (turn === TOOL_TURN) {
      push(t, 'tool_call_requested', { source: 'model', name: 'Read', input: {}, callId: `c${turn}` });
      push(t, 'tool_result', { source: 'tool', callId: `c${turn}`, content: 'file body' });
    }
    if (turn === PLUGIN_TURN) {
      push(t, 'plugin_event', { pluginId: '@moxxy/subagents', kind: 'spawned', agentId: 'a1' });
    }
    push(t, 'provider_response', { provider: 'fake', model: 'm' });
    if (turn === UNSEALED_TURN) {
      push(t, 'error', { source: 'system', kind: 'fatal', message: 'provider died mid-stream' });
    } else if (turn === SEALED_AFTER_ERROR_TURN) {
      push(t, 'error', { source: 'system', kind: 'fatal', message: 'transient' });
      push(t, 'assistant_message', { source: 'model', content: `a${turn}`, stopReason: 'end_turn' });
    } else {
      push(t, 'assistant_message', { source: 'model', content: `a${turn}`, stopReason: 'end_turn' });
    }
    if (turn === COMPACTION_TURN) push(t, 'compaction', { tokensSaved: 1234 });
  }
  return events;
}

const RAW_LOG = buildRawLog();

/** Independent ground truth: feed the RAW log through the REAL live reducer,
 *  firing turn_complete at each turn boundary so an unsealed turn's streamed
 *  text is synthesized exactly as the renderer commits it live. */
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

const EXPECTED_VISIBLE = visible(liveRenderedTranscript(RAW_LOG));

/** What the user actually SEES — id-independent (the runner reconstruction and
 *  the live synth use different ids, but must show the same text in order). */
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

/** The production backend serves history from the runner (raw + seq cursor). */
const runnerBackend: ChatPersistence = {
  async loadHistory(_ws, before, limit) {
    return pageRawBySeq(before, limit);
  },
};

async function loadWholeTranscript(persistence: ChatPersistence, workspaceId: string): Promise<MoxxyEvent[]> {
  chatStore.setPersistence(persistence);
  await chatStore.loadInitial(workspaceId);
  for (let guard = 0; guard < 100 && chatStore.getChat(workspaceId).hasOlder; guard += 1) {
    await chatStore.loadOlder(workspaceId);
  }
  return [...chatStore.getChat(workspaceId).events];
}

describe('runner-read history projection', () => {
  it('the fixture actually exercises the hard cases', () => {
    expect(RAW_LOG.some((e) => e.type === 'assistant_chunk')).toBe(true);
    expect(RAW_LOG.some((e) => e.type === 'compaction')).toBe(true);
    expect(RAW_LOG.some((e) => e.type === 'plugin_event')).toBe(true);
    const unsealed = RAW_LOG.filter((e) => e.turnId === `t${UNSEALED_TURN}`);
    expect(unsealed.some((e) => e.type === 'assistant_chunk')).toBe(true);
    expect(unsealed.some((e) => e.type === 'assistant_message')).toBe(false);
    const synthText = `${UNSEALED_TURN}.0 ${UNSEALED_TURN}.1 ${UNSEALED_TURN}.2 ${UNSEALED_TURN}.3 ${UNSEALED_TURN}.4 ${UNSEALED_TURN}.5 ${UNSEALED_TURN}.6 ${UNSEALED_TURN}.7 `;
    expect(EXPECTED_VISIBLE).toContain(`assistant:${synthText}`);
    expect(EXPECTED_VISIBLE.filter((v) => v === `assistant:a${SEALED_AFTER_ERROR_TURN}`)).toHaveLength(1);
    expect(EXPECTED_VISIBLE.length).toBeGreaterThan(50);
    expect(RAW_LOG.length).toBeGreaterThan(200);
  });

  it('runner-stream projection reconstructs exactly the live-rendered transcript (incl. the unsealed reply)', async () => {
    const events = await loadWholeTranscript(runnerBackend, 'rr-1');
    expect(visible(events)).toEqual(EXPECTED_VISIBLE);
  });

  it('a connected runner with no history yet shows an empty transcript (no fallback store)', async () => {
    const emptyRunner: ChatPersistence = {
      async loadHistory() {
        return { events: [], prevCursor: null };
      },
    };
    const events = await loadWholeTranscript(emptyRunner, 'rr-empty');
    expect(events).toEqual([]);
  });

  it('no connected runner (loadHistory null) shows an empty transcript', async () => {
    const noRunner: ChatPersistence = {
      async loadHistory() {
        return null;
      },
    };
    const events = await loadWholeTranscript(noRunner, 'rr-none');
    expect(events).toEqual([]);
  });

  it('a runner that drops mid-scroll keeps hasOlder so a later scroll resumes', async () => {
    let live = true;
    const flaky: ChatPersistence = {
      async loadHistory(_ws, before, limit) {
        return live ? pageRawBySeq(before, limit) : null;
      },
    };
    chatStore.setPersistence(flaky);
    await chatStore.loadInitial('rr-flaky');
    expect(chatStore.getChat('rr-flaky').hasOlder).toBe(true);
    live = false;
    await chatStore.loadOlder('rr-flaky');
    expect(chatStore.getChat('rr-flaky').hasOlder).toBe(true);
  });
});
