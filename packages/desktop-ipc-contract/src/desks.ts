// ---------- Desks ---------------------------------------------------------

/** One conversation under a desk. Each session is backed by its own
 *  runner process (the pool keys supervisors by session id) with its
 *  own sticky runner log (`~/.moxxy/sessions/<id>.jsonl`) and chat
 *  NDJSON mirror — switching sessions never tears the others down. */
export interface DeskSession {
  id: string;
  name: string;
  createdAt: number;
  cwd?: string;
  firstPrompt?: string | null;
  lastActivity?: string;
  eventCount?: number;
  provider?: string | null;
  model?: string | null;
  source?: 'desktop' | 'tui' | 'mobile' | 'cli' | 'slack';
}

export interface Desk {
  id: string;
  name: string;
  cwd: string;
  color: string;
  createdAt: number;
  /** Every conversation under this desk. Normal project desks always have >= 1
   *  session; the global Moxxy workspace may be empty before session sync.
   *  The default first project-session id equals the desk id (the v1 migration
   *  invariant that keeps pre-multi-session runner logs + chat mirrors
   *  resuming untouched). */
  sessions: DeskSession[];
  /** The session the desk foregrounds when it becomes active. */
  activeSessionId: string | null;
}

export interface DesksOverview {
  desks: Desk[];
  activeId: string | null;
}

/** `sessions.list` result — one desk's sessions + which one is active. */
export interface SessionsOverview {
  sessions: DeskSession[];
  activeSessionId: string | null;
}
