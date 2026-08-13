import type { Desk } from '@moxxy/desktop-ipc-contract';

/**
 * Filter the workspace tree by a free-text query.
 *
 * Matching is deliberately generous about WHERE it looks and strict about what
 * survives:
 *
 *   - a workspace matches on its name or its path, because "which of my six
 *     checkouts is this" is usually answered by the path;
 *   - a session matches on its name;
 *   - a workspace that matches KEEPS ALL its sessions (you asked for the
 *     workspace, so you want what is in it), while a workspace that does not
 *     match keeps only the sessions that do, and disappears if none do.
 *
 * That last rule is the whole point. A filter that dropped the non-matching
 * sessions of a matching workspace would answer a different question than the one
 * typed, and one that kept every workspace would not be a filter.
 */
export function filterDesks(desks: ReadonlyArray<Desk>, query: string): ReadonlyArray<Desk> {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return desks;
  const out: Desk[] = [];
  for (const desk of desks) {
    const deskHit =
      desk.name.toLowerCase().includes(q) || desk.cwd.toLowerCase().includes(q);
    if (deskHit) {
      out.push(desk);
      continue;
    }
    const sessions = desk.sessions.filter((s) => s.name.toLowerCase().includes(q));
    if (sessions.length > 0) out.push({ ...desk, sessions });
  }
  return out;
}
