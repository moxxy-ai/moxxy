/**
 * The composer's @ menu wired to its textarea: where the caret is, the keys the
 * open menu takes before the composer, and a pick put into the draft with the
 * caret after it. What the menu offers is `useMentionPicker` (client-core).
 */

import { useState, type RefObject } from 'react';
import { useMentionPicker, type MentionOption } from '@moxxy/client-core';
import type { SkillInfo } from '@moxxy/sdk';

/** The part of a textarea key event the menu reads. */
export interface MentionKey {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly nativeEvent: { readonly isComposing: boolean };
  preventDefault(): void;
}

export interface ComposerMentions {
  readonly open: boolean;
  readonly options: ReadonlyArray<MentionOption>;
  readonly active: number;
  /** Puts the option (the highlighted one by default) into the draft. */
  pick(index?: number): void;
  /** Follows the caret, from the textarea's change and select events. */
  trackCaret(field: { readonly selectionStart: number }): void;
  /** Handles a key the open menu takes (arrows, Enter/Tab, Escape); true when the composer must not handle it. */
  handleKey(event: MentionKey): boolean;
}

export function useComposerMentions(
  skills: ReadonlyArray<SkillInfo> | undefined,
  draft: string,
  setDraft: (text: string) => void,
  textarea: RefObject<HTMLTextAreaElement | null>,
): ComposerMentions {
  const [caret, setCaret] = useState(0);
  const picker = useMentionPicker(skills, draft, caret);

  const pick = (index?: number): void => {
    const picked = picker.pick(index);
    if (!picked) return;
    setDraft(picked.text);
    setCaret(picked.caret);
    // The textarea gets its new value on the next render; the caret is placed after it.
    requestAnimationFrame(() => {
      const field = textarea.current;
      if (!field) return;
      field.focus();
      field.selectionStart = field.selectionEnd = picked.caret;
    });
  };

  const handleKey = (event: MentionKey): boolean => {
    if (!picker.open || event.nativeEvent.isComposing) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      picker.move(event.key === 'ArrowDown' ? 1 : -1);
      return true;
    }
    if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
      event.preventDefault();
      pick();
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      picker.dismiss();
      return true;
    }
    return false;
  };

  return {
    open: picker.open,
    options: picker.options,
    active: picker.active,
    pick,
    trackCaret: (field) => setCaret(field.selectionStart),
    handleKey,
  };
}
