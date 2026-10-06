import type { MoxxyEvent } from './events.js';
import type { ModeContext } from './mode.js';
import type { TurnCheckpoint } from './mode/checkpoint.js';

/**
 * What a tool result says about the thing it looked at: `key` names it (a
 * browser tab, a job), `pending` says what was still under way there, or null
 * when nothing was. A result that knows nothing about it leaves `progress` out.
 */
export interface Progress {
  readonly key: string;
  readonly pending: string | null;
}

export function progressOf(output: unknown): Progress | null {
  if (typeof output !== 'object' || output === null) return null;
  const progress = (output as { progress?: unknown }).progress;
  if (typeof progress !== 'object' || progress === null) return null;
  const { key, pending } = progress as { key?: unknown; pending?: unknown };
  if (typeof key !== 'string') return null;
  return { key, pending: typeof pending === 'string' ? pending : null };
}

/** What was still under way the last time each thing was looked at, in `events`. */
export function unfinishedWork(events: ReadonlyArray<MoxxyEvent>): string[] {
  const latest = new Map<string, string | null>();
  for (const e of events) {
    if (e.type !== 'tool_result' || !e.ok) continue;
    const progress = progressOf(e.output);
    if (progress) latest.set(progress.key, progress.pending);
  }
  return [...latest.values()].filter((pending): pending is string => pending !== null);
}

export function unfinishedWorkNudge(pending: ReadonlyArray<string>): string {
  return (
    `Before you report: the last time you looked, this was still in progress — ${pending.join('; ')}. ` +
    'What it leads to is not known yet, and anything you checked before it may no longer hold. ' +
    'Wait for it to finish (with a tool’s own wait, if it has one), look again, and report what you see then. ' +
    'If it does not finish, say plainly that it has not.'
  );
}

const turnOf = (ctx: ModeContext): string => `${ctx.sessionId}/${ctx.turnId}`;

/** Turns already asked, so one turn is asked at most once. Bounded: oldest go first. */
const MAX_REMEMBERED_TURNS = 256;

/**
 * At the end of a turn, one reminder when the last look at something found
 * work still under way. The report is then based on a state that has not
 * settled — the agent pressed Deploy and reported the address from a check
 * made before it. Asked once per turn: the agent may well have good reason to
 * report anyway, and it is told how to say so.
 */
export function unfinishedWorkCheckpoint(): TurnCheckpoint {
  const asked = new Set<string>();
  return {
    name: 'unfinished-work',
    applies: (ctx: ModeContext) =>
      !asked.has(turnOf(ctx)) && unfinishedWork(ctx.log.byTurn(ctx.turnId)).length > 0,
    async run(_check, ctx: ModeContext) {
      const pending = unfinishedWork(ctx.log.byTurn(ctx.turnId));
      if (pending.length === 0) return { action: 'pass' };
      asked.add(turnOf(ctx));
      for (const oldest of asked) {
        if (asked.size <= MAX_REMEMBERED_TURNS) break;
        asked.delete(oldest);
      }
      return { action: 'inject', text: unfinishedWorkNudge(pending), volatile: true };
    },
  };
}
