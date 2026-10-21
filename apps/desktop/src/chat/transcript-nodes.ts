import { groupThinkingNodes, groupToolNodes, groupWorkNodes, type RenderNode } from '@moxxy/client-core';
import type { ToolCallBlockData } from '@moxxy/chat-model';
import type { MoxxyEvent } from '@moxxy/sdk';
import { accountLimitOfEvent } from '@moxxy/sdk/agent-account-limit';
import { isAgentNoReplyEvent } from '@moxxy/sdk/agent-no-reply';
import { MODE_SIGNAL_TOOLS, type ModeTranscript } from './modes/mode-events';

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
    return VISIBLE_EVENT_TYPES.has(event.type) || (event.type === 'plugin_event' && (notes.has(event.id) || isUsedUpLimit(event) || isAgentNoReplyEvent(event)));
  });
}

/** An agent's used-up account limit is said where the turn stopped; one with room left is the bar's. */
function isUsedUpLimit(event: MoxxyEvent): boolean {
  const limit = accountLimitOfEvent(event);
  return limit !== undefined && limit.limit.state === 'reached';
}

/**
 * The rows the conversation draws: what renders, tool runs and thoughts folded
 * into groups, and each finished turn's work folded under its answer. A mode's
 * card (a plan, a goal's end) is never folded away; the turn still `running`
 * stays open so its steps show as they come.
 */
export function transcriptNodes(
  nodes: ReadonlyArray<RenderNode>,
  modes: Pick<ModeTranscript, 'notes' | 'outcomes'>,
  running: boolean,
): RenderNode[] {
  return groupWorkNodes(groupThinkingNodes(groupToolNodes(visibleTranscriptNodes(nodes, modes.notes))), {
    running,
    keep: (node) => node.kind === 'block' && modes.outcomes.has(node.block.id),
  });
}
