import { GOAL_PLACEHOLDER, modeMeta } from '../modes/mode-meta';

export interface ComposerPlaceholderState {
  readonly ready: boolean;
  readonly compacting: boolean;
  readonly goalArmed: boolean;
  readonly inFlight: boolean;
  readonly hasAttachments: boolean;
  readonly mode: string | null;
}

/** What the empty field says. It names the one thing that differs from an
 *  ordinary message: a lock, a goal, a queue, what the mode works on. One rule
 *  for the desktop composer and the focus window's. */
export function composerPlaceholder(state: ComposerPlaceholderState): string {
  if (state.compacting) return 'Compacting context…';
  if (!state.ready) return 'Waiting for runner…';
  if (state.goalArmed) return GOAL_PLACEHOLDER;
  if (state.inFlight) return 'Queue a follow-up…';
  if (state.hasAttachments) return 'Ask about the attached file…';
  return (state.mode !== null && modeMeta(state.mode).placeholder) || 'Message Moxxy…';
}
