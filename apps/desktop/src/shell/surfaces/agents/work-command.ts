import type { MoxxyEvent } from '@moxxy/sdk';

/**
 * The command a background work ran, read from the call that started it: the
 * agent names the work by the call's description (or by the command itself),
 * and a later start of the same work wins. Null when no call matches, so the
 * pane never offers a command it only guessed.
 */
export function commandOf(events: ReadonlyArray<MoxxyEvent>, label: string): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type !== 'tool_call_requested') continue;
    const input = (event.input ?? {}) as Record<string, unknown>;
    if (input.run_in_background !== true || typeof input.command !== 'string') continue;
    if (input.description === label || input.command === label) return input.command;
  }
  return null;
}
