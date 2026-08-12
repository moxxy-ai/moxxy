import { describe, expect, it } from 'vitest';
import { buildRenderNodes } from '@moxxy/client-core';
import type { MoxxyEvent } from '@moxxy/sdk';
import { visibleTranscriptNodes } from './transcript-nodes';

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
});
