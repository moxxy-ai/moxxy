import type { DeskSession } from '@moxxy/desktop-ipc-contract';
import { plainLine } from '@/lib/plain-line';

/** The part of a chat event a preview reads. */
export interface PreviewEvent {
  readonly type: string;
  readonly text?: unknown;
  readonly content?: unknown;
}

const EMPTY_RUN = 'No messages yet';

/** The last thing either side said. Tool activity is not a message. */
export function lastMessageText(events: ReadonlyArray<PreviewEvent>): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event) continue;
    const raw =
      event.type === 'assistant_message'
        ? event.content
        : event.type === 'user_prompt'
          ? event.text
          : null;
    if (typeof raw === 'string' && raw.trim().length > 0) return plainLine(raw);
  }
  return null;
}

/**
 * The second line of a run row.
 *
 * `latest` is the newest message when the conversation is loaded in this
 * window. The session list itself carries only the first prompt, which is
 * already the name of a run nobody renamed; repeating it would say nothing.
 */
export function sessionPreview(session: DeskSession, latest: string | null): string | null {
  if (latest && latest.trim().length > 0) return plainLine(latest);
  const first = session.firstPrompt ? plainLine(session.firstPrompt) : '';
  if (first.length > 0) {
    const title = session.name.replace(/…$/, '').trim();
    if (!first.startsWith(title)) return first;
  } else if (session.eventCount === 0) {
    return EMPTY_RUN;
  }
  return session.model ?? null;
}
