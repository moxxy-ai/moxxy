/**
 * Desk (workspace) CRUD.
 *
 * Persistence lives in the {@link DeskStore}; these handlers also keep
 * the {@link RunnerPool} in step — creating / switching a desk spins up
 * or foregrounds its supervisor, and removing one tears its runner
 * down (then ensures *some* runner stays alive for the next active
 * desk). The native folder picker rounds out the create flow.
 */

import { dialog, BrowserWindow as BrowserWindowApi } from 'electron';

import type { RunnerPool } from '../runner-pool';
import { cwdForSession, type DeskStore } from '../desks';
import { broadcastHostEvent } from '../event-bus';
import { withSessionTitles } from '../session-titles';
import { handle } from './shared';

export function registerDesksHandlers(pool: RunnerPool, desks: DeskStore): void {
  // ---- Desks --------------------------------------------------------------

  handle('desks.list', async () => {
    const list = await desks.list();
    const active = await desks.getActive();
    // Auto-named sessions ("Session N") are displayed under their first
    // prompt — derived here at list time, never written back (see
    // ../session-titles).
    return { desks: await withSessionTitles(list), activeId: active?.id ?? null };
  });
  handle('desks.create', async ({ name, cwd }) => {
    const created = await desks.create({ name, cwd });
    await broadcastDesksChanged(desks);
    return created;
  });
  handle('desks.remove', async ({ id }) => {
    // The pool is keyed by SESSION id (a desk can hold several), so tear down
    // every one of the removed desk's session runners — not just one entry.
    const removed = await desks.remove(id);
    for (const session of removed?.sessions ?? []) {
      await pool.remove(session.id);
    }
    // Defensive: also drop a pool entry keyed by the bare desk id (the
    // pre-multi-session key; normally identical to the first session's id).
    await pool.remove(id);
    const active = await desks.getActive();
    if (active?.activeSessionId) {
      await pool.getOrCreate(active.activeSessionId, cwdForSession(active, active.activeSessionId));
    }
    await broadcastDesksChanged(desks);
  });
  handle('desks.setActive', async ({ id }) => {
    await desks.setActive(id);
    const active = await desks.getActive();
    if (active?.activeSessionId) {
      // Foreground the desk's ACTIVE SESSION — the pool key is a session id.
      await pool.getOrCreate(active.activeSessionId, cwdForSession(active, active.activeSessionId));
      pool.setActive(active.activeSessionId);
    }
    await broadcastDesksChanged(desks);
  });
  handle('desks.rename', async ({ id, name }) => {
    const renamed = await desks.rename(id, name);
    await broadcastDesksChanged(desks);
    return renamed;
  });
  handle('desks.pickFolder', async () => {
    const window =
      BrowserWindowApi.getFocusedWindow() ?? BrowserWindowApi.getAllWindows()[0];
    const opts: Electron.OpenDialogOptions = {
      title: 'Bind a desk to a folder',
      properties: ['openDirectory', 'createDirectory'],
    };
    // Use the honest parentless overload when no window exists rather than
    // coercing an intentionally-null value with `null!`.
    const result = window
      ? await dialog.showOpenDialog(window, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0]!;
  });
}

async function broadcastDesksChanged(desks: DeskStore): Promise<void> {
  const list = await desks.list();
  const active = await desks.getActive();
  broadcastHostEvent('desks.changed', { desks: list, activeId: active?.id ?? null });
}
