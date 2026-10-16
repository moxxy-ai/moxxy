import type { QuestionAnswers, QuestionItem } from './question.js';

interface ItemDraft {
  readonly selected: ReadonlyArray<string>;
  readonly other: string;
}

/**
 * An answer being put together on a surface (the desktop card, the TUI, a chat
 * bot's buttons): what the person has picked and typed so far, by question id.
 */
export type QuestionDraft = Readonly<Record<string, ItemDraft>>;

export function emptyDraft(questions: ReadonlyArray<QuestionItem>): QuestionDraft {
  return Object.fromEntries(questions.map((item) => [item.id, { selected: [], other: '' }]));
}

/** Pick an option: the one answer where one fits, a toggle where several do. */
export function chooseOption(draft: QuestionDraft, item: QuestionItem, optionId: string): QuestionDraft {
  const current = itemDraft(draft, item);
  if (!item.multiSelect) return { ...draft, [item.id]: { selected: [optionId], other: '' } };
  const selected = current.selected.includes(optionId)
    ? current.selected.filter((id) => id !== optionId)
    : [...current.selected, optionId];
  return { ...draft, [item.id]: { ...current, selected } };
}

/** Type an answer of the person's own; where one answer fits, it replaces the choice. */
export function typeOwnAnswer(draft: QuestionDraft, item: QuestionItem, other: string): QuestionDraft {
  const current = itemDraft(draft, item);
  const selected = !item.multiSelect && other.trim() !== '' ? [] : current.selected;
  return { ...draft, [item.id]: { selected, other } };
}

/** The draft as the answer the session takes. */
export function draftAnswers(draft: QuestionDraft): QuestionAnswers {
  return Object.fromEntries(
    Object.entries(draft).map(([id, item]) => {
      const other = item.other.trim();
      return [id, other === '' ? { selected: item.selected } : { selected: item.selected, other }];
    }),
  );
}

function itemDraft(draft: QuestionDraft, item: QuestionItem): ItemDraft {
  return draft[item.id] ?? { selected: [], other: '' };
}
