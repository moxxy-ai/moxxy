import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@moxxy/client-core';
import type { BrowserCursor } from '@moxxy/desktop-ipc-contract';

/** The agent's pointer as the pane draws it; `press` counts marks, so each one rings anew. */
export interface AgentCursorView extends BrowserCursor {
  readonly press: number;
}

/**
 * The agent's pointer on the tab in front, from main's `browser.cursor` frames.
 *
 * Main holds each press until the pointer has arrived, so a glide is answered
 * once it ends (`arrived`, from the drawn pointer's transition) — and at once
 * whenever nothing is drawn: a hidden pointer, another tab, no distance to go.
 * Waiting on a picture nobody can see would only slow the agent down.
 */
export function useAgentCursor(
  tabId: string | null,
  shown: boolean,
): { cursor: AgentCursorView | null; arrived: () => void } {
  const [cursors, setCursors] = useState<ReadonlyMap<string, AgentCursorView>>(new Map());
  const pending = useRef<string | null>(null);
  const live = useRef({ tabId, shown });
  live.current = { tabId, shown };

  const confirm = useCallback((requestId: string) => {
    void api().invoke('browser.confirmCursor', { requestId }).catch(() => {});
  }, []);

  const arrived = useCallback(() => {
    const requestId = pending.current;
    pending.current = null;
    if (requestId) confirm(requestId);
  }, [confirm]);

  useEffect(() => {
    return api().subscribe('browser.cursor', ({ requestId, tabId: tab, cursor }) => {
      if (!cursor) {
        setCursors((prev) => without(prev, tab));
        return;
      }
      setCursors((prev) => {
        const before = prev.get(tab);
        const press = (before?.press ?? 0) + (cursor.phase === 'moving' ? 0 : 1);
        return new Map(prev).set(tab, { ...cursor, press });
      });
      if (cursor.phase !== 'moving') return;
      const drawn = live.current.shown && live.current.tabId === tab && cursor.durationMs > 0 && !stillMotion();
      if (!drawn) {
        confirm(requestId);
        return;
      }
      // A newer glide replaces an older one; the older one's wait is over.
      arrived();
      pending.current = requestId;
    });
  }, [arrived, confirm]);

  // A pointer that stops being drawn mid-glide — hidden, or its tab sent to the
  // back — will never report arriving.
  useEffect(() => arrived, [shown, tabId, arrived]);

  const cursor = shown && tabId ? (cursors.get(tabId) ?? null) : null;
  return { cursor, arrived };
}

/** With reduced motion the pointer jumps; there is no glide to wait for. */
function stillMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function without(map: ReadonlyMap<string, AgentCursorView>, key: string): ReadonlyMap<string, AgentCursorView> {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}
