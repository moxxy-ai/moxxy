import type { OpenQuestion, QuestionDraft } from '@moxxy/sdk';

export interface QuestionCardItem {
  readonly id: string;
  readonly header: string | null;
  readonly question: string;
  readonly hint: string | null;
  readonly options: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly description: string | null;
    readonly chosen: boolean;
  }>;
  /** The answer of the person's own typed so far. */
  readonly own: string;
  readonly takesOwn: boolean;
}

export interface QuestionCardView {
  readonly title: string;
  readonly items: ReadonlyArray<QuestionCardItem>;
}

/** What the phone's Question card shows for an open question and the answer being put together. */
export function questionCardView(question: OpenQuestion, draft: QuestionDraft): QuestionCardView {
  const count = question.questions.length;
  return {
    title: count > 1 ? `${count} questions` : 'Question',
    items: question.questions.map((item) => {
      const picked = draft[item.id];
      return {
        id: item.id,
        header: item.header ?? null,
        question: item.question,
        hint: item.multiSelect ? 'Choose any' : null,
        options: item.options.map((option) => ({
          id: option.id,
          label: option.label,
          description: option.description ?? null,
          chosen: picked ? picked.selected.includes(option.id) : false,
        })),
        own: picked ? picked.other : '',
        takesOwn: item.allowOther,
      };
    }),
  };
}
