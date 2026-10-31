/**
 * The held cards in the toast corner: agent CLIs to install or update. Unlike
 * a toast each stays until it is settled, so the card the person pressed
 * Update on is the one that shows the progress.
 */

import type { AgentCliNoticeView } from '../chat/useAgentCliNotice';

const NONE: ReadonlyArray<AgentCliNoticeView> = [];
let cards = NONE;
const listeners = new Set<() => void>();

export function setAgentUpdateCards(next: ReadonlyArray<AgentCliNoticeView>): void {
  cards = next.length > 0 ? next : NONE;
  for (const listener of listeners) listener();
}

export function getAgentUpdateCards(): ReadonlyArray<AgentCliNoticeView> {
  return cards;
}

export function subscribeAgentUpdateCards(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
