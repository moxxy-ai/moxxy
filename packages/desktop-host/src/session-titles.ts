/**
 * Derived session titles — "name the conversation after its first prompt".
 *
 * The desk registry persists auto-generated names ("Session 1", "Session 2",
 * …) and user renames. The runner, independently, records the first 80 chars
 * of each session's first user prompt in its meta sidecar
 * (`~/.moxxy/sessions/<id>.meta.json`, written by @moxxy/core's
 * SessionPersistence). At LIST time the two meet: a session that still
 * carries an auto-generated name is displayed under its first prompt
 * instead. Display-only — nothing is written back, so:
 *
 *  - the title keeps tracking the session (e.g. `/new` resets the log +
 *    sidecar and the next first prompt re-titles it);
 *  - "Session N" numbering in the registry stays stable for `nextSessionName`;
 *  - a user rename (any name not matching the auto pattern) wins and is
 *    never overridden.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultSessionsDir } from '@moxxy/core';
import type { Desk, DeskSession, SessionsOverview } from '@moxxy/desktop-ipc-contract';

/** The registry's auto-generated names — the only ones we override. */
const AUTO_NAME = /^Session \d+$/;

/** Sidebar rows are narrow; the sidecar stores up to 80 chars. */
const MAX_TITLE = 48;

/** Squash a raw first prompt into a single-line, length-capped title.
 *  null when there is nothing usable (empty / whitespace-only). */
export function titleFromFirstPrompt(firstPrompt: unknown): string | null {
  if (typeof firstPrompt !== 'string') return null;
  const oneLine = firstPrompt.replace(/\s+/g, ' ').trim();
  if (!oneLine) return null;
  return oneLine.length > MAX_TITLE ? `${oneLine.slice(0, MAX_TITLE - 1).trimEnd()}…` : oneLine;
}

async function readFirstPrompt(sessionId: string, dir: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(dir, `${sessionId}.meta.json`), 'utf8');
    const parsed = JSON.parse(raw) as { firstPrompt?: unknown };
    return titleFromFirstPrompt(parsed.firstPrompt);
  } catch {
    // No sidecar yet (fresh session) or a corrupt one — keep the stored name.
    return null;
  }
}

async function withTitle(session: DeskSession, dir: string): Promise<DeskSession> {
  if (!AUTO_NAME.test(session.name)) return session;
  const title = await readFirstPrompt(session.id, dir);
  return title ? { ...session, name: title } : session;
}

/** Desks with every auto-named session re-titled from its first prompt. */
export async function withSessionTitles(
  desks: ReadonlyArray<Desk>,
  dir: string = defaultSessionsDir(),
): Promise<Desk[]> {
  return Promise.all(
    desks.map(async (desk) => ({
      ...desk,
      sessions: await Promise.all(desk.sessions.map((s) => withTitle(s, dir))),
    })),
  );
}

/** `sessions.list`-shaped variant of {@link withSessionTitles}. */
export async function withSessionTitlesOverview(
  overview: SessionsOverview,
  dir: string = defaultSessionsDir(),
): Promise<SessionsOverview> {
  return {
    ...overview,
    sessions: await Promise.all(overview.sessions.map((s) => withTitle(s, dir))),
  };
}
