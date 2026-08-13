import type { RenderNode } from '@moxxy/client-core';
import type { MoxxyEvent } from '@moxxy/sdk';

const VISIBLE_EVENT_TYPES: ReadonlySet<MoxxyEvent['type']> = new Set([
  'user_prompt',
  'assistant_message',
  'reasoning_message',
  'error',
  'abort',
]);

function isVisibleTranscriptNode(node: RenderNode): boolean {
  if (node.kind !== 'block' || node.block.kind !== 'event') return true;
  return VISIBLE_EVENT_TYPES.has(node.block.event.type);
}

/** Remove bookkeeping fallbacks that render no DOM before Virtuoso measures rows. */
export function visibleTranscriptNodes(nodes: ReadonlyArray<RenderNode>): RenderNode[] {
  return nodes.filter(isVisibleTranscriptNode);
}
