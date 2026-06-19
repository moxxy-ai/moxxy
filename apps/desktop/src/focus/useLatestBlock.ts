/**
 * Latest-line subscription for the mini-text preview. Reads the freshest
 * line from the chat store — live (still-streaming) assistant text wins,
 * otherwise the last committed assistant / user message — and memoises by
 * content so the preview only re-renders when the visible line changes.
 */

import { useSyncExternalStore } from 'react';
import type { MoxxyEvent } from '@moxxy/sdk';
import { chatStore } from '@moxxy/client-core';

// ---- Types ---------------------------------------------------------------

export interface LatestBlock {
  readonly who: 'user' | 'assistant';
  readonly text: string;
}

// ---- Snapshot reading ----------------------------------------------------

// Memo of the last-returned block per workspace. `useSyncExternalStore` calls
// getSnapshot multiple times per commit and compares by reference, so this MUST
// return a stable reference while the visible line is unchanged. It's a memo
// (recomputable, never authoritative), and bounded by a small LRU so a long
// session across many workspaces can't grow it without bound — Map preserves
// insertion order, so re-inserting the most-recently-read key keeps it newest.
const LATEST_BLOCK_CACHE_MAX = 64;
const latestBlockCache = new Map<string, { key: string; block: LatestBlock }>();

function readLatestBlock(workspaceId: string | null): LatestBlock | null {
  if (!workspaceId) return null;
  const snap = chatStore.getChat(workspaceId);
  // Live assistant text (still streaming) wins — it's the freshest line.
  const candidate = latestLineFromSnapshot(snap);
  if (!candidate) {
    if (latestBlockCache.has(workspaceId)) latestBlockCache.delete(workspaceId);
    return null;
  }
  const key = `${candidate.who}:${candidate.text.length}:${candidate.text.slice(0, 64)}`;
  const cached = latestBlockCache.get(workspaceId);
  if (cached?.key === key) {
    // Touch for LRU recency while preserving the stable reference.
    if (latestBlockCache.size > 1) {
      latestBlockCache.delete(workspaceId);
      latestBlockCache.set(workspaceId, cached);
    }
    return cached.block;
  }
  latestBlockCache.set(workspaceId, { key, block: candidate });
  // Evict the least-recently-used entries (front of insertion order) once over
  // the cap. The just-written key is newest, so it's never the victim.
  while (latestBlockCache.size > LATEST_BLOCK_CACHE_MAX) {
    const oldest = latestBlockCache.keys().next().value;
    if (oldest === undefined) break;
    latestBlockCache.delete(oldest);
  }
  return candidate;
}

function latestLineFromSnapshot(snap: {
  readonly events: ReadonlyArray<MoxxyEvent>;
  readonly streamingText: string;
}): LatestBlock | null {
  if (snap.streamingText.trim()) return { who: 'assistant', text: snap.streamingText };
  for (let i = snap.events.length - 1; i >= 0; i--) {
    const e = snap.events[i]!;
    if (e.type === 'assistant_message' && e.content.trim()) {
      return { who: 'assistant', text: e.content };
    }
    if (e.type === 'user_prompt' && e.text.trim()) {
      return { who: 'user', text: e.text };
    }
  }
  return null;
}

// ---- Hook ----------------------------------------------------------------

export function useLatestBlock(workspaceId: string | null): LatestBlock | null {
  return useSyncExternalStore(chatStore.subscribe, () =>
    readLatestBlock(workspaceId),
  );
}
