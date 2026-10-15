import type { MoxxyEvent } from '@moxxy/sdk';
import { accountLimitInForce, recordedAccountLimit, type RecordedAccountLimit } from '@moxxy/sdk/agent-account-limit';

/**
 * The account limit of the conversation's active agent connection while it holds (near, or used
 * up until it resets), read from the log so every surface says the same.
 */
export function conversationAccountLimit(
  events: ReadonlyArray<MoxxyEvent>,
  activeProvider: string | null | undefined,
  nowMs: number,
): RecordedAccountLimit | undefined {
  if (!activeProvider) return undefined;
  return accountLimitInForce(recordedAccountLimit(events, activeProvider), nowMs);
}

/**
 * How much of its limit the conversation's active agent last said it used, for the model and
 * usage window: also a limit that is still fine, when it came with a number, until that window
 * resets.
 */
export function conversationAccountUsage(
  events: ReadonlyArray<MoxxyEvent>,
  activeProvider: string | null | undefined,
  nowMs: number,
): RecordedAccountLimit | undefined {
  if (!activeProvider) return undefined;
  const recorded = recordedAccountLimit(events, activeProvider);
  if (!recorded) return undefined;
  const { state, usedPercent, resetsAt } = recorded.limit;
  if (state === 'ok' && usedPercent === undefined) return undefined;
  return resetsAt !== undefined && resetsAt <= nowMs ? undefined : recorded;
}

/** "Claude's weekly limit is used up · resets Fri at 09:00", "Codex has used 80% of its 5-hour limit · resets at 18:00". */
export function accountLimitText(recorded: RecordedAccountLimit, nowMs: number): string {
  const { limit } = recorded;
  const agent = recorded.agent ?? 'The agent';
  const window = windowName(limit.windowMinutes);
  const resets = limit.resetsAt !== undefined ? ` · resets ${whenText(limit.resetsAt, nowMs)}` : '';
  if (limit.state === 'reached') return `${recorded.agent ? `${agent}'s` : "The agent's"} ${window} is used up${resets}`;
  if (limit.usedPercent === undefined) return `${agent} is close to its ${window}${resets}`;
  return `${agent} has used ${Math.round(limit.usedPercent)}% of its ${window}${resets}`;
}

function windowName(minutes: number | undefined): string {
  if (minutes === 300) return '5-hour limit';
  if (minutes === 10080) return 'weekly limit';
  return 'usage limit';
}

const DAY = 86_400_000;

/** "at 18:00" today, "tomorrow at 09:30", "Fri at 09:00" within a week, else "25 Oct at 09:00". */
function whenText(atMs: number, nowMs: number): string {
  const at = new Date(atMs);
  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const days = Math.round((startOfDay(atMs) - startOfDay(nowMs)) / DAY);
  if (days <= 0) return `at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days < 7) return `${at.toLocaleDateString('en-GB', { weekday: 'short' })} at ${time}`;
  return `${at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} at ${time}`;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
