import type { MoxxyEvent } from './events.js';
import type { ModeContext } from './mode.js';
import type { TurnCheckpoint } from './mode/checkpoint.js';

/**
 * What a tool result says it was asked to do and did not get done: `what`
 * names the step and why, `unverified` marks a step that was delivered though
 * its effect was not seen. A result that got everything done leaves
 * `shortfall` out, and so does one stopped by a refusal — that is the user's
 * answer, not a step left to finish.
 */
export interface Shortfall {
  readonly what: string;
  readonly unverified?: boolean;
}

export function shortfallOf(output: unknown): Shortfall | null {
  if (typeof output !== 'object' || output === null) return null;
  const shortfall = (output as { shortfall?: unknown }).shortfall;
  if (typeof shortfall !== 'object' || shortfall === null) return null;
  const { what, unverified } = shortfall as { what?: unknown; unverified?: unknown };
  if (typeof what !== 'string' || what.trim() === '') return null;
  return { what, ...(unverified === true ? { unverified: true } : {}) };
}

/**
 * The step `events` ended on, when it did not get done. Any step after it
 * settles it — another route that worked, a hand-over to the user, a look at
 * the result — and an error, a refusal or a cancel is not one: those say
 * nothing of a step left to finish.
 */
export function openShortfall(events: ReadonlyArray<MoxxyEvent>): Shortfall | null {
  const last = events.findLast((e) => e.type === 'tool_result');
  if (last?.type !== 'tool_result' || !last.ok) return null;
  return shortfallOf(last.output);
}

export function shortfallNudge(shortfall: Shortfall): string {
  const next = shortfall.unverified
    ? 'It was delivered, so first read the page or window to see whether it took effect. ' +
      'If it shows that it did not — an error, a "try again" — do the step again. ' +
      'If it may have gone through (a send, a payment, a tick), do not repeat it blind. '
    : 'Try it again where the error or the page invites that, or go another way: a different element, tool or route. ';
  return (
    `Before you report: your last step did not get done — ${shortfall.what}. ` +
    'If what the user asked for is not done yet and there is still a way to get there, take it now. ' +
    next +
    'If the user has to do something themselves (sign in, solve a CAPTCHA, decide, grant access), or nothing is left to try, ' +
    'say plainly what stops you — and do not work around a refusal.'
  );
}

const NAME = 'unfinished-step';

/** Whether this turn was already reminded: read from its log, so a resumed turn is not asked twice. */
const reminded = (events: ReadonlyArray<MoxxyEvent>): boolean =>
  events.some(
    (e) =>
      e.type === 'plugin_event' &&
      e.subtype === 'checkpoint_injected' &&
      (e.payload as { name?: unknown } | null)?.name === NAME,
  );

/**
 * At the end of a turn, one reminder when the turn ended on a step that did
 * not get done. In a form trial the agent pressed Send, the page answered
 * "503, try again", and the agent reported that it could not send. Asked once
 * per turn: the agent may be right that nothing is left to try, and it is told
 * how to say so. Off with `unfinishedStepCheck: false`.
 */
export function unfinishedStepCheckpoint(): TurnCheckpoint {
  const due = (ctx: ModeContext): Shortfall | null => {
    if (ctx.unfinishedStepCheck === false) return null;
    const events = ctx.log.byTurn(ctx.turnId);
    return reminded(events) ? null : openShortfall(events);
  };
  return {
    name: NAME,
    applies: (ctx: ModeContext) => due(ctx) !== null,
    async run(check, ctx: ModeContext) {
      const shortfall = check.signal.aborted ? null : due(ctx);
      if (!shortfall) return { action: 'pass' };
      return { action: 'inject', text: shortfallNudge(shortfall), volatile: true };
    },
  };
}
