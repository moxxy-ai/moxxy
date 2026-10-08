/**
 * The composer's slash menu wired to its field: when it is open, which row is
 * highlighted, the keys it takes before the composer, and what a pick or a
 * slash line typed in full does. What it offers is `slash-commands.ts`.
 */

import { useEffect, useMemo, useState } from 'react';
import type { CommandInfo } from '../../command-palette/types';
import type { MentionKey } from '../useComposerMentions';
import { slashInvocation, slashOptions, slashQuery, type SlashOption, type SlashSource } from './slash-commands';
import { useSlashWorkflows } from './useSlashWorkflows';

/** What a composer knows of its session; the menu reads the workflows itself. */
export type SlashSession = Omit<SlashSource, 'workflows'>;

/** What the composer does for a pick; the menu itself changes nothing. */
export interface SlashHandlers {
  readonly setMode: (mode: string) => void;
  /** Switch to `mode`, then send `prompt` in it. */
  readonly startIn: (mode: string, prompt: string) => void;
  readonly armGoal: () => void;
  readonly toggleAutoApprove: () => void;
  readonly runCommand: (command: CommandInfo, args: string) => void;
}

export interface SlashMenu {
  readonly open: boolean;
  readonly options: ReadonlyArray<SlashOption>;
  readonly active: number;
  /** Does what the option (the highlighted one by default) stands for. */
  pick(index?: number): void;
  /** Handles a key the open menu takes (arrows, Enter/Tab, Escape); true when the composer must not handle it. */
  handleKey(event: MentionKey): boolean;
  /** Runs a slash line typed in full (`/goal ship it`); true when the draft was one. */
  submit(): boolean;
}

export function useSlashMenu(
  session: SlashSession,
  draft: string,
  setDraft: (text: string) => void,
  handlers: SlashHandlers,
): SlashMenu {
  const query = slashQuery(draft);
  const workflows = useSlashWorkflows(query !== null);
  const source = useMemo((): SlashSource => ({ ...session, workflows }), [session, workflows]);
  const options = useMemo(() => (query === null ? [] : slashOptions(source, query)), [source, query]);
  const [dismissed, setDismissed] = useState(false);
  const [highlight, setHighlight] = useState({ query: '', index: 0 });
  // Escape closes the menu for one slash word: once it is gone, a slash typed anew opens it again.
  useEffect(() => {
    if (query === null) setDismissed(false);
  }, [query]);

  const open = query !== null && options.length > 0 && !dismissed;
  // Typing more narrows the list, so the highlight goes back to its top.
  const active = highlight.query === query ? Math.min(highlight.index, options.length - 1) : 0;

  /** What an option does, with the words typed after it (none when it was picked from the menu). */
  const run = (option: SlashOption, rest: string): void => {
    const { action } = option;
    if (action.kind === 'skill') {
      setDraft(`@${action.token} `);
      return;
    }
    setDraft('');
    if (action.kind === 'mode') {
      if (rest) handlers.startIn(action.mode, rest);
      else handlers.setMode(action.mode);
    } else if (action.kind === 'goal') {
      if (rest) handlers.startIn('goal', rest);
      else handlers.armGoal();
    } else if (action.kind === 'auto-approve') {
      handlers.toggleAutoApprove();
    } else if (action.kind === 'workflow') {
      handlers.runCommand(action.command, `run ${action.name}`);
    } else {
      handlers.runCommand(action.command, rest);
    }
  };

  const pick = (index = active): void => {
    const option = options[index];
    if (!option || option.disabled) return;
    run(option, '');
  };

  const handleKey = (event: MentionKey): boolean => {
    if (!open || event.nativeEvent.isComposing) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setHighlight({ query: query ?? '', index: (active + step + options.length) % options.length });
      return true;
    }
    if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
      event.preventDefault();
      pick();
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setDismissed(true);
      return true;
    }
    return false;
  };

  const submit = (): boolean => {
    const typed = slashInvocation(draft, source);
    if (!typed) return false;
    // A mode cannot change under a running turn: the line stays for when it can.
    if (!typed.option.disabled) run(typed.option, typed.rest);
    return true;
  };

  return { open, options, active, pick, handleKey, submit };
}
