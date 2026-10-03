/**
 * The chat's @ menu: while the caret is in an @ word, the skills that answer it
 * (Computer Use, Moxxy Browser, …), a highlighted one, and the draft with a pick
 * put in. DOM-free so the desktop composer and the mobile one share it; what a
 * mention does is decided by the runner when the prompt arrives, not here.
 */

import { useEffect, useMemo, useState } from 'react';
import type { SkillInfo } from '@moxxy/sdk';
// The subpath, not the barrel: the barrel reaches node-only modules a renderer cannot bundle.
import { insertMention, mentionOptions, mentionQueryAt, type MentionOption } from '@moxxy/sdk/skill-mentions';

export type { MentionOption } from '@moxxy/sdk/skill-mentions';

export interface MentionPicker {
  readonly open: boolean;
  readonly options: ReadonlyArray<MentionOption>;
  readonly active: number;
  /** Moves the highlight, wrapping around the list. */
  move(delta: 1 | -1): void;
  /** The draft with the option (the highlighted one by default) put in, or null when the menu has nothing. */
  pick(index?: number): { text: string; caret: number } | null;
  /** Closes the menu until another @ word is started. */
  dismiss(): void;
}

export function useMentionPicker(
  skills: ReadonlyArray<SkillInfo> | undefined,
  draft: string,
  caret: number,
): MentionPicker {
  const query = useMemo(() => mentionQueryAt(draft, caret), [draft, caret]);
  const options = useMemo(
    () => (query && skills ? mentionOptions(skills, query.query) : []),
    [query, skills],
  );
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [highlight, setHighlight] = useState({ query: '', index: 0 });
  // Escape closes the menu for one @ word: once the caret has left it, an @ typed anew opens it again.
  useEffect(() => {
    if (query === null) setDismissedAt(null);
  }, [query]);

  const open = query !== null && options.length > 0 && dismissedAt !== query.start;
  // Typing more narrows the list, so the highlight goes back to its top.
  const active = query && highlight.query === query.query ? Math.min(highlight.index, options.length - 1) : 0;

  return {
    open,
    options,
    active,
    move: (delta) => {
      if (!query || options.length === 0) return;
      setHighlight({ query: query.query, index: (active + delta + options.length) % options.length });
    },
    pick: (index = active) => {
      const option = options[index];
      if (!query || !option) return null;
      return insertMention(draft, query, option.token);
    },
    dismiss: () => {
      if (query) setDismissedAt(query.start);
    },
  };
}
