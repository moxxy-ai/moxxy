/**
 * The runner the app starts with: the active workspace's active session, in
 * that session's folder. With no workspace picked yet (the first-run step was
 * skipped) that is the built-in Moxxy workspace — saved, brought to front and
 * given its folder — so the agent never works in whatever folder the app
 * process happened to start in.
 */

import { cwdForSession, type DeskStore } from './desks.js';
import { UNBOUND_ID } from './runner-pool.js';

export async function initialRunnerTarget(desks: DeskStore): Promise<{ id: string; cwd: string }> {
  const desk = (await desks.getActive()) ?? (await desks.ensureMoxxyWorkspace());
  // A workspace with no session yet keeps the unbound runner (its socket is the
  // one an external `moxxy tui` / attach finds), now in the workspace's folder.
  const id = desk.activeSessionId ?? UNBOUND_ID;
  return { id, cwd: cwdForSession(desk, desk.activeSessionId) };
}
