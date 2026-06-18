/**
 * The collaboration BRIEF — a compact, token-efficient digest of the user's
 * conversation that the coordinator writes into the scaffold (`.moxxy-collab/
 * BRIEF.md`) so EVERY spawned agent inherits the overall goal + intent, not just
 * its one-line subtask. Without it, peers boot fresh sessions that have never
 * seen the dialogue, clarifications, or constraints that produced the task.
 *
 * Kept a pure function over the event log so it is unit-testable and cheap: it
 * distills (not dumps) — the most recent turns, each clipped — to stay well
 * under a few KB regardless of how long the conversation ran.
 */

/** How many recent user/assistant turns to include. */
const MAX_TURNS = 12;
/** Per-message clip (chars) — enough to convey intent, not the whole turn. */
const MAX_MSG_CHARS = 600;
/** Overall cap (chars) so a huge conversation still yields a small brief. */
const MAX_TOTAL_CHARS = 6000;

interface DigestTurn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

function clip(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Pull the user/assistant turns out of the raw event log, in order. */
export function digestTurns(events: ReadonlyArray<unknown>): DigestTurn[] {
  const out: DigestTurn[] = [];
  for (const raw of events) {
    const e = raw as { type?: string; text?: string; content?: string; source?: string };
    if (e.type === 'user_prompt' && typeof e.text === 'string' && e.text.trim()) {
      out.push({ role: 'user', text: e.text });
    } else if (
      e.type === 'assistant_message' &&
      e.source === 'model' &&
      typeof e.content === 'string' &&
      e.content.trim()
    ) {
      out.push({ role: 'assistant', text: e.content });
    }
  }
  return out;
}

/**
 * Build the markdown brief. `task` is the headline goal (the last user prompt);
 * `events` is the coordinator's event log (`ctx.log.slice()`). The result is the
 * goal plus the tail of the conversation, clipped and total-capped.
 */
export function buildBrief(task: string, events: ReadonlyArray<unknown>): string {
  const turns = digestTurns(events);
  // The headline goal is already `task`; avoid repeating the identical last user
  // turn in the conversation section.
  const trimmed =
    turns.length > 0 && turns[turns.length - 1]!.role === 'user' && turns[turns.length - 1]!.text.trim() === task.trim()
      ? turns.slice(0, -1)
      : turns;
  const recent = trimmed.slice(-MAX_TURNS);

  const lines: string[] = [
    '# Collaboration brief',
    '',
    'This is the shared context for the whole team. It is the user\'s goal and the',
    'conversation that led to it — read it before planning so your work fits the',
    'real intent, not just your narrow sub-task.',
    '',
    '## Goal',
    '',
    clip(task, 1500) || '(no goal text)',
  ];

  if (recent.length > 0) {
    lines.push('', '## Conversation so far', '');
    for (const t of recent) {
      const who = t.role === 'user' ? 'User' : 'Assistant';
      lines.push(`- **${who}:** ${clip(t.text, MAX_MSG_CHARS)}`);
    }
  }

  let brief = lines.join('\n');
  if (brief.length > MAX_TOTAL_CHARS) {
    brief = `${brief.slice(0, MAX_TOTAL_CHARS - 1)}…`;
  }
  return `${brief}\n`;
}
