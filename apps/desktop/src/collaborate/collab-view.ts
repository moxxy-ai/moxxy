/**
 * Pure view helpers for the Collaborate panel.
 *
 * Extracted verbatim from `CollaboratePanel.tsx` so the channel-filter and
 * status-mapping logic can be unit-tested without rendering React. Behavior is
 * unchanged; the panel imports these instead of declaring them inline.
 */
import type { Block, CollaborationBlock, CollabMsgView } from '@moxxy/chat-model';
import { invariant } from '@/lib/assert';

/** Status-dot colour for an agent row in the left rail. */
export function dotColor(status: string): string {
  if (status === 'done') return 'var(--color-green)';
  if (status === 'crashed' || status === 'killed') return 'var(--color-red)';
  if (status === 'working') return 'var(--color-primary)';
  return 'var(--color-text-dim)';
}

/** Background colour for a task-board status chip. */
export function taskChipBg(status: string): string {
  if (status === 'done') return 'var(--color-green)';
  if (status === 'blocked') return 'var(--color-amber)';
  if (status === 'in_progress' || status === 'claimed') return 'var(--color-primary)';
  return 'var(--color-text-dim)';
}

/** The most recent `collab` block in a folded block list, or undefined. */
export function latestCollab(blocks: ReadonlyArray<Block>): CollaborationBlock | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    invariant(b !== undefined, 'block index within bounds');
    if (b.kind === 'collab') return b;
  }
  return undefined;
}

/**
 * Messages visible in the selected channel. `'all'` shows the whole bus;
 * a specific agent id shows messages to/from that agent plus team broadcasts
 * (`to === 'all'`).
 */
export function filterCollabMessages(
  messages: ReadonlyArray<CollabMsgView>,
  channel: string,
): ReadonlyArray<CollabMsgView> {
  if (channel === 'all') return messages;
  return messages.filter((m) => m.from === channel || m.to === channel || m.to === 'all');
}
