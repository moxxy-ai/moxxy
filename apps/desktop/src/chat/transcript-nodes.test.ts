import { describe, expect, it } from 'vitest';
import { buildRenderNodes } from '@moxxy/client-core';
import type { MoxxyEvent } from '@moxxy/sdk';
import { transcriptNodes, visibleTranscriptNodes } from './transcript-nodes';
import type { ModeOutcome } from './modes/mode-events';

function event(
  type: MoxxyEvent['type'],
  fields: Readonly<Record<string, unknown>>,
  sequence: number,
): MoxxyEvent {
  return {
    type,
    id: `event-${sequence}`,
    seq: sequence,
    ts: sequence,
    sessionId: 'session',
    turnId: 'turn',
    source: 'system',
    ...fields,
  } as MoxxyEvent;
}

describe('visibleTranscriptNodes', () => {
  it('keeps the reason an unanswered question closed, without showing raw question bookkeeping', () => {
    const nodes = buildRenderNodes([
      event('plugin_event', { pluginId: '@moxxy/question', subtype: 'question_asked', payload: { questionId: 'q1', questions: [] } }, 1),
      event('plugin_event', { pluginId: '@moxxy/question', subtype: 'question_resolved', payload: { questionId: 'q1', dismissed: 'cancelled', note: 'agent-went-on' } }, 2),
    ], []);

    expect(visibleTranscriptNodes(nodes).map((node) => (node.kind === 'block' ? node.block.id : node.kind))).toEqual(['event-2']);
  });

  it('removes event blocks that render no content before Virtuoso measures them', () => {
    const nodes = buildRenderNodes([
      event('user_prompt', { text: 'Please inspect this.' }, 1),
      event('tool_result', { callId: 'orphan', ok: true, output: 'done' }, 2),
      event('assistant_message', { content: 'Done.', stopReason: 'end_turn' }, 3),
    ], []);

    expect(nodes).toHaveLength(3);
    expect(visibleTranscriptNodes(nodes).map((node) => {
      if (node.kind === 'block') return node.block.id;
      if (node.kind === 'ext') return node.ext.id;
      return node.id;
    }))
      .toEqual(['event-1', 'event-3']);
  });

  it("keeps the line of an agent's used-up account limit, and none for a limit with room left", () => {
    const limit = (state: string, sequence: number) =>
      event('plugin_event', { pluginId: '@moxxy/agent-connection', subtype: 'account_limit', payload: { provider: 'claude-code', limit: { state } } }, sequence);
    const nodes = buildRenderNodes([limit('near', 1), limit('reached', 2)], []);

    expect(visibleTranscriptNodes(nodes).map((node) => (node.kind === 'block' ? node.block.id : node.kind))).toEqual(['event-2']);
  });

  it('keeps the line saying the agent finished without replying', () => {
    const nodes = buildRenderNodes([
      event('user_prompt', { text: 'Task finished', origin: { kind: 'agent', name: 'Task finished' } }, 1),
      event('plugin_event', { pluginId: '@moxxy/agent-connection', subtype: 'no_reply', payload: {} }, 2),
    ], []);

    expect(visibleTranscriptNodes(nodes).map((node) => (node.kind === 'block' ? node.block.id : node.kind))).toEqual(['event-1', 'event-2']);
  });
});

describe('transcriptNodes', () => {
  const turn = (from: number): MoxxyEvent[] => [
    event('user_prompt', { text: 'Fix the port.' }, from),
    event('reasoning_message', { content: 'Where is it set?' }, from + 1),
    event('tool_call_requested', { callId: `c${from}`, name: 'Bash', input: { command: 'grep -r port' } }, from + 2),
    event('tool_result', { callId: `c${from}`, ok: true, output: 'server.ts' }, from + 3),
    event('assistant_message', { content: 'Found it in server.ts.' }, from + 4),
    event('assistant_message', { content: 'Moved the port to 4000.', stopReason: 'end_turn' }, from + 5),
  ];
  const ids = (nodes: ReturnType<typeof transcriptNodes>): string[] =>
    nodes.map((node) => (node.kind === 'block' ? node.block.id : node.kind === 'ext' ? node.ext.id : node.kind));
  const noModes = { notes: new Map(), outcomes: new Map<string, ModeOutcome>() };

  it("folds a finished turn's work under one row, its answer left in view", () => {
    expect(ids(transcriptNodes(buildRenderNodes(turn(1), []), noModes, false))).toEqual(['event-1', 'work', 'event-6']);
  });

  it('leaves the turn that is still going unfolded', () => {
    const nodes = transcriptNodes(buildRenderNodes([...turn(1), ...turn(11)], []), noModes, true);
    expect(ids(nodes)).toEqual(['event-1', 'work', 'event-6', 'event-11', 'event-12', 'event-13', 'event-15', 'event-16']);
  });

  it("keeps a mode's card in view", () => {
    const outcomes = new Map<string, ModeOutcome>([['event-5', { kind: 'plan', title: 'Plan', tone: 'neutral', facts: [] }]]);
    expect(ids(transcriptNodes(buildRenderNodes(turn(1), []), { notes: new Map(), outcomes }, false)))
      .toEqual(['event-1', 'work', 'event-5', 'event-6']);
  });
});
