import {
  chooseOption,
  draftAnswers,
  emptyDraft,
  questionAnswersProblem,
  typeOwnAnswer,
  type OpenQuestion,
  type QuestionAnswers,
  type QuestionDraft,
  type QuestionItem,
} from '@moxxy/sdk';
import { sanitizeEntry } from '../components/ApprovalDialog.js';

/**
 * Answering a Question in the terminal, as a pure step function the dialog
 * feeds keys to: one question at a time, ↑↓ over the suggested answers (and a
 * row for one of your own), Space to toggle where several fit, Enter to answer
 * and go on. After the last question the whole answer goes out together.
 */
export interface QuestionFlow {
  readonly questionId: string;
  readonly step: number;
  readonly cursor: number;
  readonly draft: QuestionDraft;
  /** The own answer being typed, or null when the cursor is on the rows. */
  readonly typing: string | null;
}

export type FlowKey =
  | { readonly kind: 'up' | 'down' | 'space' | 'enter' | 'escape' | 'backspace' }
  | { readonly kind: 'text'; readonly text: string };

export interface QuestionRow {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

export const OWN_ANSWER_ROW = '__own__';

export function questionRows(item: QuestionItem): ReadonlyArray<QuestionRow> {
  const rows: QuestionRow[] = item.options.map((option) => ({
    id: option.id,
    label: option.label,
    ...(option.description ? { description: option.description } : {}),
  }));
  if (item.allowOther) rows.push({ id: OWN_ANSWER_ROW, label: 'Write my own answer' });
  return rows;
}

export function startFlow(question: OpenQuestion): QuestionFlow {
  return { questionId: question.questionId, step: 0, cursor: 0, draft: emptyDraft(question.questions), typing: null };
}

/** Why the answer cannot go out yet, or null once it fits every question. */
export function flowProblem(flow: QuestionFlow, question: OpenQuestion): string | null {
  return questionAnswersProblem(question.questions, draftAnswers(flow.draft));
}

export function flowKey(
  flow: QuestionFlow,
  question: OpenQuestion,
  key: FlowKey,
): { readonly flow: QuestionFlow; readonly answers?: QuestionAnswers } {
  const item = question.questions[flow.step];
  if (!item) return { flow };
  return flow.typing === null ? onRows(flow, question, item, key) : onTyping(flow, question, item, flow.typing, key);
}

function onRows(
  flow: QuestionFlow,
  question: OpenQuestion,
  item: QuestionItem,
  key: FlowKey,
): { readonly flow: QuestionFlow; readonly answers?: QuestionAnswers } {
  const rows = questionRows(item);
  const row = rows[flow.cursor];
  switch (key.kind) {
    case 'up':
      return { flow: { ...flow, cursor: (flow.cursor - 1 + rows.length) % rows.length } };
    case 'down':
      return { flow: { ...flow, cursor: (flow.cursor + 1) % rows.length } };
    case 'space':
      if (!item.multiSelect || !row || row.id === OWN_ANSWER_ROW) return { flow };
      return { flow: { ...flow, draft: chooseOption(flow.draft, item, row.id) } };
    case 'escape':
      return { flow: flow.step > 0 ? { ...flow, step: flow.step - 1, cursor: 0 } : flow };
    case 'enter': {
      if (!row) return { flow };
      if (row.id === OWN_ANSWER_ROW) return { flow: { ...flow, typing: ownAnswer(flow, item) } };
      const picked = flow.draft[item.id];
      const pickedNone = !picked || (picked.selected.length === 0 && picked.other.trim() === '');
      const draft = !item.multiSelect || pickedNone ? chooseOption(flow.draft, item, row.id) : flow.draft;
      return advance({ ...flow, draft }, question);
    }
    default:
      return { flow };
  }
}

function onTyping(
  flow: QuestionFlow,
  question: OpenQuestion,
  item: QuestionItem,
  typing: string,
  key: FlowKey,
): { readonly flow: QuestionFlow; readonly answers?: QuestionAnswers } {
  switch (key.kind) {
    case 'text':
      return { flow: { ...flow, typing: typing + sanitizeEntry(key.text) } };
    case 'backspace':
      return { flow: { ...flow, typing: typing.slice(0, -1) } };
    case 'escape':
      return { flow: { ...flow, typing: null } };
    case 'enter':
      if (typing.trim() === '') return { flow };
      return advance({ ...flow, typing: null, draft: typeOwnAnswer(flow.draft, item, typing) }, question);
    default:
      return { flow };
  }
}

/** On to the next question; after the last, send, or go back to the first one still unanswered. */
function advance(
  flow: QuestionFlow,
  question: OpenQuestion,
): { readonly flow: QuestionFlow; readonly answers?: QuestionAnswers } {
  if (flow.step < question.questions.length - 1) return { flow: { ...flow, step: flow.step + 1, cursor: 0 } };
  const answers = draftAnswers(flow.draft);
  if (questionAnswersProblem(question.questions, answers) === null) return { flow, answers };
  const unanswered = question.questions.findIndex((item) => {
    const answer = answers[item.id];
    return !answer || (answer.selected.length === 0 && answer.other === undefined);
  });
  return { flow: { ...flow, step: unanswered >= 0 ? unanswered : flow.step, cursor: 0 } };
}

function ownAnswer(flow: QuestionFlow, item: QuestionItem): string {
  const current = flow.draft[item.id];
  return current ? current.other : '';
}
