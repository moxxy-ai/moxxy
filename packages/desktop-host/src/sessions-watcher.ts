/**
 * Live workspace sync. The per-session metadata files (`~/.moxxy/sessions/
 * <id>.json`) are the single source of truth; a runner PROCESS updates its own
 * file as a conversation progresses (first prompt → title, etc.). This watcher
 * pushes a debounced `desks.changed` to every surface (desktop windows + mobile
 * over the WS bridge) whenever a change actually affects the sidebar — so a
 * title/first-prompt/new-session/deletion shows live, not just on the next CRUD.
 *
 * Best-effort: if the directory can't be watched the app simply falls back to
 * refresh-on-CRUD. A sidebar-projection diff suppresses the per-event churn
 * (lastActivity/eventCount tick on every streamed chunk) so an active turn
 * doesn't fan out a broadcast every debounce window.
 */

import { mkdirSync, watch, type FSWatcher } from 'node:fs';

import { defaultSessionsDir } from '@moxxy/core';
import type { DesksOverview } from '@moxxy/desktop-ipc-contract';

import type { DeskStore } from './desks';
import { broadcastHostEvent } from './event-bus';

/** The sidebar-relevant slice of an overview — what a desks.changed needs to
 *  reflect. Ignores per-event fields (lastActivity, eventCount) so streaming a
 *  turn doesn't trigger a broadcast on every chunk. */
function sidebarProjection(overview: DesksOverview): string {
  return JSON.stringify({
    activeId: overview.activeId,
    desks: overview.desks.map((d) => ({
      id: d.id,
      name: d.name,
      color: d.color,
      activeSessionId: d.activeSessionId,
      sessions: d.sessions.map((s) => [s.id, s.name]),
    })),
  });
}

export function watchSessionsForChanges(desks: DeskStore, debounceMs = 400): () => void {
  const dir = defaultSessionsDir();
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* a watch failure below just degrades to refresh-on-CRUD */
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastProjection: string | null = null;
  let watcher: FSWatcher | null = null;

  const fire = (): void => {
    timer = null;
    void desks
      .overview()
      .then((overview) => {
        const projection = sidebarProjection(overview);
        if (projection === lastProjection) return;
        lastProjection = projection;
        broadcastHostEvent('desks.changed', overview);
      })
      .catch(() => undefined);
  };

  try {
    watcher = watch(dir, { persistent: false }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, debounceMs);
      timer.unref?.();
    });
  } catch {
    return () => undefined;
  }

  return () => {
    if (timer) clearTimeout(timer);
    watcher?.close();
  };
}
