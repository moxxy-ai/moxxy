import { describe, expect, it } from 'vitest';
import { projectMessagesFromLog, projectUserPrompt, resolvedCallIdSet } from './project-messages.js';
import { computeElisionState } from '../elision-state.js';
import { asEventId, asSessionId, asTurnId } from '../ids.js';
import type { EventLogReader } from '../log.js';
import type { MoxxyEvent, MoxxyEventOfType, MoxxyEventType, UserPromptEvent } from '../events.js';
import type { TurnId } from '../ids.js';

const sid = asSessionId('s1');
const t1 = asTurnId('t1');

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

// No-elision state — computeElisionState returns the empty/inactive state when
// the log has no elision events, which is the only state these pure sub-steps
// branch on for a fresh (non-stubbed) prompt.
const noElision = computeElisionState([]);

function userPrompt(seq: number, partial: Partial<UserPromptEvent>): UserPromptEvent {
  return {
    id: asEventId(`e${seq}`),
    seq,
    ts: seq,
    sessionId: sid,
    turnId: t1,
    source: 'user',
    type: 'user_prompt',
    text: 'hi',
    ...partial,
  } as UserPromptEvent;
}

function event(seq: number, partial: Omit<MoxxyEvent, 'id' | 'seq' | 'ts' | 'sessionId'>): MoxxyEvent {
  return {
    id: asEventId(`e${seq}`),
    seq,
    ts: seq,
    sessionId: sid,
    ...partial,
  } as MoxxyEvent;
}

describe('projectUserPrompt', () => {
  it('projects a plain prompt to a single text block', () => {
    const blocks = projectUserPrompt(userPrompt(0, { text: 'hello world' }), noElision);
    expect(blocks).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('expands an image attachment to an image block (default mediaType)', () => {
    const blocks = projectUserPrompt(
      userPrompt(0, {
        text: 'look',
        attachments: [{ kind: 'image', content: 'BASE64' }],
      }),
      noElision,
    );
    expect(blocks).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', mediaType: 'image/png', data: 'BASE64' },
    ]);
  });

  it('expands a document attachment, carrying name + mediaType', () => {
    const blocks = projectUserPrompt(
      userPrompt(0, {
        text: 'read',
        attachments: [{ kind: 'document', content: 'PDF64', name: 'spec.pdf', mediaType: 'application/pdf' }],
      }),
      noElision,
    );
    expect(blocks).toEqual([
      { type: 'text', text: 'read' },
      { type: 'document', mediaType: 'application/pdf', data: 'PDF64', name: 'spec.pdf' },
    ]);
  });

  it('renders a text/file attachment inline with a labeled header', () => {
    const blocks = projectUserPrompt(
      userPrompt(0, {
        text: 'see file',
        attachments: [{ kind: 'file', content: 'console.log(1)', name: 'a.ts' }],
      }),
      noElision,
    );
    expect(blocks).toEqual([
      { type: 'text', text: 'see file' },
      { type: 'text', text: '[file a.ts]\nconsole.log(1)' },
    ]);
  });
});

describe('resolvedCallIdSet', () => {
  it('collects callIds from tool_result and tool_call_denied events only', () => {
    const events = [
      event(0, { type: 'user_prompt', turnId: t1, source: 'user', text: 'go' }),
      event(1, {
        type: 'tool_call_requested',
        turnId: t1,
        source: 'model',
        callId: 'orphan',
        name: 'x',
        input: {},
      }),
      event(2, { type: 'tool_result', turnId: t1, source: 'tool', callId: 'resolved', ok: true, output: 'ok' }),
      event(3, {
        type: 'tool_call_denied',
        turnId: t1,
        source: 'system',
        callId: 'denied',
        decidedBy: 'policy',
        reason: 'nope',
      }),
    ];
    const set = resolvedCallIdSet(events);
    expect([...set].sort()).toEqual(['denied', 'resolved']);
    expect(set.has('orphan')).toBe(false);
  });

  it('returns a fresh mutable set (callers augment it for orphan synthesis)', () => {
    const set = resolvedCallIdSet([]);
    expect(set.size).toBe(0);
    set.add('later');
    expect(set.has('later')).toBe(true);
  });
});

describe('projectMessagesFromLog tool_result stringify hardening', () => {
  function logWith(output: unknown): MoxxyEvent[] {
    return [
      event(0, { type: 'user_prompt', turnId: t1, source: 'user', text: 'go' }),
      event(1, {
        type: 'tool_call_requested',
        turnId: t1,
        source: 'model',
        callId: 'c1',
        name: 'weird',
        input: {},
      }),
      event(2, { type: 'tool_result', turnId: t1, source: 'tool', callId: 'c1', ok: true, output }),
    ];
  }

  function toolResultText(events: MoxxyEvent[]): string {
    const msgs = projectMessagesFromLog({ log: reader(events) });
    const tr = msgs.find((m) => m.role === 'tool_result');
    const block = tr?.content[0];
    return block && block.type === 'tool_result' ? (block.content as string) : '';
  }

  it('does not throw on a circular tool_result output (would permanently wedge the turn)', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const events = logWith(circular);
    expect(() => projectMessagesFromLog({ log: reader(events) })).not.toThrow();
    // Re-projecting the same append-only log must also never throw.
    expect(() => projectMessagesFromLog({ log: reader(events) })).not.toThrow();
    expect(typeof toolResultText(events)).toBe('string');
  });

  it('does not throw on a BigInt-bearing tool_result output', () => {
    const events = logWith({ n: 10n });
    expect(() => projectMessagesFromLog({ log: reader(events) })).not.toThrow();
    expect(typeof toolResultText(events)).toBe('string');
  });

  it('still serializes a plain object output as JSON', () => {
    expect(toolResultText(logWith({ ok: true }))).toBe('{"ok":true}');
  });

  it('passes a string output through verbatim', () => {
    expect(toolResultText(logWith('plain text'))).toBe('plain text');
  });
});
