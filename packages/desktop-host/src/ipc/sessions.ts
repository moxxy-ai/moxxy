/**
 * Multi-session commands — multiple conversations per desk.
 *
 * The {@link DeskStore} owns the persisted session registry (which
 * sessions exist under which desk + which is active); these handlers
 * keep the {@link RunnerPool} in step. The pool is keyed by SESSION id:
 * every session runs its own supervised `moxxy serve` whose sticky
 * MOXXY_SESSION_ID is the session id, so each conversation persists to
 * its own `~/.moxxy/sessions/<sessionId>.jsonl` and streams events
 * tagged with its own workspace-routing key. Switching sessions never
 * tears the others down — same model as switching desks.
 *
 * `session.newSession` (the `/new` reset of the CURRENT session) is
 * unchanged and lives in ./session.ts; `sessions.create` ADDS a
 * conversation instead.
 */

import { deleteSession } from '@moxxy/core';

import type { RunnerPool } from '../runner-pool';
import { cwdForSession, type DeskStore } from '../desks';
import { broadcastHostEvent } from '../event-bus';
import { withSessionTitles, withSessionTitlesOverview } from '../session-titles';
import { handle } from './shared';

export function registerSessionsHandlers(pool: RunnerPool, desks: DeskStore): void {
  // ---- Sessions (per-desk conversations) -----------------------------------

  // Same derived-title pass as desks.list (auto-named sessions display
  // their first prompt) — this handler also serves mobile over the WS bridge.
  handle('sessions.list', async (args) =>
    withSessionTitlesOverview(await desks.listSessions(args?.deskId)),
  );

  handle('sessions.create', async (args) => {
    const { desk, session } = await desks.createSession(args?.deskId, args?.name);
    // Spawn the session's runner eagerly so a follow-up setActive (the usual
    // next call from the UI) foregrounds an already-connecting supervisor.
    await pool.getOrCreate(session.id, cwdForSession(desk, session.id));
    await broadcastDesksChanged(desks);
    return session;
  });

  handle('sessions.setActive', async ({ id }) => {
    // Persist first (also makes the owning desk the active desk), then make
    // sure a runner exists before pointing the pool at it — pool.setActive
    // throws on unknown ids.
    const desk = await desks.setActiveSession(id);
    await pool.getOrCreate(id, cwdForSession(desk, id));
    pool.setActive(id);
    await broadcastDesksChanged(desks);
  });

  handle('sessions.remove', async ({ id }) => {
    // Drop it from the registry first (this also seeds a fresh replacement
    // when it was the desk's last session), then tear down + erase its
    // on-disk state: the runner's sticky session log (else the conversation
    // would resurrect if the id were ever reused).
    const desk = await desks.removeSession(id);
    await pool.remove(id);
    try {
      await deleteSession(id);
    } catch {
      // Best-effort: a missing file just means there was nothing to clear.
    }
    if (!desk) return;
    // If the removed session belonged to the ACTIVE desk, foreground the
    // desk's (possibly freshly-seeded) active session so the user never
    // lands on a dead pool id — pool.remove promotes an arbitrary entry.
    const active = await desks.getActive();
    if (active && active.id === desk.id) {
      if (desk.activeSessionId) {
        await pool.getOrCreate(desk.activeSessionId, cwdForSession(desk, desk.activeSessionId));
        pool.setActive(desk.activeSessionId);
      }
    }
    await broadcastDesksChanged(desks);
  });

  handle('sessions.rename', async ({ id, name }) => {
    const renamed = await desks.renameSession(id, name);
    await broadcastDesksChanged(desks);
    return renamed;
  });
}

async function broadcastDesksChanged(desks: DeskStore): Promise<void> {
  const list = await desks.list();
  const active = await desks.getActive();
  broadcastHostEvent('desks.changed', {
    desks: await withSessionTitles(list),
    activeId: active?.id ?? null,
  });
}
