import { lastMessageText, type PreviewEvent } from '@/shell/workspace-sidebar/session-preview';
import type { Call } from './calls-for-attention';

/** A system banner shows about three lines; more is cut by the system mid-word. */
export const BANNER_BODY_LIMIT = 180;

const NO_ANSWER = 'Finished without an answer.';
const WAITING = 'Waiting for your decision.';

/** What the turn that just ended said: only the events after the last prompt. */
function answerLine(events: ReadonlyArray<PreviewEvent>): string | null {
  const lastPrompt = events.map((event) => event.type).lastIndexOf('user_prompt');
  return lastMessageText(events.slice(lastPrompt + 1));
}

function cut(line: string): string {
  return line.length <= BANNER_BODY_LIMIT ? line : `${line.slice(0, BANNER_BODY_LIMIT - 1).trimEnd()}…`;
}

/** The words of a system banner for a chat that wants the person back. */
export function bannerText({
  reason,
  name,
  events,
}: {
  readonly reason: Call['reason'];
  /** The chat's name, as the run list shows it. */
  readonly name: string;
  /** The chat's events as loaded in this window; empty when it is not loaded. */
  readonly events: ReadonlyArray<PreviewEvent>;
}): { readonly title: string; readonly body: string } {
  if (reason === 'asked') return { title: name, body: WAITING };
  return { title: name, body: cut(answerLine(events) ?? NO_ANSWER) };
}
