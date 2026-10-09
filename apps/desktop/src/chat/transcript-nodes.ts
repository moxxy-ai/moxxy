import type { RenderNode } from '@moxxy/client-core';
import type { ToolCallBlockData } from '@moxxy/chat-model';
import type { MoxxyEvent } from '@moxxy/sdk';
import { MODE_SIGNAL_TOOLS } from './modes/mode-events';

const VISIBLE_EVENT_TYPES: ReadonlySet<MoxxyEvent['type']> = new Set([
  'user_prompt',
  'assistant_message',
  'reasoning_message',
  'error',
  'abort',
]);

/** A mode's own "done" call that went through; a refused one stays, as the only word of it. */
function isQuietSignal(call: ToolCallBlockData): boolean {
  if (!MODE_SIGNAL_TOOLS.has(call.request.name)) return false;
  const outcome = call.outcome;
  if (outcome === null) return true;
  return outcome.type !== 'denied' && outcome.ok;
}

const NO_NOTES: ReadonlyMap<string, unknown> = new Map();

/**
 * Remove bookkeeping fallbacks that render no DOM before Virtuoso measures rows.
 * `notes` holds the plugin events a mode's run draws a line for; every other
 * plugin event is bookkeeping.
 */
export function visibleTranscriptNodes(
  nodes: ReadonlyArray<RenderNode>,
  notes: ReadonlyMap<string, unknown> = NO_NOTES,
): RenderNode[] {
  return nodes.filter((node) => {
    if (node.kind !== 'block') return true;
    if (node.block.kind === 'tool-call') return !isQuietSignal(node.block);
    if (node.block.kind !== 'event') return true;
    const event = node.block.event;
    return VISIBLE_EVENT_TYPES.has(event.type) || (event.type === 'plugin_event' && notes.has(event.id));
  });
}
