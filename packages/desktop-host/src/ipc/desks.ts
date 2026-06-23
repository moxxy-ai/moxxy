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
import { handle } from './shared';

export function registerDesksHandlers(pool: RunnerPool, desks: DeskStore): void {
  // ---- Desks --------------------------------------------------------------

  // The registry derives the full session list (names, first prompts, …) from
  // the per-session files, so handlers return it as-is — no list-time title pass.
  handle('desks.list', async () => desks.overview());
  handle('desks.create', async ({ name, cwd }) => {
    const created = await desks.create({ name, cwd });
    await broadcastDesksChanged(desks);
    return created;
  });
  handle('desks.remove', async ({ id }) => {
    // Tear down every one of the desk's session runners BEFORE the registry
    // erases their files — a dying runner must not re-write a file we just
    // deleted (single-source: erasing the file IS the deletion, and it is what
    // makes the removal stick across a restart). The pool is keyed by SESSION id.
    const overview = await desks.listSessions(id);
    for (const session of overview.sessions) {
      await pool.remove(session.id);
    }
    // Defensive: also drop a pool entry keyed by the bare desk id (the
    // pre-multi-session key; normally identical to the first session's id).
    await pool.remove(id);
    await desks.remove(id);
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
  broadcastHostEvent('desks.changed', await desks.overview());
}
