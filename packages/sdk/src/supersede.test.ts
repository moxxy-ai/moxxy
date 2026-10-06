import { describe, expect, it } from 'vitest';
import { assertDefined } from './assert.js';
import { asEventId, asSessionId, asTurnId } from './ids.js';
import type { EventLogReader } from './log.js';
import type { MoxxyEvent, MoxxyEventOfType, MoxxyEventType } from './events.js';
import type { TurnId } from './ids.js';
import { computeElisionState, toolResultStubbed } from './elision-state.js';
import { estimateContextTokens } from './compactor-helpers.js';
import { projectMessagesFromLog } from './mode/project-messages.js';

/**
 * A read of a page stops meaning anything once the same page has been read
 * whole again. In the Coolify task the first turn's reads (one of them 178,073
 * characters) were sent again on each of the 44 calls of the second turn, long
 * after the agent had moved on to other pages. A result that names what it
 * reads (`supersede.key`) is sent as a short marker once a later result reads
 * the same thing whole; `recall` still brings it back.
 */
const sid = asSessionId('s1');
const t1 = asTurnId('t1');

function event(seq: number, partial: Omit<MoxxyEvent, 'id' | 'seq' | 'ts' | 'sessionId'>): MoxxyEvent {
  return { id: asEventId(`e${seq}`), seq, ts: seq, sessionId: sid, ...partial } as MoxxyEvent;
}

function reader(events: ReadonlyArray<MoxxyEvent>): EventLogReader {
  return {
    length: events.length,
    at: (seq) => events[seq],
    slice: (from = 0, to = events.length) => events.slice(from, to),
    ofType: <T extends MoxxyEventType>(type: T): ReadonlyArray<MoxxyEventOfType<T>> =>
      events.filter((e): e is MoxxyEventOfType<T> => e.type === type),
    byTurn: (turnId: TurnId) => events.filter((e) => e.turnId === turnId),
    toJSON: () => events,
  };
}

/** A tool call and its result, at seq and seq + 1. */
function read(seq: number, callId: string, key: string, whole: boolean, text = 'x'.repeat(5_000)): MoxxyEvent[] {
  return [
    event(seq, { type: 'tool_call_requested', turnId: t1, source: 'model', callId, name: 'browser_snapshot', input: {} }),
    event(seq + 1, {
      type: 'tool_result',
      turnId: t1,
      source: 'tool',
      callId,
      ok: true,
      output: { text, supersede: { key, whole } },
    }),
  ];
}

const log: MoxxyEvent[] = [
  event(0, { type: 'user_prompt', turnId: t1, source: 'user', text: 'go' }),
  ...read(1, 'page-1', 'browser:t1', true),
  ...read(3, 'diff-1', 'browser:t1', false),
  ...read(5, 'other-tab', 'browser:t2', true),
  ...read(7, 'page-2', 'browser:t1', true, 'the page now'),
];

function resultOf(callId: string): Extract<MoxxyEvent, { type: 'tool_result' }> {
  const found = log.find(
    (e): e is Extract<MoxxyEvent, { type: 'tool_result' }> => e.type === 'tool_result' && e.callId === callId,
  );
  assertDefined(found, `result ${callId}`);
  return found;
}

function sentFor(events: MoxxyEvent[], callId: string): string {
  for (const m of projectMessagesFromLog({ log: reader(events) })) {
    for (const block of m.content) {
      if (block.type === 'tool_result' && block.toolUseId === callId) return String(block.content);
    }
  }
  return '';
}

describe('a result read again whole is superseded', () => {
  it('marks every earlier result of the same key once a later one is whole', () => {
    const state = computeElisionState(log);

    expect(toolResultStubbed(resultOf('page-1'), state)).toBe(true);
    expect(toolResultStubbed(resultOf('diff-1'), state)).toBe(true);
  });

  it('keeps the newest whole read, and what another key read', () => {
    const state = computeElisionState(log);

    expect(toolResultStubbed(resultOf('page-2'), state)).toBe(false);
    expect(toolResultStubbed(resultOf('other-tab'), state)).toBe(false);
  });

  it('does not let a partial read stand in for the whole one before it', () => {
    // The changes alone mean something only against the read they change.
    const partialLast = [...log.slice(0, 5)];
    const state = computeElisionState(partialLast);

    expect(toolResultStubbed(resultOf('page-1'), state)).toBe(false);
  });

  it('sends a superseded result as a marker that says how to get it back', () => {
    const sent = sentFor(log, 'page-1');

    expect(sent).toContain('recall("page-1")');
    expect(sent.length).toBeLessThan(200);
    expect(sentFor(log, 'page-2')).toContain('the page now');
  });

  it('counts the marker, not the read, when estimating the context', () => {
    const withoutLater = log.slice(0, 7);

    // Adding a short whole read takes the earlier reads out of the estimate.
    expect(estimateContextTokens(reader(log))).toBeLessThan(estimateContextTokens(reader(withoutLater)));
  });
});
