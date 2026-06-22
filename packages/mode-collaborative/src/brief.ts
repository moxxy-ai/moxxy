/**
 * The collaboration BRIEF + the full-conversation recall file.
 *
 * BRIEF.md is a CONCISE summary (goal + key requirements/constraints/decisions)
 * that every spawned agent reads up front — NOT the raw transcript, so the N
 * peers don't each re-ingest the whole dialogue. The summary is normally written
 * by a single coordinator LLM call (`summarize.ts`); `heuristicSummary` here is
 * the deterministic fallback when no provider is available.
 *
 * CONVERSATION.md holds the full (clipped) transcript for ON-DEMAND recall — it
 * is never loaded into an agent's context by default; an agent reads or greps it
 * only when it needs a detail the summary omits.
 *
 * Pure functions over the event log, so they stay cheap + unit-testable.
 */

/** Heuristic-summary window (the fallback brief): recent turns, clipped, capped. */
const MAX_TURNS = 12;
const MAX_MSG_CHARS = 600;
const MAX_TOTAL_CHARS = 6000;

/** The recall file is allowed to be much bigger (it's read on demand, not in context). */
const CONVERSATION_MSG_CHARS = 1200;
const CONVERSATION_TOTAL_CHARS = 48_000;

/** Guard on the (already-small) summary embedded into BRIEF.md. */
const SUMMARY_GUARD_CHARS = 4000;

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

/** Drop the trailing user turn when it's identical to the goal headline. */
function withoutGoalTail(turns: DigestTurn[], task: string): DigestTurn[] {
  const last = turns[turns.length - 1];
  return turns.length > 0 && last!.role === 'user' && last!.text.trim() === task.trim()
    ? turns.slice(0, -1)
    : turns;
}

/**
 * The BRIEF.md document: the goal + a concise SUMMARY (produced upstream). It no
 * longer carries the raw conversation — that's CONVERSATION.md.
 */
export function buildBrief(task: string, summary: string): string {
  const lines = [
    '# Collaboration brief',
    '',
    "This is the team's shared brief — the goal and the key requirements,",
    "constraints, and decisions distilled from the user's conversation. The full",
    'transcript is NOT in your context; if you need a specific detail this summary',
    'omits, read or grep `.moxxy-collab/CONVERSATION.md` (do not load it wholesale).',
    '',
    '## Goal',
    '',
    clip(task, 1500) || '(no goal text)',
    '',
    '## Summary',
    '',
    clip(summary, SUMMARY_GUARD_CHARS) || '(no summary available)',
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * The deterministic fallback summary (used when the LLM summarizer is
 * unavailable): the most recent turns, clipped + capped. Returned as the
 * `summary` argument to {@link buildBrief}.
 */
export function heuristicSummary(task: string, events: ReadonlyArray<unknown>): string {
  const recent = withoutGoalTail(digestTurns(events), task).slice(-MAX_TURNS);
  if (recent.length === 0) return '(no prior conversation to summarize)';
  const lines = ['(heuristic summary — LLM summarizer unavailable; recent turns:)'];
  for (const t of recent) {
    lines.push(`- **${t.role === 'user' ? 'User' : 'Assistant'}:** ${clip(t.text, MAX_MSG_CHARS)}`);
  }
  let body = lines.join('\n');
  if (body.length > MAX_TOTAL_CHARS) body = `${body.slice(0, MAX_TOTAL_CHARS - 1)}…`;
  return body;
}

/**
 * The CONVERSATION.md recall file: the full (clipped) transcript. Generous caps
 * because it's read on demand, never auto-loaded into an agent's context.
 */
export function buildConversation(task: string, events: ReadonlyArray<unknown>): string {
  const turns = digestTurns(events);
  const lines = [
    '# Full conversation (recall-only)',
    '',
    'Not loaded into any agent by default. Read or grep this only when you need a',
    'specific detail the brief summary omits.',
    '',
    '## Goal',
    '',
    clip(task, 1500) || '(no goal text)',
    '',
    '## Conversation',
    '',
  ];
  if (turns.length === 0) {
    lines.push('(no prior conversation)');
  } else {
    for (const t of turns) {
      lines.push(`- **${t.role === 'user' ? 'User' : 'Assistant'}:** ${clip(t.text, CONVERSATION_MSG_CHARS)}`);
    }
  }
  let body = lines.join('\n');
  if (body.length > CONVERSATION_TOTAL_CHARS) body = `${body.slice(0, CONVERSATION_TOTAL_CHARS - 1)}…`;
  return `${body}\n`;
}
