import { describe, expect, it } from 'vitest';
import { projectUserPrompt, resolvedCallIdSet } from './project-messages.js';
import { computeElisionState } from '../elision-state.js';
import { asEventId, asSessionId, asTurnId } from '../ids.js';
import type { MoxxyEvent, UserPromptEvent } from '../events.js';

const sid = asSessionId('s1');
const t1 = asTurnId('t1');

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
